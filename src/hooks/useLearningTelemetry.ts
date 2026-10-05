// Student-side telemetry for the Real-Time Learning Event Stream.
// Mounted once in AppLayout. Reports only: which app page was opened, and a once-a-minute "actively here"
// heartbeat (tab visible AND the student touched the page in the last two minutes, so a tab left open
// overnight doesn't count as study time). No content, no keystrokes, no query strings.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { flushLearningEvents, trackLearningEvent } from "@/lib/learningEvents";

const BEAT_MS = 60_000;
const CHECK_MS = 15_000;
const ACTIVE_WINDOW_MS = 120_000;

// Module-level on purpose: AppLayout remounts on every page change and the clock must survive that.
let lastInteraction = 0;
let lastBeat = 0;
let lastPath = "";
let lastPathAt = 0;

export function useLearningTelemetry(): void {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const enabled = profile?.role === "student";

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    if (pathname === lastPath && now - lastPathAt < 3000) return; // StrictMode double-run / quick re-render
    lastPath = pathname;
    lastPathAt = now;
    trackLearningEvent({ event_type: "page_view", path: pathname });
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const touch = () => { lastInteraction = Date.now(); };
    touch();
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));

    const tick = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState !== "visible") return;
      if (now - lastInteraction > ACTIVE_WINDOW_MS) return;
      if (now - lastBeat < BEAT_MS) return;
      lastBeat = now;
      trackLearningEvent({ event_type: "session_heartbeat", duration_seconds: 60 });
    }, CHECK_MS);

    const onHide = () => { if (document.visibilityState === "hidden") void flushLearningEvents(); };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true } as EventListenerOptions));
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [enabled]);
}
