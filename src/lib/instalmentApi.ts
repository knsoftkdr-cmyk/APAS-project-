// Supabase + Razorpay calls for the fee-instalment feature. Every write goes through a SECURITY DEFINER database function or an
// edge function that re-checks the caller - nothing here can mark anything paid. (The generated Supabase types do not cover the
// new tables yet, hence the single `db` cast.)
import { supabase } from "@/integrations/supabase/client";
import type {
  AdminSummary, InstalmentItem, InstalmentPlan, InstalmentRequest, InstalmentSettingsRow, InstalmentTxn, ParentOverview, ScheduleRow,
} from "@/lib/instalments";
import { friendlyError } from "@/lib/instalments";

const db = supabase as any;

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyError(error.message));
  return data as T;
}

// ─────────────────────────── parent ───────────────────────────
export const fetchParentOverview = (studentId: string) => unwrap<ParentOverview>(db.rpc("get_parent_instalment_overview", { p_student_id: studentId }));

export async function fetchStudentInstalmentData(studentId: string) {
  const [requests, plans, items, txns] = await Promise.all([
    unwrap<InstalmentRequest[]>(db.from("instalment_requests").select("*").eq("student_id", studentId).order("created_at", { ascending: false })),
    unwrap<InstalmentPlan[]>(db.from("instalment_plans").select("*").eq("student_id", studentId).order("created_at", { ascending: false })),
    unwrap<InstalmentItem[]>(db.from("instalment_items_v").select("*").eq("student_id", studentId).order("due_date", { ascending: true }).order("seq", { ascending: true })),
    unwrap<InstalmentTxn[]>(db.from("instalment_transactions").select("id,item_id,plan_id,amount,refunded_amount,status,receipt_no,razorpay_payment_id,gateway,failure_reason,method,created_at,paid_at").eq("student_id", studentId).order("created_at", { ascending: false })),
  ]);
  return { requests: requests ?? [], plans: plans ?? [], items: items ?? [], txns: txns ?? [] };
}

export const requestInstalmentPlan = (studentId: string, feeId: string, count: number | null, reason: string) =>
  unwrap<string>(db.rpc("request_instalment_plan", { p_student_id: studentId, p_fee_payment_id: feeId, p_count: count, p_reason: reason }));

// ─────────────────────────── admin ───────────────────────────
export async function fetchSettings(schoolId: string): Promise<InstalmentSettingsRow | null> {
  return (await unwrap<InstalmentSettingsRow | null>(db.from("instalment_settings").select("*").eq("school_id", schoolId).maybeSingle())) ?? null;
}
export async function saveSettings(row: Omit<InstalmentSettingsRow, never>) {
  const { data: u } = await supabase.auth.getUser();
  await unwrap(db.from("instalment_settings").upsert({ ...row, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "school_id" }));
}
export const fetchAdminSummary = (schoolId: string) => unwrap<AdminSummary>(db.rpc("instalment_admin_summary", { p_school: schoolId }));

export async function fetchAdminRequests(schoolId: string) {
  return (await unwrap<(InstalmentRequest & { student_name?: string })[]>(db.from("instalment_requests").select("*").eq("school_id", schoolId).order("created_at", { ascending: false }).limit(500))) ?? [];
}
export async function fetchAdminItems(schoolId: string) {
  return (await unwrap<InstalmentItem[]>(db.from("instalment_items_v").select("*").eq("school_id", schoolId).order("due_date", { ascending: true }).limit(5000))) ?? [];
}
export async function fetchAdminPlans(schoolId: string) {
  return (await unwrap<InstalmentPlan[]>(db.from("instalment_plans").select("*").eq("school_id", schoolId).order("created_at", { ascending: false }).limit(2000))) ?? [];
}
export async function fetchStudentNamesForRequests(studentIds: string[]): Promise<Record<string, { name: string; class: string | null; section: string | null }>> {
  if (studentIds.length === 0) return {};
  const rows = await unwrap<any[]>(db.from("students").select("id, full_name, class, section").in("id", [...new Set(studentIds)]));
  return Object.fromEntries((rows ?? []).map((r) => [r.id, { name: r.full_name, class: r.class, section: r.section }]));
}
export async function fetchFeeBalance(feeId: string) {
  const row = await unwrap<any>(db.from("fee_payments").select("id, student_id, student_name, class_grade, section, amount_due, amount_paid").eq("id", feeId).maybeSingle());
  return row ? { ...row, balance: Number(row.amount_due) - Number(row.amount_paid) } : null;
}
export async function fetchPlannableFees(schoolId: string) {
  const [fees, plans] = await Promise.all([
    unwrap<any[]>(db.from("fee_payments").select("id, student_id, student_name, class_grade, section, amount_due, amount_paid, due_date").eq("school_id", schoolId).not("student_id", "is", null).neq("status", "paid").order("student_name").limit(2000)),
    unwrap<any[]>(db.from("instalment_plans").select("fee_payment_id").eq("school_id", schoolId).eq("status", "active")),
  ]);
  const taken = new Set((plans ?? []).map((p) => p.fee_payment_id));
  return (fees ?? []).filter((f) => Number(f.amount_due) - Number(f.amount_paid) > 0 && !taken.has(f.id)).map((f) => ({ ...f, balance: Number(f.amount_due) - Number(f.amount_paid) }));
}

export const reviewInstalmentRequest = (requestId: string, decision: "approve" | "reject", opts: { reason?: string; items?: ScheduleRow[]; firstDue?: string } = {}) =>
  unwrap<string | null>(db.rpc("review_instalment_request", {
    p_request_id: requestId, p_decision: decision, p_rejection_reason: opts.reason ?? null,
    p_items: opts.items ? opts.items.map((r) => ({ amount: r.amount, due_date: r.due_date })) : null, p_first_due: opts.firstDue ?? null,
  }));
export const createPlanForStudent = (studentId: string, feeId: string, items: ScheduleRow[], note?: string) =>
  unwrap<string>(db.rpc("create_instalment_plan_for_student", { p_student_id: studentId, p_fee_payment_id: feeId, p_items: items.map((r) => ({ amount: r.amount, due_date: r.due_date })), p_note: note ?? "Created by school" }));
export const updateInstalmentSchedule = (planId: string, items: ScheduleRow[]) =>
  unwrap<null>(db.rpc("update_instalment_schedule", { p_plan_id: planId, p_items: items.map((r) => ({ ...(r.id ? { id: r.id } : {}), amount: r.amount, due_date: r.due_date })) }));

// ─────────────────────────── payments ───────────────────────────
// Payment processing is gateway-neutral and lives in paymentGateways.ts (Razorpay). The helpers below keep the
// instalment screens' existing call shape.
import { downloadReceipt as downloadReceiptImpl, startPayment, verifyPayment, type GatewayId, type PayOutcome } from "./paymentGateways";
export type { PayOutcome };

/** Pay ONE instalment through Razorpay. */
export function payInstalment(itemId: string, prefill: { businessName: string; description: string; name?: string; email?: string; contact?: string; gateway?: GatewayId }): Promise<PayOutcome> {
  return startPayment({ itemId }, { gateway: prefill.gateway ?? "razorpay", businessName: prefill.businessName, description: prefill.description, customer: { name: prefill.name, email: prefill.email, phone: prefill.contact } });
}

/** Re-check a payment that is still "processing" (bank slow / tab closed). The server asks the gateway again. */
export const recheckPayment = (orderId: string, gateway: GatewayId = "razorpay") => verifyPayment(gateway, orderId);

export const downloadReceipt = downloadReceiptImpl;
