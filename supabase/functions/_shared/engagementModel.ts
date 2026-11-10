// supabase/functions/_shared/engagementModel.ts
//
// Student Engagement Score: pure, rule-based logic (no I/O, no AI). Unit-tested in src/test/engagementModel.test.ts.
//
//   Score (0-100) = sum(activity score x weight) / sum(weight of the activities that APPLY to the student)
//
// Each activity is first normalised to 0-100. An activity that was never assigned / made available to the
// student is EXCLUDED and the remaining weights are re-normalised, so the student is not penalised for it.
// If there are too few real opportunities to judge, the result is "insufficient" (UI: "Not enough data").
//
// The model never reads the database: the handler (handlers/engagementScore.ts) gathers facts and passes them in.

export type ActivityKey = "video" | "quiz" | "assignment" | "live_class" | "interaction";
export const ACTIVITY_KEYS: readonly ActivityKey[] = ["video", "quiz", "assignment", "live_class", "interaction"];

export type EngagementWeights = Record<ActivityKey, number>;

export const DEFAULT_WEIGHTS: EngagementWeights = { video: 20, quiz: 25, assignment: 25, live_class: 20, interaction: 10 };

export interface EngagementConfig {
  weights: EngagementWeights;
  /** Reporting period. Default: the last 30 days. */
  window_days: number;
  /** Real opportunities (videos + quizzes + assignments + live classes) needed before a score is shown. */
  min_opportunities: number;
  /** Videos a student is expected to watch per period (capped by how many are available to them). */
  video_target: number;
  /** Below this fraction watched a video counts as "opened", not "watched". */
  video_min_fraction: number;
  /** Meaningful doubts / interactions expected per period. */
  interaction_target: number;
  interaction_min_chars: number;
  /** Max interactions counted per calendar day, so spamming cannot inflate the score. */
  interaction_daily_cap: number;
  /** Homework with no due date counts as "missed" only after this many days. */
  homework_grace_days: number;
  late_credit: number;
  started_quiz_credit: number;
  /** A drop of at least this many points vs the previous period is flagged as declining. */
  decline_threshold: number;
  /** Minutes east of UTC used to turn timestamps into school-local dates (IST = 330). */
  timezone_offset_minutes: number;
}

export const DEFAULT_CONFIG: EngagementConfig = {
  weights: { ...DEFAULT_WEIGHTS },
  window_days: 30,
  min_opportunities: 3,
  video_target: 3,
  video_min_fraction: 0.1,
  interaction_target: 5,
  interaction_min_chars: 15,
  interaction_daily_cap: 3,
  homework_grace_days: 3,
  late_credit: 0.6,
  started_quiz_credit: 0.5,
  decline_threshold: 10,
  timezone_offset_minutes: 330,
};

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Merge a (possibly partial / untrusted) settings object over the defaults, clamping every value. */
export function sanitizeConfig(raw: unknown): EngagementConfig {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_CONFIG;
  const wRaw = r.weights && typeof r.weights === "object" ? (r.weights as Record<string, unknown>) : {};
  const weights = {} as EngagementWeights;
  for (const k of ACTIVITY_KEYS) weights[k] = num(wRaw[k], d.weights[k], 0, 100);
  const total = ACTIVITY_KEYS.reduce((s, k) => s + weights[k], 0);
  return {
    weights: total > 0 ? weights : { ...DEFAULT_WEIGHTS },
    window_days: Math.round(num(r.window_days, d.window_days, 7, 90)),
    min_opportunities: Math.round(num(r.min_opportunities, d.min_opportunities, 1, 50)),
    video_target: Math.round(num(r.video_target, d.video_target, 1, 50)),
    video_min_fraction: num(r.video_min_fraction, d.video_min_fraction, 0, 1),
    interaction_target: Math.round(num(r.interaction_target, d.interaction_target, 1, 100)),
    interaction_min_chars: Math.round(num(r.interaction_min_chars, d.interaction_min_chars, 1, 500)),
    interaction_daily_cap: Math.round(num(r.interaction_daily_cap, d.interaction_daily_cap, 1, 50)),
    homework_grace_days: Math.round(num(r.homework_grace_days, d.homework_grace_days, 0, 30)),
    late_credit: num(r.late_credit, d.late_credit, 0, 1),
    started_quiz_credit: num(r.started_quiz_credit, d.started_quiz_credit, 0, 1),
    decline_threshold: num(r.decline_threshold, d.decline_threshold, 1, 50),
    timezone_offset_minutes: Math.round(num(r.timezone_offset_minutes, d.timezone_offset_minutes, -720, 840)),
  };
}

// ── shared types ─────────────────────────────────────────────────────────────────────────────────

export interface ActivityResult {
  key: ActivityKey;
  /** false = never assigned / not available to this student: excluded from the calculation. */
  available: boolean;
  /** 0-100, null when not available. */
  score: number | null;
  /** How many real opportunities this activity offered in the period. */
  opportunities: number;
  /** Credit earned across those opportunities (e.g. 2.6 of 3). */
  credit: number;
  /** Raw weight from the settings. */
  weight: number;
  /** Weight actually applied after dropping unavailable activities (percent of 100). */
  effective_weight: number;
  /** Contribution to the final score in points. */
  points: number;
}

export type EngagementCategory = "highly_engaged" | "moderately_engaged" | "low" | "very_low";

export interface EngagementResult {
  status: "ok" | "insufficient";
  score: number | null;
  category: EngagementCategory | null;
  opportunities: number;
  activities: Record<ActivityKey, ActivityResult>;
}

export const CATEGORY_LABEL: Record<EngagementCategory, string> = {
  highly_engaged: "Highly Engaged",
  moderately_engaged: "Moderately Engaged",
  low: "Low Engagement",
  very_low: "Very Low Engagement",
};

/** 80-100 Highly, 60-79 Moderately, 40-59 Low, 0-39 Very Low. */
export function categoryFor(score: number | null | undefined): EngagementCategory | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 80) return "highly_engaged";
  if (score >= 60) return "moderately_engaged";
  if (score >= 40) return "low";
  return "very_low";
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const DAY_MS = 86_400_000;

export interface Period { startMs: number; endMs: number }
export function periodFor(nowMs: number, windowDays: number): Period {
  return { startMs: nowMs - windowDays * DAY_MS, endMs: nowMs };
}

/** "YYYY-MM-DD" for an instant, in the school's local time. */
export function localDateKey(ms: number, tzOffsetMinutes: number): string {
  return new Date(ms + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

const emptyResult = (key: ActivityKey, weight: number): ActivityResult =>
  ({ key, available: false, score: null, opportunities: 0, credit: 0, weight, effective_weight: 0, points: 0 });

function finish(key: ActivityKey, weight: number, opportunities: number, credit: number, denominator: number): ActivityResult {
  if (denominator <= 0) return emptyResult(key, weight);
  return {
    key, available: true, weight, opportunities, credit: round1(credit),
    score: round1(clamp01(credit / denominator) * 100), effective_weight: 0, points: 0,
  };
}

// ── 1. Video ─────────────────────────────────────────────────────────────────────────────────────

/** One `video_progress` telemetry event. `watched_seconds` is cumulative for that viewing. */
export interface VideoEvent { ref_id: string; watched_seconds: number; video_duration: number; at?: string }

/**
 * Credit per video = fraction actually watched (0-1). Opening a video does nothing: it must clear
 * `video_min_fraction`. Duplicate / repeated events for the same video take the MAXIMUM, never the sum.
 */
export function videoActivity(availableVideoIds: readonly string[], events: readonly VideoEvent[], cfg: EngagementConfig): ActivityResult {
  const best = new Map<string, { watched: number; duration: number }>();
  for (const e of events) {
    if (!e || !e.ref_id) continue;
    const watched = Number(e.watched_seconds), duration = Number(e.video_duration);
    if (!Number.isFinite(watched) || !Number.isFinite(duration) || duration <= 0 || watched < 0) continue;
    const cur = best.get(e.ref_id) ?? { watched: 0, duration: 0 };
    best.set(e.ref_id, { watched: Math.max(cur.watched, Math.min(watched, duration)), duration: Math.max(cur.duration, duration) });
  }
  let credit = 0;
  for (const v of best.values()) {
    const f = clamp01(v.watched / v.duration);
    if (f >= cfg.video_min_fraction) credit += f;
  }
  const available = new Set(availableVideoIds).size;
  // A student who watched videos plainly had access to them, even if the availability list was empty.
  const expected = Math.max(Math.min(available, cfg.video_target), credit > 0 ? 1 : 0);
  return finish("video", cfg.weights.video, expected, credit, expected);
}

// ── 2. Quiz ──────────────────────────────────────────────────────────────────────────────────────

export interface QuizItem {
  id: string;
  opens_at: string | null;
  due_at: string | null;
  created_at: string;
  /** Attempt status for this student, or null when never started. */
  status: "assigned" | "in_progress" | "submitted" | "graded" | null;
  /** When the attempt was submitted (used to rebuild the previous period). */
  submitted_at?: string | null;
}

const ms = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/** Is this assigned item relevant to the period? (created before it ended, and due / created inside it) */
function relevant(createdMs: number | null, dueMs: number | null, p: Period): boolean {
  const created = createdMs ?? p.endMs;
  if (created > p.endMs) return false;
  return dueMs !== null ? dueMs >= p.startMs : created >= p.startMs;
}

/**
 * Participation, not marks: submitted/graded = full credit, started = partial, never started = 0.
 * Quizzes not opened yet, or still before their deadline and untouched, are excluded (nothing was missed yet).
 */
export function quizActivity(items: readonly QuizItem[], p: Period, cfg: EngagementConfig): ActivityResult {
  const seen = new Set<string>();
  let counted = 0, credit = 0;
  for (const q of items) {
    if (!q || seen.has(q.id)) continue; // duplicate rows never count twice
    seen.add(q.id);
    const opens = ms(q.opens_at), due = ms(q.due_at), created = ms(q.created_at);
    if (opens !== null && opens > p.endMs) continue;
    if (!relevant(created, due, p)) continue;
    const done = q.status === "submitted" || q.status === "graded";
    const started = q.status === "in_progress";
    if (!done && !started && due !== null && due > p.endMs) continue; // still open, not yet missed
    counted++;
    credit += done ? 1 : started ? cfg.started_quiz_credit : 0;
  }
  return finish("quiz", cfg.weights.quiz, counted, credit, counted);
}

// ── 3. Assignment (homework + worksheets) ───────────────────────────────────────────────────────

export interface AssignmentItem {
  kind: "homework" | "worksheet";
  id: string;
  assigned_at: string;
  due_at: string | null;
  submitted_at: string | null;
}

export function assignmentActivity(items: readonly AssignmentItem[], p: Period, cfg: EngagementConfig): ActivityResult {
  const seen = new Set<string>();
  let counted = 0, credit = 0;
  for (const a of items) {
    const key = `${a.kind}:${a.id}`;
    if (!a || seen.has(key)) continue;
    seen.add(key);
    const assigned = ms(a.assigned_at), due = ms(a.due_at), sub = ms(a.submitted_at);
    if (!relevant(assigned, due, p)) continue;
    if (sub !== null) {
      counted++;
      credit += due !== null && sub > due ? cfg.late_credit : 1;
    } else if (due !== null) {
      if (due < p.endMs) counted++; // deadline passed with no submission = missed; otherwise still pending
    } else if (assigned !== null && assigned + cfg.homework_grace_days * DAY_MS < p.endMs) {
      counted++; // no deadline: missed only after the grace period
    }
  }
  return finish("assignment", cfg.weights.assignment, counted, credit, counted);
}

// ── 4. Live class ────────────────────────────────────────────────────────────────────────────────

export interface LiveSession {
  id: string;
  status: string | null;
  scheduled_start: string;
  scheduled_end: string;
  recurrence_end_date: string | null;
}
export interface LiveAttendance { session_id: string; session_date: string; attendance_status: string }

const CANCELLED = new Set(["cancelled", "canceled"]);

/**
 * APAS recurring sessions run EVERY day from the start date to `recurrence_end_date` (see
 * StudentVirtualClassroomWidget.isTodayInRange); one-off sessions run on their start date. Attendance is one row per
 * (session, student, session_date) with status joined | absent | excused. No row = the student never joined.
 * Excused occurrences are excluded; occurrences that have not finished yet are excluded.
 */
export function liveClassActivity(
  sessions: readonly LiveSession[], attendance: readonly LiveAttendance[], p: Period, cfg: EngagementConfig,
): ActivityResult {
  const status = new Map<string, string>();
  for (const a of attendance) status.set(`${a.session_id}|${String(a.session_date).slice(0, 10)}`, a.attendance_status);
  const tz = cfg.timezone_offset_minutes;
  const startKey = localDateKey(p.startMs, tz), endKey = localDateKey(p.endMs, tz);

  let held = 0, credit = 0;
  const seen = new Set<string>();
  for (const s of sessions) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.status && CANCELLED.has(s.status.toLowerCase())) continue;
    const st = ms(s.scheduled_start), en = ms(s.scheduled_end);
    if (st === null || en === null) continue;
    const firstKey = localDateKey(st, tz);
    const lastKey = s.recurrence_end_date ? String(s.recurrence_end_date).slice(0, 10) : firstKey;
    const from = firstKey > startKey ? firstKey : startKey;
    const to = lastKey < endKey ? lastKey : endKey;
    // Time of day the session ends, in local time.
    const endOfDayMs = ((en + tz * 60_000) % DAY_MS + DAY_MS) % DAY_MS;
    for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += DAY_MS) {
      const key = new Date(d).toISOString().slice(0, 10);
      const endsAtUtc = d + endOfDayMs - tz * 60_000;
      if (endsAtUtc > p.endMs) continue; // not finished yet
      if (endsAtUtc < p.startMs) continue; // finished before the period
      const att = status.get(`${s.id}|${key}`);
      if (att === "excused") continue;
      held++;
      if (att === "joined") credit += 1;
    }
  }
  return finish("live_class", cfg.weights.live_class, held, credit, held);
}

// ── 5. Doubts & interactions ────────────────────────────────────────────────────────────────────

export interface InteractionEvent { at: string; kind: "tutor" | "classroom_question"; chars: number | null }

/**
 * Meaningful interactions only: AI-tutor doubts (not the career coach) of at least `interaction_min_chars`, and
 * questions posted to the digital classroom. Capped per day. Always "available" (the tutor is open to every student).
 */
export function interactionActivity(events: readonly InteractionEvent[], p: Period, cfg: EngagementConfig): ActivityResult {
  const perDay = new Map<string, number>();
  let counted = 0;
  for (const e of events) {
    const t = ms(e.at);
    if (t === null || t < p.startMs || t > p.endMs) continue;
    if (e.kind === "tutor" && (e.chars ?? 0) < cfg.interaction_min_chars) continue;
    const day = localDateKey(t, cfg.timezone_offset_minutes);
    const n = perDay.get(day) ?? 0;
    if (n >= cfg.interaction_daily_cap) continue;
    perDay.set(day, n + 1);
    counted++;
  }
  const r = finish("interaction", cfg.weights.interaction, 0, counted, cfg.interaction_target);
  return { ...r, available: true, opportunities: 0, score: r.score ?? 0 };
}

// ── combine ─────────────────────────────────────────────────────────────────────────────────────

export interface EngagementFacts {
  /** `availableAt` (optional) = when each available video was published, so past periods are rebuilt correctly. */
  videos: { availableIds: readonly string[]; events: readonly VideoEvent[]; availableAt?: Readonly<Record<string, string>> };
  quizzes: readonly QuizItem[];
  assignments: readonly AssignmentItem[];
  liveSessions: readonly LiveSession[];
  liveAttendance: readonly LiveAttendance[];
  interactions: readonly InteractionEvent[];
}

export function computeEngagement(facts: EngagementFacts, nowMs: number, rawCfg?: unknown): EngagementResult {
  const cfg = sanitizeConfig(rawCfg);
  const p = periodFor(nowMs, cfg.window_days);
  const activities: Record<ActivityKey, ActivityResult> = {
    video: videoActivity(facts.videos.availableIds, facts.videos.events, cfg),
    quiz: quizActivity(facts.quizzes, p, cfg),
    assignment: assignmentActivity(facts.assignments, p, cfg),
    live_class: liveClassActivity(facts.liveSessions, facts.liveAttendance, p, cfg),
    interaction: interactionActivity(facts.interactions, p, cfg),
  };
  const opportunities = activities.video.opportunities + activities.quiz.opportunities
    + activities.assignment.opportunities + activities.live_class.opportunities;

  // Only activities that apply AND carry weight take part; their weights are re-normalised to 100.
  const active = ACTIVITY_KEYS.filter((k) => activities[k].available && activities[k].weight > 0);
  const totalWeight = active.reduce((s, k) => s + activities[k].weight, 0);
  const judgeable = opportunities >= cfg.min_opportunities
    && active.some((k) => k !== "interaction") && totalWeight > 0;
  if (!judgeable) return { status: "insufficient", score: null, category: null, opportunities, activities };

  let score = 0;
  for (const k of active) {
    const a = activities[k];
    a.effective_weight = round1((a.weight / totalWeight) * 100);
    a.points = round1(((a.score ?? 0) * a.weight) / totalWeight);
    score += ((a.score ?? 0) * a.weight) / totalWeight;
  }
  const final = round1(score);
  return { status: "ok", score: final, category: categoryFor(final), opportunities, activities };
}

// ── trend & suggestions ─────────────────────────────────────────────────────────────────────────

export type Trend = "up" | "down" | "flat" | "unknown";
export interface Comparison { delta: number | null; trend: Trend; declining: boolean }

/** Compare to the previous period. Needs a real score on both sides, otherwise "unknown". */
export function compareScores(current: number | null, previous: number | null, declineThreshold = DEFAULT_CONFIG.decline_threshold): Comparison {
  if (current === null || previous === null) return { delta: null, trend: "unknown", declining: false };
  const delta = round1(current - previous);
  return { delta, trend: delta >= 3 ? "up" : delta <= -3 ? "down" : "flat", declining: delta <= -declineThreshold };
}

export const ACTIVITY_LABEL: Record<ActivityKey, string> = {
  video: "Video watching", quiz: "Quiz participation", assignment: "Assignment submission",
  live_class: "Live class attendance", interaction: "Doubts & interactions",
};

const TIPS: Record<ActivityKey, string> = {
  video: "Watch your assigned videos to the end - opening a video without watching it does not count.",
  quiz: "Attempt the quizzes your teacher has assigned, even if you are unsure of every answer.",
  assignment: "Submit homework and worksheets before their deadlines; late submissions earn less.",
  live_class: "Join your live classes on time - attendance is recorded when you join.",
  interaction: "Ask your doubts in the AI Tutor or the class discussion when something is unclear.",
};

/** Up to `max` tips, for the activities with the biggest weighted shortfall. */
export function improvementTips(result: EngagementResult, max = 3): { key: ActivityKey; text: string }[] {
  return ACTIVITY_KEYS
    .map((k) => result.activities[k])
    .filter((a) => a.available && a.score !== null && a.score < 70 && a.weight > 0)
    .sort((a, b) => (100 - (b.score ?? 0)) * b.weight - (100 - (a.score ?? 0)) * a.weight)
    .slice(0, max)
    .map((a) => ({ key: a.key, text: TIPS[a.key] }));
}

/** Activities the student has not taken part in at all, despite them being available (for teachers). */
export function missingActivities(result: EngagementResult): ActivityKey[] {
  return ACTIVITY_KEYS.filter((k) => {
    const a = result.activities[k];
    return a.available && (a.score ?? 0) === 0 && (k === "interaction" || a.opportunities > 0);
  });
}

// ── class matching & point-in-time facts ────────────────────────────────────────────────────────

/** Same normalisation the classroom code uses: "Class 5" / "grade 5" / "5" all match. */
export const normClass = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/\b(class|grade|std)\b\.?/g, "").replace(/\s+/g, "");
export const normSection = (s: unknown): string => String(s ?? "").trim().toUpperCase();

/**
 * The facts as they stood at `asOfMs`, so the PREVIOUS reporting period can be scored from the same data:
 * things created later do not exist yet, and submissions made later had not happened.
 */
export function factsAsOf(f: EngagementFacts, asOfMs: number): EngagementFacts {
  const before = (iso: string | null | undefined) => { const t = ms(iso); return t === null || t <= asOfMs; };
  const known = (iso: string | null | undefined) => { const t = ms(iso); return t !== null && t <= asOfMs; };
  return {
    videos: {
      availableIds: f.videos.availableIds.filter((id) => !f.videos.availableAt?.[id] || before(f.videos.availableAt[id])),
      events: f.videos.events.filter((e) => !e.at || before(e.at)),
      availableAt: f.videos.availableAt,
    },
    quizzes: f.quizzes.filter((q) => before(q.created_at)).map((q) => {
      const done = q.status === "submitted" || q.status === "graded";
      return done && q.submitted_at && !known(q.submitted_at) ? { ...q, status: null } : q;
    }),
    assignments: f.assignments.filter((a) => before(a.assigned_at)).map((a) => (a.submitted_at && !known(a.submitted_at) ? { ...a, submitted_at: null } : a)),
    liveSessions: f.liveSessions,
    liveAttendance: f.liveAttendance,
    interactions: f.interactions.filter((i) => before(i.at)),
  };
}
