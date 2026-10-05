// supabase/functions/_shared/learningEventModel.ts
//
// Pure logic for the Real-Time Learning Event Stream (centralised student learning telemetry).
// No I/O here so it can be unit-tested (src/test/learningEventModel.test.ts).
//
//   * which event types exist, and which of them a browser may report itself
//   * sanitising client-reported events (whitelisted fields only, clamped, no free text, no PII)
//   * turning an event into a human line for the feed
//   * summarising a window of events (volume, accuracy, active minutes, sessions, daily series, status)

export const SERVER_EVENT_TYPES = [
  "question_answered",     // every graded answer, written by a DB trigger on mastery_evidence_log
  "tutor_message",         // student sent a message to the AI tutor (length only, never the text)
  "adaptive_test_started",
  "adaptive_test_completed",
  "assessment_submitted",
  "pronunciation_attempt",
] as const;

export const CLIENT_EVENT_TYPES = [
  "page_view",
  "session_heartbeat",     // "the student is actively on the page" - one per minute at most
  "resource_opened",       // lesson / worksheet / video / reading opened
  "resource_completed",
] as const;

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type LearningEventType = ServerEventType | ClientEventType;

export const ALL_EVENT_TYPES: readonly string[] = [...SERVER_EVENT_TYPES, ...CLIENT_EVENT_TYPES];
const CLIENT_SET = new Set<string>(CLIENT_EVENT_TYPES);

/** Heartbeats power "active minutes" but would drown the feed, so the feed hides them by default. */
export const NOISY_EVENT_TYPES: readonly string[] = ["session_heartbeat"];

export const MAX_CLIENT_BATCH = 20;
/** A client may backdate an event by at most this much (offline / tab-sleep), never future-date it. */
export const MAX_BACKDATE_MS = 10 * 60 * 1000;
export const MAX_FUTURE_MS = 60 * 1000;
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const ACTIVE_NOW_MS = 5 * 60 * 1000;

export interface CleanClientEvent {
  event_type: ClientEventType;
  source: "client";
  ref_id: string | null;
  duration_seconds: number | null;
  payload: Record<string, string | number>;
  occurred_at: string;
  dedupe_key: string | null;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** "/ai-tutor?mode=x#y" -> "/ai-tutor" (query strings and hashes can carry tokens or ids). */
export function cleanPath(v: unknown): string | null {
  const s = str(v, 200);
  if (!s || !s.startsWith("/")) return null;
  return s.split(/[?#]/)[0].slice(0, 120) || null;
}

/**
 * Reduce one client-reported event to the fields we allow. Returns null when it should be dropped.
 * Anything not listed here is discarded - the client never gets to write free-form payloads.
 */
export function sanitizeClientEvent(raw: unknown, nowMs: number): CleanClientEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const type = typeof r.event_type === "string" ? r.event_type : "";
  if (!CLIENT_SET.has(type)) return null;

  const payload: Record<string, string | number> = {};
  let ref: string | null = null;

  const path = cleanPath(r.path);
  if (path) payload.path = path;

  if (type === "page_view") {
    if (!path) return null;
    const title = str(r.title, 80);
    if (title) payload.title = title;
    ref = path;
  } else if (type === "resource_opened" || type === "resource_completed") {
    const rt = str(r.resource_type, 30);
    const rid = typeof r.resource_id === "string" && ID_RE.test(r.resource_id) ? r.resource_id : null;
    if (!rt) return null;
    payload.resource_type = rt;
    if (rid) { payload.resource_id = rid; ref = rid; }
    const title = str(r.title, 80);
    if (title) payload.title = title;
  }

  let duration: number | null = null;
  const d = Number(r.duration_seconds);
  if (Number.isFinite(d) && d >= 0) duration = Math.min(Math.round(d), type === "session_heartbeat" ? 120 : 3600);
  if (type === "session_heartbeat" && duration === null) duration = 60;

  let at = nowMs;
  if (typeof r.occurred_at === "string") {
    const t = Date.parse(r.occurred_at);
    if (Number.isFinite(t)) at = Math.min(Math.max(t, nowMs - MAX_BACKDATE_MS), nowMs + MAX_FUTURE_MS);
  }

  const cid = typeof r.client_event_id === "string" && ID_RE.test(r.client_event_id) ? r.client_event_id : null;

  return {
    event_type: type as ClientEventType,
    source: "client",
    ref_id: ref,
    duration_seconds: duration,
    payload,
    occurred_at: new Date(at).toISOString(),
    dedupe_key: cid ? `c:${cid}` : null,
  };
}

// ── describing an event for the feed ─────────────────────────────────────────────────────────────

export interface FeedEvent {
  id?: string;
  event_type: string;
  source?: string | null;
  is_correct?: boolean | null;
  score?: number | null;
  duration_seconds?: number | null;
  payload?: Record<string, unknown> | null;
  occurred_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  mcq: "practice question", homework: "homework", worksheet: "worksheet", ai_tutor: "AI tutor question",
  diagnostic: "diagnostic", manual: "teacher-entered", spaced_review: "daily review", assessment_paper: "exam paper",
  adaptive_homework: "adaptive homework", cat: "adaptive test",
};
const pretty = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function describeEvent(e: FeedEvent): { label: string; detail: string | null } {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.event_type) {
    case "question_answered": {
      const before = num(p.mastery_before), after = num(p.mastery_after);
      const delta = before !== null && after !== null ? Math.round((after - before) * 100) : null;
      return {
        label: e.is_correct ? "Answered correctly" : "Answered incorrectly",
        detail: [e.source ? pretty(e.source) : null, delta !== null ? `mastery ${delta >= 0 ? "+" : ""}${delta} pts` : null]
          .filter(Boolean).join(" · ") || null,
      };
    }
    case "tutor_message":
      return { label: "Asked the AI tutor", detail: e.source === "career" ? "career coach" : null };
    case "adaptive_test_started":
      return { label: "Started an adaptive test", detail: typeof p.scope_label === "string" ? p.scope_label : null };
    case "adaptive_test_completed":
      return {
        label: "Finished an adaptive test",
        detail: [typeof p.scope_label === "string" ? p.scope_label : null, num(p.items) !== null ? `${p.items} questions` : null]
          .filter(Boolean).join(" · ") || null,
      };
    case "assessment_submitted": {
      const s = num(p.total_score), m = num(p.total_max_marks);
      return { label: "Submitted an exam paper", detail: s !== null && m ? `${s}/${m}` : null };
    }
    case "pronunciation_attempt":
      return { label: "Practised pronunciation", detail: num(e.score) !== null ? `score ${Math.round(e.score as number)}` : null };
    case "page_view":
      return { label: "Opened a page", detail: typeof p.title === "string" ? p.title : typeof p.path === "string" ? p.path : null };
    case "resource_opened":
      return { label: "Opened learning material", detail: [p.resource_type, p.title].filter((x) => typeof x === "string").join(" · ") || null };
    case "resource_completed":
      return { label: "Completed learning material", detail: [p.resource_type, p.title].filter((x) => typeof x === "string").join(" · ") || null };
    case "session_heartbeat":
      return { label: "Active on the platform", detail: null };
    default:
      return { label: e.event_type.replace(/_/g, " "), detail: null };
  }
}

// ── summarising a window of events ───────────────────────────────────────────────────────────────

export interface SummaryInput {
  event_type: string;
  source?: string | null;
  is_correct?: boolean | null;
  occurred_at: string;
}

export type ActivityStatus = "active_now" | "active_today" | "idle" | "inactive" | "no_data";

export interface LearningSummary {
  window_days: number;
  total_events: number;
  by_type: Record<string, number>;
  questions: { answered: number; correct: number; accuracy_pct: number | null };
  /** Distinct minutes in which anything happened - an estimate, not a stopwatch. */
  active_minutes: number;
  sessions: number;
  active_days: number;
  last_active_at: string | null;
  status: ActivityStatus;
  daily: { date: string; events: number; questions: number; active_minutes: number }[];
}

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** YYYY-MM-DD in the viewer's zone. `tzOffsetMinutes` is minutes EAST of UTC (India = 330). */
export function localDate(ms: number, tzOffsetMinutes: number): string {
  return new Date(ms + tzOffsetMinutes * MIN).toISOString().slice(0, 10);
}

export function clampTzOffset(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-14 * 60, Math.min(14 * 60, Math.round(n))) : 0;
}

export function activityStatus(lastMs: number | null, nowMs: number, tzOffsetMinutes = 0): ActivityStatus {
  if (lastMs === null) return "no_data";
  const age = nowMs - lastMs;
  if (age <= ACTIVE_NOW_MS) return "active_now";
  if (localDate(lastMs, tzOffsetMinutes) === localDate(nowMs, tzOffsetMinutes)) return "active_today";
  return age <= 3 * DAY ? "idle" : "inactive";
}

export function summarizeEvents(events: SummaryInput[], nowMs: number, windowDays: number, tzOffsetMinutes = 0): LearningSummary {
  const days = Math.max(1, Math.min(90, Math.round(windowDays)));
  const from = nowMs - days * DAY;

  const rows = events
    .map((e) => ({ ...e, t: Date.parse(e.occurred_at) }))
    .filter((e) => Number.isFinite(e.t) && e.t >= from && e.t <= nowMs + MAX_FUTURE_MS)
    .sort((a, b) => a.t - b.t);

  const by_type: Record<string, number> = {};
  let answered = 0, correct = 0;
  const minuteBuckets = new Set<number>();
  const dayMap = new Map<string, { events: number; questions: number; minutes: Set<number> }>();
  const activeDays = new Set<string>();
  let sessions = 0, prev: number | null = null;

  for (const e of rows) {
    by_type[e.event_type] = (by_type[e.event_type] ?? 0) + 1;
    if (e.event_type === "question_answered") { answered++; if (e.is_correct) correct++; }

    const bucket = Math.floor(e.t / MIN);
    minuteBuckets.add(bucket);
    const d = localDate(e.t, tzOffsetMinutes);
    activeDays.add(d);
    let day = dayMap.get(d);
    if (!day) { day = { events: 0, questions: 0, minutes: new Set() }; dayMap.set(d, day); }
    if (!NOISY_EVENT_TYPES.includes(e.event_type)) day.events++;
    if (e.event_type === "question_answered") day.questions++;
    day.minutes.add(bucket);

    if (prev === null || e.t - prev > SESSION_GAP_MS) sessions++;
    prev = e.t;
  }

  // Series covers every day in the window so the chart has no holes.
  const daily: LearningSummary["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = localDate(nowMs - i * DAY, tzOffsetMinutes);
    const v = dayMap.get(d);
    daily.push({ date: d, events: v?.events ?? 0, questions: v?.questions ?? 0, active_minutes: v?.minutes.size ?? 0 });
  }

  const lastMs = rows.length ? rows[rows.length - 1].t : null;
  return {
    window_days: days,
    total_events: rows.filter((e) => !NOISY_EVENT_TYPES.includes(e.event_type)).length,
    by_type,
    questions: { answered, correct, accuracy_pct: answered ? Math.round((correct / answered) * 100) : null },
    active_minutes: minuteBuckets.size,
    sessions,
    active_days: activeDays.size,
    last_active_at: lastMs === null ? null : new Date(lastMs).toISOString(),
    status: activityStatus(lastMs, nowMs, tzOffsetMinutes),
    daily,
  };
}

export interface StudentRollup {
  student_id: string;
  events: number;
  questions: number;
  accuracy_pct: number | null;
  active_minutes: number;
  last_active_at: string | null;
  status: ActivityStatus;
}

export interface CohortSummary {
  /** Everyone together: counts are sums, so "active minutes" is student-minutes. */
  summary: LearningSummary;
  students: StudentRollup[];
  status_counts: Record<ActivityStatus, number>;
}

/**
 * One pass over a class: a per-student rollup (students with no events still appear, status "no_data")
 * and a combined summary. Most recently active students come first, never-active last.
 */
export function summarizeCohort(
  roster: string[], events: (SummaryInput & { student_id: string })[], nowMs: number, windowDays: number, tzOffsetMinutes = 0,
): CohortSummary {
  const grouped = new Map<string, (SummaryInput & { student_id: string })[]>();
  for (const e of events) {
    const g = grouped.get(e.student_id);
    if (g) g.push(e); else grouped.set(e.student_id, [e]);
  }
  const per = roster.map((id) => ({ id, s: summarizeEvents(grouped.get(id) ?? [], nowMs, windowDays, tzOffsetMinutes) }));

  const students: StudentRollup[] = per.map(({ id, s }) => ({
    student_id: id, events: s.total_events, questions: s.questions.answered, accuracy_pct: s.questions.accuracy_pct,
    active_minutes: s.active_minutes, last_active_at: s.last_active_at, status: s.status,
  })).sort((a, b) => (b.last_active_at ? Date.parse(b.last_active_at) : -1) - (a.last_active_at ? Date.parse(a.last_active_at) : -1));

  const status_counts: Record<ActivityStatus, number> = { active_now: 0, active_today: 0, idle: 0, inactive: 0, no_data: 0 };
  for (const st of students) status_counts[st.status]++;

  const days = Math.max(1, Math.min(90, Math.round(windowDays)));
  const by_type: Record<string, number> = {};
  let answered = 0, correct = 0, minutes = 0, sessions = 0, total = 0;
  let last: number | null = null;
  const daily = new Map<string, { date: string; events: number; questions: number; active_minutes: number }>();
  for (const { s } of per) {
    total += s.total_events; answered += s.questions.answered; correct += s.questions.correct;
    minutes += s.active_minutes; sessions += s.sessions;
    for (const [k, v] of Object.entries(s.by_type)) by_type[k] = (by_type[k] ?? 0) + v;
    if (s.last_active_at) { const t = Date.parse(s.last_active_at); if (last === null || t > last) last = t; }
    for (const d of s.daily) {
      const cur = daily.get(d.date) ?? { date: d.date, events: 0, questions: 0, active_minutes: 0 };
      cur.events += d.events; cur.questions += d.questions; cur.active_minutes += d.active_minutes;
      daily.set(d.date, cur);
    }
  }
  const series = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const summary: LearningSummary = {
    window_days: days, total_events: total, by_type,
    questions: { answered, correct, accuracy_pct: answered ? Math.round((correct / answered) * 100) : null },
    active_minutes: minutes, sessions,
    active_days: series.filter((d) => d.events > 0 || d.active_minutes > 0).length,
    last_active_at: last === null ? null : new Date(last).toISOString(),
    status: activityStatus(last, nowMs, tzOffsetMinutes),
    daily: series,
  };
  return { summary, students, status_counts };
}

/** Per-student rollup for a class roster (see summarizeCohort). */
export function rollupByStudent(
  roster: string[], events: (SummaryInput & { student_id: string })[], nowMs: number, windowDays: number, tzOffsetMinutes = 0,
): StudentRollup[] {
  return summarizeCohort(roster, events, nowMs, windowDays, tzOffsetMinutes).students;
}
