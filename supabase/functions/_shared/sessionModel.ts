// supabase/functions/_shared/sessionModel.ts
//
// Pure helpers for Session & Device Management (no I/O; unit-tested in src/test/sessionModel.test.ts).

// deno-lint-ignore-file no-explicit-any
export interface DeviceInfo { browser: string; os: string; kind: "desktop" | "mobile" | "tablet" | "app"; label: string }

export interface DeviceView {
  session_id: string;
  label: string;
  browser: string | null;
  os: string | null;
  kind: string | null;
  ip_address: string | null;
  first_seen: string | null;
  last_seen: string | null;
  current: boolean;
}

/** Friendly description of a user agent. `native` = the Capacitor app. */
export function describeDevice(ua: string | null | undefined, native = false): DeviceInfo {
  const s = String(ua ?? "");
  const os = /Android/i.test(s) ? "Android"
    : /iPhone|iPod/i.test(s) ? "iPhone"
    : /iPad/i.test(s) ? "iPad"
    : /Windows/i.test(s) ? "Windows"
    : /Mac OS X|Macintosh/i.test(s) ? "macOS"
    : /CrOS/i.test(s) ? "ChromeOS"
    : /Linux/i.test(s) ? "Linux" : "Unknown OS";
  const browser = /Edg\//i.test(s) ? "Edge"
    : /OPR\/|Opera/i.test(s) ? "Opera"
    : /SamsungBrowser/i.test(s) ? "Samsung Internet"
    : /Firefox\/|FxiOS/i.test(s) ? "Firefox"
    : /Chrome\/|CriOS/i.test(s) ? "Chrome"
    : /Safari\//i.test(s) ? "Safari" : "Browser";
  const tablet = /iPad/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const mobile = /iPhone|iPod|Android.*Mobile|Mobile/i.test(s);
  if (native) {
    return { browser: "App", os, kind: "app", label: os === "Unknown OS" ? "APAS app" : `APAS app on ${os}` };
  }
  const kind = tablet ? "tablet" : mobile ? "mobile" : "desktop";
  return { browser, os, kind, label: os === "Unknown OS" && browser === "Browser" ? "Unknown device" : `${browser} on ${os}` };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** `session_id` claim of a Supabase access token. The token is verified elsewhere (auth.getUser); this only reads it. */
export function sessionIdFromJwt(token: string | null | undefined): string | null {
  try {
    const part = String(token ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return isUuid(claims?.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

const stripMask = (ip: unknown) => (ip == null ? null : String(ip).replace(/\/(32|128)$/, "") || null);
const laterOf = (...ds: (string | null | undefined)[]) =>
  ds.filter(Boolean).sort((a, b) => Date.parse(b!) - Date.parse(a!))[0] ?? null;

/**
 * Live logins (rows of auth.sessions) + our labels (rows of user_sessions) -> what the person sees.
 * Expired logins and ones we recorded as revoked are dropped; the current device is always first.
 */
export function mergeSessions(authRows: any[], ownRows: any[], currentId: string | null, now = Date.now()): DeviceView[] {
  const own = new Map<string, any>((ownRows ?? []).map((r) => [r.session_id, r]));
  const out: DeviceView[] = [];
  for (const a of authRows ?? []) {
    if (a?.not_after && Date.parse(a.not_after) <= now) continue;
    const o = own.get(a.id);
    if (o?.revoked_at) continue;
    const ua = o?.user_agent ?? a.user_agent ?? null;
    const d = o?.device_label
      ? { label: o.device_label, browser: o.browser ?? null, os: o.os ?? null, kind: o.kind ?? null }
      : describeDevice(ua, false);
    out.push({
      session_id: a.id, label: d.label, browser: d.browser ?? null, os: d.os ?? null, kind: d.kind ?? null,
      ip_address: o?.ip_address ?? stripMask(a.ip),
      first_seen: o?.first_seen ?? a.created_at ?? null,
      last_seen: laterOf(o?.last_seen, a.refreshed_at, a.updated_at, a.created_at),
      current: a.id === currentId,
    });
  }
  return out.sort((x, y) =>
    Number(y.current) - Number(x.current) || Date.parse(y.last_seen ?? "0") - Date.parse(x.last_seen ?? "0"));
}
