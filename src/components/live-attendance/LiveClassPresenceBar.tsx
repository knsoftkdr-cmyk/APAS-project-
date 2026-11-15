import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLiveAttendanceTracker } from "@/hooks/useLiveAttendanceTracker";
import { confirmStillInClass, stopTracking } from "@/lib/liveAttendanceTracker";
import { formatDuration } from "@/lib/liveAttendance";

/**
 * Shown to a student while their attendance is being recorded. It is where "Leave class" lives, and where a student
 * who comes back to APAS after a while is asked whether they are still in class (their Meet call cannot be seen
 * from here, so this is how the leave time stays honest).
 */
export function LiveClassPresenceBar({ className = "" }: { className?: string }) {
  const { active, needsConfirm } = useLiveAttendanceTracker();
  const [, tick] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const elapsed = Math.max(0, Math.floor((Date.now() - active.joinedAt) / 1000));

  const leave = async () => {
    setLeaving(true);
    await stopTracking();
    setLeaving(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2 ${className}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <p className="text-sm font-semibold text-emerald-900 min-w-0 flex-1 truncate">In class: {active.title}</p>
        <span className="text-xs tabular-nums text-emerald-800">{formatDuration(elapsed)}</span>
      </div>

      {needsConfirm ? (
        <div className="space-y-2">
          <p className="text-sm text-emerald-900">Welcome back. Are you still in the class?</p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirmStillInClass}>
              Still in class
            </Button>
            <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-800" onClick={leave} disabled={leaving}>
              {leaving ? "Saving..." : "I've left"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs text-emerald-800 flex-1 min-w-[12rem]">
            Your attendance is recorded while APAS stays open. Tap Leave class when you finish.
          </p>
          <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-800 shrink-0" onClick={leave} disabled={leaving}>
            {leaving ? "Saving..." : "Leave class"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default LiveClassPresenceBar;
