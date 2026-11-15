import { useEffect, useSyncExternalStore } from "react";
import { getTrackerState, resumeTracking, subscribeTracker } from "@/lib/liveAttendanceTracker";

/** Current live-class tracking state (shared across every component), and restores tracking after a reload. */
export function useLiveAttendanceTracker() {
  const state = useSyncExternalStore(subscribeTracker, getTrackerState, getTrackerState);
  useEffect(() => { resumeTracking(); }, []);
  return state;
}
