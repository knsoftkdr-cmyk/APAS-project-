// Client for the Real-Time Learning Event Stream (centralised student learning telemetry).
// Served by the existing `get-mastery-history` edge function (no new function) via the `lel_*` actions.
// Server side: supabase/functions/_shared/handlers/learningEventStream.ts
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export type ActivityStatus = "active_now" | "active_today" | "idle" | "inactive" | "no_data";

export interface LearningEvent {
  id: string;
  student_id: string;
  student_name?: string;
  event_type: string;
  source: string | null;
  is_correct: boolean | null;
  score: number | null;
  duration_seconds: number | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
  /** Worded by the server so every screen says the same thing. */
  label: string;
  detail: string | null;
}

export interface LearningSummary {
  window_days: number;
  total_events: number;
  by_type: Record<string, number>;
  questions: { answered: number; correct: number; accuracy_pct: number | null };
  active_minutes: number;
  sessions: number;
  active_days: number;
  last_active_at: string | null;
  status: ActivityStatus;
  daily: { date: string; events: number; questions: number; active_minutes: number }[];
}

export interface StudentRollup {
  student_id: string;
  name: string | null;
  events: number;
  questions: number;
  accuracy_pct: number | null;
  active_minutes: number;
  last_active_at: string | null;
  status: ActivityStatus;
}

export type Persistence = "available" | "unavailable";
/** Exactly one of `studentId` (students.id) or `classId`. A student viewing themself may pass neither. */
export interface StreamScope { studentId?: string; classId?: string }

export interface StreamResponse { events: LearningEvent[]; cursor: string | null; persistence: Persistence }
export interface SummaryResponse {
  persistence: Persistence;
  truncated?: boolean;
  summary?: LearningSummary;
  status_counts?: Record<ActivityStatus, number>;
  students?: StudentRollup[];
  roster_truncated?: boolean;
}

const scopeBody = (s: StreamScope) => ({
  ...(s.studentId ? { student_id: s.studentId } : {}),
  ...(s.classId ? { class_id: s.classId } : {}),
});

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("get-mastery-history", { body });
  if (error) throw new Error((await unwrapFunctionError(error, "Couldn't load learning activity.")).message);
  return data as T;
}

export function fetchLearningStream(
  scope: StreamScope, opts: { since?: string | null; limit?: number; includeHeartbeats?: boolean } = {},
): Promise<StreamResponse> {
  return call<StreamResponse>({
    action: "lel_stream", ...scopeBody(scope),
    ...(opts.since ? { since: opts.since } : {}),
    ...(opts.limit ? { limit: opts.limit } : {}),
    ...(opts.includeHeartbeats ? { include_heartbeats: true } : {}),
  });
}

export function fetchLearningSummary(scope: StreamScope, days = 7): Promise<SummaryResponse> {
  return call<SummaryResponse>({
    action: "lel_summary", ...scopeBody(scope), days,
    // Minutes EAST of UTC (JS reports the opposite sign), so "today" means the viewer's today.
    tz_offset_minutes: -new Date().getTimezoneOffset(),
  });
}

// ── browser telemetry (students only; failures are silent by design) ────────────────────────────────

export type ClientEventType = "page_view" | "session_heartbeat" | "resource_opened" | "resource_completed";
export interface ClientEvent {
  event_type: ClientEventType;
  path?: string;
  title?: string;
  resource_type?: string;
  resource_id?: string;
  duration_seconds?: number;
}

const FLUSH_MS = 4000;
const MAX_QUEUE = 40;
let queue: (ClientEvent & { occurred_at: string; client_event_id: string })[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let blockedUntil = 0;

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`)
    .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);

/** Queue one event; they go out together every few seconds. Never throws, never blocks the UI. */
export function trackLearningEvent(e: ClientEvent): void {
  if (Date.now() < blockedUntil) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ ...e, occurred_at: new Date().toISOString(), client_event_id: newId() });
  if (!timer) timer = setTimeout(() => void flushLearningEvents(), FLUSH_MS);
}

export async function flushLearningEvents(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  const batch = queue.slice(0, 20);
  queue = queue.slice(batch.length);
  try {
    const { data, error } = await supabase.functions.invoke("get-mastery-history", { body: { action: "lel_ingest", events: batch } });
    if ((data as { persistence?: string } | null)?.persistence === "unavailable") {
      // Migration not applied yet: stop sending for a while instead of hitting the endpoint all day.
      blockedUntil = Date.now() + 30 * 60 * 1000;
      queue = [];
    } else if (error) {
      // Rate limited or the endpoint is unhappy: back off for a few minutes and drop the backlog.
      blockedUntil = Date.now() + 5 * 60 * 1000;
      queue = [];
    }
  } catch {
    blockedUntil = Date.now() + 5 * 60 * 1000;
    queue = [];
  }
  if (queue.length && !timer) timer = setTimeout(() => void flushLearningEvents(), FLUSH_MS);
}
