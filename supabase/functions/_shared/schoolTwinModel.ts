// supabase/functions/_shared/schoolTwinModel.ts
//
// Pure logic (no imports, no I/O) behind two features that are served through the already-deployed
// `whatif-timetable` edge function (see _shared/mergedRouter.ts + CONSOLIDATION.md):
//
//   mode "twin_snapshot"       School Academic Digital Twin: one connected model of students, teachers,
//                              classes, timetable, syllabus coverage and performance.
//   mode "academic_simulation" What-If Academic Simulation: projected effect of extra classes, remedial
//                              periods or timetable changes on scores, risk bands, syllabus pace,
//                              teacher load and timetable feasibility.
//
// Everything here is deterministic and unit-tested (src/test/schoolTwinModel.test.ts). The data loading
// lives in schoolTwinData.ts; the auth + HTTP wrapping lives in handlers/.
//
// IMPORTANT - what the simulation is: a transparent, rule-based *estimate*, not a trained causal model.
// Every constant below is exposed in the response (`model.assumptions`) so a principal can see and
// challenge it. It starts from the same per-student predictions APAS already stores
// (student_predictions) and moves them using documented effect sizes.

// deno-lint-ignore-file no-explicit-any
export type Row = Record<string, any>;

export const MODEL_VERSION = "1.0";

// ── Constants (all surfaced in `assumptions`) ──────────────────────────────────────────────────────
/** Same bands predict-performance uses: >=70 low risk, 50-69 medium, <50 high. */
export const RISK_LOW_MIN = 70;
export const RISK_MEDIUM_MIN = 50;
/** Score points gained per e-fold (~2.7x) increase in regular instructional time. */
export const K_REGULAR = 8;
/** Points gained from the FIRST weekly remedial period for a student with 50 points of headroom. */
export const K_REMEDIAL = 3;
/** Each additional weekly remedial period is worth this fraction of the previous one. */
export const REMEDIAL_DECAY = 0.7;
/** Time constant (weeks) for effects to build up: realised share = 1 - exp(-weeks / RAMP_WEEKS). */
export const RAMP_WEEKS = 6;
/** Weekly periods assumed for a subject that has none on the timetable (or no timetable at all). */
export const REFERENCE_PERIODS = 5;
export const TEACHER_LOAD_WARN = 30;
export const TEACHER_LOAD_MAX = 36;
export const MAX_EXTRA_PERIODS = 10;
export const MIN_EXTRA_PERIODS = -5;
export const MAX_REMEDIAL_PERIODS = 6;
export const MAX_WEEKS = 40;

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────
export interface ClassRow { id: string; name: string; section: string }
export interface AssignmentRow { class_id: string; teacher_id: string; subject: string | null }
export interface TimetableInput { class_grade: string; section: string; parsed_grid: { headers: string[]; rows: string[][] } | null }
export interface PredictionRow {
  student_id: string; subject: string; predicted_score_next_test: number | null;
  risk_level: string | null; dropout_risk_percentage?: number | null; confidence_score?: number | null; updated_at?: string | null;
}
export interface LessonRow { teacher_id: string; class_level: string | null; subject: string | null; created_at: string | null }
export interface Agg { sum: number; n: number }

export interface SchoolData {
  schoolId: string;
  classes: ClassRow[];
  assignments: AssignmentRow[];
  teacherNames: Map<string, string>;
  /** class_id -> students.id[] (only for the classes in scope) */
  studentsByClass: Map<string, string[]>;
  studentNames: Map<string, string>;
  predictions: PredictionRow[];
  /** students.id -> sum/count of p_mastery over assessed objectives */
  mastery: Map<string, Agg>;
  masterySampled: boolean;
  /** students.id -> present-like / total attendance rows in the window */
  attendance: Map<string, Agg>;
  teacherAttendance: Map<string, Agg>;
  timetables: TimetableInput[];
  lessons: LessonRow[];
  /** `${class name lower}|${subject lower}` -> chapters in the school's books (same rule as Syllabus Coverage) */
  chaptersByKey: Map<string, number>;
  /** classes the caller may see (all for staff, assigned ones for a teacher) */
  scopeClassIds: Set<string>;
  windowDays: number;
  lessonWindowWeeks: number;
}

// ── Subject / class matching (identical rules to whatif-timetable so both read a timetable the same way) ──
const SYNONYMS: Record<string, string[]> = {
  mathematics: ["maths", "math", "mathematic"],
  "social studies": ["social", "social science", "ss", "sst"],
  "physical education": ["pt", "games", "sports", "phy edu", "pe"],
  english: ["eng"],
  telugu: ["tel"],
  hindi: ["hin"],
  science: ["sci", "general science", "gen science"],
  "computer science": ["computer", "cs", "it", "computers"],
};

export function normalize(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

const FUZZY_THRESHOLD = 0.55;

export function matchSubject(rawCell: string, candidates: string[]): { subject: string; confidence: number } | null {
  const cellNorm = normalize(rawCell);
  if (!cellNorm) return null;
  for (const candidate of candidates) {
    const candNorm = normalize(candidate);
    if (candNorm === cellNorm || (SYNONYMS[candNorm] || []).includes(cellNorm)) return { subject: candidate, confidence: 1 };
  }
  let best: { subject: string; confidence: number } | null = null;
  for (const candidate of candidates) {
    const score = similarity(cellNorm, normalize(candidate));
    if (score >= FUZZY_THRESHOLD && (!best || score > best.confidence)) best = { subject: candidate, confidence: score };
  }
  return best;
}

/** Folds spelling variants ("maths", "Math", "Mathematics") to one key. */
export function canonicalSubject(raw: string): string {
  const n = normalize(raw);
  for (const [canon, alts] of Object.entries(SYNONYMS)) if (n === canon || alts.includes(n)) return canon;
  return n;
}

export function sameSubject(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = canonicalSubject(a), cb = canonicalSubject(b);
  if (!ca || !cb) return false;
  return ca === cb || (ca.length >= 4 && cb.length >= 4 && (ca.includes(cb) || cb.includes(ca)));
}

export const normalizeClass = (c: string) => (c || "").toLowerCase().replace(/^class\s*/i, "").trim();
const classSectionKey = (name: string, section: string) => `${normalizeClass(name)}|${(section || "").trim().toUpperCase()}`;

/** Mirrors src/lib/subjectUtils.ts normalizeSubject() so syllabus numbers match the Syllabus Coverage page. */
const SUBJECT_ALIASES: Record<string, string> = {
  maths: "Mathematics", math: "Mathematics", mathematics: "Mathematics", science: "Science",
  social: "Social Studies", "social studies": "Social Studies", english: "English",
  "computer science": "Computer Science", computers: "Computer Science", hindi: "Hindi", telugu: "Telugu",
};
export function normalizeSubjectDisplay(raw: string): string {
  const trimmed = (raw || "").trim();
  const lower = trimmed.toLowerCase();
  if (SUBJECT_ALIASES[lower]) return SUBJECT_ALIASES[lower];
  return trimmed.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase());
}

export const chapterKey = (className: string, subject: string) =>
  `${(className || "").trim().toLowerCase()}|${normalizeSubjectDisplay(subject).toLowerCase()}`;

// ── Small numeric helpers ──────────────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round0 = (v: number) => Math.round(v);
function mean(xs: number[]): number | null { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
const pct = (a: Agg | undefined): number | null => (a && a.n > 0 ? (a.sum / a.n) * 100 : null);

export function riskBand(score: number): "low" | "medium" | "high" {
  return score >= RISK_LOW_MIN ? "low" : score >= RISK_MEDIUM_MIN ? "medium" : "high";
}
const RISK_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

// ── Timetable resolution ───────────────────────────────────────────────────────────────────────────
export interface ResolvedCell { classId: string; className: string; section: string; day: string; period: string; subject: string; teacherId: string }
export interface BlankSlot { classId: string; day: string; period: string }
export interface TimetableModel {
  cells: ResolvedCell[];
  blanks: BlankSlot[];
  unmatched: { classId: string; day: string; period: string; rawText: string }[];
  classesWithTimetable: Set<string>;
  /** `${day}|${period}|${teacherId}` for every taught slot in the school */
  busy: Set<string>;
  periodsByTeacher: Map<string, number>;
  periodsByClassSubject: Map<string, number>; // `${classId}|${canonicalSubject}`
  periodsByClass: Map<string, number>;
}

const NON_TEACHING = /\b(break|lunch|recess|interval|assembly|prayer|snacks?|registration|tiffin)\b/i;
const slotKey = (day: string, period: string, teacherId: string) => `${day.toLowerCase().trim()}|${period.toLowerCase().trim()}|${teacherId}`;

export function resolveTimetables(data: Pick<SchoolData, "classes" | "assignments" | "timetables">): TimetableModel {
  const classByKey = new Map<string, ClassRow>();
  data.classes.forEach((c) => classByKey.set(classSectionKey(c.name, c.section), c));
  const subjectsByClass = new Map<string, { subject: string; teacher_id: string }[]>();
  data.assignments.forEach((a) => {
    if (!a.subject) return;
    const list = subjectsByClass.get(a.class_id) ?? [];
    list.push({ subject: a.subject, teacher_id: a.teacher_id });
    subjectsByClass.set(a.class_id, list);
  });

  const m: TimetableModel = {
    cells: [], blanks: [], unmatched: [], classesWithTimetable: new Set(), busy: new Set(),
    periodsByTeacher: new Map(), periodsByClassSubject: new Map(), periodsByClass: new Map(),
  };

  for (const tt of data.timetables) {
    const cls = classByKey.get(classSectionKey(tt.class_grade, tt.section));
    const grid = tt.parsed_grid;
    if (!cls || !grid?.headers || !grid?.rows) continue;
    m.classesWithTimetable.add(cls.id);
    const candidates = subjectsByClass.get(cls.id) ?? [];
    const candidateSubjects = candidates.map((c) => c.subject);
    const dayColumns = grid.headers.slice(1);

    for (const row of grid.rows) {
      const period = String(row?.[0] ?? "");
      if (!period.trim() || NON_TEACHING.test(period)) continue;
      for (let i = 0; i < dayColumns.length; i++) {
        const rawText = row[i + 1];
        if (!rawText || !String(rawText).trim()) {
          m.blanks.push({ classId: cls.id, day: dayColumns[i], period });
          continue;
        }
        if (NON_TEACHING.test(String(rawText))) continue;
        const match = matchSubject(String(rawText), candidateSubjects);
        if (!match) { m.unmatched.push({ classId: cls.id, day: dayColumns[i], period, rawText: String(rawText) }); continue; }
        const teacher = candidates.find((c) => c.subject === match.subject);
        if (!teacher) continue;
        m.cells.push({
          classId: cls.id, className: cls.name, section: cls.section, day: dayColumns[i], period,
          subject: match.subject, teacherId: teacher.teacher_id,
        });
      }
    }
  }

  for (const c of m.cells) {
    m.busy.add(slotKey(c.day, c.period, c.teacherId));
    m.periodsByTeacher.set(c.teacherId, (m.periodsByTeacher.get(c.teacherId) ?? 0) + 1);
    const k = `${c.classId}|${canonicalSubject(c.subject)}`;
    m.periodsByClassSubject.set(k, (m.periodsByClassSubject.get(k) ?? 0) + 1);
    m.periodsByClass.set(c.classId, (m.periodsByClass.get(c.classId) ?? 0) + 1);
  }
  return m;
}

// ── Shared per-class derivations ───────────────────────────────────────────────────────────────────
function predictionsByStudent(preds: PredictionRow[]): Map<string, PredictionRow[]> {
  const out = new Map<string, PredictionRow[]>();
  for (const p of preds) {
    const l = out.get(p.student_id) ?? [];
    l.push(p);
    out.set(p.student_id, l);
  }
  return out;
}

function classAttendancePct(studentIds: string[], att: Map<string, Agg>): number | null {
  let present = 0, total = 0;
  for (const id of studentIds) { const a = att.get(id); if (a) { present += a.sum; total += a.n; } }
  return total > 0 ? (present / total) * 100 : null;
}

interface SyllabusInfo { covered: number; total: number; pct: number | null; lessons_per_week: number }

function syllabusFor(data: SchoolData, cls: ClassRow, subject: string, teacherId: string): SyllabusInfo {
  const total = data.chaptersByKey.get(chapterKey(cls.name, subject)) ?? 0;
  const wantClass = cls.name.trim().toLowerCase();
  const wantSubject = normalizeSubjectDisplay(subject).toLowerCase();
  const cutoff = Date.now() - data.lessonWindowWeeks * 7 * 86400000;
  let covered = 0, recent = 0;
  for (const l of data.lessons) {
    if (l.teacher_id !== teacherId) continue;
    if ((l.class_level ?? "").trim().toLowerCase() !== wantClass) continue;
    if ((l.subject ?? "").trim().toLowerCase() !== wantSubject) continue;
    covered++;
    if (l.created_at && new Date(l.created_at).getTime() >= cutoff) recent++;
  }
  return {
    covered, total,
    pct: total > 0 ? Math.min(100, round0((covered / total) * 100)) : null,
    lessons_per_week: recent / data.lessonWindowWeeks,
  };
}

const teacherName = (data: SchoolData, id: string) => data.teacherNames.get(id) ?? "Unknown Teacher";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 1. DIGITAL TWIN SNAPSHOT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface TwinSignal { severity: "critical" | "warning" | "info"; type: string; message: string; class_id?: string; teacher_id?: string; subject?: string }

export function buildTwinSnapshot(data: SchoolData, scope: "school" | "teacher", meta: { generatedAt?: string } = {}) {
  const tt = resolveTimetables(data);
  const predsByStudent = predictionsByStudent(data.predictions);
  const scopedClasses = data.classes.filter((c) => data.scopeClassIds.has(c.id));

  const students: Row[] = [];
  const classesOut: Row[] = [];
  const signals: TwinSignal[] = [];
  const subjectSyllabus = new Map<string, number[]>(); // canonical subject -> pct values, for cross-class comparison

  for (const cls of scopedClasses) {
    const ids = data.studentsByClass.get(cls.id) ?? [];
    const label = `${cls.name}-${cls.section}`;

    // student-level rows
    const classStudentRows: Row[] = [];
    for (const sid of ids) {
      const ps = predsByStudent.get(sid) ?? [];
      const scores = ps.map((p) => Number(p.predicted_score_next_test)).filter((n) => Number.isFinite(n));
      const worst = ps.reduce<string | null>((acc, p) => (p.risk_level && (!acc || RISK_RANK[p.risk_level] > RISK_RANK[acc]) ? p.risk_level : acc), null);
      const row = {
        id: sid, name: data.studentNames.get(sid) ?? "Student", class_id: cls.id,
        avg_predicted: mean(scores) === null ? null : round1(mean(scores)!),
        risk: worst, attendance_pct: pct(data.attendance.get(sid)) === null ? null : round0(pct(data.attendance.get(sid))!),
        mastery_pct: pct(data.mastery.get(sid)) === null ? null : round0(pct(data.mastery.get(sid))!),
        weakest_subject: ps.length ? ps.reduce((a, b) => (Number(b.predicted_score_next_test) < Number(a.predicted_score_next_test) ? b : a)).subject : null,
      };
      classStudentRows.push(row);
      students.push(row);
    }

    // subject-level rows (timetable x teacher x syllabus x performance)
    const seen = new Set<string>();
    const subjectRows: Row[] = [];
    for (const a of data.assignments.filter((x) => x.class_id === cls.id && x.subject)) {
      const dedupe = `${canonicalSubject(a.subject!)}|${a.teacher_id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const syl = syllabusFor(data, cls, a.subject!, a.teacher_id);
      const subjPreds = ids.flatMap((sid) => (predsByStudent.get(sid) ?? []).filter((p) => sameSubject(p.subject, a.subject)));
      const subjScores = subjPreds.map((p) => Number(p.predicted_score_next_test)).filter((n) => Number.isFinite(n));
      const weekly = tt.periodsByClassSubject.get(`${cls.id}|${canonicalSubject(a.subject!)}`) ?? 0;
      const risk = { high: 0, medium: 0, low: 0 } as Record<string, number>;
      subjPreds.forEach((p) => { if (p.risk_level && risk[p.risk_level] !== undefined) risk[p.risk_level]++; });
      if (syl.pct !== null) {
        const k = canonicalSubject(a.subject!);
        subjectSyllabus.set(k, [...(subjectSyllabus.get(k) ?? []), syl.pct]);
      }
      subjectRows.push({
        subject: a.subject, teacher_id: a.teacher_id, teacher_name: teacherName(data, a.teacher_id),
        weekly_periods: weekly, syllabus: { covered: syl.covered, total: syl.total, pct: syl.pct },
        avg_predicted: mean(subjScores) === null ? null : round1(mean(subjScores)!), students_with_data: subjScores.length, risk,
      });

      if (tt.classesWithTimetable.has(cls.id) && weekly === 0) {
        signals.push({ severity: "info", type: "not_on_timetable", class_id: cls.id, subject: a.subject!, teacher_id: a.teacher_id,
          message: `${label}: ${a.subject} is assigned to ${teacherName(data, a.teacher_id)} but doesn't appear on the class timetable.` });
      }
      const share = ids.length ? (risk.high / ids.length) * 100 : 0;
      if (risk.high >= 3 && share >= 30) {
        signals.push({ severity: "critical", type: "risk_concentration", class_id: cls.id, subject: a.subject!, teacher_id: a.teacher_id,
          message: `${label} ${a.subject}: ${risk.high} of ${ids.length} students (${round0(share)}%) are high-risk with ${weekly || "no"} periods/week — a candidate for remedial support.` });
      }
    }

    const perStudentPred = classStudentRows.map((r) => r.avg_predicted).filter((n): n is number => n !== null);
    const perStudentMastery = classStudentRows.map((r) => r.mastery_pct).filter((n): n is number => n !== null);
    const riskCounts = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    classStudentRows.forEach((r) => { if (r.risk && riskCounts[r.risk] !== undefined) riskCounts[r.risk]++; });
    const attPct = classAttendancePct(ids, data.attendance);
    const sylVals = subjectRows.map((s) => s.syllabus.pct).filter((n: number | null): n is number => n !== null);

    // health = weighted average of whatever components have data
    const comps: { key: string; w: number; v: number | null }[] = [
      { key: "performance", w: 0.35, v: mean(perStudentPred) ?? mean(perStudentMastery) },
      { key: "syllabus", w: 0.25, v: mean(sylVals) },
      { key: "attendance", w: 0.2, v: attPct },
      { key: "low_risk_share", w: 0.2, v: classStudentRows.filter((r) => r.risk).length ? 100 - (riskCounts.high / classStudentRows.filter((r) => r.risk).length) * 100 : null },
    ];
    const avail = comps.filter((c) => c.v !== null);
    const wSum = avail.reduce((a, c) => a + c.w, 0);
    const health = wSum > 0 ? round0(avail.reduce((a, c) => a + c.v! * c.w, 0) / wSum) : null;

    if (attPct !== null && attPct < 85) {
      signals.push({ severity: attPct < 75 ? "critical" : "warning", type: "attendance_dip", class_id: cls.id,
        message: `${label}: attendance is ${round0(attPct)}% over the last ${data.windowDays} days.` });
    }
    if (!tt.classesWithTimetable.has(cls.id)) {
      signals.push({ severity: "info", type: "no_timetable", class_id: cls.id, message: `${label} has no readable timetable, so periods and free slots can't be modelled.` });
    }

    classesOut.push({
      id: cls.id, name: cls.name, section: cls.section, student_count: ids.length,
      avg_predicted: mean(perStudentPred) === null ? null : round1(mean(perStudentPred)!),
      avg_mastery_pct: mean(perStudentMastery) === null ? null : round0(mean(perStudentMastery)!),
      risk: riskCounts, attendance_pct: attPct === null ? null : round0(attPct),
      syllabus_pct: mean(sylVals) === null ? null : round0(mean(sylVals)!),
      weekly_periods: tt.periodsByClass.get(cls.id) ?? 0,
      free_slots: tt.blanks.filter((b) => b.classId === cls.id).length,
      has_timetable: tt.classesWithTimetable.has(cls.id),
      health, health_label: health === null ? "no_data" : health >= 75 ? "healthy" : health >= 55 ? "watch" : "attention",
      subjects: subjectRows,
    });
  }

  // cross-class syllabus comparison (same subject, other sections)
  for (const c of classesOut) {
    for (const s of c.subjects as Row[]) {
      const peers = subjectSyllabus.get(canonicalSubject(s.subject));
      if (s.syllabus.pct === null || !peers || peers.length < 3) continue;
      const avg = mean(peers)!;
      if (avg - s.syllabus.pct >= 20) {
        signals.push({ severity: "warning", type: "syllabus_lag", class_id: c.id, subject: s.subject, teacher_id: s.teacher_id,
          message: `${c.name}-${c.section} ${s.subject}: syllabus coverage ${s.syllabus.pct}% is ${round0(avg - s.syllabus.pct)} points below the ${s.subject} average across classes (${round0(avg)}%).` });
      }
    }
  }

  // teachers
  const teacherIds = [...new Set(data.assignments.filter((a) => data.scopeClassIds.has(a.class_id)).map((a) => a.teacher_id))];
  const teachersOut: Row[] = teacherIds.map((tid) => {
    const rows = classesOut.flatMap((c) => (c.subjects as Row[]).filter((s) => s.teacher_id === tid).map((s) => ({ c, s })));
    const syl = rows.map((r) => r.s.syllabus.pct).filter((n: number | null): n is number => n !== null);
    const perf = rows.map((r) => r.s.avg_predicted).filter((n: number | null): n is number => n !== null);
    const load = tt.periodsByTeacher.get(tid) ?? 0;
    if (load > TEACHER_LOAD_WARN) {
      signals.push({ severity: load > TEACHER_LOAD_MAX ? "critical" : "warning", type: "teacher_overload", teacher_id: tid,
        message: `${teacherName(data, tid)} teaches ${load} periods/week (recommended max ${TEACHER_LOAD_WARN}).` });
    }
    const att = data.teacherAttendance.get(tid);
    return {
      id: tid, name: teacherName(data, tid), weekly_periods: load,
      load_status: load > TEACHER_LOAD_MAX ? "overloaded" : load > TEACHER_LOAD_WARN ? "high" : load === 0 ? "none" : "ok",
      assignments: rows.map((r) => ({ class_id: r.c.id, class: `${r.c.name}-${r.c.section}`, subject: r.s.subject, weekly_periods: r.s.weekly_periods })),
      syllabus_pct: mean(syl) === null ? null : round0(mean(syl)!),
      avg_student_predicted: mean(perf) === null ? null : round1(mean(perf)!),
      attendance_pct: att && att.n > 0 ? round0((att.sum / att.n) * 100) : null,
    };
  });

  // school-level summary (over the caller's scope)
  const allPred = students.map((s) => s.avg_predicted).filter((n): n is number => n !== null);
  const allMastery = students.map((s) => s.mastery_pct).filter((n): n is number => n !== null);
  const allSyl = classesOut.map((c) => c.syllabus_pct).filter((n): n is number => n !== null);
  const scopedStudentIds = students.map((s) => s.id);
  const studentAtt = classAttendancePct(scopedStudentIds, data.attendance);
  let tPresent = 0, tTotal = 0;
  teacherIds.forEach((t) => { const a = data.teacherAttendance.get(t); if (a) { tPresent += a.sum; tTotal += a.n; } });
  const risk = { high: 0, medium: 0, low: 0, unassessed: 0 } as Record<string, number>;
  students.forEach((s) => { if (s.risk && risk[s.risk] !== undefined) risk[s.risk]++; else risk.unassessed++; });
  const loads = teachersOut.map((t) => t.weekly_periods).filter((n) => n > 0);

  const lastPrediction = data.predictions.reduce<string | null>((acc, p) => (p.updated_at && (!acc || p.updated_at > acc) ? p.updated_at : acc), null);
  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  signals.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    model_version: MODEL_VERSION,
    generated_at: meta.generatedAt ?? new Date().toISOString(),
    school_id: data.schoolId,
    scope,
    window_days: data.windowDays,
    summary: {
      students: students.length, teachers: teachersOut.length, classes: classesOut.length,
      avg_predicted: mean(allPred) === null ? null : round1(mean(allPred)!),
      avg_mastery_pct: mean(allMastery) === null ? null : round0(mean(allMastery)!),
      avg_syllabus_pct: mean(allSyl) === null ? null : round0(mean(allSyl)!),
      student_attendance_pct: studentAtt === null ? null : round0(studentAtt),
      teacher_attendance_pct: tTotal > 0 ? round0((tPresent / tTotal) * 100) : null,
      risk,
      scheduled_periods_per_week: classesOut.reduce((a, c) => a + c.weekly_periods, 0),
      avg_teacher_load: mean(loads) === null ? null : round1(mean(loads)!),
      classes_with_timetable: classesOut.filter((c) => c.has_timetable).length,
    },
    classes: classesOut.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.section.localeCompare(b.section)),
    teachers: teachersOut.sort((a, b) => b.weekly_periods - a.weekly_periods),
    students: students.slice(0, 4000),
    students_truncated: students.length > 4000,
    signals: signals.slice(0, 40),
    data_quality: {
      students_without_predictions: students.filter((s) => s.avg_predicted === null).length,
      classes_without_timetable: classesOut.filter((c) => !c.has_timetable).length,
      class_subjects_without_syllabus: classesOut.reduce((a, c) => a + (c.subjects as Row[]).filter((s) => s.syllabus.total === 0).length, 0),
      unmatched_timetable_cells: tt.unmatched.filter((u) => data.scopeClassIds.has(u.classId)).length,
      mastery_sampled: data.masterySampled,
      last_prediction_at: lastPrediction,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 2. WHAT-IF ACADEMIC SIMULATION
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface ScenarioInput {
  label?: string;
  subject: string;
  /** Regular periods added to (or, if negative, removed from) the weekly timetable. */
  extra_periods?: number;
  /** Small-group remedial periods per week for targeted students. */
  remedial_periods?: number;
  remedial_target?: "at_risk" | "below_average" | "all";
  weeks?: number;
  /** Teacher who would deliver the added periods (defaults to the class's subject teacher). */
  teacher_id?: string;
}

export function listClassOptions(data: SchoolData) {
  const tt = resolveTimetables(data);
  return data.classes.filter((c) => data.scopeClassIds.has(c.id)).map((c) => {
    const subjects: Row[] = [];
    const seen = new Set<string>();
    for (const a of data.assignments.filter((x) => x.class_id === c.id && x.subject)) {
      const k = canonicalSubject(a.subject!);
      if (seen.has(k)) continue;
      seen.add(k);
      subjects.push({ subject: a.subject, teacher_id: a.teacher_id, teacher_name: teacherName(data, a.teacher_id), weekly_periods: tt.periodsByClassSubject.get(`${c.id}|${k}`) ?? 0 });
    }
    return { id: c.id, name: c.name, section: c.section, student_count: (data.studentsByClass.get(c.id) ?? []).length, has_timetable: tt.classesWithTimetable.has(c.id), subjects };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.section.localeCompare(b.section));
}

export function validateScenario(raw: Row): { ok: true; value: Required<Omit<ScenarioInput, "teacher_id" | "label">> & { teacher_id?: string; label?: string } } | { ok: false; error: string } {
  if (!raw || typeof raw.subject !== "string" || !raw.subject.trim()) return { ok: false, error: "Each scenario needs a subject" };
  const extra = raw.extra_periods === undefined ? 0 : Number(raw.extra_periods);
  const rem = raw.remedial_periods === undefined ? 0 : Number(raw.remedial_periods);
  const weeks = raw.weeks === undefined ? 8 : Number(raw.weeks);
  if (!Number.isInteger(extra) || extra < MIN_EXTRA_PERIODS || extra > MAX_EXTRA_PERIODS) return { ok: false, error: `extra_periods must be a whole number between ${MIN_EXTRA_PERIODS} and ${MAX_EXTRA_PERIODS}` };
  if (!Number.isInteger(rem) || rem < 0 || rem > MAX_REMEDIAL_PERIODS) return { ok: false, error: `remedial_periods must be a whole number between 0 and ${MAX_REMEDIAL_PERIODS}` };
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) return { ok: false, error: `weeks must be a whole number between 1 and ${MAX_WEEKS}` };
  const target = raw.remedial_target ?? "at_risk";
  if (!["at_risk", "below_average", "all"].includes(target)) return { ok: false, error: "remedial_target must be at_risk, below_average or all" };
  return { ok: true, value: {
    subject: raw.subject.trim(), extra_periods: extra, remedial_periods: rem, remedial_target: target, weeks,
    teacher_id: typeof raw.teacher_id === "string" && raw.teacher_id ? raw.teacher_id : undefined,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 60) : undefined,
  } };
}

function remedialEffectiveness(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.pow(REMEDIAL_DECAY, i);
  return total;
}

export function simulateScenarios(data: SchoolData, classId: string, scenarios: ReturnType<typeof validateScenario> extends infer R ? (R extends { ok: true; value: infer V } ? V[] : never) : never) {
  const cls = data.classes.find((c) => c.id === classId)!;
  const tt = resolveTimetables(data);
  const predsByStudent = predictionsByStudent(data.predictions);
  const ids = data.studentsByClass.get(classId) ?? [];
  const classAtt = classAttendancePct(ids, data.attendance);
  const defaultAtt = clamp((classAtt ?? 90) / 100, 0.5, 1);
  const classSubjects = data.assignments.filter((a) => a.class_id === classId && a.subject);

  const results = scenarios.map((sc, idx) => {
    const warnings: string[] = [];
    const assumptions: string[] = [];
    const assignment = classSubjects.find((a) => sameSubject(a.subject, sc.subject));
    if (!assignment) {
      return { label: sc.label ?? `Scenario ${idx + 1}`, scenario: sc, error: `${sc.subject} isn't assigned to ${cls.name}-${cls.section} in Class Management, so it can't be simulated.` };
    }
    const subject = assignment.subject!;
    const deliveringTeacher = sc.teacher_id ?? assignment.teacher_id;

    // ── timetable baseline ──
    const hasTimetable = tt.classesWithTimetable.has(classId);
    const baseRaw = tt.periodsByClassSubject.get(`${classId}|${canonicalSubject(subject)}`) ?? 0;
    const baseEff = baseRaw > 0 ? baseRaw : REFERENCE_PERIODS;
    if (baseRaw === 0) assumptions.push(`${subject} has no periods on the ${hasTimetable ? "class timetable" : "timetable (none uploaded)"}; ${REFERENCE_PERIODS} periods/week assumed as the baseline.`);
    const newEff = Math.max(0.5, baseEff + sc.extra_periods);
    if (baseRaw > 0 && baseRaw + sc.extra_periods < 0) warnings.push(`Removing ${-sc.extra_periods} periods would take ${subject} below zero periods/week.`);
    else if (baseRaw > 0 && baseRaw + sc.extra_periods === 0) warnings.push(`This removes ${subject} from the timetable entirely.`);

    // ── teacher load ──
    const loadBefore = tt.periodsByTeacher.get(deliveringTeacher) ?? 0;
    const added = Math.max(0, sc.extra_periods) + sc.remedial_periods;
    const freed = Math.max(0, -sc.extra_periods);
    // if a different teacher delivers, the class teacher's own regular periods are unchanged; removals always come off the class teacher
    const loadAfter = loadBefore + added - (deliveringTeacher === assignment.teacher_id ? freed : 0);
    const classTeacherLoadBefore = tt.periodsByTeacher.get(assignment.teacher_id) ?? 0;
    const classTeacherLoadAfter = deliveringTeacher === assignment.teacher_id ? loadAfter : Math.max(0, classTeacherLoadBefore - freed);
    const loadFactor = loadAfter > TEACHER_LOAD_MAX ? 0.8 : loadAfter > TEACHER_LOAD_WARN ? 0.9 : 1;
    if (added > 0 && loadAfter > TEACHER_LOAD_WARN) warnings.push(`${teacherName(data, deliveringTeacher)} would be teaching ${loadAfter} periods/week (recommended max ${TEACHER_LOAD_WARN}); effect is discounted by ${round0((1 - loadFactor) * 100)}%.`);

    // ── feasibility: slots free for BOTH the class and the delivering teacher ──
    const needed = added;
    const classBlanks = tt.blanks.filter((b) => b.classId === classId);
    const available = classBlanks.filter((b) => !tt.busy.has(slotKey(b.day, b.period, deliveringTeacher)));
    let feasibility: Row;
    if (!hasTimetable) {
      feasibility = { checked: false, slots_needed: needed, slots_available: null, slots_freed: freed, sample_slots: [], feasible: null, note: "No readable timetable for this class, so free slots can't be checked." };
    } else {
      const short = Math.max(0, needed - available.length);
      feasibility = {
        checked: true, slots_needed: needed, slots_available: available.length, slots_freed: freed,
        sample_slots: available.slice(0, 8).map((b) => ({ day: b.day, period: b.period })),
        feasible: needed === 0 ? true : short === 0,
        note: needed === 0 ? "No extra periods needed." : short === 0
          ? `${available.length} slot(s) are free for both the class and ${teacherName(data, deliveringTeacher)}.`
          : `Only ${available.length} slot(s) are free for both the class and ${teacherName(data, deliveringTeacher)}; ${short} more would need a zero period, after-school slot or a swap.`,
      };
      if (needed > 0 && short > 0) warnings.push(`Timetable can only absorb ${available.length} of the ${needed} added period(s) without a clash.`);
    }

    // ── student projections ──
    const ramp = 1 - Math.exp(-sc.weeks / RAMP_WEEKS);
    if (sc.weeks < 4 && (sc.extra_periods !== 0 || sc.remedial_periods !== 0)) warnings.push(`${sc.weeks} week(s) is short — only ${round0(ramp * 100)}% of the effect is expected to show up.`);
    const regBase = K_REGULAR * Math.log(newEff / baseEff);
    const remEff = remedialEffectiveness(sc.remedial_periods);

    type Base = { score: number; source: "subject" | "other_subjects"; conf: number };
    const baselines = new Map<string, Base>();
    for (const sid of ids) {
      const ps = predsByStudent.get(sid) ?? [];
      const match = ps.find((p) => sameSubject(p.subject, subject) && Number.isFinite(Number(p.predicted_score_next_test)));
      if (match) { baselines.set(sid, { score: Number(match.predicted_score_next_test), source: "subject", conf: Number(match.confidence_score ?? 0.5) }); continue; }
      const others = ps.map((p) => Number(p.predicted_score_next_test)).filter((n) => Number.isFinite(n));
      if (others.length) baselines.set(sid, { score: mean(others)!, source: "other_subjects", conf: 0.3 });
    }
    const noBaseline = ids.length - baselines.size;
    const classAvgBefore = mean([...baselines.values()].map((b) => b.score));
    if (baselines.size === 0) warnings.push("None of the students in this class have prediction data yet — run Predictions on School Intelligence first.");
    else if (noBaseline > 0) warnings.push(`${noBaseline} student(s) have no prediction data and are excluded from the projection.`);
    const estimated = [...baselines.values()].filter((b) => b.source === "other_subjects").length;
    if (estimated > 0) assumptions.push(`${estimated} student(s) have no ${subject} prediction; their average across other subjects is used as the baseline.`);

    const isTargeted = (sid: string, score: number): boolean => {
      if (sc.remedial_periods <= 0) return false;
      if (sc.remedial_target === "all") return true;
      if (sc.remedial_target === "below_average") return classAvgBefore !== null && score < classAvgBefore;
      const ps = predsByStudent.get(sid) ?? [];
      const r = ps.find((p) => sameSubject(p.subject, subject))?.risk_level ?? null;
      return score < 60 || r === "medium" || r === "high";
    };

    const rows: Row[] = [];
    const bandsBefore = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    const bandsAfter = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    let improved = 0, declined = 0, targetedCount = 0;
    for (const sid of ids) {
      const b = baselines.get(sid);
      if (!b) continue;
      const headroom = clamp((100 - b.score) / 50, 0.2, 1.5);
      const att = data.attendance.get(sid) && data.attendance.get(sid)!.n > 0 ? clamp(data.attendance.get(sid)!.sum / data.attendance.get(sid)!.n, 0.5, 1) : defaultAtt;
      const targeted = isTargeted(sid, b.score);
      if (targeted) targetedCount++;
      const reg = regBase >= 0 ? regBase * headroom : regBase;
      const rem = targeted ? K_REMEDIAL * remEff * headroom : 0;
      const gain = reg >= 0 ? (reg + rem) * att * loadFactor : reg + rem * att * loadFactor;
      const delta = gain * ramp;
      const after = clamp(b.score + delta, 0, 100);
      const bb = riskBand(b.score), ba = riskBand(after);
      bandsBefore[bb]++; bandsAfter[ba]++;
      if (RISK_RANK[ba] < RISK_RANK[bb]) improved++;
      if (RISK_RANK[ba] > RISK_RANK[bb]) declined++;
      rows.push({ student_id: sid, name: data.studentNames.get(sid) ?? "Student", before: round1(b.score), after: round1(after), delta: round1(after - b.score), targeted, attendance_pct: round0(att * 100), baseline_source: b.source });
    }
    if (sc.remedial_periods > 0 && targetedCount === 0 && baselines.size > 0) warnings.push("No students match the remedial target, so remedial periods add nothing.");
    if (sc.extra_periods === 0 && sc.remedial_periods === 0) warnings.push("No change entered — the projection equals the baseline.");

    const avgAfter = mean(rows.map((r) => r.after));
    const avgGain = avgAfter !== null && classAvgBefore !== null ? avgAfter - classAvgBefore : null;
    const conf = mean([...baselines.values()].map((b) => b.conf)) ?? 0;
    const coverage = ids.length ? baselines.size / ids.length : 0;
    const spread = clamp(0.35 + 0.35 * (1 - conf) + 0.3 * (1 - coverage), 0.3, 0.9);
    const confidenceLabel = baselines.size === 0 ? "none" : coverage >= 0.8 && conf >= 0.6 ? "medium" : "low";

    // ── syllabus pace ──
    const syl = syllabusFor(data, cls, subject, assignment.teacher_id);
    let syllabus: Row;
    if (syl.total === 0) {
      syllabus = { available: false, note: "No chapters found for this class/subject in the school's books, so syllabus pace can't be projected." };
    } else {
      const rate = syl.lessons_per_week;
      const scaled = rate * (newEff / baseEff);
      const project = (r: number) => Math.min(syl.total, syl.covered + r * sc.weeks);
      const remaining = Math.max(0, syl.total - syl.covered);
      syllabus = {
        available: true, covered: syl.covered, total: syl.total, current_pct: syl.pct,
        lessons_per_week_now: round1(rate), lessons_per_week_after: round1(scaled),
        projected_pct_without_change: rate > 0 ? round0((project(rate) / syl.total) * 100) : null,
        projected_pct_with_change: rate > 0 ? round0((project(scaled) / syl.total) * 100) : null,
        weeks_to_finish_now: rate > 0 && remaining > 0 ? round1(remaining / rate) : remaining === 0 ? 0 : null,
        weeks_to_finish_after: scaled > 0 && remaining > 0 ? round1(remaining / scaled) : remaining === 0 ? 0 : null,
        note: rate > 0 ? undefined : `No lessons logged in the last ${data.lessonWindowWeeks} weeks, so the current pace is unknown.`,
      };
      if (rate === 0) assumptions.push(`Syllabus pace needs recent lesson activity; none was logged in the last ${data.lessonWindowWeeks} weeks.`);
    }

    return {
      label: sc.label ?? `Scenario ${idx + 1}`,
      scenario: { ...sc, subject, teacher_id: deliveringTeacher },
      timetable: { weekly_periods_now: baseRaw, weekly_periods_after: Math.max(0, baseRaw + sc.extra_periods), remedial_periods: sc.remedial_periods },
      projected: {
        students_evaluated: baselines.size, students_without_baseline: noBaseline, students_targeted: targetedCount,
        avg_before: classAvgBefore === null ? null : round1(classAvgBefore), avg_after: avgAfter === null ? null : round1(avgAfter),
        avg_gain: avgGain === null ? null : round1(avgGain),
        gain_low: avgGain === null ? null : round1(avgGain * (1 - spread)), gain_high: avgGain === null ? null : round1(avgGain * (1 + spread)),
        confidence: confidenceLabel,
      },
      risk: { before: bandsBefore, after: bandsAfter, improved, declined },
      syllabus,
      teacher_load: { teacher_id: deliveringTeacher, teacher_name: teacherName(data, deliveringTeacher), before: loadBefore, after: loadAfter,
        class_teacher_before: classTeacherLoadBefore, class_teacher_after: classTeacherLoadAfter,
        status: loadAfter > TEACHER_LOAD_MAX ? "overloaded" : loadAfter > TEACHER_LOAD_WARN ? "high" : "ok" },
      feasibility,
      students: rows.sort((a, b) => b.delta - a.delta).slice(0, 60),
      warnings, assumptions,
    };
  });

  return {
    class: {
      id: cls.id, name: cls.name, section: cls.section, student_count: ids.length,
      attendance_pct: classAtt === null ? null : round0(classAtt), has_timetable: tt.classesWithTimetable.has(classId),
    },
    results,
    model: {
      version: MODEL_VERSION,
      kind: "rule-based estimate",
      disclaimer: "Indicative projection from APAS's own predictions and documented effect sizes — not a guarantee. Use it to compare options, not to forecast an exact score.",
      assumptions: [
        `Baseline = each student's stored predicted score for the subject (student_predictions). Risk bands use the predict-performance thresholds: ≥${RISK_LOW_MIN} low, ${RISK_MEDIUM_MIN}-${RISK_LOW_MIN - 1} medium, <${RISK_MEDIUM_MIN} high.`,
        `Extra/removed regular periods: ${K_REGULAR} points per e-fold change in weekly periods (e.g. +2 on ${REFERENCE_PERIODS} ≈ +${round1(K_REGULAR * Math.log((REFERENCE_PERIODS + 2) / REFERENCE_PERIODS))} pts), scaled up for students with more headroom.`,
        `Remedial periods: ${K_REMEDIAL} points for the first weekly period at 50 points of headroom; each further period is worth ${REMEDIAL_DECAY * 100}% of the previous one.`,
        `Effects build up over time: realised share = 1 − e^(−weeks/${RAMP_WEEKS}). Gains are scaled by each student's recent attendance and discounted if the delivering teacher goes above ${TEACHER_LOAD_WARN} periods/week.`,
        "Syllabus pace scales with weekly periods, from lessons logged in the last 8 weeks.",
        "Free slots are blank cells in the class timetable where the delivering teacher has no class.",
      ],
    },
  };
}
