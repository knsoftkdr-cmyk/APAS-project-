// Pure rules for the Automatic Fee Plan Assignment feature. Everything here MIRRORS the database migration
// 20261116000000_fee_plan_assignment.sql (the database is the source of truth and enforces the same rules); the client
// uses these to preview amounts before saving and to label what the server returns. No imports, so it is trivially testable.

export type FeeLineKey =
  | "admission_fee" | "tuition_fee" | "transport_fee" | "uniform_fee" | "material_fee" | "exam_fee" | "other_fee";

export const FEE_LINES: { key: FeeLineKey; label: string }[] = [
  { key: "admission_fee", label: "Admission fee" },
  { key: "tuition_fee", label: "Tuition fee" },
  { key: "transport_fee", label: "Transport fee" },
  { key: "uniform_fee", label: "Uniform" },
  { key: "material_fee", label: "Study material" },
  { key: "exam_fee", label: "Exam fee" },
  { key: "other_fee", label: "Other charges" },
];

export type FeeLines = Record<FeeLineKey, number>;

export const emptyLines = (): FeeLines => ({
  admission_fee: 0, tuition_fee: 0, transport_fee: 0, uniform_fee: 0, material_fee: 0, exam_fee: 0, other_fee: 0,
});

export interface InstalmentTemplateRow { label: string; percent: number; due_date: string }

export interface FeeStructure extends FeeLines {
  id: string;
  school_id: string;
  name: string;
  academic_year: string;
  class_grade: string;
  category: string | null;
  total_fee: number;
  due_date: string | null;
  instalment_schedule: InstalmentTemplateRow[] | null;
  notes: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type AssignmentStatus = "active" | "unmatched" | "cancelled";
export type MatchBasis = "exact" | "default" | "manual";

export interface FeeAssignmentView extends FeeLines {
  id: string;
  applicant_id: string;
  applicant_name: string;
  student_id: string | null;
  fee_payment_id: string | null;
  structure_id: string | null;
  structure_name: string | null;
  academic_year: string;
  class_grade: string;
  category: string | null;
  status: AssignmentStatus;
  source: "auto" | "manual";
  match_basis: MatchBasis | null;
  gross_total: number;
  concession_amount: number;
  concession_reason: string | null;
  net_total: number;
  paid: number;
  outstanding: number;
  fee_status: string | null;
  due_date: string | null;
  instalment_schedule: InstalmentTemplateRow[] | null;
  has_instalment_plan: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeeHistoryEntry {
  id: string;
  action: FeeHistoryAction;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  actor_name?: string | null;
  created_at: string;
}

export type FeeHistoryAction =
  | "auto_assigned" | "manual_assigned" | "corrected" | "structure_changed" | "concession_changed"
  | "cancelled" | "linked_student" | "instalments_created" | "no_match" | "error";

export const HISTORY_LABELS: Record<FeeHistoryAction, string> = {
  auto_assigned: "Assigned automatically on admission",
  manual_assigned: "Assigned manually",
  corrected: "Amounts corrected",
  structure_changed: "Fee structure changed",
  concession_changed: "Concession changed",
  cancelled: "Assignment cancelled",
  linked_student: "Linked to enrolled student",
  instalments_created: "Instalment plan created",
  no_match: "No matching fee structure found",
  error: "Automatic assignment failed",
};

/** Same normalisation as public.fee_norm(): "Grade 5" = "class 5" = "5"; "Pre-KG" = "pre kg"; "2026-27" = "2026 - 27". */
export function feeNorm(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replace(/^(grade|class)\s+/i, "");
  return trimmed.toLowerCase().replace(/[\s_-]+/g, "");
}

export const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const sumLines = (l: Partial<FeeLines>): number =>
  roundMoney(FEE_LINES.reduce((s, { key }) => s + (Number(l[key]) || 0), 0));

export interface MatchContext { school_id?: string; academic_year: string; class_grade: string; category: string | null | undefined }

/**
 * The structure the database trigger would pick: same academic year + class, and the applicant's category - or, when no
 * structure exists for that category, the "all categories" structure (blank category). A category-specific one always wins.
 * Inactive structures never match.
 */
export function matchStructure(structures: FeeStructure[], ctx: MatchContext): { structure: FeeStructure; basis: MatchBasis } | null {
  const year = feeNorm(ctx.academic_year);
  const grade = feeNorm(ctx.class_grade);
  const cat = feeNorm(ctx.category);
  const candidates = structures.filter(
    (s) => s.is_active && feeNorm(s.academic_year) === year && feeNorm(s.class_grade) === grade && (!ctx.school_id || s.school_id === ctx.school_id),
  );
  const exact = candidates.find((s) => feeNorm(s.category) === cat);
  if (exact) return { structure: exact, basis: "exact" };
  const fallback = candidates.find((s) => feeNorm(s.category) === "");
  return fallback ? { structure: fallback, basis: "default" } : null;
}

/** The six columns of the existing fee_payments ledger. Admission + other charges share other_amount (no admission column exists). */
export interface LedgerLines {
  course_amount: number; transport_amount: number; other_amount: number; uniform_amount: number; material_amount: number; exam_amount: number;
}

/** Concession order, identical to public.fee_ledger_lines(). */
const CONCESSION_ORDER: FeeLineKey[] = ["tuition_fee", "admission_fee", "other_fee", "exam_fee", "material_fee", "uniform_fee", "transport_fee"];

/** Splits a concession over the fee lines so the ledger columns always add up to gross - concession. Throws if it exceeds the fee. */
export function allocateConcession(lines: Partial<FeeLines>, concession: number): LedgerLines {
  const rest: FeeLines = { ...emptyLines(), ...lines };
  let remaining = roundMoney(Math.max(concession || 0, 0));
  for (const key of CONCESSION_ORDER) {
    const take = Math.min(rest[key], remaining);
    rest[key] = roundMoney(rest[key] - take);
    remaining = roundMoney(remaining - take);
  }
  if (remaining > 0) throw new Error("The concession cannot be more than the total fee");
  return {
    course_amount: rest.tuition_fee, transport_amount: rest.transport_fee, other_amount: roundMoney(rest.admission_fee + rest.other_fee),
    uniform_amount: rest.uniform_fee, material_amount: rest.material_fee, exam_amount: rest.exam_fee,
  };
}

export interface Breakdown { gross: number; concession: number; net: number; paid: number; outstanding: number; status: "paid" | "partial" | "overdue" | "pending" }

/** Fees -> concession -> net payable -> paid -> outstanding. `today` is injectable for tests (YYYY-MM-DD). */
export function computeBreakdown(
  lines: Partial<FeeLines>, concession: number, paid: number, dueDate: string | null, today: string = new Date().toISOString().slice(0, 10),
): Breakdown {
  const gross = sumLines(lines);
  const conc = roundMoney(Math.max(concession || 0, 0));
  const net = roundMoney(gross - conc);
  const p = roundMoney(Math.max(paid || 0, 0));
  const outstanding = roundMoney(Math.max(net - p, 0));
  let status: Breakdown["status"] = "pending";
  if (outstanding <= 0) status = "paid";
  else if (dueDate && dueDate < today) status = "overdue";
  else if (p > 0) status = "partial";
  return { gross, concession: conc, net, paid: p, outstanding, status };
}

/** Validation the editor shows before saving (the database re-checks all of it). Returns an error message or null. */
export function validatePlanInput(lines: Partial<FeeLines>, concession: number, concessionReason: string, paid = 0): string | null {
  for (const { key, label } of FEE_LINES) {
    const v = Number(lines[key] ?? 0);
    if (!Number.isFinite(v) || v < 0) return `${label} cannot be negative`;
    if (roundMoney(v) !== v) return `${label} can have at most 2 decimals`;
  }
  const gross = sumLines(lines);
  if (gross <= 0) return "Enter at least one fee amount above 0";
  if (!Number.isFinite(concession) || concession < 0) return "The concession cannot be negative";
  if (concession > gross) return "The concession cannot be more than the total fee";
  if (concession > 0 && !concessionReason.trim()) return "Give a reason for the concession";
  if (roundMoney(gross - concession) < paid) return `The new payable total is lower than the amount already paid (₹${paid.toLocaleString("en-IN")})`;
  return null;
}

/** Template rule from the database trigger: at least 2 rows, each > 0% with a valid date, summing to exactly 100. */
export function validateInstalmentTemplate(rows: InstalmentTemplateRow[]): string | null {
  if (rows.length === 0) return null; // optional
  if (rows.length < 2) return "An instalment schedule needs at least 2 instalments";
  let sum = 0;
  for (const r of rows) {
    if (!(Number(r.percent) > 0)) return "Each instalment needs a percentage above 0";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.due_date || "")) return "Each instalment needs a due date";
    sum += Number(r.percent);
  }
  if (roundMoney(sum) !== 100) return `Instalment percentages must add up to 100 (currently ${roundMoney(sum)})`;
  return null;
}

/** What each instalment of a template comes to for a given outstanding amount; the last one absorbs rounding (as in the database). */
export function previewInstalments(rows: InstalmentTemplateRow[], outstanding: number): { label: string; due_date: string; amount: number }[] {
  let allocated = 0;
  return rows.map((r, i) => {
    const amount = i === rows.length - 1 ? roundMoney(outstanding - allocated) : roundMoney((outstanding * Number(r.percent)) / 100);
    allocated = roundMoney(allocated + amount);
    return { label: r.label, due_date: r.due_date, amount };
  });
}

export const formatInr = (n: number): string => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Human summary of one history entry's money change, e.g. "₹60,000 → ₹54,000". */
export function describeChange(entry: FeeHistoryEntry): string | null {
  const o = entry.old_values as { net_total?: number } | null;
  const n = entry.new_values as { net_total?: number } | null;
  if (o?.net_total != null && n?.net_total != null && o.net_total !== n.net_total) return `${formatInr(o.net_total)} → ${formatInr(n.net_total)}`;
  if (n?.net_total != null && !o) return formatInr(n.net_total);
  return null;
}

/** Turns database errors into plain sentences (the functions already raise readable messages; this trims the wrapper). */
export function friendlyFeeError(message: string): string {
  if (/duplicate key.*uq_fee_structures_active/i.test(message)) return "An active fee structure already exists for this academic year, class and category. Edit it or deactivate it first.";
  if (/violates foreign key constraint.*fee_assignments_structure_id/i.test(message) || /fee_assignments_structure_id_fkey/i.test(message))
    return "This fee structure has been assigned to students and cannot be deleted. Deactivate it instead.";
  if (/row-level security|42501|Not authorised/i.test(message)) return "You don't have permission to manage fee plans for this school.";
  return message.replace(/^.*?ERROR:\s*/i, "");
}
