/**
 * messageDeliveryModel.ts
 * Pure helpers for Communication Module delivery + read tracking. No React, no Supabase.
 *
 * Status meaning (mirrors the generated `teacher_messages.delivery_status` column):
 *   pending    the recipient's APAS app has not confirmed receiving the message
 *   delivered  the recipient's own client fetched it and confirmed (ack_message_delivery)
 *   read       the recipient opened it (is_read = true)
 * A push notification accepted by FCM is deliberately NOT "delivered": FCM only confirms it accepted the request.
 */

export type DeliveryStatus = "pending" | "delivered" | "read";
export type DeliveryFilter = "all" | DeliveryStatus;

export const DELIVERY_STATUSES: DeliveryStatus[] = ["pending", "delivered", "read"];
export const DELIVERY_FILTERS: DeliveryFilter[] = ["all", "pending", "delivered", "read"];

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "Pending",
  delivered: "Delivered",
  read: "Read",
};

export const STATUS_HELP: Record<DeliveryStatus, string> = {
  pending: "The recipient's APAS app has not confirmed receiving this yet (for example they are offline).",
  delivered: "The message reached the recipient's APAS inbox but has not been opened.",
  read: "The recipient opened the message.",
};

export interface DeliveryRow {
  message_id: string;
  recipient_id: string;
  recipient_role: string | null;
  delivery_status: DeliveryStatus;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string | null;
}

export interface DeliverySummary {
  total: number;
  pending: number;
  delivered: number;
  read: number;
}

export const EMPTY_SUMMARY: DeliverySummary = { total: 0, pending: 0, delivered: 0, read: 0 };

/** Anything unexpected is treated as pending, never as delivered/read. */
export function normalizeStatus(raw: unknown): DeliveryStatus {
  return raw === "read" || raw === "delivered" ? raw : "pending";
}

/** Same rule as the DB column: read beats delivered beats pending. */
export function deriveStatus(m: { is_read?: boolean | null; delivered_at?: string | null }): DeliveryStatus {
  if (m.is_read) return "read";
  if (m.delivered_at) return "delivered";
  return "pending";
}

/** Status for a message row, preferring the server's column and falling back to the same derivation. */
export function statusOfMessage(m: {
  delivery_status?: unknown;
  is_read?: boolean | null;
  delivered_at?: string | null;
}): DeliveryStatus {
  if (m.delivery_status !== undefined && m.delivery_status !== null) return normalizeStatus(m.delivery_status);
  return deriveStatus(m);
}

/** One report per broadcast (batch_id) or per direct message (its own id). */
export function reportKey(m: { id: string; batch_id?: string | null }): string {
  return m.batch_id || m.id;
}

export function summarize(rows: Pick<DeliveryRow, "delivery_status">[]): DeliverySummary {
  const s: DeliverySummary = { total: 0, pending: 0, delivered: 0, read: 0 };
  for (const r of rows) {
    s.total += 1;
    s[normalizeStatus(r.delivery_status)] += 1;
  }
  return s;
}

/** Build a summary from the RPC row (bigint counts can arrive as strings). */
export function summaryFromRpc(r: {
  total_recipients?: unknown;
  pending_count?: unknown;
  delivered_count?: unknown;
  read_count?: unknown;
}): DeliverySummary {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
  };
  return {
    total: n(r.total_recipients),
    pending: n(r.pending_count),
    delivered: n(r.delivered_count),
    read: n(r.read_count),
  };
}

export function countFor(summary: DeliverySummary, filter: DeliveryFilter): number {
  return filter === "all" ? summary.total : summary[filter];
}

export function filterRows<T extends Pick<DeliveryRow, "delivery_status">>(rows: T[], filter: DeliveryFilter): T[] {
  if (filter === "all") return rows;
  return rows.filter((r) => normalizeStatus(r.delivery_status) === filter);
}

export function percent(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** Single-status view of a summary, for a compact tick on one message. */
export function overallStatus(s: DeliverySummary): DeliveryStatus {
  if (s.total > 0 && s.read === s.total) return "read";
  if (s.total > 0 && s.pending === 0) return "delivered";
  return "pending";
}

const ORDER: Record<DeliveryStatus, number> = { pending: 0, delivered: 1, read: 2 };

/** Pending first (those need attention), then delivered, then read; names A-Z inside each group. */
export function sortRecipients<T extends Pick<DeliveryRow, "delivery_status" | "recipient_id">>(
  rows: T[],
  nameFor: (id: string) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const d = ORDER[normalizeStatus(a.delivery_status)] - ORDER[normalizeStatus(b.delivery_status)];
    if (d !== 0) return d;
    return nameFor(a.recipient_id).localeCompare(nameFor(b.recipient_id), undefined, { sensitivity: "base" });
  });
}

export function searchRows<T extends Pick<DeliveryRow, "recipient_id">>(
  rows: T[],
  query: string,
  nameFor: (id: string) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => nameFor(r.recipient_id).toLowerCase().includes(q));
}

/** De-duplicate and chunk ids before an ack call. */
export function chunkIds(ids: string[], size = 500): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/** One entry per recipient id, first one wins, so a broadcast can never create two records for one person. */
export function uniqueRecipients<T extends { id: string }>(recipients: T[]): T[] {
  const seen = new Set<string>();
  return recipients.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
