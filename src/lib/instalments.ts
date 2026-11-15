// Pure helpers + types for the fee-instalment feature (no network, no React) so the rules are unit-tested.
// The database is the source of truth for every rule below; these helpers only mirror them so the UI can preview
// a schedule and give instant feedback before the server re-validates it.

// ───────────────────────────────────────────── types ─────────────────────────────────────────────
export type RequestStatus = "pending" | "approved" | "rejected";
export type PlanStatus = "active" | "completed" | "cancelled";
export type DisplayStatus = "paid" | "pending" | "upcoming" | "overdue" | "failed" | "partially_paid" | "cancelled";
export type TxnStatus = "created" | "pending" | "success" | "failed" | "cancelled" | "refunded" | "partially_refunded";

export interface InstalmentSettings {
  enabled: boolean;
  allowed_counts: number[];
  allow_flexible: boolean;
  default_count: number;
  min_instalment_amount: number | null;
  max_instalment_amount: number | null;
}
export interface InstalmentSettingsRow extends InstalmentSettings {
  school_id: string;
  default_interval_days: number;
  reminder_days: number[];
  overdue_repeat_days: number;
}
export interface ParentFee {
  fee_payment_id: string;
  amount_due: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  status: string;
  overdue: boolean;
  plan_id: string | null;
  pending_request_id: string | null;
  eligible: boolean;
  course_amount: number;
  transport_amount: number;
  other_amount: number;
  uniform_amount: number;
  material_amount: number;
  exam_amount: number;
}
export interface ParentOverview {
  school_id: string | null;
  settings: InstalmentSettings;
  fees: ParentFee[];
}
export interface InstalmentRequest {
  id: string;
  school_id: string;
  student_id: string;
  fee_payment_id: string | null;
  requested_amount: number;
  requested_count: number;
  reason: string;
  status: RequestStatus;
  approved_amount: number | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}
export interface InstalmentPlan {
  id: string;
  school_id: string;
  student_id: string;
  fee_payment_id: string;
  request_id: string;
  student_name: string;
  class_grade: string | null;
  section: string | null;
  total_amount: number;
  status: PlanStatus;
  created_at: string;
}
export interface InstalmentItem {
  id: string;
  plan_id: string;
  school_id: string;
  student_id: string;
  seq: number;
  amount: number;
  amount_paid: number;
  balance: number;
  due_date: string;
  status: "pending" | "partially_paid" | "paid" | "cancelled";
  display_status: DisplayStatus;
  paid_at: string | null;
  student_name?: string;
  class_grade?: string | null;
  section?: string | null;
  fee_payment_id?: string;
}
export interface InstalmentTxn {
  id: string;
  item_id: string;
  plan_id: string;
  amount: number;
  refunded_amount: number;
  status: TxnStatus;
  receipt_no: string | null;
  razorpay_payment_id: string | null;
  gateway?: string;
  failure_reason: string | null;
  method: string | null;
  created_at: string;
  paid_at: string | null;
}
export interface AdminSummary {
  students: number;
  active_plans: number;
  total_scheduled: number;
  collected: number;
  pending: number;
  overdue_count: number;
  overdue_amount: number;
  partially_paid_count: number;
  pending_requests: number;
  by_class: { class_grade: string; section: string; students: number; scheduled: number; collected: number; pending: number; overdue_count: number; overdue_amount: number }[];
}
export interface ScheduleRow { id?: string; amount: number; due_date: string }

// ───────────────────────────────────────────── money (integer paise: no float drift) ─────────────────────────────────────────────
export const toCents = (rupees: number | string): number => Math.round(Number(rupees) * 100);
export const fromCents = (cents: number): number => cents / 100;

export function formatINR(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const whole = Number.isInteger(Math.round(n * 100) / 100) && Math.round(n * 100) % 100 === 0;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// ───────────────────────────────────────────── dates (school calendar day, India) ─────────────────────────────────────────────
/** Today's date in India as YYYY-MM-DD - what the database uses to decide "overdue". */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  const f = from.split("-").map(Number), t = to.split("-").map(Number);
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86400000);
}
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// ───────────────────────────────────────────── schedule maths (mirrors instalment_split) ─────────────────────────────────────────────
/** Split a total into n parts at 2 decimals; the LAST part absorbs rounding so the parts sum EXACTLY to the total. */
export function splitEvenly(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error("Number of instalments must be at least 1");
  const cents = toCents(total);
  const base = Math.floor(cents / n);
  const parts = Array<number>(n - 1).fill(base);
  parts.push(cents - base * (n - 1));
  return parts.map(fromCents);
}

/** Automatic schedule: n equal-ish instalments starting at firstDue, spaced intervalDays apart (what approve does when no custom schedule is given). */
export function buildSchedule(total: number, n: number, firstDue: string, intervalDays: number): ScheduleRow[] {
  return splitEvenly(total, n).map((amount, i) => ({ amount, due_date: addDays(firstDue, i * intervalDays) }));
}

export function scheduleSum(rows: { amount: number }[]): number {
  return fromCents(rows.reduce((s, r) => s + toCents(r.amount || 0), 0));
}

/** Instant, human-readable problems with a schedule draft. Empty = OK to submit (the server still re-checks everything). */
export function validateSchedule(
  rows: ScheduleRow[],
  expectedTotal: number,
  opts: { today?: string; minCount?: number; minAmount?: number | null; maxAmount?: number | null; existingIds?: Set<string> } = {},
): string[] {
  const errors: string[] = [];
  const today = opts.today ?? todayIST();
  if (rows.length < (opts.minCount ?? 1)) errors.push(`A schedule needs at least ${opts.minCount ?? 1} instalment${(opts.minCount ?? 1) > 1 ? "s" : ""}.`);
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!(Number(r.amount) > 0)) errors.push(`Instalment ${n}: enter an amount above zero.`);
    else if (toCents(r.amount) !== Number(r.amount) * 100 && Math.abs(Number(r.amount) * 100 - toCents(r.amount)) > 1e-6) errors.push(`Instalment ${n}: use at most 2 decimals.`);
    if (!r.due_date) errors.push(`Instalment ${n}: choose a due date.`);
    else if (r.due_date < today && !(r.id && opts.existingIds?.has(r.id))) errors.push(`Instalment ${n}: the due date cannot be in the past.`);
    if (opts.minAmount != null && Number(r.amount) > 0 && Number(r.amount) < opts.minAmount) errors.push(`Instalment ${n}: below the school minimum of ${formatINR(opts.minAmount)}.`);
    if (opts.maxAmount != null && Number(r.amount) > opts.maxAmount) errors.push(`Instalment ${n}: above the school maximum of ${formatINR(opts.maxAmount)}.`);
  });
  const diff = toCents(expectedTotal) - rows.reduce((s, r) => s + toCents(r.amount || 0), 0);
  if (diff !== 0) errors.push(diff > 0 ? `${formatINR(fromCents(diff))} is still unallocated - the instalments must add up to ${formatINR(expectedTotal)}.` : `The instalments exceed the total by ${formatINR(fromCents(-diff))}.`);
  return errors;
}

// ───────────────────────────────────────────── plan progress ─────────────────────────────────────────────
export interface PlanProgress {
  total: number; paid: number; balance: number; percent: number;
  count: number; paidCount: number; overdueCount: number;
  next: InstalmentItem | null;
}
export function planProgress(items: InstalmentItem[]): PlanProgress {
  const live = items.filter((i) => i.status !== "cancelled");
  const totalC = live.reduce((s, i) => s + toCents(i.amount), 0);
  const paidC = live.reduce((s, i) => s + toCents(i.amount_paid), 0);
  const open = live.filter((i) => i.status !== "paid").sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq);
  return {
    total: fromCents(totalC), paid: fromCents(paidC), balance: fromCents(totalC - paidC),
    percent: totalC > 0 ? Math.min(100, Math.round((paidC / totalC) * 100)) : 0,
    count: live.length, paidCount: live.filter((i) => i.status === "paid").length,
    overdueCount: live.filter((i) => i.display_status === "overdue").length,
    next: open[0] ?? null,
  };
}

export const canPay = (i: Pick<InstalmentItem, "status" | "balance">): boolean => (i.status === "pending" || i.status === "partially_paid") && Number(i.balance) > 0;

// ───────────────────────────────────────────── status presentation ─────────────────────────────────────────────
export const STATUS_META: Record<DisplayStatus, { label: string; tone: "success" | "warning" | "danger" | "info" | "muted" | "gold"; hint: string }> = {
  paid: { label: "Paid", tone: "success", hint: "Payment received and verified" },
  pending: { label: "Pending", tone: "muted", hint: "Not due yet" },
  upcoming: { label: "Upcoming", tone: "gold", hint: "Due within 7 days" },
  overdue: { label: "Overdue", tone: "danger", hint: "Past the due date and unpaid" },
  failed: { label: "Failed", tone: "danger", hint: "The last payment attempt did not go through - no money was recorded" },
  partially_paid: { label: "Part paid", tone: "info", hint: "Part of this instalment is paid" },
  cancelled: { label: "Cancelled", tone: "muted", hint: "Removed from the schedule" },
};

export const TXN_LABEL: Record<TxnStatus, string> = {
  created: "Started", pending: "Processing", success: "Successful", failed: "Failed", cancelled: "Cancelled", refunded: "Refunded", partially_refunded: "Part refunded",
};

/** Postgres/RPC errors -> a sentence a parent can act on. */
export function friendlyError(message: string | undefined | null): string {
  const m = (message ?? "").trim();
  if (!m) return "Something went wrong. Please try again.";
  if (/row-level security|permission denied|Not authorised/i.test(m)) return "You don't have permission to do that.";
  if (/duplicate key|uq_instalment/i.test(m)) return "This schedule already exists.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Network problem - please check your connection and try again.";
  return m.replace(/^error:\s*/i, "");
}

// ───────────────────────────────────────────── admin reports ─────────────────────────────────────────────
export interface StudentReportRow {
  student_id: string; student_name: string; class_grade: string; section: string;
  instalments: number; scheduled: number; paid: number; pending: number; overdue: number; overdueCount: number; nextDue: string | null;
}
/** One row per student across all their (non-cancelled) instalments - the "student-wise report". */
export function studentReport(items: InstalmentItem[]): StudentReportRow[] {
  const by = new Map<string, { r: StudentReportRow; s: number; p: number; o: number }>();
  for (const i of items) {
    if (i.status === "cancelled") continue;
    let e = by.get(i.student_id);
    if (!e) {
      e = { r: { student_id: i.student_id, student_name: i.student_name ?? "—", class_grade: i.class_grade ?? "-", section: i.section ?? "-", instalments: 0, scheduled: 0, paid: 0, pending: 0, overdue: 0, overdueCount: 0, nextDue: null }, s: 0, p: 0, o: 0 };
      by.set(i.student_id, e);
    }
    e.r.instalments += 1;
    e.s += toCents(i.amount); e.p += toCents(i.amount_paid);
    if (i.display_status === "overdue") { e.o += toCents(i.balance); e.r.overdueCount += 1; }
    if (i.status !== "paid" && (e.r.nextDue === null || i.due_date < e.r.nextDue)) e.r.nextDue = i.due_date;
  }
  return [...by.values()].map(({ r, s, p, o }) => ({ ...r, scheduled: fromCents(s), paid: fromCents(p), pending: fromCents(s - p), overdue: fromCents(o) }))
    .sort((a, b) => a.class_grade.localeCompare(b.class_grade, undefined, { numeric: true }) || a.section.localeCompare(b.section) || a.student_name.localeCompare(b.student_name));
}

/** CSV with every cell quoted, and cells that start with = + - @ neutralised so a hostile student name can't run as a spreadsheet formula. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
