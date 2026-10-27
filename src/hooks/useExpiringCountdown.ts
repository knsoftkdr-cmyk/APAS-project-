import { useEffect, useRef } from "react";

/**
 * Counts `seconds` down once per second while `active`, and calls `onExpire` exactly once when it reaches 0.
 * The timer stays "active" at 0 on purpose: the consumer's submit handler is what switches it off.
 * (Switching it off at the same moment as reaching 0 is what previously stopped the auto-submit from firing.)
 */
export function useExpiringCountdown(opts: {
  active: boolean;
  seconds: number;
  setSeconds: (updater: (prev: number) => number) => void;
  paused?: boolean;
  onExpire: () => void;
}) {
  const { active, seconds, setSeconds, paused } = opts;
  const fired = useRef(false);
  const onExpireRef = useRef(opts.onExpire);
  onExpireRef.current = opts.onExpire; // always call the latest handler (it reads the latest answers)

  useEffect(() => {
    if (seconds > 0) fired.current = false; // a new countdown has started
    if (paused || !active) return;
    if (seconds <= 0) {
      if (!fired.current) {
        fired.current = true;
        onExpireRef.current();
      }
      return;
    }
    const id = setInterval(() => setSeconds((prev) => (prev <= 1 ? 0 : prev - 1)), 1000);
    return () => clearInterval(id);
  }, [active, seconds, paused, setSeconds]);
}
