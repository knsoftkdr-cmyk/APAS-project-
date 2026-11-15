/**
 * scheduledMessagesModel.ts
 * Pure helpers for Communication Module "Scheduled Messages". No React, no Supabase.
 *
 * Lifecycle (mirrors public.scheduled_messages.status, enforced server-side):
 *   scheduled -> sent        delivered into teacher_messages at the scheduled time (exactly once)
 *   scheduled -> cancelled   cancelled by the sender (or a school admin) before it went out
 *   scheduled -> failed      delivery kept failing (5 attempts) - nothing was sent
 * `sent`, `cancelled` and `failed` are final: a message can only be edited or cancelled while it is `scheduled`.
 *
 * Everything here is a convenience for the UI. The database is the authority on permissions, recipient scope and
 * the "only while scheduled" rule, so none of these checks is a security boundary.
 */

export type ScheduledStatus = "scheduled" | "sent" | "cancelled" | "failed";
export type ScheduledFilter = ScheduledStatus;

export const SCHEDULED_FILTERS: ScheduledFilter[] = ["scheduled", "sent", "cancelled", "failed"];

export const STATUS_LABEL: Record<ScheduledStatus, string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const STATUS_HELP: Record<ScheduledStatus, string> = {
  scheduled: "Waiting for its delivery time. You can still edit or cancel it.",
  sent: "Delivered to the recipients' Communication Center at the scheduled time.",
  cancelled: "Cancelled before it was sent. Nothing was delivered.",
  failed: "Delivery failed repeatedly. Nothing was delivered. Schedule it again to retry.",
};

/** Roles that have a Communication Center composer (mirrors scheduled_message_sender_roles() in the database). */
export const SCHEDULE_SENDER_ROLES = ["teacher", "admin", "principal", "hod", "school_admin"] as const;
/** Roles that may also view and cancel other people's scheduled messages of their school. */
export const SCHEDULE_MODERATOR_ROLES = ["admin", "principal", "school_admin"] as const;

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_RECIPIENTS = 5000;
/** The UI asks for at least this much lead time; the server only requires "in the future". */
export const MIN_LEAD_MINUTES = 1;
export const MAX_HORIZON_DAYS = 365;

export interface ScheduledMessage {
  id: string;
  school_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  message_type: string;
  attachment_url: string | null;
  attachment_name: string | null;
  audience_label: string | null;
  scheduled_for: string;
  status: ScheduledStatus;
  batch_id: string;
  recipient_count: number;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipientRef {
  id: string;
  role: string;
}

export function canScheduleMessages(role: string | null | undefined): boolean {
  return !!role && (SCHEDULE_SENDER_ROLES as readonly string[]).includes(role);
}

export function normalizeStatus(raw: unknown): ScheduledStatus {
  return raw === "sent" || raw === "cancelled" || raw === "failed" ? raw : "scheduled";
}

/** Edit is for the sender only, and only before the message goes out. */
export function canEdit(m: Pick<ScheduledMessage, "status" | "sender_id">, userId: string | null | undefined): boolean {
  return !!userId && m.sender_id === userId && m.status === "scheduled";
}

/** The sender, or an admin / principal / school_admin of the school, may cancel - only while still scheduled. */
export function canCancel(
  m: Pick<ScheduledMessage, "status" | "sender_id">,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!userId || m.status !== "scheduled") return false;
  return m.sender_id === userId || (!!role && (SCHEDULE_MODERATOR_ROLES as readonly string[]).includes(role));
}

/** Scheduled time has passed but the worker has not delivered it yet (it runs every minute). */
export function isDueSoon(m: Pick<ScheduledMessage, "status" | "scheduled_for">, now: Date = new Date()): boolean {
  return m.status === "scheduled" && new Date(m.scheduled_for).getTime() <= now.getTime();
}

export function countByStatus(list: Pick<ScheduledMessage, "status">[]): Record<ScheduledStatus, number> {
  const c: Record<ScheduledStatus, number> = { scheduled: 0, sent: 0, cancelled: 0, failed: 0 };
  for (const m of list) c[normalizeStatus(m.status)] += 1;
  return c;
}

export function filterByStatus<T extends Pick<ScheduledMessage, "status">>(list: T[], status: ScheduledFilter): T[] {
  return list.filter((m) => normalizeStatus(m.status) === status);
}

/** Upcoming messages soonest first (what is going out next); everything else newest first. */
export function sortForDisplay<T extends Pick<ScheduledMessage, "status" | "scheduled_for">>(
  list: T[],
  status: ScheduledFilter,
): T[] {
  const dir = status === "scheduled" ? 1 : -1;
  return [...list].sort((a, b) => dir * (new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()));
}

/** Key the EXISTING delivery report uses: batch_id for a broadcast, the teacher_messages row id for one recipient. */
export function deliveryReportKey(
  m: Pick<ScheduledMessage, "status" | "batch_id" | "recipient_count">,
  singleMessageId: string | null | undefined,
): string | null {
  if (m.status !== "sent") return null;
  if (m.recipient_count > 1) return m.batch_id;
  return singleMessageId || null;
}

// ─────────────────────────────────────────── date / time ───────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** Value for <input type="datetime-local"> in the user's LOCAL time ("YYYY-MM-DDTHH:mm"). */
export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses a datetime-local value as LOCAL time. Returns null for empty / malformed / impossible dates (e.g. 31 Feb). */
export function fromLocalInputValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) {
    return null; // rolled over: not a real local time (31 Feb, or a clock-change gap)
  }
  return date;
}

export interface SchedulePreset {
  id: string;
  label: string;
  at: Date;
}

/** Quick picks shown in the dialog, computed from `now` so they are always in the future. */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  inOneHour.setSeconds(0, 0);

  const tomorrow8 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);

  const nextMonday8 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
  const daysToMonday = ((8 - nextMonday8.getDay()) % 7) || 7; // always the NEXT Monday, never today
  nextMonday8.setDate(nextMonday8.getDate() + daysToMonday);

  return [
    { id: "in-1h", label: "In 1 hour", at: inOneHour },
    { id: "tomorrow-8", label: "Tomorrow, 8:00 AM", at: tomorrow8 },
    { id: "monday-8", label: "Next Monday, 8:00 AM", at: nextMonday8 },
  ];
}

/** "in 2h 15m", "in 3 days", "due now". */
export function timeUntil(target: Date | string, now: Date = new Date()): string {
  const ms = new Date(target).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "due now";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

// ─────────────────────────────────────────── validation ───────────────────────────────────────────

export interface ScheduleDraft {
  text: string;
  hasAttachment: boolean;
  /** datetime-local value in the user's local time. */
  localValue: string;
  recipientCount: number;
}

export interface ScheduleValidation {
  ok: boolean;
  when: Date | null;
  errors: { message?: string; when?: string; recipients?: string };
}

export function validateSchedule(draft: ScheduleDraft, now: Date = new Date()): ScheduleValidation {
  const errors: ScheduleValidation["errors"] = {};

  const text = (draft.text ?? "").trim();
  if (!text && !draft.hasAttachment) errors.message = "Write a message or attach a file.";
  else if (text.length > MAX_MESSAGE_LENGTH) errors.message = `Message is too long (${MAX_MESSAGE_LENGTH} characters maximum).`;

  const when = fromLocalInputValue(draft.localValue);
  if (!draft.localValue) errors.when = "Choose a date and time.";
  else if (!when) errors.when = "That date or time is not valid.";
  else if (when.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    errors.when = MIN_LEAD_MINUTES === 1 ? "Choose a time at least a minute from now." : `Choose a time at least ${MIN_LEAD_MINUTES} minutes from now.`;
  } else if (when.getTime() > now.getTime() + MAX_HORIZON_DAYS * 86_400_000) {
    errors.when = "Messages can be scheduled at most one year ahead.";
  }

  if (draft.recipientCount <= 0) errors.recipients = "Select at least one recipient.";
  else if (draft.recipientCount > MAX_RECIPIENTS) errors.recipients = `A scheduled message can have at most ${MAX_RECIPIENTS} recipients.`;

  return { ok: Object.keys(errors).length === 0, when: errors.when ? null : when, errors };
}

// ─────────────────────────────────────────── recipients ───────────────────────────────────────────

/** One entry per person (first wins), in the shape the schedule_message RPC expects. */
export function normalizeRecipients(list: { id: string; role: string }[]): RecipientRef[] {
  const seen = new Set<string>();
  const out: RecipientRef[] = [];
  for (const r of list) {
    if (!r?.id || !r?.role || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, role: r.role });
  }
  return out;
}

/** Label stored with a broadcast, so recipients (and the sender's thread) see who it was addressed to. */
export function audienceLabelFor(opts: { kind: "individual" | "group"; name: string }): string | null {
  return opts.kind === "group" ? opts.name : null;
}

/** Short "To:" line for a card: "All Parents", "Sam Student", "3 recipients". */
export function recipientSummary(m: Pick<ScheduledMessage, "audience_label" | "recipient_count">, firstName?: string | null): string {
  if (m.audience_label) return `${m.audience_label} · ${m.recipient_count} recipient${m.recipient_count === 1 ? "" : "s"}`;
  if (m.recipient_count === 1) return firstName || "1 recipient";
  return `${m.recipient_count} recipients`;
}

// ─────────────────────────────────────────── errors ───────────────────────────────────────────

/** True when the database objects are not installed yet (migration not applied). */
export function isMissingBackend(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return (
    e.code === "42P01" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205" ||
    /could not find the (function|table)|relation .* does not exist/i.test(e.message || "")
  );
}

/** Readable message for the toast. Our RPCs already raise human sentences; map the rest. */
export function friendlyError(e: { code?: string; message?: string } | null | undefined): string {
  if (!e) return "Something went wrong.";
  if (isMissingBackend(e)) return "Scheduled messages are not set up on the server yet. Ask an administrator to apply the latest database update.";
  if (e.code === "42501" && /permission denied/i.test(e.message || "")) return "You do not have permission to do that.";
  return e.message || "Something went wrong.";
}
