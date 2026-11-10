// supabase/functions/_shared/handlers/engagementScore.ts
//
// Student Engagement Score. Not a standalone edge function (deployment limit): `get-mastery-history` routes to this
// handler by its `action` field (see _shared/mergedRouter.ts).
//
//   eng_me            student: own score + history.                       Body: { force? }
//   eng_student       staff:   one student's score + history.             Body: { student_id }
//   eng_class         staff:   one class's roster with scores + summary.  Body: { class_id }
//   eng_overview      staff:   teacher -> their classes; admin/principal/hod/school_admin -> their whole school.
//   eng_settings_get  staff:   effective configuration for the caller's school.
//   eng_settings_save school staff (admin/principal/hod/school_admin): save weights / period / thresholds.
//
// How a score is produced (pure rules in _shared/engagementModel.ts - no AI):
//   * Real activity is read from the tables APAS already has (learning_events, homework/worksheet submissions,
//     generated_assessment_paper_attempts, virtual_classroom_attendance, classroom_posts, marketplace video listings).
//     Nothing is tracked twice.
//   * Scores are stored in engagement_scores (latest) + engagement_score_history (one snapshot per day).
//   * Recalculation is lazy and cheap: DB triggers only mark a student "dirty" (engagement_recalc_queue); the next
//     read recalculates that student at most once per cool-down. Bursts of events cost one recalculation.
//   * A source that is missing in this database (table or column) is skipped and reported in `sources_unavailable`;
//     the score is then computed from the remaining activities instead of failing or guessing.
//
// Access: students -> themself. Staff -> studentAccess.ts rules (own school; teachers only classes they teach).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, canStaffAccessStudent, canStaffAccessClass, studentIdForProfile } from "../studentAccess.ts";
import {
  ACTIVITY_KEYS, CATEGORY_LABEL, DEFAULT_CONFIG, categoryFor, compareScores, computeEngagement, factsAsOf, improvementTips,
  missingActivities, normClass, normSection, sanitizeConfig,
  type ActivityKey, type ActivityResult, type EngagementConfig, type EngagementFacts, type EngagementResult,
} from "../engagementModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = Record<string, any>;
const DAY = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHOOL_ROLES = ["admin", "principal", "hod", "school_admin"];
const COOLDOWN_MS = 5 * 60_000;        // a burst of activity triggers one recalculation, not one per event
const MAX_AGE_MS = 12 * 3_600_000;     // even without activity, refresh twice a day (the window moves, deadlines pass)
const MAX_RECALC_PER_REQUEST = 60;     // bounds the work one request can trigger; the rest converge on later reads
const GATHER_CHUNK = 30;

class Deny extends Error { constructor(public status: number, message: string) { super(message); } }

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const uniq = <T,>(a: T[]): T[] => [...new Set(a)];

async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>, max = 20000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T, missing: string[]): Promise<T> {
  try { return await fn(); } catch (e: any) {
    console.error(`engagement: source "${label}" unavailable:`, e?.message ?? e);
    if (!missing.includes(label)) missing.push(label);
    return fallback;
  }
}

/** Stable short hash of the configuration, to notice when settings changed and scores need recomputing. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Row).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Row)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
function configHash(cfg: EngagementConfig): string {
  const s = stableStringify(cfg); // recursive: nested weights must be part of the hash
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function loadConfig(admin: any, schoolId: string | null): Promise<EngagementConfig> {
  if (!schoolId) return DEFAULT_CONFIG;
  const { data, error } = await admin.from("engagement_settings").select("config").eq("school_id", schoolId).maybeSingle();
  if (error) { console.error("engagement settings unavailable:", error.message); return DEFAULT_CONFIG; }
  return sanitizeConfig(data?.config);
}

// ── students ─────────────────────────────────────────────────────────────────────────────────────

interface StudentCtx { id: string; profileId: string; schoolId: string | null; grade: string | null; name: string }

async function loadStudents(admin: any, ids: string[]): Promise<StudentCtx[]> {
  const students: Row[] = [];
  for (const c of chunk(ids, 100)) {
    const { data, error } = await admin.from("students").select("id, profile_id, grade").in("id", c);
    if (error) throw error;
    students.push(...(data ?? []));
  }
  const profiles = new Map<string, Row>();
  for (const c of chunk(uniq(students.map((s) => s.profile_id)), 100)) {
    const { data, error } = await admin.from("profiles").select("id, school_id, full_name").in("id", c);
    if (error) throw error;
    for (const p of data ?? []) profiles.set(p.id, p);
  }
  return students.map((s) => ({
    id: s.id, profileId: s.profile_id, grade: s.grade ?? null,
    schoolId: profiles.get(s.profile_id)?.school_id ?? null, name: profiles.get(s.profile_id)?.full_name ?? "Student",
  }));
}

// ── gather real activity ─────────────────────────────────────────────────────────────────────────

async function gatherFacts(admin: any, studs: StudentCtx[], cfg: EngagementConfig, nowMs: number) {
  const missing: string[] = [];
  const since = new Date(nowMs - (2 * cfg.window_days + 30) * DAY).toISOString(); // two periods + slack (for the comparison)
  const sinceDate = since.slice(0, 10);
  const nowIso = new Date(nowMs).toISOString();
  const ids = studs.map((s) => s.id);
  const profileIds = studs.map((s) => s.profileId);
  const schoolIds = uniq(studs.map((s) => s.schoolId).filter((x): x is string => !!x));

  // Class membership
  const memberships = await safe("classes", async () => (await Promise.all(chunk(ids, 100).map((c) =>
    pageAll((f, t) => admin.from("class_students").select("class_id, student_id").in("student_id", c).order("id").range(f, t))))).flat(), [] as Row[], missing);
  const classIds = uniq(memberships.map((m) => m.class_id));
  const classRows = new Map<string, Row>();
  await safe("classes", async () => {
    for (const c of chunk(classIds, 100)) {
      const { data, error } = await admin.from("classes").select("id, name, section").in("id", c);
      if (error) throw error;
      for (const r of data ?? []) classRows.set(r.id, r);
    }
  }, undefined, missing);
  const classesOf = new Map<string, string[]>();
  for (const m of memberships) classesOf.set(m.student_id, [...(classesOf.get(m.student_id) ?? []), m.class_id]);

  // Learning events: video progress + tutor messages (the existing telemetry stream)
  const events = await safe("learning_events", async () => (await Promise.all(chunk(ids, 50).map((c) =>
    pageAll((f, t) => admin.from("learning_events").select("id, student_id, event_type, source, ref_id, payload, occurred_at")
      .in("student_id", c).in("event_type", ["video_progress", "tutor_message"]).gte("occurred_at", since).order("id").range(f, t))))).flat(), [] as Row[], missing);

  // Videos available to each student: published videos of the student's own school for the student's class
  const listings = await safe("videos", async () => (await Promise.all(schoolIds.map((sid) =>
    pageAll((f, t) => admin.from("marketplace_listings").select("id, class_label, publisher_school_id, published_at, created_at")
      .eq("content_type", "video").eq("status", "published").eq("publisher_school_id", sid).order("id").range(f, t))))).flat(), [] as Row[], missing);

  // Live classes
  const sessions = await safe("live_class", async () => {
    const out: Row[] = [];
    for (const c of chunk(classIds, 100)) {
      const rows = await pageAll((f, t) => admin.from("virtual_classroom_sessions")
        .select("id, class_id, status, scheduled_start, scheduled_end, recurrence_end_date").in("class_id", c).lte("scheduled_start", nowIso).order("scheduled_start").range(f, t));
      out.push(...rows);
    }
    return out.filter((s) => (s.recurrence_end_date ?? s.scheduled_end).slice(0, 10) >= sinceDate);
  }, [] as Row[], missing);
  const attendance = await safe("live_class", async () => (await Promise.all(chunk(ids, 50).map((c) =>
    pageAll((f, t) => admin.from("virtual_classroom_attendance").select("session_id, student_id, session_date, attendance_status")
      .in("student_id", c).gte("session_date", sinceDate).order("session_date").range(f, t))))).flat(), [] as Row[], missing);

  // Quizzes: an assessment paper is "assigned" to a student when an attempt row exists for them
  const attempts = await safe("quizzes", async () => (await Promise.all(chunk(ids, 50).map((c) =>
    pageAll((f, t) => admin.from("generated_assessment_paper_attempts").select("assignment_id, student_id, status, submitted_at, created_at")
      .in("student_id", c).gte("created_at", since).order("created_at").range(f, t))))).flat(), [] as Row[], missing);
  const paperAssignments = new Map<string, Row>();
  await safe("quizzes", async () => {
    for (const c of chunk(uniq(attempts.map((a) => a.assignment_id)), 100)) {
      const { data, error } = await admin.from("generated_assessment_paper_assignments").select("id, due_at, opens_at, created_at").in("id", c);
      if (error) throw error;
      for (const r of data ?? []) paperAssignments.set(r.id, r);
    }
  }, undefined, missing);

  // Homework (matched to a class by class + section, from that class's teachers) and worksheets
  const teacherRows = await safe("homework", async () => {
    const out: Row[] = [];
    for (const c of chunk(classIds, 100)) {
      const { data, error } = await admin.from("class_teachers").select("class_id, teacher_id").in("class_id", c);
      if (error) throw error;
      out.push(...(data ?? []));
    }
    return out;
  }, [] as Row[], missing);
  const homework = await safe("homework", async () => {
    const out: Row[] = [];
    for (const c of chunk(uniq(teacherRows.map((t) => t.teacher_id)), 50)) {
      out.push(...await pageAll((f, t) => admin.from("homework_assignments").select("id, class_level, section, assigned_by, created_at")
        .in("assigned_by", c).gte("created_at", since).order("id").range(f, t)));
    }
    return out;
  }, [] as Row[], missing);
  const hwSubs = await safe("homework", async () => (await Promise.all(chunk(profileIds, 50).map((c) =>
    pageAll((f, t) => admin.from("homework_submissions").select("assignment_id, student_id, submitted_at")
      .in("student_id", c).gte("submitted_at", since).order("id").range(f, t))))).flat(), [] as Row[], missing);
  const worksheets = await safe("worksheets", async () => (await Promise.all(schoolIds.map((sid) =>
    pageAll((f, t) => admin.from("worksheet_assignments").select("id, class_level, section, assigned_at, due_date, status")
      .eq("school_id", sid).gte("assigned_at", since).order("id").range(f, t))))).flat(), [] as Row[], missing);
  const wsSubs = await safe("worksheets", async () => (await Promise.all(chunk(profileIds, 50).map((c) =>
    pageAll((f, t) => admin.from("worksheet_submissions").select("assignment_id, student_id, submitted_at, status")
      .in("student_id", c).gte("created_at", since).order("id").range(f, t))))).flat(), [] as Row[], missing);

  // Doubts: questions posted in the digital classroom (the AI-tutor doubts come from learning_events above)
  const posts = await safe("classroom_questions", async () => (await Promise.all(chunk(profileIds, 50).map((c) =>
    pageAll((f, t) => admin.from("classroom_posts").select("author_id, kind, created_at")
      .in("author_id", c).eq("kind", "question").gte("created_at", since).order("created_at").range(f, t))))).flat(), [] as Row[], missing);

  // ── per-student facts ──
  const group = <T extends Row>(rows: T[], key: string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r[key], [...(m.get(r[key]) ?? []), r]);
    return m;
  };
  const eventsBy = group(events, "student_id");
  const attendanceBy = group(attendance, "student_id");
  const attemptsBy = group(attempts, "student_id");
  const hwSubBy = group(hwSubs, "student_id");
  const wsSubBy = group(wsSubs, "student_id");
  const postsBy = group(posts, "author_id");
  const sessionsByClass = group(sessions, "class_id");
  const hwByTeacher = group(homework, "assigned_by");
  const teachersOfClass = group(teacherRows, "class_id");

  const facts = new Map<string, EngagementFacts>();
  for (const s of studs) {
    const myClassIds = classesOf.get(s.id) ?? [];
    const myClasses = myClassIds.map((id) => classRows.get(id)).filter(Boolean) as Row[];
    const classKeys = uniq([...myClasses.map((c) => normClass(c.name)), ...(s.grade ? [normClass(s.grade)] : [])].filter(Boolean));
    const sameClass = (level: unknown, section: unknown) => myClasses.some((c) =>
      normClass(c.name) === normClass(level) && (!section || normSection(section) === normSection(c.section)));

    const myEvents = eventsBy.get(s.id) ?? [];
    const videoEvents = myEvents.filter((e) => e.event_type === "video_progress").map((e) => ({
      ref_id: e.ref_id ?? e.payload?.resource_id, watched_seconds: Number(e.payload?.watched_seconds), video_duration: Number(e.payload?.video_duration), at: e.occurred_at,
    })).filter((e) => e.ref_id);
    const myListings = listings.filter((l) => l.publisher_school_id === s.schoolId && l.class_label && classKeys.includes(normClass(l.class_label)));
    const availableAt: Record<string, string> = {};
    for (const l of myListings) availableAt[l.id] = l.published_at ?? l.created_at;

    const hwIds = uniq(myClassIds.flatMap((cid) => (teachersOfClass.get(cid) ?? []).map((t) => t.teacher_id)))
      .flatMap((tid) => hwByTeacher.get(tid) ?? []).filter((h) => sameClass(h.class_level, h.section));
    const hwSubMap = new Map((hwSubBy.get(s.profileId) ?? []).map((x) => [x.assignment_id, x.submitted_at]));
    const wsSubMap = new Map((wsSubBy.get(s.profileId) ?? []).filter((x) => x.submitted_at && x.status !== "draft").map((x) => [x.assignment_id, x.submitted_at]));

    facts.set(s.id, {
      videos: { availableIds: myListings.map((l) => l.id), availableAt, events: videoEvents },
      quizzes: (attemptsBy.get(s.id) ?? []).map((a) => {
        const p = paperAssignments.get(a.assignment_id);
        return p ? { id: a.assignment_id, opens_at: p.opens_at ?? null, due_at: p.due_at ?? null, created_at: p.created_at, status: a.status ?? null, submitted_at: a.submitted_at ?? null } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x),
      assignments: [
        ...uniq(hwIds.map((h) => h.id)).map((id) => {
          const h = hwIds.find((x) => x.id === id)!;
          return { kind: "homework" as const, id, assigned_at: h.created_at, due_at: null, submitted_at: hwSubMap.get(id) ?? null };
        }),
        ...worksheets.filter((w) => sameClass(w.class_level, w.section) && w.status !== "draft").map((w) => ({
          kind: "worksheet" as const, id: w.id, assigned_at: w.assigned_at, due_at: w.due_date ?? null, submitted_at: wsSubMap.get(w.id) ?? null,
        })),
      ],
      liveSessions: myClassIds.flatMap((cid) => sessionsByClass.get(cid) ?? []).map((x) => ({
        id: x.id, status: x.status ?? null, scheduled_start: x.scheduled_start, scheduled_end: x.scheduled_end, recurrence_end_date: x.recurrence_end_date ?? null,
      })),
      liveAttendance: (attendanceBy.get(s.id) ?? []).map((a) => ({ session_id: a.session_id, session_date: a.session_date, attendance_status: a.attendance_status })),
      interactions: [
        ...myEvents.filter((e) => e.event_type === "tutor_message" && e.source !== "career")
          .map((e) => ({ at: e.occurred_at, kind: "tutor" as const, chars: Number(e.payload?.chars) || 0 })),
        ...(postsBy.get(s.profileId) ?? []).map((p) => ({ at: p.created_at, kind: "classroom_question" as const, chars: null })),
      ],
    });
  }
  return { facts, missing };
}

// ── compute & persist ────────────────────────────────────────────────────────────────────────────

interface Computed { studentId: string; schoolId: string | null; result: EngagementResult; previous: EngagementResult }

async function recompute(admin: any, studs: StudentCtx[], cfg: EngagementConfig, nowMs: number): Promise<{ done: Computed[]; missing: string[] }> {
  const done: Computed[] = [];
  const missing: string[] = [];
  const hash = configHash(cfg);
  const nowIso = new Date(nowMs).toISOString();
  const prevEnd = nowMs - cfg.window_days * DAY;

  for (const group of chunk(studs, GATHER_CHUNK)) {
    const { facts, missing: m } = await gatherFacts(admin, group, cfg, nowMs);
    for (const x of m) if (!missing.includes(x)) missing.push(x);
    const rows: Row[] = [];
    const hist: Row[] = [];
    for (const s of group) {
      const f = facts.get(s.id)!;
      const result = computeEngagement(f, nowMs, cfg);
      const previous = computeEngagement(factsAsOf(f, prevEnd), prevEnd, cfg);
      done.push({ studentId: s.id, schoolId: s.schoolId, result, previous });
      rows.push({
        student_id: s.id, school_id: s.schoolId, window_days: cfg.window_days,
        period_start: new Date(nowMs - cfg.window_days * DAY).toISOString(), period_end: nowIso,
        status: result.status, score: result.score, category: result.category, opportunities: result.opportunities,
        breakdown: { activities: result.activities }, previous_score: previous.score, config_hash: hash, computed_at: nowIso,
      });
      hist.push({
        student_id: s.id, school_id: s.schoolId, snapshot_date: nowIso.slice(0, 10), window_days: cfg.window_days,
        status: result.status, score: result.score, category: result.category, breakdown: { activities: result.activities }, computed_at: nowIso,
      });
    }
    const a = await admin.from("engagement_scores").upsert(rows, { onConflict: "student_id" });
    if (a.error) throw a.error;
    const b = await admin.from("engagement_score_history").upsert(hist, { onConflict: "student_id,snapshot_date" });
    if (b.error) throw b.error;
    // Clear only the markers that predate this calculation: activity that arrives meanwhile stays queued.
    await admin.from("engagement_recalc_queue").delete().in("student_id", group.map((s) => s.id)).lte("requested_at", nowIso);
  }
  return { done, missing };
}

/** Recalculate the students whose stored score is missing / outdated; returns how many were refreshed. */
async function ensureFresh(admin: any, studs: StudentCtx[], cfg: EngagementConfig, opts: { force?: boolean; budget?: number } = {}) {
  if (!studs.length) return { refreshed: 0, stale: 0, missing: [] as string[] };
  const nowMs = Date.now();
  const hash = configHash(cfg);
  const ids = studs.map((s) => s.id);
  const stored = new Map<string, Row>(), queued = new Map<string, number>();
  for (const c of chunk(ids, 100)) {
    const [sc, q] = await Promise.all([
      admin.from("engagement_scores").select("student_id, computed_at, config_hash").in("student_id", c),
      admin.from("engagement_recalc_queue").select("student_id, requested_at").in("student_id", c),
    ]);
    if (sc.error) throw sc.error;
    for (const r of sc.data ?? []) stored.set(r.student_id, r);
    for (const r of q.data ?? []) queued.set(r.student_id, Date.parse(r.requested_at));
  }
  const stale = studs.filter((s) => {
    const row = stored.get(s.id);
    if (!row) return true;
    if (opts.force || row.config_hash !== hash) return true;
    const age = nowMs - Date.parse(row.computed_at);
    if (age > MAX_AGE_MS) return true;
    return (queued.get(s.id) ?? 0) > Date.parse(row.computed_at) && age >= COOLDOWN_MS;
  });
  const todo = stale.slice(0, opts.budget ?? MAX_RECALC_PER_REQUEST);
  const { missing } = todo.length ? await recompute(admin, todo, cfg, nowMs) : { missing: [] as string[] };
  return { refreshed: todo.length, stale: stale.length - todo.length, missing };
}

// ── shaping responses ────────────────────────────────────────────────────────────────────────────

function present(row: Row, cfg: EngagementConfig) {
  const activities = (row.breakdown?.activities ?? {}) as Record<ActivityKey, ActivityResult>;
  const result: EngagementResult = { status: row.status, score: row.score === null ? null : Number(row.score), category: row.category, opportunities: row.opportunities ?? 0, activities };
  const prev = row.previous_score === null || row.previous_score === undefined ? null : Number(row.previous_score);
  const cmp = compareScores(result.score, prev, cfg.decline_threshold);
  const complete = ACTIVITY_KEYS.every((k) => activities[k]);
  return {
    student_id: row.student_id, status: row.status as "ok" | "insufficient", score: result.score, category: row.category as string | null,
    category_label: row.category ? CATEGORY_LABEL[row.category as keyof typeof CATEGORY_LABEL] : null,
    opportunities: result.opportunities, activities: complete ? activities : null,
    previous_score: prev, delta: cmp.delta, trend: cmp.trend, declining: cmp.declining,
    period_start: row.period_start, period_end: row.period_end, window_days: row.window_days, computed_at: row.computed_at,
    tips: complete && result.status === "ok" ? improvementTips(result) : [],
    not_participating: complete && result.status === "ok" ? missingActivities(result) : [],
  };
}

async function loadScores(admin: any, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (const c of chunk(ids, 100)) {
    const { data, error } = await admin.from("engagement_scores").select("*").in("student_id", c);
    if (error) throw error;
    for (const r of data ?? []) out.set(r.student_id, r);
  }
  return out;
}

async function loadHistory(admin: any, studentId: string, days = 120) {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const { data, error } = await admin.from("engagement_score_history").select("snapshot_date, score, status, category")
    .eq("student_id", studentId).gte("snapshot_date", since).order("snapshot_date");
  if (error) throw error;
  return (data ?? []).map((h: Row) => ({ date: h.snapshot_date, score: h.score === null ? null : Number(h.score), status: h.status, category: h.category }));
}

function summarise(items: ReturnType<typeof present>[]) {
  const scored = items.filter((i) => i.status === "ok" && i.score !== null);
  const category_counts: Record<string, number> = { highly_engaged: 0, moderately_engaged: 0, low: 0, very_low: 0 };
  for (const i of scored) if (i.category) category_counts[i.category]++;
  const avg = scored.length ? Math.round((scored.reduce((s, i) => s + (i.score as number), 0) / scored.length) * 10) / 10 : null;
  const activity_averages: Record<string, number | null> = {};
  const activity_gaps: Record<string, number> = {};
  for (const k of ACTIVITY_KEYS) {
    const withIt = scored.filter((i) => i.activities?.[k]?.available);
    activity_averages[k] = withIt.length ? Math.round((withIt.reduce((s, i) => s + (i.activities![k].score ?? 0), 0) / withIt.length) * 10) / 10 : null;
    activity_gaps[k] = scored.filter((i) => i.not_participating.includes(k)).length;
  }
  return {
    students: items.length, scored: scored.length, insufficient: items.length - scored.length,
    average: avg, category: categoryFor(avg), category_counts, declining: scored.filter((i) => i.declining).length,
    activity_averages, activity_gaps,
  };
}

// ── actions ──────────────────────────────────────────────────────────────────────────────────────

async function schoolStudentIds(admin: any, schoolId: string): Promise<string[]> {
  const profs = await pageAll((f, t) => admin.from("profiles").select("id").eq("school_id", schoolId).eq("role", "student").order("id").range(f, t), 50000);
  const out: string[] = [];
  for (const c of chunk(profs.map((p) => p.id), 100)) {
    const { data, error } = await admin.from("students").select("id").in("profile_id", c);
    if (error) throw error;
    out.push(...(data ?? []).map((s: Row) => s.id));
  }
  return out;
}

export async function handleEngagementScore(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);
    const caller = await resolveCaller(admin, user.id);
    if (!caller) return json({ error: "Profile not found" }, 403);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const cfg = await loadConfig(admin, caller.schoolId);

    // ── a student's own score ──
    if (action === "me") {
      if (caller.role !== "student") return json({ error: "Students only" }, 403);
      const sid = await studentIdForProfile(admin, user.id);
      if (!sid) return json({ error: "No student record found for this account" }, 404);
      const studs = await loadStudents(admin, [sid]);
      const r = await ensureFresh(admin, studs, cfg, { force: body?.force === true });
      const row = (await loadScores(admin, [sid])).get(sid);
      return json({ config: { window_days: cfg.window_days, weights: cfg.weights }, score: row ? present(row, cfg) : null, history: await loadHistory(admin, sid), sources_unavailable: r.missing });
    }

    if (action !== "student" && action !== "class" && action !== "overview" && action !== "settings_get" && action !== "settings_save") {
      return json({ error: "Unknown action" }, 400);
    }
    if (!caller.isStaff) return json({ error: "Not permitted" }, 403);

    // ── settings ──
    if (action === "settings_get") return json({ config: cfg, defaults: DEFAULT_CONFIG, can_edit: SCHOOL_ROLES.includes(caller.role) && !!caller.schoolId });
    if (action === "settings_save") {
      if (!SCHOOL_ROLES.includes(caller.role) || !caller.schoolId) return json({ error: "Only school administrators can change the settings" }, 403);
      const next = sanitizeConfig(body?.config);
      const { error } = await admin.from("engagement_settings").upsert({ school_id: caller.schoolId, config: next, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "school_id" });
      if (error) throw error;
      return json({ config: next }); // scores refresh lazily: their stored config hash no longer matches
    }

    // ── one student (staff) ──
    if (action === "student") {
      const sid = String(body?.student_id ?? "");
      if (!UUID_RE.test(sid)) return json({ error: "student_id is required" }, 400);
      const access = await canStaffAccessStudent(admin, caller, sid);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      const studs = await loadStudents(admin, [sid]);
      const r = await ensureFresh(admin, studs, cfg, { force: body?.force === true });
      const row = (await loadScores(admin, [sid])).get(sid);
      return json({ student: { id: sid, name: studs[0]?.name }, config: { window_days: cfg.window_days, weights: cfg.weights }, score: row ? present(row, cfg) : null, history: await loadHistory(admin, sid), sources_unavailable: r.missing });
    }

    // ── one class ──
    if (action === "class") {
      const classId = String(body?.class_id ?? "");
      if (!UUID_RE.test(classId)) return json({ error: "class_id is required" }, 400);
      const access = await canStaffAccessClass(admin, caller, classId);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      const ids = access.studentIds ?? [];
      const studs = await loadStudents(admin, ids);
      const r = await ensureFresh(admin, studs, cfg, { force: body?.force === true });
      const scores = await loadScores(admin, ids);
      const items = studs.map((s) => ({ name: s.name, ...(scores.has(s.id) ? present(scores.get(s.id)!, cfg) : { student_id: s.id, status: "insufficient" as const, score: null, category: null, category_label: null, opportunities: 0, activities: null, previous_score: null, delta: null, trend: "unknown" as const, declining: false, period_start: null, period_end: null, window_days: cfg.window_days, computed_at: null, tips: [], not_participating: [] }) }));
      return json({ config: { window_days: cfg.window_days, weights: cfg.weights }, summary: summarise(items), students: items, pending_refresh: r.stale, trend: await classTrend(admin, ids), sources_unavailable: r.missing });
    }

    // ── overview: teacher -> their classes, school staff -> the whole school ──
    const isTeacher = caller.role === "teacher";
    if (!isTeacher && !caller.schoolId) return json({ error: "Your account is not linked to a school" }, 400);

    let classes: Row[] = [];
    let memberships: Row[] = [];
    if (isTeacher) {
      const { data, error } = await admin.from("class_teachers").select("classes(id, name, section)").eq("teacher_id", user.id);
      if (error) throw error;
      classes = [...new Map((data ?? []).filter((r: Row) => r.classes).map((r: Row) => [r.classes.id, r.classes])).values()];
      for (const c of chunk(classes.map((x) => x.id), 50)) {
        memberships.push(...await pageAll((f, t) => admin.from("class_students").select("class_id, student_id").in("class_id", c).order("id").range(f, t)));
      }
    }
    let studentIds: string[];
    if (isTeacher) studentIds = uniq(memberships.map((m) => m.student_id));
    else {
      studentIds = await schoolStudentIds(admin, caller.schoolId!);
      for (const c of chunk(studentIds, 100)) memberships.push(...await pageAll((f, t) => admin.from("class_students").select("class_id, student_id").in("student_id", c).order("id").range(f, t)));
      const cids = uniq(memberships.map((m) => m.class_id));
      for (const c of chunk(cids, 100)) { const { data } = await admin.from("classes").select("id, name, section").in("id", c); classes.push(...(data ?? [])); }
    }
    const studs = await loadStudents(admin, studentIds);
    // Never trust class membership alone for school isolation: keep only this school's students.
    const scoped = isTeacher ? studs : studs.filter((s) => s.schoolId === caller.schoolId);
    const r = await ensureFresh(admin, scoped, cfg, { budget: body?.force === true ? 120 : MAX_RECALC_PER_REQUEST, force: body?.force === true });
    const scores = await loadScores(admin, scoped.map((s) => s.id));
    const byId = new Map(scoped.map((s) => [s.id, s]));
    const itemOf = (sid: string) => ({ name: byId.get(sid)?.name ?? "Student", ...(scores.has(sid) ? present(scores.get(sid)!, cfg) : null) });
    const all = scoped.filter((s) => scores.has(s.id)).map((s) => itemOf(s.id) as ReturnType<typeof present> & { name: string });

    const classSummaries = classes.map((c) => {
      const members = uniq(memberships.filter((m) => m.class_id === c.id).map((m) => m.student_id)).filter((id) => byId.has(id));
      const items = members.filter((id) => scores.has(id)).map((id) => itemOf(id) as ReturnType<typeof present> & { name: string });
      return { class_id: c.id, name: c.name, section: c.section, roster: members.length, ...summarise(items) };
    }).sort((a, b) => `${a.name}${a.section}`.localeCompare(`${b.name}${b.section}`, undefined, { numeric: true }));

    const ranked = all.filter((i) => i.status === "ok" && i.score !== null).sort((a, b) => (b.score as number) - (a.score as number));
    const slim = (i: any) => ({ student_id: i.student_id, name: i.name, score: i.score, category: i.category, category_label: i.category_label, delta: i.delta, trend: i.trend });
    return json({
      scope: isTeacher ? "teacher" : "school",
      config: { window_days: cfg.window_days, weights: cfg.weights },
      summary: { ...summarise(all), roster: scoped.length, not_calculated: scoped.length - all.length },
      classes: classSummaries,
      most_engaged: ranked.slice(0, 5).map(slim),
      least_engaged: ranked.slice(-5).reverse().map(slim),
      declining: all.filter((i) => i.declining).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 20).map(slim),
      trend: await schoolTrend(admin, scoped.map((s) => s.id)),
      pending_refresh: r.stale, sources_unavailable: r.missing,
    });
  } catch (e: any) {
    if (e instanceof Deny) return json({ error: e.message }, e.status);
    console.error("engagement score error:", e?.message ?? e);
    return json({ error: "Could not load engagement scores" }, 500);
  }
}

/** Average score per day across a set of students (from the stored daily snapshots). */
async function trendFor(admin: any, ids: string[], days: number) {
  if (!ids.length) return [];
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const rows: Row[] = [];
  for (const c of chunk(ids, 100)) {
    rows.push(...await pageAll((f, t) => admin.from("engagement_score_history").select("student_id, snapshot_date, score")
      .in("student_id", c).eq("status", "ok").gte("snapshot_date", since).order("snapshot_date").range(f, t), 30000));
  }
  const byDay = new Map<string, number[]>();
  for (const r of rows) if (r.score !== null) byDay.set(r.snapshot_date, [...(byDay.get(r.snapshot_date) ?? []), Number(r.score)]);
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, average: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10, students: v.length }));
}
const classTrend = (admin: any, ids: string[]) => trendFor(admin, ids, 90);
const schoolTrend = (admin: any, ids: string[]) => trendFor(admin, ids, 120);
