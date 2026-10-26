// Notification model - pure helpers (no React, no Supabase) shared by NotificationContext, the bell and the
// Notification Inbox page, so there is exactly one definition of "category", "important" and "where does this open".
//
// Nothing here decides who may SEE a notification. Rows in governance_notifications are per recipient and RLS
// returns only the signed-in user's own rows; the context never fetches anyone else's. This file only
// classifies, links, filters and de-duplicates what the user already has.

export type NotificationType = "info" | "success" | "warning" | "error";

export type NotificationCategory = "academics" | "attendance" | "messages" | "transport" | "approvals" | "safety" | "system";

export interface NotificationLike {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  is_read: boolean;
  created_at: string;
  link?: string;
  /** Stored governance_notifications.event_type, or a short name for notifications raised in the browser. */
  event_type?: string;
  category?: NotificationCategory;
  /** "db" = backed by a governance_notifications row (read/dismiss are saved there); otherwise browser-only. */
  source?: "db" | "local";
  /** Optional identity for the live-arrival duplicate guard (e.g. the sender, so two senders' messages never merge). */
  dedupe_key?: string;
}

export const CATEGORY_META: Record<NotificationCategory, { label: string }> = {
  academics: { label: "Academics" },
  attendance: { label: "Attendance" },
  messages: { label: "Messages" },
  transport: { label: "Transport" },
  approvals: { label: "Requests & approvals" },
  safety: { label: "Safety & alerts" },
  system: { label: "System" },
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_META) as NotificationCategory[];

// ─────────────────────────────────────────── classification ───────────────────────────────────────────

const SAFETY_EVENTS = new Set([
  "vehicle_overspeed", "unauthorized_stop", "unauthorized_boarding", "restricted_zone_entry", "route_deviation",
  "student_incident", "weather_alert",
]);

const TRANSPORT_PREFIXES = ["transport_", "vehicle_", "route_", "round_", "geofence_"];

/** Category of a notification. Uses the event type when there is one, else falls back to the wording/link. */
export function inferCategory(n: Pick<NotificationLike, "event_type" | "title" | "link" | "category">): NotificationCategory {
  if (n.category) return n.category;
  const e = (n.event_type ?? "").toLowerCase();
  if (e) {
    if (SAFETY_EVENTS.has(e)) return "safety";
    if (TRANSPORT_PREFIXES.some((p) => e.startsWith(p))) return "transport";
    if (e.startsWith("calendar_")) return "academics";
    if (e.startsWith("attendance")) return "attendance";
    if (e === "tutor_message" || e.includes("message")) return "messages";
    if (e.startsWith("diagnostic_request") || e.startsWith("substitute") || e.startsWith("transfer") || e === "promotion" || e === "alumni_conversion") return "approvals";
    if (e.startsWith("diagnostic") || e.startsWith("assessment") || e.startsWith("homework") || e.startsWith("worksheet") || e.startsWith("exam") || e.startsWith("lesson")) return "academics";
    if (e.startsWith("automation") || e.includes("calibration") || e.startsWith("irt")) return "system";
  }
  const t = (n.title ?? "").toLowerCase();
  if (/message|meeting|appreciation|behaviour/.test(t)) return "messages";
  if (/request|approved|rejected/.test(t)) return "approvals";
  if (/homework|worksheet|exam|diagnostic|lesson|milestone|assessment/.test(t)) return "academics";
  if (/attendance/.test(t)) return "attendance";
  if (/bus|transport|boarding/.test(t)) return "transport";
  if (/performance drop|alert/.test(t)) return "safety";
  return "system";
}

/**
 * "Important" = something a person should not miss: a safety/transport alert, a rejected request, a performance drop,
 * an absence, or anything the app already styles as a warning/error. There is no stored flag (the table has no such
 * column), so this is derived the same way everywhere.
 */
export function isImportant(n: Pick<NotificationLike, "type" | "event_type" | "message" | "title">): boolean {
  if (n.type === "warning" || n.type === "error") return true;
  const e = (n.event_type ?? "").toLowerCase();
  if (SAFETY_EVENTS.has(e)) return true;
  if (e === "diagnostic_request_rejected" || e === "irt_calibration_flagged") return true;
  if (e === "attendance_marked" && /\babsent\b/i.test(`${n.title} ${n.message}`)) return true;
  return false;
}

// ─────────────────────────────────────────── where a notification opens ───────────────────────────────────────────
// Only routes that exist in App.tsx AND admit the role (verified by the test suite against App.tsx).

const SCHOOL_ADMIN_ROLES = ["admin", "principal", "school_admin"];

export function governanceLink(eventType: string, role: string | null | undefined): string | undefined {
  const e = (eventType ?? "").toLowerCase();
  const r = role ?? "";
  const isTransportish = SAFETY_EVENTS.has(e) || TRANSPORT_PREFIXES.some((p) => e.startsWith(p));
  if (isTransportish) {
    if (r === "parent") return "/parent-dashboard";
    if (r === "driver") return "/driver/tracking";
    if (SCHOOL_ADMIN_ROLES.includes(r)) return "/transport";
    return undefined;
  }
  if (e.startsWith("calendar_")) return ["student", "parent", "teacher", "hod", ...SCHOOL_ADMIN_ROLES].includes(r) ? "/academic-calendar" : undefined;
  if (e === "attendance_marked") return r === "parent" || r === "student" ? "/attendance" : undefined;
  if (e === "diagnostic_request_approved") return ["teacher", "admin", "hod", "principal"].includes(r) ? "/curative" : undefined;
  if (e === "diagnostic_request_rejected") return ["teacher", "admin", "principal", "hod"].includes(r) ? "/requests" : undefined;
  if (e === "diagnostic_request_submitted" || e === "diagnostic_questions_assigned") return [...SCHOOL_ADMIN_ROLES, "hod"].includes(r) ? "/admin" : undefined;
  if (e === "diagnostic_completed") return r === "teacher" ? "/diagnostic" : [...SCHOOL_ADMIN_ROLES, "hod"].includes(r) ? "/admin" : undefined;
  if (e === "substitute_approved") return r === "teacher" ? "/timetable" : undefined;
  if (e === "tutor_message") return r === "student" ? "/ai-tutor" : undefined;
  if (e === "irt_calibration_flagged" || e === "open_ended_calibration_adjusted") return r === "knsoft_admin" ? "/notification-dashboard" : undefined;
  if (e.startsWith("automation_")) return r === "knsoft_admin" ? "/automation-dashboard" : undefined;
  return undefined;
}

export interface GovernanceRow {
  id: string;
  event_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

/** Same type mapping the context already used (approved -> success, rejected -> warning), plus alerts -> warning. */
export function mapGovernanceRow(row: GovernanceRow, role: string | null | undefined): NotificationLike {
  const e = (row.event_type ?? "").toLowerCase();
  const type: NotificationType = e.includes("rejected") || SAFETY_EVENTS.has(e) || e === "irt_calibration_flagged"
    ? "warning"
    : e.includes("approved") ? "success" : "info";
  const n: NotificationLike = {
    id: row.id,
    title: row.title,
    message: row.message,
    type,
    is_read: !!row.is_read,
    created_at: row.created_at,
    event_type: row.event_type,
    source: "db",
    link: governanceLink(row.event_type, role),
  };
  n.category = inferCategory(n);
  return n;
}

// ─────────────────────────────────────────── list operations ───────────────────────────────────────────

export type InboxTab = "all" | "unread" | "read" | "important";

export interface InboxFilter {
  tab: InboxTab;
  category: NotificationCategory | "all";
  query: string;
}

export function normalizeSearch(q: string | null | undefined): string {
  return (q ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function filterNotifications(list: NotificationLike[], f: InboxFilter): NotificationLike[] {
  const q = normalizeSearch(f.query);
  return list.filter((n) => {
    if (f.tab === "unread" && n.is_read) return false;
    if (f.tab === "read" && !n.is_read) return false;
    if (f.tab === "important" && !isImportant(n)) return false;
    if (f.category !== "all" && inferCategory(n) !== f.category) return false;
    if (q && !`${n.title} ${n.message}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function tabCounts(list: NotificationLike[]): Record<InboxTab, number> {
  return {
    all: list.length,
    unread: list.filter((n) => !n.is_read).length,
    read: list.filter((n) => n.is_read).length,
    important: list.filter(isImportant).length,
  };
}

export function sortNewest<T extends { created_at: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Content identity of an event, for the "same event twice" guard. */
export function contentKey(n: Pick<NotificationLike, "title" | "message" | "link" | "dedupe_key">): string {
  return `${n.title}\u0001${n.message}\u0001${n.link ?? ""}\u0001${n.dedupe_key ?? ""}`.toLowerCase();
}

/**
 * True when an equivalent notification (same title + message + link) already exists that was created within
 * `windowMs` of the candidate - e.g. the same event arriving from two channels, or a re-subscribed channel replaying it.
 */
export function isDuplicateOfRecent(
  existing: Pick<NotificationLike, "title" | "message" | "link" | "created_at" | "dedupe_key">[],
  candidate: Pick<NotificationLike, "title" | "message" | "link" | "created_at" | "dedupe_key">,
  windowMs = 60_000,
): boolean {
  const key = contentKey(candidate);
  const t = Date.parse(candidate.created_at);
  return existing.some((e) => contentKey(e) === key && Math.abs(t - Date.parse(e.created_at)) <= windowMs);
}

/**
 * Merge lists by id. The first occurrence of an id wins, so pass the freshest copy first (e.g. the live state before
 * history fetched from the database). Notifications are NOT collapsed by wording: two different people sending the
 * same kind of message must both show.
 */
export function mergeNotifications(...lists: NotificationLike[][]): NotificationLike[] {
  const seen = new Set<string>();
  const out: NotificationLike[] = [];
  for (const n of lists.flat()) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return sortNewest(out);
}
