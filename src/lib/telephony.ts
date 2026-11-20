// Click-to-Call - browser helpers. Rules (phone validation, statuses, labels) come from the server model so both sides agree.
export {
  normalizePhone, formatPhone, formatDuration, isTerminal, ACTIVE_STATUSES, TERMINAL_STATUSES, CALL_STATUS_LABEL,
  type CallStatus, type ProviderName,
} from "../../supabase/functions/_shared/telephonyModel";
import type { CallStatus } from "../../supabase/functions/_shared/telephonyModel";

export const CALL_STATUSES_FOR_FILTER: CallStatus[] = ["completed", "missed", "busy", "failed", "cancelled", "ringing", "connected", "initiating"];

/** Offset (minutes) of a time zone at a given instant. */
function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at.getTime() / 1000) * 1000) / 60000;
}

/** "2026-11-20T15:30" typed as the SCHOOL's local time -> the real instant (ISO, UTC). Null if unparseable. */
export function schoolLocalToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    let guess = asUtc - offsetMinutes(tz, new Date(asUtc)) * 60000;
    guess = asUtc - offsetMinutes(tz, new Date(guess)) * 60000; // second pass settles DST edges
    return new Date(guess).toISOString();
  } catch { return null; }
}

export function formatInSchoolTz(iso: string, tz: string): string {
  try { return new Intl.DateTimeFormat("en-IN", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); }
  catch { return new Date(iso).toLocaleString(); }
}
