// supabase/functions/_shared/securityAnomalyModel.ts
//
// Pure rules for Security Anomaly Detection (no I/O, unit-tested in src/test/securityAnomalyModel.test.ts).
// Takes login / data-access events and returns alert drafts. Every rule is deterministic and explainable:
// each alert carries the numbers that triggered it. No model call, so no personal data leaves the system.

// deno-lint-ignore-file no-explicit-any
export type EventType = "login_success" | "login_failed" | "data_export" | "record_view";
export type Severity = "low" | "medium" | "high" | "critical";

export interface SecEvent {
  id?: string;
  user_id: string | null;
  school_id: string | null;
  role: string | null;
  event_type: EventType;
  identifier_hash: string | null;
  ip_address: string | null;
  device_key: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface AlertDraft {
  rule: string;
  severity: Severity;
  user_id: string | null;
  school_id: string | null;
  title: string;
  detail: string;
  evidence: Record<string, any>;
  dedupe_key: string;
}

export const THRESHOLDS = {
  bruteForceFailures: 5,          // failures on one login id ...
  bruteForceWindowMin: 15,        // ... within this many minutes
  sprayDistinctIds: 8,            // distinct login ids failing from one IP ...
  sprayWindowMin: 15,
  successAfterFailures: 3,        // successful login after this many recent failures on that id
  successAfterFailuresWindowMin: 30,
  baselineLoginsNeeded: 3,        // prior successful logins before "new device/place" means anything
  rapidIpPrefixes: 3,             // distinct networks within the window
  rapidIpWindowMin: 60,
  oddHourStart: 0,                // local hours [start, end)
  oddHourEnd: 5,
  oddHourBaselineNeeded: 5,
  oddHourMaxShare: 0.1,           // only flag if <10% of the user's usual logins fall in those hours
  exportMinCount: 5,              // exports within one hour ...
  exportBaselineFactor: 3,        // ... and at least 3x the user's usual busiest hour
  exportHighCount: 10,
  largeExportRows: 500,
  hugeExportRows: 5000,
  viewDistinctStaff: 30,          // distinct records opened within one hour
  viewDistinctLeadership: 60,
  viewBaselineFactor: 3,
  historyDays: 60,
} as const;

export const PRIVILEGED_ROLES = ["admin", "principal", "school_admin", "knsoft_admin"];
export const STAFF_ROLES = ["admin", "principal", "school_admin", "hod", "teacher"];
const LEADERSHIP = ["admin", "principal", "school_admin", "knsoft_admin"];
const MIN = 60_000;
const HOUR = 60 * MIN;

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────

/** Student ids log in as `<id>@student.apas.local`; the login form sends the bare id. Make both the same. */
export function normalizeIdentifier(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().replace(/@student\.apas\.local$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "ab***" - enough for an admin to recognise the account, not enough to reuse. */
export function maskIdentifier(raw: string): string {
  const s = normalizeIdentifier(raw);
  if (!s) return "";
  return s.length <= 2 ? `${s[0]}***` : `${s.slice(0, 2)}***`;
}

/** First hop of x-forwarded-for, trimmed; "unknown" -> null. */
export function cleanIp(raw: string | null | undefined): string | null {
  const first = String(raw ?? "").split(",")[0].trim();
  if (!first || first === "unknown") return null;
  return first.slice(0, 64);
}

/** Network of an address: IPv4 /24, IPv6 first four groups. Mobile / home IPs wander inside a network. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":");
  const p = ip.split(".");
  return p.length === 4 ? p.slice(0, 3).join(".") : ip;
}

/** Coarse "browser|os" label from a user agent. */
export function deviceKey(ua: string | null | undefined): string {
  const s = String(ua ?? "");
  if (!s || s === "unknown") return "unknown|unknown";
  const os = /Android/i.test(s) ? "android"
    : /iPhone|iPad|iPod/i.test(s) ? "ios"
    : /Windows/i.test(s) ? "windows"
    : /Mac OS X|Macintosh/i.test(s) ? "macos"
    : /CrOS/i.test(s) ? "chromeos"
    : /Linux/i.test(s) ? "linux" : "other";
  const browser = /Edg\//i.test(s) ? "edge"
    : /OPR\/|Opera/i.test(s) ? "opera"
    : /Firefox\//i.test(s) ? "firefox"
    : /Chrome\/|CriOS/i.test(s) ? "chrome"
    : /Safari\//i.test(s) ? "safari"
    : /okhttp|Dalvik|Capacitor/i.test(s) ? "app" : "other";
  return `${browser}|${os}`;
}

const t = (e: SecEvent) => Date.parse(e.created_at);
const hourBucket = (ms: number) => new Date(ms).toISOString().slice(0, 13);
const SEV_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Largest set of items (by value fn) falling inside any `windowMs` window; events must be time-sorted. */
function busiestWindow(events: SecEvent[], windowMs: number, key: (e: SecEvent) => string | null) {
  let best = { count: 0, start: 0, end: 0, keys: [] as string[] };
  let lo = 0;
  for (let hi = 0; hi < events.length; hi++) {
    while (t(events[hi]) - t(events[lo]) > windowMs) lo++;
    const keys = new Set<string>();
    for (let i = lo; i <= hi; i++) { const k = key(events[i]); if (k) keys.add(k); }
    if (keys.size > best.count) best = { count: keys.size, start: t(events[lo]), end: t(events[hi]), keys: [...keys] };
  }
  return best;
}

const groupBy = <T>(items: T[], key: (x: T) => string | null) => {
  const m = new Map<string, T[]>();
  for (const it of items) { const k = key(it); if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(it); }
  return m;
};

function peakPerHour(events: SecEvent[], key: (e: SecEvent) => string | null): number {
  const perHour = new Map<string, Set<string>>();
  for (const e of events) {
    const k = key(e); if (!k) continue;
    const b = hourBucket(t(e));
    (perHour.get(b) ?? perHour.set(b, new Set()).get(b)!).add(k);
  }
  let peak = 0;
  for (const s of perHour.values()) peak = Math.max(peak, s.size);
  return peak;
}

// ── detection ──────────────────────────────────────────────────────────────────────────────────────────

export interface DetectInput {
  /** Events to raise alerts about (normally the last 24 hours). */
  recent: SecEvent[];
  /** Older events, used only as each user's baseline (normally the 60 days before `recent`). */
  history: SecEvent[];
  /** Minutes east of UTC for "odd hour" checks. India = 330. */
  tzOffsetMinutes?: number;
}

export function detectAnomalies({ recent, history, tzOffsetMinutes = 330 }: DetectInput): AlertDraft[] {
  const out: AlertDraft[] = [];
  const rec = [...recent].sort((a, b) => t(a) - t(b));
  const hist = [...history].sort((a, b) => t(a) - t(b));
  const T = THRESHOLDS;

  // 1. Brute force: many failures on one login id in a short window.
  const failedById = groupBy(rec.filter((e) => e.event_type === "login_failed"), (e) => e.identifier_hash);
  for (const [hash, evs] of failedById) {
    const w = busiestWindow(evs, T.bruteForceWindowMin * MIN, (e) => e.id ?? e.created_at);
    if (w.count >= T.bruteForceFailures) {
      const last = evs[evs.length - 1];
      const ips = [...new Set(evs.map((e) => e.ip_address).filter(Boolean))];
      out.push({
        rule: "brute_force", severity: w.count >= T.bruteForceFailures * 2 ? "critical" : "high",
        user_id: null, school_id: evs.find((e) => e.school_id)?.school_id ?? null,
        title: "Repeated failed logins on one account",
        detail: `${w.count} failed sign-ins for ${last.metadata?.identifier_hint ?? "one login id"} within ${T.bruteForceWindowMin} minutes.`,
        evidence: { failures: w.count, window_minutes: T.bruteForceWindowMin, identifier_hint: last.metadata?.identifier_hint ?? null, ips: ips.slice(0, 5), from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() },
        dedupe_key: `brute_force:${hash}:${hourBucket(w.end)}`,
      });
    }
  }

  // 2. Password spraying: one address failing against many different login ids.
  const failedByIp = groupBy(rec.filter((e) => e.event_type === "login_failed"), (e) => e.ip_address);
  for (const [ip, evs] of failedByIp) {
    const w = busiestWindow(evs, T.sprayWindowMin * MIN, (e) => e.identifier_hash);
    if (w.count >= T.sprayDistinctIds) {
      out.push({
        rule: "password_spray", severity: "high", user_id: null,
        school_id: evs.find((e) => e.school_id)?.school_id ?? null,
        title: "One address trying many accounts",
        detail: `${w.count} different login ids failed from ${ip} within ${T.sprayWindowMin} minutes.`,
        evidence: { distinct_accounts: w.count, window_minutes: T.sprayWindowMin, ip, from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() },
        dedupe_key: `password_spray:${ip}:${hourBucket(w.end)}`,
      });
    }
  }

  // Everything below needs the user's earlier history.
  const histByUser = groupBy(hist, (e) => e.user_id);
  const allFailed = [...hist, ...rec].filter((e) => e.event_type === "login_failed");
  const failedHistById = groupBy(allFailed, (e) => e.identifier_hash);
  const recSuccessByUser = groupBy(rec.filter((e) => e.event_type === "login_success"), (e) => e.user_id);

  for (const [uid, logins] of recSuccessByUser) {
    const prior = (histByUser.get(uid) ?? []).filter((e) => e.event_type === "login_success");
    const role = logins[0].role ?? "";
    const schoolId = logins.find((e) => e.school_id)?.school_id ?? null;
    const priorIpPrefixes = new Set(prior.map((e) => ipPrefix(e.ip_address)).filter(Boolean));
    const priorDevices = new Set(prior.map((e) => e.device_key).filter(Boolean));
    const seenIp = new Set(priorIpPrefixes), seenDev = new Set(priorDevices);

    for (const e of logins) {
      const when = t(e);

      // 3. Success right after failures on the same login id.
      const fails = (failedHistById.get(e.identifier_hash ?? "") ?? [])
        .filter((f) => t(f) <= when && when - t(f) <= T.successAfterFailuresWindowMin * MIN);
      if (e.identifier_hash && fails.length >= T.successAfterFailures) {
        out.push({
          rule: "success_after_failures", severity: "high", user_id: uid, school_id: schoolId,
          title: "Signed in right after repeated failures",
          detail: `A sign-in succeeded after ${fails.length} failed attempts in the previous ${T.successAfterFailuresWindowMin} minutes. If this was not the account owner, the password may have been guessed.`,
          evidence: { failures_before: fails.length, ip: e.ip_address, device: e.device_key, at: e.created_at },
          dedupe_key: `success_after_failures:${uid}:${hourBucket(when)}`,
        });
      }

      // 4. New network AND new device, for someone with an established pattern.
      const newIp = !!ipPrefix(e.ip_address) && !seenIp.has(ipPrefix(e.ip_address));
      const newDev = !!e.device_key && !seenDev.has(e.device_key);
      if (prior.length >= T.baselineLoginsNeeded && newIp && newDev) {
        out.push({
          rule: "new_device_and_network", severity: PRIVILEGED_ROLES.includes(role) ? "high" : "medium",
          user_id: uid, school_id: schoolId,
          title: "Sign-in from a new device and network",
          detail: `First sign-in from this device and network after ${prior.length} earlier logins in the last ${T.historyDays} days.`,
          evidence: { ip: e.ip_address, device: e.device_key, earlier_logins: prior.length, at: e.created_at },
          dedupe_key: `new_device_and_network:${uid}:${e.device_key}:${ipPrefix(e.ip_address)}`,
        });
      }
      if (ipPrefix(e.ip_address)) seenIp.add(ipPrefix(e.ip_address)!);
      if (e.device_key) seenDev.add(e.device_key);

      // 5. Odd hours for staff, only when it is unusual for that person.
      if (STAFF_ROLES.includes(role) && prior.length >= T.oddHourBaselineNeeded) {
        const localHour = new Date(when + tzOffsetMinutes * MIN).getUTCHours();
        if (localHour >= T.oddHourStart && localHour < T.oddHourEnd) {
          const inWindow = prior.filter((p) => {
            const h = new Date(t(p) + tzOffsetMinutes * MIN).getUTCHours();
            return h >= T.oddHourStart && h < T.oddHourEnd;
          }).length;
          if (inWindow / prior.length < T.oddHourMaxShare) {
            out.push({
              rule: "odd_hours_login", severity: "low", user_id: uid, school_id: schoolId,
              title: "Sign-in at an unusual hour",
              detail: `Signed in at ${String(localHour).padStart(2, "0")}:xx local time; fewer than ${Math.round(T.oddHourMaxShare * 100)}% of this person's usual logins happen overnight.`,
              evidence: { local_hour: localHour, ip: e.ip_address, device: e.device_key, at: e.created_at },
              dedupe_key: `odd_hours_login:${uid}:${new Date(when + tzOffsetMinutes * MIN).toISOString().slice(0, 10)}`,
            });
          }
        }
      }
    }

    // 6. Several different networks in one hour.
    const w = busiestWindow(logins, T.rapidIpWindowMin * MIN, (e) => ipPrefix(e.ip_address));
    if (w.count >= T.rapidIpPrefixes) {
      out.push({
        rule: "rapid_network_change", severity: "medium", user_id: uid, school_id: schoolId,
        title: "Sign-ins from several networks in one hour",
        detail: `${w.count} different networks signed in to this account within ${T.rapidIpWindowMin} minutes. The account may be shared or compromised.`,
        evidence: { networks: w.keys.slice(0, 6), window_minutes: T.rapidIpWindowMin, from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() },
        dedupe_key: `rapid_network_change:${uid}:${hourBucket(w.end)}`,
      });
    }
  }

  // 7. Data exports: unusually many in an hour, or one very large one.
  const recExportsByUser = groupBy(rec.filter((e) => e.event_type === "data_export"), (e) => e.user_id);
  for (const [uid, evs] of recExportsByUser) {
    const base = peakPerHour((histByUser.get(uid) ?? []).filter((e) => e.event_type === "data_export"), (e) => e.id ?? e.created_at);
    const need = Math.max(T.exportMinCount, base * T.exportBaselineFactor);
    const w = busiestWindow(evs, HOUR, (e) => e.id ?? e.created_at);
    const schoolId = evs.find((e) => e.school_id)?.school_id ?? null;
    if (w.count >= need) {
      out.push({
        rule: "bulk_export", severity: w.count >= T.exportHighCount ? "high" : "medium", user_id: uid, school_id: schoolId,
        title: "Unusually many data exports",
        detail: `${w.count} exports in one hour; this person's usual busiest hour is ${base}.`,
        evidence: { exports: w.count, usual_peak_per_hour: base, resources: [...new Set(evs.map((e) => e.metadata?.resource).filter(Boolean))].slice(0, 6), from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() },
        dedupe_key: `bulk_export:${uid}:${hourBucket(w.end)}`,
      });
    }
    for (const e of evs) {
      const rows = Number(e.metadata?.count ?? 0);
      if (rows >= T.largeExportRows) {
        out.push({
          rule: "large_export", severity: rows >= T.hugeExportRows ? "high" : "medium", user_id: uid, school_id: schoolId,
          title: "Large data export",
          detail: `One export contained ${rows.toLocaleString("en-IN")} records${e.metadata?.resource ? ` from ${e.metadata.resource}` : ""}.`,
          evidence: { records: rows, resource: e.metadata?.resource ?? null, at: e.created_at },
          dedupe_key: `large_export:${uid}:${e.id ?? e.created_at}`,
        });
      }
    }
  }

  // 8. Mass record access: opening far more distinct student/staff records than usual in an hour.
  const recViewsByUser = groupBy(rec.filter((e) => e.event_type === "record_view"), (e) => e.user_id);
  for (const [uid, evs] of recViewsByUser) {
    const role = evs[0].role ?? "";
    const floor = LEADERSHIP.includes(role) ? T.viewDistinctLeadership : T.viewDistinctStaff;
    const rid = (e: SecEvent) => (e.metadata?.resource_id ? String(e.metadata.resource_id) : null);
    const base = peakPerHour((histByUser.get(uid) ?? []).filter((e) => e.event_type === "record_view"), rid);
    const need = Math.max(floor, base * T.viewBaselineFactor);
    const w = busiestWindow(evs, HOUR, rid);
    if (w.count >= need) {
      out.push({
        rule: "mass_record_access", severity: w.count >= need * 2 ? "high" : "medium", user_id: uid,
        school_id: evs.find((e) => e.school_id)?.school_id ?? null,
        title: "Unusually many records opened",
        detail: `${w.count} different records opened within one hour; this person's usual busiest hour is ${base}.`,
        evidence: { distinct_records: w.count, usual_peak_per_hour: base, resource: evs[0].metadata?.resource ?? null, from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() },
        dedupe_key: `mass_record_access:${uid}:${hourBucket(w.end)}`,
      });
    }
  }

  // Newest-and-most-severe first; collapse accidental duplicate keys.
  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.dedupe_key) ? false : (seen.add(a.dedupe_key), true)))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}
