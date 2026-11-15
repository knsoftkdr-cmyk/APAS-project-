// src/lib/liveAttendanceTracker.ts
//
// Records a student's stay in a live class. Live classes run on an external Meet link, so the Meet call itself cannot
// be observed from APAS; instead a stay starts when the student taps Join in APAS and is kept alive by a heartbeat
// from the student's APAS page. It ends when the student taps "Leave class", or is closed by the server when
// heartbeats stop (see the header of 20261112000000_live_class_auto_attendance.sql for the exact rules).
//
// This is a module-level singleton, not component state, so tracking survives in-app navigation (dashboard ->
// another page) and is restored after a reload from localStorage. Every failure is swallowed: attendance tracking
// must never stop a student from opening the class.

import { supabase } from "@/integrations/supabase/client";
import { isMissingRpc, legacyRecordJoin } from "@/lib/liveAttendance";

export interface TrackedSession {
  sessionId: string;
  title: string;
  joinedAt: number;      // ms
  windowEnd: number;     // ms: end of today's occurrence
}

export interface TrackerState {
  active: TrackedSession | null;
  /** The student came back to APAS after a while away: ask whether they are still in class. */
  needsConfirm: boolean;
}

export type JoinOutcome =
  | { recorded: true; tracking: boolean }
  | { recorded: false; reason: "outside_class_time" | "cancelled" | "error"; message?: string };

const STORAGE_KEY = "apas.liveAttendance.active";
const HEARTBEAT_MS = 30_000;
const CONFIRM_AFTER_AWAY_MS = 3 * 60_000;
const STOP_AFTER_END_MS = 30 * 60_000;

let state: TrackerState = { active: null, needsConfirm: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let endTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let hiddenAt: number | null = null;
let accessToken: string | null = null;
let restored = false;
let beating = false;

// ── store ──────────────────────────────────────────────────────────────────────────────────────────
export const getTrackerState = () => state;
export function subscribeTracker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function setState(next: Partial<TrackerState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function persist() {
  try {
    if (state.active) localStorage.setItem(STORAGE_KEY, JSON.stringify(state.active));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable (private mode): tracking still works for this page load */ }
}

/**
 * Phones and tablets suspend the browser while the Meet app is open, so silence from them is ambiguous and gets a
 * grace period. On a computer a background tab keeps sending heartbeats, so silence means the page was closed.
 */
function isMobileDevice(): boolean {
  try {
    const ua = navigator.userAgent || "";
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

// ── transport ──────────────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Fire-and-forget request that survives the page being hidden or closed (a normal supabase call may be cancelled). */
function sendKeepalive(fn: string, args: Record<string, unknown>) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !accessToken) return;
  try {
    void fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }).catch(() => undefined);
  } catch { /* ignore */ }
}

async function refreshToken() {
  try {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? accessToken;
  } catch { /* ignore */ }
}

// ── heartbeat ──────────────────────────────────────────────────────────────────────────────────────
async function beat(visible: boolean) {
  const a = state.active;
  if (!a || beating) return;
  beating = true;
  try {
    const { data, error } = await db.rpc("live_attendance_heartbeat", { p_session: a.sessionId, p_visible: visible });
    if (error) return;                       // offline or transient: the next beat tries again
    if (data && data.active === false) clearActive();   // the server closed the stay (class ended, or it was already closed)
  } catch { /* ignore */ } finally {
    beating = false;
  }
}

function onVisibility() {
  if (!state.active) return;
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    sendKeepalive("live_attendance_heartbeat", { p_session: state.active.sessionId, p_visible: false });
    return;
  }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = null;
  void refreshToken();
  void beat(true);
  if (away >= CONFIRM_AFTER_AWAY_MS && Date.now() < state.active.windowEnd) setState({ needsConfirm: true });
}
function onPageHide() {
  if (state.active) sendKeepalive("live_attendance_heartbeat", { p_session: state.active.sessionId, p_visible: false });
}
function onOnline() { void beat(document.visibilityState === "visible"); }

function startLoop() {
  stopLoop();
  void refreshToken();
  timer = setInterval(() => { void beat(document.visibilityState === "visible"); }, HEARTBEAT_MS);
  const a = state.active;
  if (a) {
    const wait = Math.max(0, a.windowEnd + STOP_AFTER_END_MS - Date.now());
    endTimer = setTimeout(() => { void stopTracking(); }, wait);
  }
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    supabase.auth.onAuthStateChange((_e, session) => { accessToken = session?.access_token ?? accessToken; });
  }
}
function stopLoop() {
  if (timer) clearInterval(timer);
  if (endTimer) clearTimeout(endTimer);
  timer = null;
  endTimer = null;
}
function clearActive() {
  stopLoop();
  setState({ active: null, needsConfirm: false });
  persist();
}

// ── public API ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Record a join and start the heartbeat. Never throws. Call it AFTER opening the Meet link so a slow network or
 * a popup blocker can never get in the way of joining.
 */
export async function startTracking(session: { id: string; title: string }): Promise<JoinOutcome> {
  try {
    if (state.active && state.active.sessionId !== session.id) await stopTracking();   // one class at a time
    let { data, error } = await db.rpc("live_attendance_join", { p_session: session.id, p_mobile: isMobileDevice() });
    // database not yet on the device-aware version of the function: join the way it understands
    if (error && isMissingRpc(error)) ({ data, error } = await db.rpc("live_attendance_join", { p_session: session.id }));
    if (error) throw error;
    if (!data?.recorded) {
      return { recorded: false, reason: data?.reason === "cancelled" ? "cancelled" : "outside_class_time" };
    }
    if (data.tracking === false) return { recorded: true, tracking: false };   // school switched auto-tracking off
    setState({
      active: {
        sessionId: session.id,
        title: session.title,
        joinedAt: Date.now(),
        windowEnd: data.window_end ? new Date(data.window_end).getTime() : Date.now() + 60 * 60_000,
      },
      needsConfirm: false,
    });
    persist();
    startLoop();
    return { recorded: true, tracking: true };
  } catch (e) {
    if (isMissingRpc(e)) {
      // Migration not applied yet: behave exactly as before (one "joined" row, no tracking).
      try { await legacyRecordJoin(session.id); return { recorded: true, tracking: false }; }
      catch (le) { return { recorded: false, reason: "error", message: (le as Error).message }; }
    }
    return { recorded: false, reason: "error", message: (e as { message?: string })?.message };
  }
}

/** The student says they are done. Closes the stay on the server, then stops. */
export async function stopTracking(): Promise<void> {
  const a = state.active;
  clearActive();
  if (!a) return;
  try { await db.rpc("live_attendance_leave", { p_session: a.sessionId }); } catch { /* the server times the stay out */ }
}

export function confirmStillInClass() {
  setState({ needsConfirm: false });
  void beat(true);
}

/** Pick tracking back up after a reload / app restart. Safe to call many times. */
export function resumeTracking() {
  if (restored || state.active) return;
  restored = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const a = JSON.parse(raw) as TrackedSession;
    if (!a?.sessionId || Date.now() > (a.windowEnd ?? 0) + STOP_AFTER_END_MS) { localStorage.removeItem(STORAGE_KEY); return; }
    setState({ active: a, needsConfirm: false });
    startLoop();
    void beat(document.visibilityState === "visible");
  } catch { /* corrupt entry: ignore */ }
}

/** A user-facing note for a join that was NOT recorded (null when nothing needs saying). */
export function joinOutcomeMessage(o: JoinOutcome): string | null {
  if (o.recorded) return null;
  if (o.reason === "outside_class_time") return "You opened the class outside its scheduled time, so attendance was not recorded.";
  if (o.reason === "cancelled") return "This class has been cancelled.";
  return o.message ? `Attendance could not be recorded: ${o.message}` : "Attendance could not be recorded.";
}
