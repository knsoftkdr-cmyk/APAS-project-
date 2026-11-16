// Browser proctoring for an online exam (TakeExam). While the attempt is open it records:
//   tab_hidden       the student left the exam tab (switched tab, minimised, locked the phone) - with seconds away
//   window_blur      the exam tab stayed visible but another window/app took focus for 2s or more
//   fullscreen_exit  the student left full screen
//   copy_paste       copy, cut or paste (blocked)
//   right_click      the context menu (blocked)
// Each event goes to log_exam_integrity_event, which only accepts events for the student's own in-progress attempt.
// If the network drops, events wait in a queue and are sent when it's back. Nothing is recorded from a camera.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type IntegrityEvent = "tab_hidden" | "window_blur" | "fullscreen_exit" | "copy_paste" | "right_click";

const SAME_EVENT_GAP_MS = 3000;
const MIN_BLUR_SECONDS = 2;
const RETRY_MS = 10_000;

export function integrityWarningMessage(e: IntegrityEvent): string {
  switch (e) {
    case "tab_hidden": return "You left the exam tab. This has been recorded for your teacher.";
    case "window_blur": return "You switched to another window. This has been recorded for your teacher.";
    case "fullscreen_exit": return "You left full screen. This has been recorded for your teacher.";
    case "copy_paste": return "Copy and paste are turned off during the exam. This has been recorded.";
    case "right_click": return "Right-click is turned off during the exam. This has been recorded.";
  }
}

export const fullscreenSupported = () => typeof document !== "undefined" && !!document.fullscreenEnabled;

export async function enterExamFullscreen(): Promise<boolean> {
  if (!fullscreenSupported() || document.fullscreenElement) return !!document.fullscreenElement;
  try { await document.documentElement.requestFullscreen(); return true; } catch { return false; }
}

export function useExamProctoring(attemptId: string, { active, initialCount = 0 }: { active: boolean; initialCount?: number }) {
  const [count, setCount] = useState(initialCount);
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  const queue = useRef<{ event: IntegrityEvent; away: number | null }[]>([]);
  const lastAt = useRef<Partial<Record<IntegrityEvent, number>>>({});
  const sending = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const { event, away } = queue.current[0];
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase as any).rpc("log_exam_integrity_event", { p_attempt_id: attemptId, p_event: event, p_away_seconds: away });
        if (error) {
          if (/not open|unknown integrity|only students/i.test(error.message)) queue.current.shift(); // will never succeed
          else break; // network: retry later
        } else {
          queue.current.shift();
          if (typeof data === "number") setCount((c) => Math.max(c, data));
        }
      }
    } finally {
      sending.current = false;
    }
  }, [attemptId]);

  const record = useCallback((event: IntegrityEvent, away: number | null = null) => {
    if (!activeRef.current) return;
    const now = Date.now();
    if (now - (lastAt.current[event] ?? 0) < SAME_EVENT_GAP_MS) return;
    lastAt.current[event] = now;
    setCount((c) => c + 1);
    toast.warning(integrityWarningMessage(event), { id: `integrity-${event}` });
    queue.current.push({ event, away });
    void flush();
  }, [flush]);

  useEffect(() => {
    if (!active) return;
    let hiddenAt: number | null = null;
    let blurAt: number | null = null;
    let wasFullscreen = !!document.fullscreenElement;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); blurAt = null; }
      else if (hiddenAt != null) { record("tab_hidden", Math.round((Date.now() - hiddenAt) / 1000)); hiddenAt = null; }
    };
    const onBlur = () => { if (document.visibilityState === "visible") blurAt = Date.now(); };
    const onFocus = () => {
      if (blurAt != null && hiddenAt == null) {
        const secs = Math.round((Date.now() - blurAt) / 1000);
        if (secs >= MIN_BLUR_SECONDS) record("window_blur", secs);
      }
      blurAt = null;
    };
    const onFullscreen = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (wasFullscreen && !fs) record("fullscreen_exit");
      wasFullscreen = fs;
    };
    const onClipboard = (e: ClipboardEvent) => { e.preventDefault(); record("copy_paste"); };
    const onContext = (e: MouseEvent) => { e.preventDefault(); record("right_click"); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("contextmenu", onContext);
    const retry = setInterval(() => { if (queue.current.length) void flush(); }, RETRY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("contextmenu", onContext);
      clearInterval(retry);
    };
  }, [active, record, flush]);

  // Leave full screen once the exam is over (submitted, or the exam page closed).
  useEffect(() => {
    const leave = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
    if (!active) leave();
    return leave;
  }, [active]);

  return { count, isFullscreen, fullscreenAvailable: fullscreenSupported(), enterFullscreen: enterExamFullscreen };
}
