// supabase/functions/_shared/ptmPrepModel.ts
//
// PARENT-TEACHER MEETING (PTM) PREP - pure model. No I/O, no Deno APIs, unit-tested in
// src/test/ptmPrepModel.test.ts. The handler (handlers/ptmPrep.ts) loads the data and calls this.
//
// Design:
//   1. buildSignals()  turns raw records into verifiable findings ("signals"), each with a stable id and a
//                      plain-English evidence line built from the numbers. This is deterministic.
//   2. buildFallbackPrep() writes a complete brief from the signals alone (used when AI is unavailable).
//   3. buildAiPrompt() / sanitiseAiPrep() let a model phrase the "how to raise it" guidance, but every
//      discussion point must cite real signal ids; the evidence shown to the teacher is ALWAYS taken from
//      the signals, never from model text, so a model cannot put a wrong number in front of a teacher.

// deno-lint-ignore-file no-explicit-any

export type Category = "agenda" | "academics" | "attendance" | "homework" | "behaviour" | "wellbeing" | "support" | "strengths";
export type Priority = "high" | "medium" | "low";
export type Polarity = "concern" | "strength" | "info";

export interface Signal {
  id: string;
  category: Category;
  polarity: Polarity;
  severity: 1 | 2 | 3;
  headline: string;
  evidence: string;
}

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────
export interface PtmInput {
  now: number; // epoch ms
  appointment: {
    reason_category: string | null;
    reason_note: string | null;
    requested_by: "parent" | "teacher" | string | null;
    meeting_mode: string | null;
    date: string | null;
  };
  previous_meetings: Array<{ date: string; reason_category: string | null; reason_note: string | null }>;
  attendance: Array<{ status: string; date: string }> | null;
  marks: Array<{ subject: string; obtained: number; max: number; at: string | null }> | null;
  practice_tests: Array<{ subject: string; score: number; total: number; at: string | null }> | null;
  homework: { assigned: number; submitted: number } | null;
  behaviour: Array<{ category: string; title: string; points: number; date: string | null; action_taken: string | null }> | null;
  notes: Array<{ type: string; note: string; date: string | null; follow_up_date: string | null; follow_up_completed: boolean }> | null;
  interventions: Array<{ reason: string; priority: string | null; tier: number | null; status: string; review_date: string | null; effectiveness: string | null; action_plan: string[] }> | null;
  mastery: {
    weak_topics: Array<{ topic: string; subject: string; mastery_pct: number }>;
    strong_topics: Array<{ topic: string; subject: string; mastery_pct: number }>;
    misconceptions: Array<{ misconception: string; topic: string; severity: string; times_seen: number }>;
    risk_signals: Array<{ signal: string; strength: string; detail: string }>;
  } | null;
  prediction: { risk_level: string; factors: string[] } | null;
  goals: Array<{ title: string; status: string; progress_percent: number | null; target_date: string | null }> | null;
}

// ── Outputs ─────────────────────────────────────────────────────────────────────────────────
export interface DiscussionPoint {
  title: string;
  category: Category;
  priority: Priority;
  evidence: string[];
  approach: string;
  signal_ids: string[];
}

export interface Snapshot {
  attendance_rate_pct: number | null;
  attendance_days_recorded: number;
  avg_marks_pct: number | null;
  subjects: Array<{ subject: string; pct: number; trend: "up" | "down" | "flat" | null }>;
  homework_completion_pct: number | null;
  behaviour: { positive: number; negative: number; net_points: number };
  active_interventions: number;
  risk_level: string | null;
  last_meeting: { date: string; reason: string | null } | null;
}

export interface PtmPrep {
  summary: string;
  agenda: { reason: string; note: string | null; raised_by: "parent" | "teacher" };
  discussion_points: DiscussionPoint[];
  questions_for_parent: string[];
  strengths: Array<{ title: string; evidence: string }>;
  proposed_next_steps: string[];
  snapshot: Snapshot;
  data_gaps: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "x";
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ts = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
};
const priorityOf = (sev: number): Priority => (sev >= 3 ? "high" : sev === 2 ? "medium" : "low");
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const REASON_LABELS: Record<string, string> = {
  academic_concern: "Academic concern",
  behaviour_discussion: "Behaviour discussion",
  general_checkin: "General check-in",
  other: "Other",
};
export const reasonLabel = (r: string | null | undefined) => REASON_LABELS[r ?? ""] ?? (r ? clip(r.replace(/_/g, " "), 40) : "General check-in");

const TARGET_ATTENDANCE = 90; // mirrors APP_CONFIG.attendance.targetPercent

// ── Per-source summaries ────────────────────────────────────────────────────────────────────
export interface AttendanceSummary {
  counted: number; present: number; late: number; absent: number; excused: number;
  rate: number | null; recentRate: number | null; earlierRate: number | null;
}

export function summariseAttendance(rows: PtmInput["attendance"], now: number): AttendanceSummary {
  const out: AttendanceSummary = { counted: 0, present: 0, late: 0, absent: 0, excused: 0, rate: null, recentRate: null, earlierRate: null };
  if (!rows?.length) return out;
  const recent: number[] = [];
  const earlier: number[] = [];
  for (const r of rows) {
    const t = ts(r.date);
    if (t === null) continue;
    if (r.status === "excused") { out.excused++; continue; }
    const ok = r.status === "present" || r.status === "late";
    out.counted++;
    if (r.status === "present") out.present++;
    else if (r.status === "late") out.late++;
    else if (r.status === "absent") out.absent++;
    const age = now - t;
    if (age <= 30 * DAY) recent.push(ok ? 1 : 0);
    else earlier.push(ok ? 1 : 0);
  }
  if (out.counted > 0) out.rate = round1(((out.present + out.late) / out.counted) * 100);
  if (recent.length >= 5) out.recentRate = round1(mean(recent) * 100);
  if (earlier.length >= 5) out.earlierRate = round1(mean(earlier) * 100);
  return out;
}

export interface SubjectScore { subject: string; pct: number; n: number; latestPct: number | null; trend: "up" | "down" | "flat" | null; delta: number | null }

export function summariseMarks(rows: PtmInput["marks"]): { subjects: SubjectScore[]; overall: number | null } {
  if (!rows?.length) return { subjects: [], overall: null };
  const by = new Map<string, Array<{ obtained: number; max: number; at: number | null; idx: number }>>();
  rows.forEach((r, idx) => {
    if (!(r.max > 0) || !Number.isFinite(r.obtained)) return;
    const key = r.subject?.trim() || "General";
    const list = by.get(key) ?? [];
    list.push({ obtained: r.obtained, max: r.max, at: ts(r.at), idx });
    by.set(key, list);
  });
  const subjects: SubjectScore[] = [];
  let totalObt = 0, totalMax = 0;
  for (const [subject, list] of by) {
    // newest first; undated rows keep their given order, after dated ones
    list.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.idx - b.idx);
    const obt = list.reduce((s, x) => s + x.obtained, 0);
    const max = list.reduce((s, x) => s + x.max, 0);
    totalObt += obt; totalMax += max;
    const pcts = list.map((x) => (x.obtained / x.max) * 100);
    let trend: SubjectScore["trend"] = null;
    let delta: number | null = null;
    if (pcts.length >= 2) {
      delta = round1(pcts[0] - mean(pcts.slice(1)));
      trend = delta >= 8 ? "up" : delta <= -8 ? "down" : "flat";
    }
    subjects.push({ subject, pct: round((obt / max) * 100), n: list.length, latestPct: round(pcts[0]), trend, delta });
  }
  return { subjects: subjects.sort((a, b) => a.pct - b.pct), overall: totalMax > 0 ? round((totalObt / totalMax) * 100) : null };
}

// ── Signals ─────────────────────────────────────────────────────────────────────────────────
export function buildSignals(input: PtmInput): Signal[] {
  const out: Signal[] = [];
  const add = (s: Signal) => out.push(s);
  const now = input.now;

  // Attendance
  const att = summariseAttendance(input.attendance, now);
  if (att.counted >= 5 && att.rate !== null) {
    const base = `${att.rate}% over the last 90 days (${att.absent} absent, ${att.late} late, ${att.counted} days recorded)`;
    if (att.rate < 75) add({ id: "att_low", category: "attendance", polarity: "concern", severity: 3, headline: "Attendance is well below target", evidence: base });
    else if (att.rate < TARGET_ATTENDANCE) add({ id: "att_low", category: "attendance", polarity: "concern", severity: 2, headline: "Attendance is below the school target", evidence: `${base}; target is ${TARGET_ATTENDANCE}%` });
    else if (att.rate >= 95) add({ id: "att_good", category: "attendance", polarity: "strength", severity: 1, headline: "Excellent attendance", evidence: base });
    if (att.recentRate !== null && att.earlierRate !== null && att.earlierRate - att.recentRate >= 10) {
      add({ id: "att_trend", category: "attendance", polarity: "concern", severity: 2, headline: "Attendance has dropped recently", evidence: `${att.recentRate}% in the last 30 days vs ${att.earlierRate}% before that` });
    }
    if (att.late >= 5) add({ id: "att_late", category: "attendance", polarity: "concern", severity: 1, headline: "Frequent late arrivals", evidence: `${att.late} late arrivals in the last 90 days` });
  }

  // Marks
  const marks = summariseMarks(input.marks);
  for (const s of marks.subjects) {
    const id = `marks_${slug(s.subject)}`;
    if (s.pct < 40) add({ id, category: "academics", polarity: "concern", severity: 3, headline: `${s.subject}: marks are low`, evidence: `${s.subject} average ${s.pct}% across ${s.n} assessment${s.n === 1 ? "" : "s"}` });
    else if (s.pct < 60) add({ id, category: "academics", polarity: "concern", severity: 2, headline: `${s.subject}: marks need support`, evidence: `${s.subject} average ${s.pct}% across ${s.n} assessment${s.n === 1 ? "" : "s"}` });
    else if (s.pct >= 85) add({ id, category: "academics", polarity: "strength", severity: 1, headline: `Strong in ${s.subject}`, evidence: `${s.subject} average ${s.pct}% across ${s.n} assessment${s.n === 1 ? "" : "s"}` });
    if (s.trend === "down" && s.delta !== null) add({ id: `${id}_down`, category: "academics", polarity: "concern", severity: s.delta <= -15 ? 3 : 2, headline: `${s.subject}: latest result dropped`, evidence: `Latest ${s.subject} result ${s.latestPct}%, which is ${Math.abs(round(s.delta))} points below the earlier average` });
    if (s.trend === "up" && s.delta !== null) add({ id: `${id}_up`, category: "academics", polarity: "strength", severity: 1, headline: `${s.subject}: improving`, evidence: `Latest ${s.subject} result ${s.latestPct}%, which is ${round(s.delta)} points above the earlier average` });
  }

  // Practice tests (self-practice quizzes) - only a signal when there is enough to be meaningful
  if (input.practice_tests?.length) {
    const by = new Map<string, number[]>();
    for (const t of input.practice_tests) {
      if (!(t.total > 0)) continue;
      const key = t.subject || "General";
      const list = by.get(key) ?? [];
      list.push((t.score / t.total) * 100);
      by.set(key, list);
    }
    for (const [subject, pcts] of by) {
      if (pcts.length >= 3 && mean(pcts) < 50) {
        add({ id: `practice_${slug(subject)}`, category: "academics", polarity: "concern", severity: 1, headline: `${subject}: low scores on practice quizzes`, evidence: `${subject} practice quiz average ${round(mean(pcts))}% over ${pcts.length} attempts` });
      }
    }
  }

  // Homework
  if (input.homework && input.homework.assigned >= 3) {
    const rate = round((Math.min(input.homework.submitted, input.homework.assigned) / input.homework.assigned) * 100);
    const ev = `${Math.min(input.homework.submitted, input.homework.assigned)} of ${input.homework.assigned} homework tasks submitted in the last 60 days (${rate}%)`;
    if (rate < 50) add({ id: "hw_low", category: "homework", polarity: "concern", severity: 3, headline: "Many homework tasks are not being submitted", evidence: ev });
    else if (rate < 75) add({ id: "hw_low", category: "homework", polarity: "concern", severity: 2, headline: "Homework completion is inconsistent", evidence: ev });
    else if (rate >= 90) add({ id: "hw_good", category: "homework", polarity: "strength", severity: 1, headline: "Reliable with homework", evidence: ev });
  }

  // Behaviour records (last 90 days)
  if (input.behaviour?.length) {
    const recent = input.behaviour.filter((b) => { const t = ts(b.date); return t === null || now - t <= 90 * DAY; });
    const neg = recent.filter((b) => b.category === "negative");
    const pos = recent.filter((b) => b.category === "positive");
    if (neg.length >= 3) {
      const latest = [...neg].sort((a, b) => (ts(b.date) ?? 0) - (ts(a.date) ?? 0))[0];
      add({ id: "beh_neg", category: "behaviour", polarity: "concern", severity: neg.length >= 5 ? 3 : 2, headline: "Repeated behaviour incidents", evidence: `${neg.length} negative behaviour records in the last 90 days; most recent: "${clip(latest.title, 80)}"` });
    }
    if (pos.length >= 3 && neg.length <= 1) {
      add({ id: "beh_pos", category: "behaviour", polarity: "strength", severity: 1, headline: "Consistently positive conduct", evidence: `${pos.length} positive behaviour records in the last 90 days` });
    }
  }

  // Teacher's own notes
  if (input.notes?.length) {
    const concerns = input.notes.filter((n) => (n.type === "concern" || n.type === "incident") && (ts(n.date) === null || now - (ts(n.date) as number) <= 30 * DAY));
    const positives = input.notes.filter((n) => n.type === "positive" && (ts(n.date) === null || now - (ts(n.date) as number) <= 60 * DAY));
    if (concerns.length >= 2) add({ id: "note_concern", category: "behaviour", polarity: "concern", severity: 2, headline: "You have logged repeated concerns", evidence: `${concerns.length} concern/incident notes from you in the last 30 days` });
    if (positives.length >= 2) add({ id: "note_positive", category: "strengths", polarity: "strength", severity: 1, headline: "You have logged positive recognition", evidence: `${positives.length} positive notes from you in the last 60 days` });
    const open = input.notes.filter((n) => n.follow_up_date && !n.follow_up_completed);
    if (open.length) add({ id: "note_followup", category: "behaviour", polarity: "info", severity: 1, headline: "Open follow-up from your notes", evidence: `${open.length} follow-up${open.length === 1 ? "" : "s"} not yet closed${open[0].follow_up_date ? ` (earliest due ${open.map((o) => o.follow_up_date as string).sort()[0]})` : ""}` });
  }

  // Interventions
  if (input.interventions?.length) {
    const active = input.interventions.filter((i) => i.status === "active");
    active.slice(0, 3).forEach((i, idx) => {
      const sev: 1 | 2 | 3 = i.priority === "high" ? 3 : i.priority === "medium" ? 2 : 1;
      const plan = i.action_plan?.length ? `; plan: ${clip(i.action_plan.slice(0, 3).join(", "), 120)}` : "";
      add({ id: `intv_${idx}`, category: "support", polarity: "concern", severity: sev, headline: "An intervention is currently active", evidence: `${i.tier ? `Tier ${i.tier} ` : ""}${i.priority ?? ""} priority: ${clip(i.reason, 120)}${plan}${i.review_date ? `; review due ${i.review_date}` : ""}`.replace(/\s+/g, " ").trim() });
    });
    const done = input.interventions.filter((i) => i.status === "completed" && i.effectiveness);
    for (const i of done.slice(0, 2)) {
      if (i.effectiveness === "improved") add({ id: `intv_done_${slug(i.reason)}`, category: "support", polarity: "strength", severity: 1, headline: "A recent intervention worked", evidence: `Completed intervention ("${clip(i.reason, 80)}") shows improvement` });
      else if (i.effectiveness === "no_change" || i.effectiveness === "worsened") add({ id: `intv_done_${slug(i.reason)}`, category: "support", polarity: "concern", severity: 2, headline: "A recent intervention did not help", evidence: `Completed intervention ("${clip(i.reason, 80)}") showed ${i.effectiveness === "worsened" ? "a decline" : "no change"}` });
    }
  }

  // Concept mastery
  if (input.mastery) {
    const weak = input.mastery.weak_topics.filter((t) => t.mastery_pct < 50).slice(0, 3);
    if (weak.length) add({ id: "mastery_weak", category: "academics", polarity: "concern", severity: weak.some((t) => t.mastery_pct < 30) ? 3 : 2, headline: "Specific topics are not yet secure", evidence: weak.map((t) => `${t.topic} (${t.subject}) ${t.mastery_pct}%`).join("; ") });
    const strong = input.mastery.strong_topics.filter((t) => t.mastery_pct >= 80).slice(0, 3);
    if (strong.length) add({ id: "mastery_strong", category: "strengths", polarity: "strength", severity: 1, headline: "Topics the student has mastered", evidence: strong.map((t) => `${t.topic} (${t.subject}) ${t.mastery_pct}%`).join("; ") });
    const misc = input.mastery.misconceptions.slice(0, 2);
    if (misc.length) add({ id: "mastery_misc", category: "academics", polarity: "concern", severity: misc.some((m) => m.severity === "high") ? 3 : 2, headline: "Recurring misconceptions detected", evidence: misc.map((m) => `"${clip(m.misconception, 90)}" in ${m.topic} (seen ${m.times_seen}x)`).join("; ") });
    const strongRisk = input.mastery.risk_signals.filter((r) => r.strength === "strong").slice(0, 2);
    if (strongRisk.length) add({ id: "risk_signals", category: "wellbeing", polarity: "concern", severity: 3, headline: "Early-warning signals are strong", evidence: strongRisk.map((r) => clip(r.detail || r.signal, 120)).join("; ") });
  }

  // Predicted risk
  if (input.prediction && (input.prediction.risk_level === "high" || input.prediction.risk_level === "medium")) {
    const factors = input.prediction.factors.slice(0, 3).map((f) => clip(f, 80));
    add({ id: "pred_risk", category: "wellbeing", polarity: "concern", severity: input.prediction.risk_level === "high" ? 3 : 2, headline: `Predicted academic risk is ${input.prediction.risk_level}`, evidence: factors.length ? `Contributing factors: ${factors.join("; ")}` : `The performance prediction model rates risk as ${input.prediction.risk_level}` });
  }

  // Goals
  if (input.goals?.length) {
    const achieved = input.goals.filter((g) => g.status === "achieved");
    if (achieved.length) add({ id: "goal_achieved", category: "strengths", polarity: "strength", severity: 1, headline: "Goals achieved", evidence: achieved.slice(0, 2).map((g) => `"${clip(g.title, 70)}"`).join("; ") });
    const missed = input.goals.filter((g) => g.status === "missed");
    if (missed.length) add({ id: "goal_missed", category: "academics", polarity: "info", severity: 1, headline: "A personal goal was missed", evidence: missed.slice(0, 2).map((g) => `"${clip(g.title, 70)}"`).join("; ") });
    const inProg = input.goals.filter((g) => g.status === "in_progress");
    if (inProg.length) add({ id: "goal_progress", category: "strengths", polarity: "info", severity: 1, headline: "Goals in progress", evidence: inProg.slice(0, 2).map((g) => `"${clip(g.title, 60)}" ${g.progress_percent ?? 0}%`).join("; ") });
  }

  // Last meeting
  if (input.previous_meetings.length) {
    const m = input.previous_meetings[0];
    add({ id: "prev_meeting", category: "agenda", polarity: "info", severity: 1, headline: "You have met before", evidence: `Last meeting on ${m.date} (${reasonLabel(m.reason_category)}${m.reason_note ? `: "${clip(m.reason_note, 100)}"` : ""}). Follow up on what was agreed.` });
  }

  // De-duplicate ids defensively (e.g. two subjects that slug identically)
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export function buildSnapshot(input: PtmInput): Snapshot {
  const att = summariseAttendance(input.attendance, input.now);
  const marks = summariseMarks(input.marks);
  const recentBeh = (input.behaviour ?? []).filter((b) => { const t = ts(b.date); return t === null || input.now - t <= 90 * DAY; });
  const hw = input.homework && input.homework.assigned >= 3
    ? round((Math.min(input.homework.submitted, input.homework.assigned) / input.homework.assigned) * 100) : null;
  const m = input.previous_meetings[0];
  return {
    attendance_rate_pct: att.counted >= 5 ? att.rate : null,
    attendance_days_recorded: att.counted,
    avg_marks_pct: marks.overall,
    subjects: marks.subjects.map((s) => ({ subject: s.subject, pct: s.pct, trend: s.trend })),
    homework_completion_pct: hw,
    behaviour: {
      positive: recentBeh.filter((b) => b.category === "positive").length,
      negative: recentBeh.filter((b) => b.category === "negative").length,
      net_points: recentBeh.reduce((s, b) => s + (Number.isFinite(b.points) ? b.points : 0), 0),
    },
    active_interventions: (input.interventions ?? []).filter((i) => i.status === "active").length,
    risk_level: input.prediction?.risk_level ?? null,
    last_meeting: m ? { date: m.date, reason: m.reason_category ? reasonLabel(m.reason_category) : null } : null,
  };
}

export function buildDataGaps(input: PtmInput): string[] {
  const gaps: string[] = [];
  const att = summariseAttendance(input.attendance, input.now);
  if (att.counted < 5) gaps.push("Attendance: fewer than 5 records in the last 90 days, so no attendance conclusions were drawn.");
  if (!input.marks?.length) gaps.push("Marks: no exam marks are recorded for this student.");
  if (!input.homework || input.homework.assigned < 3) gaps.push("Homework: fewer than 3 assignments in the last 60 days, so completion was not assessed.");
  if (!input.mastery) gaps.push("Concept mastery: no topic-level mastery data is available.");
  return gaps;
}

// ── Fallback brief (no AI) ──────────────────────────────────────────────────────────────────
const APPROACH: Record<Category, string> = {
  agenda: "This was the reason for the meeting, so address it first and ask the parent what they have noticed before sharing your view.",
  academics: "Show the specific subjects or topics from the data, ask what the parent sees during study time at home, and agree one small, measurable target for the next assessment.",
  attendance: "Share the pattern calmly, ask whether anything at home or on the journey to school is affecting attendance, and agree how absences will be communicated.",
  homework: "Ask how homework is organised at home and what gets in the way, then propose a simple routine (a fixed time and place) that you will both reinforce.",
  behaviour: "Describe specific observed behaviours rather than labels, ask whether the parent sees similar patterns, and agree one consistent response at home and at school.",
  wellbeing: "Raise this gently and with curiosity: ask how the child has seemed lately, listen first, and agree who will check in with the child and when.",
  support: "Explain what support is already in place and why, ask for the parent's observations of how it is going, and agree what the parent can reinforce at home.",
  strengths: "Open with specific, genuine praise; it builds trust before harder topics.",
};

const QUESTIONS: Partial<Record<Category, string[]>> = {
  attendance: ["Has anything changed at home or on the way to school that could be affecting attendance?"],
  academics: ["How does your child approach studying at home, and what do they say about this subject?"],
  homework: ["When and where does your child usually do homework, and what makes it hard to finish?"],
  behaviour: ["Do you see similar behaviour at home, and what seems to trigger it?"],
  wellbeing: ["How has your child seemed in terms of mood, sleep and enthusiasm lately?"],
  support: ["What have you noticed at home since the extra support started?"],
};

const NEXT_STEPS: Partial<Record<Category, string>> = {
  attendance: "Agree an attendance target and how absences will be reported to you.",
  academics: "Set one measurable goal for the next assessment and a date to review it.",
  homework: "Agree a fixed homework routine at home and a weekly check-in on submissions.",
  behaviour: "Agree one consistent response to the behaviour at home and at school, and review in two weeks.",
  wellbeing: "Plan a short check-in with the child and agree who will follow up with the parent.",
  support: "Confirm how the current intervention will be reviewed and what the parent will reinforce at home.",
};

const agendaOf = (input: PtmInput): PtmPrep["agenda"] => ({
  reason: reasonLabel(input.appointment.reason_category),
  note: input.appointment.reason_note ? clip(input.appointment.reason_note, 400) : null,
  raised_by: input.appointment.requested_by === "teacher" ? "teacher" : "parent",
});

function agendaPoint(input: PtmInput): DiscussionPoint | null {
  const a = agendaOf(input);
  if (!a.note && (!input.appointment.reason_category || input.appointment.reason_category === "general_checkin" || input.appointment.reason_category === "other")) return null;
  return {
    title: a.raised_by === "parent" ? `The parent's reason for meeting: ${a.reason}` : `Your reason for requesting the meeting: ${a.reason}`,
    category: "agenda",
    priority: "high",
    evidence: a.note ? [`${a.raised_by === "parent" ? "Parent" : "Your"} note: "${a.note}"`] : [`Reason selected: ${a.reason}`],
    approach: APPROACH.agenda,
    signal_ids: [],
  };
}

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => b.severity - a.severity);
}

export function buildFallbackPrep(input: PtmInput, signals: Signal[]): PtmPrep {
  const concerns = sortSignals(signals.filter((s) => s.polarity === "concern"));
  const strengths = signals.filter((s) => s.polarity === "strength").slice(0, 4).map((s) => ({ title: s.headline, evidence: s.evidence }));

  // One point per category (strongest concern wins), so the list stays short and non-repetitive.
  const byCat = new Map<Category, Signal[]>();
  for (const c of concerns) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  const points: DiscussionPoint[] = [];
  const ag = agendaPoint(input);
  if (ag) points.push(ag);
  for (const [cat, list] of byCat) {
    const top = list[0];
    points.push({
      title: list.length > 1 ? `${top.headline} (+${list.length - 1} related)` : top.headline,
      category: cat,
      priority: priorityOf(top.severity),
      evidence: list.slice(0, 3).map((s) => s.evidence),
      approach: APPROACH[cat],
      signal_ids: list.map((s) => s.id),
    });
  }
  points.sort((a, b) => (a.category === "agenda" ? -1 : b.category === "agenda" ? 1 : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));

  const cats = [...byCat.keys()];
  const questions = [...new Set(cats.flatMap((c) => QUESTIONS[c] ?? []))].slice(0, 5);
  const steps = [...new Set(cats.map((c) => NEXT_STEPS[c]).filter((s): s is string => !!s))].slice(0, 4);
  if (!steps.length) steps.push("Agree one positive goal for the coming month and a date for a short follow-up.");
  if (!questions.length) questions.push("What are you most pleased with, and what worries you, about your child's progress?");

  const topConcerns = concerns.slice(0, 2).map((c) => c.headline.toLowerCase());
  const summary = concerns.length
    ? `${concerns.length} area${concerns.length === 1 ? "" : "s"} to discuss, mainly: ${topConcerns.join("; ")}. ${strengths.length ? `${strengths.length} strength${strengths.length === 1 ? "" : "s"} to open with.` : ""}`.trim()
    : strengths.length
      ? `No major concerns in the available data. ${strengths.length} strength${strengths.length === 1 ? "" : "s"} to celebrate with the parent.`
      : "There is little recorded data for this student, so this meeting is a good chance to listen and gather the parent's view.";

  return {
    summary,
    agenda: agendaOf(input),
    discussion_points: points.slice(0, 6),
    questions_for_parent: questions,
    strengths,
    proposed_next_steps: steps,
    snapshot: buildSnapshot(input),
    data_gaps: buildDataGaps(input),
  };
}

// ── AI prompt + sanitiser ───────────────────────────────────────────────────────────────────
export const AI_SYSTEM_PROMPT = [
  "You help a school teacher prepare for a parent-teacher meeting. Output ONLY valid JSON, no markdown.",
  "RULES:",
  "- Use ONLY the facts in CONTEXT. Never invent scores, dates, incidents, diagnoses or causes.",
  "- Each discussion point must cite one or more signal ids from CONTEXT.signals in `signal_ids`. Do not restate numbers; the app shows the evidence itself.",
  "- The student appears as the token STU_01. Refer to them only as STU_01.",
  "- Be constructive and non-judgemental: describe patterns, never label the child or blame the parent. Do not diagnose medical, psychological or learning conditions.",
  "- Plan to open with strengths, then concerns, then agree next steps. If CONTEXT.agenda has a note, the first point must address it (category \"agenda\", signal_ids may be empty).",
  "- `approach` is 1-2 sentences of practical wording or a question the teacher can use. No filler.",
  "Return exactly this shape:",
  '{"summary": string (max 2 sentences), "discussion_points": [{"title": string, "category": "agenda"|"academics"|"attendance"|"homework"|"behaviour"|"wellbeing"|"support", "priority": "high"|"medium"|"low", "approach": string, "signal_ids": string[]}] (max 5), "questions_for_parent": string[] (max 4), "proposed_next_steps": string[] (max 4)}',
].join("\n");

export function buildAiUserPrompt(input: PtmInput, signals: Signal[], scrub: (t: string) => string): string {
  const ctx = {
    agenda: {
      reason: reasonLabel(input.appointment.reason_category),
      raised_by: input.appointment.requested_by === "teacher" ? "teacher" : "parent",
      note: input.appointment.reason_note ? scrub(clip(input.appointment.reason_note, 400)) : null,
    },
    meeting_mode: input.appointment.meeting_mode,
    signals: sortSignals(signals).slice(0, 14).map((s) => ({
      id: s.id, category: s.category, kind: s.polarity, headline: scrub(s.headline), evidence: scrub(s.evidence),
    })),
  };
  return `CONTEXT (JSON): ${JSON.stringify(ctx)}`;
}

const CATEGORIES: Category[] = ["agenda", "academics", "attendance", "homework", "behaviour", "wellbeing", "support", "strengths"];

/** Parses model text into JSON, tolerating code fences. Returns null if it cannot. */
export function parseAiJson(text: string): any | null {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* ignore */ } }
  return null;
}

/**
 * Merges model output onto the deterministic brief. Returns null when the model gave nothing usable, so the
 * caller keeps the fallback. Points that cite no known signal (and are not the parent's agenda) are dropped.
 */
export function sanitiseAiPrep(raw: any, input: PtmInput, signals: Signal[], fallback: PtmPrep, restore: (t: string) => string = (t) => t): PtmPrep | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.discussion_points)) return null;
  const known = new Map(signals.map((s) => [s.id, s]));
  const str = (v: unknown, n: number) => restore(clip(v, n));

  const points: DiscussionPoint[] = [];
  const agenda = agendaPoint(input);
  for (const p of raw.discussion_points.slice(0, 8)) {
    if (!p || typeof p !== "object") continue;
    const title = str(p.title, 120);
    const approach = str(p.approach, 400);
    if (!title || !approach) continue;
    const category: Category = CATEGORIES.includes(p.category) && p.category !== "strengths" ? p.category : "academics";
    const ids: string[] = (Array.isArray(p.signal_ids) ? p.signal_ids : []).filter((id: unknown): id is string => typeof id === "string" && known.has(id));
    const isAgenda = category === "agenda";
    if (!ids.length && !isAgenda) continue; // ungrounded: drop
    if (isAgenda && !agenda) continue; // model invented an agenda that does not exist
    const evidence = isAgenda && !ids.length ? agenda!.evidence : [...new Set(ids.map((id) => known.get(id)!.evidence))].slice(0, 3);
    const sev = ids.length ? Math.max(...ids.map((id) => known.get(id)!.severity)) : 3;
    const priority: Priority = ["high", "medium", "low"].includes(p.priority) ? p.priority : priorityOf(sev);
    points.push({ title, category: isAgenda ? "agenda" : category, priority, evidence, approach, signal_ids: ids });
  }
  if (!points.length) return null;
  points.sort((a, b) => (a.category === "agenda" ? -1 : b.category === "agenda" ? 1 : PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));

  const list = (v: unknown, max: number, n: number) =>
    (Array.isArray(v) ? v : []).map((x) => str(x, n)).filter(Boolean).slice(0, max);
  const questions = list(raw.questions_for_parent, 4, 220);
  const steps = list(raw.proposed_next_steps, 4, 220);
  const summary = str(raw.summary, 420);

  return {
    ...fallback,
    summary: summary || fallback.summary,
    discussion_points: points.slice(0, 6),
    questions_for_parent: questions.length ? questions : fallback.questions_for_parent,
    proposed_next_steps: steps.length ? steps : fallback.proposed_next_steps,
  };
}

/** Changes whenever the meeting's agenda changes, so a cached brief is not reused for a different agenda. */
export function appointmentFingerprint(a: { reason_category?: string | null; reason_note?: string | null; appointment_date?: string | null; teacher_id?: string | null; student_id?: string | null }): string {
  return [a.reason_category ?? "", a.reason_note ?? "", a.appointment_date ?? "", a.teacher_id ?? "", a.student_id ?? ""].join("|");
}
