// ---------------------------------------------------------------------------------------------------------------
// NAVIGATION HAND-OFF
// Every page renders its own <AppLayout>, so a page change re-creates the assistant widget. When the assistant itself
// navigates ("Open my timetable"), the widget parks its conversation here for a few seconds so the new page's widget
// can show the confirmation and let the user keep chatting.
//
// The hand-off is tied to the destination path: navigating anywhere else (sidebar, back button) finds nothing and the
// widget starts fresh, exactly as it always did. Module-level state is safe because only one assistant widget is
// mounted per role.
// ---------------------------------------------------------------------------------------------------------------

export const HANDOFF_WINDOW_MS = 15_000;

export interface NavHandoffStore<S> {
  /** The parked state, only if it was parked for exactly this path and is still fresh. */
  peek: (path: string) => S | null;
  /** Park state for the page we are about to open. */
  start: (path: string, state: S) => void;
  /** Keep a live hand-off in step with the conversation (the new page may re-create the widget more than once). */
  sync: (path: string, state: S) => void;
}

export function createNavHandoff<S>(windowMs: number = HANDOFF_WINDOW_MS): NavHandoffStore<S> {
  let current: { path: string; state: S; until: number } | null = null;
  const live = (path: string) => (current && current.path === path && Date.now() < current.until ? current : null);
  return {
    peek: (path) => live(path)?.state ?? null,
    start: (path, state) => {
      current = { path, state, until: Date.now() + windowMs };
    },
    sync: (path, state) => {
      const hit = live(path);
      if (hit) current = { ...hit, state };
    },
  };
}

/** Runs `fn` once, however many times the returned function is called (speech callback + safety timer). */
export const once = (fn: () => void) => {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      fn();
    }
  };
};
