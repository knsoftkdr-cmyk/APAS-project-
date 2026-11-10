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
    unwrap<InstalmentTxn[]>(db.from("instalment_transactions").select("id,item_id,plan_id,amount,refunded_amount,status,receipt_no,razorpay_payment_id,failure_reason,method,created_at,paid_at").eq("student_id", studentId).order("created_at", { ascending: false })),
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
const loadRazorpayScript = (): Promise<boolean> =>
  new Promise((resolve) => {
    if ((window as any).Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

/** supabase-js hides the JSON error body of a non-2xx edge response in error.context - dig it out for a useful message. */
async function functionErrorMessage(error: any, data: any): Promise<string> {
  if (data?.error) return String(data.error);
  try { const body = await error?.context?.json?.(); if (body?.error) return String(body.error); } catch { /* fall through */ }
  return error?.message || "Something went wrong";
}

export type PayOutcome =
  | { status: "success"; receiptNo?: string }
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

async function reconcile(orderId: string, extra: Record<string, string> = {}): Promise<{ status: string; receipt_no?: string; reason?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke("verify-razorpay-payment", { body: { kind: "instalment_verify", razorpay_order_id: orderId, ...extra } });
  if (error && !data) return { status: "error", error: await functionErrorMessage(error, data) };
  return (data as any) ?? { status: "error", error: "No response" };
}

/**
 * Pay ONE instalment through the existing Razorpay account. The browser never decides the outcome: every result comes from
 * verify-razorpay-payment (kind "instalment_verify"), which asks Razorpay itself. Resolves once the checkout is finished or closed.
 */
export async function payInstalment(itemId: string, prefill: { businessName: string; description: string; name?: string; email?: string; contact?: string }): Promise<PayOutcome> {
  if (!(await loadRazorpayScript())) return { status: "error", message: "Couldn't load the payment gateway. Please check your connection and try again." };

  const { data: order, error } = await supabase.functions.invoke("create-razorpay-order", { body: { item_id: itemId } });
  if (error || !order || (order as any).error) return { status: "error", message: await functionErrorMessage(error, order) };
  const { order_id, amount, currency, key_id } = order as { order_id: string; amount: number; currency: string; key_id: string };

  return new Promise<PayOutcome>((resolve) => {
    let settled = false;
    const finish = (o: PayOutcome) => { if (!settled) { settled = true; resolve(o); } };

    const rzp = new (window as any).Razorpay({
      key: key_id, amount, currency, order_id,
      name: prefill.businessName, description: prefill.description,
      prefill: { name: prefill.name, email: prefill.email || undefined, contact: prefill.contact || undefined },
      theme: { color: "#12203a" },
      handler: async (resp: any) => {
        const r = await reconcile(order_id, { razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature });
        if (r.status === "success") finish({ status: "success", receiptNo: r.receipt_no });
        else if (r.status === "pending") finish({ status: "pending" });
        else if (r.status === "failed") finish({ status: "failed", message: r.reason || "Payment failed" });
        else finish({ status: "error", message: r.error || "We couldn't confirm this payment. If money was deducted it will be reconciled automatically - please contact the school if it doesn't update." });
      },
      modal: {
        ondismiss: async () => {
          // closed without a handler call: ask the gateway what (if anything) happened - never assume
          const r = await reconcile(order_id);
          if (r.status === "success") finish({ status: "success", receiptNo: r.receipt_no });
          else if (r.status === "failed") finish({ status: "failed", message: r.reason || "Payment failed" });
          else finish({ status: "cancelled" });
        },
      },
    });
    // a failed attempt inside the open checkout: record it (server-verified); the modal stays open so the parent can retry
    rzp.on("payment.failed", () => { void reconcile(order_id); });
    rzp.open();
  });
}

/** Re-check a payment that is still "processing" (bank slow / tab closed). Server asks Razorpay again. */
export async function recheckPayment(orderId: string) { return reconcile(orderId); }

export async function downloadReceipt(transactionId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("verify-razorpay-payment", { body: { kind: "instalment_receipt", transaction_id: transactionId } });
  if (error || !data || (data as any).error) throw new Error(await functionErrorMessage(error, data));
  const { filename, pdf_base64 } = data as { filename: string; pdf_base64: string };
  const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
