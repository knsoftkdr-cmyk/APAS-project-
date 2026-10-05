// Live feed for the Real-Time Learning Event Stream.
// Polls the stream with a cursor (only new events come back), pauses while the tab is hidden, and - when the
// viewer is the student themself - also listens to Supabase Realtime on their own rows so new events show
// instantly. Realtime is an accelerator only: staff and parents are scoped server-side, so they rely on polling.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchLearningStream, type LearningEvent, type Persistence, type StreamScope } from "@/lib/learningEvents";

const MAX_KEPT = 100;

export interface StreamState {
  events: LearningEvent[];
  /** ids that arrived after the first load, so the UI can highlight them briefly */
  freshIds: Set<string>;
  loading: boolean;
  error: string | null;
  persistence: Persistence | null;
  /** true while polling is healthy and the tab is visible */
  live: boolean;
  lastUpdated: number | null;
}

export function useLearningEventStream(
  scope: StreamScope, opts: { pollMs?: number; limit?: number; realtimeStudentId?: string; enabled?: boolean } = {},
): StreamState & { refresh: () => void } {
  const { pollMs = 8000, limit = 50, realtimeStudentId, enabled = true } = opts;
  const scopeKey = `${scope.studentId ?? ""}|${scope.classId ?? ""}`;

  const [state, setState] = useState<StreamState>({
    events: [], freshIds: new Set(), loading: true, error: null, persistence: null, live: false, lastUpdated: null,
  });
  const cursor = useRef<string | null>(null);
  const inFlight = useRef(false);
  const first = useRef(true);
  const pollRef = useRef<() => void>(() => {});

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetchLearningStream(scope, { since: cursor.current, limit });
      cursor.current = res.cursor ?? cursor.current;
      setState((prev) => {
        const known = new Set(prev.events.map((e) => e.id));
        const incoming = res.events.filter((e) => !known.has(e.id));
        const merged = [...incoming, ...prev.events]
          .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
          .slice(0, MAX_KEPT);
        return {
          ...prev,
          events: merged,
          freshIds: first.current ? new Set() : new Set(incoming.map((e) => e.id)),
          loading: false, error: null, persistence: res.persistence, live: true, lastUpdated: Date.now(),
        };
      });
      first.current = false;
    } catch (e) {
      setState((prev) => ({ ...prev, loading: false, live: false, error: e instanceof Error ? e.message : "Couldn't load activity." }));
    } finally {
      inFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, limit]);
  pollRef.current = () => { void poll(); };

  useEffect(() => {
    if (!enabled) return;
    cursor.current = null;
    first.current = true;
    setState({ events: [], freshIds: new Set(), loading: true, error: null, persistence: null, live: false, lastUpdated: null });
    void poll();

    const id = window.setInterval(() => { if (document.visibilityState === "visible") pollRef.current(); }, pollMs);
    const onVisible = () => { if (document.visibilityState === "visible") pollRef.current(); };
    document.addEventListener("visibilitychange", onVisible);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (realtimeStudentId) {
      let debounce: number | undefined;
      channel = supabase
        .channel(`learning-events-${realtimeStudentId}`)
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "learning_events", filter: `student_id=eq.${realtimeStudentId}` },
          () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => pollRef.current(), 400); })
        .subscribe();
    }

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, scopeKey, pollMs, realtimeStudentId, poll]);

  return { ...state, refresh: () => void poll() };
}
