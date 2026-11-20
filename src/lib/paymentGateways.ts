// Client side of Razorpay payments. No secrets live here: the browser only receives the public key from the server and never
// decides a payment's outcome - every result comes from the server, which asks Razorpay itself
// (create-razorpay-order + verify-razorpay-payment).
import { supabase } from "@/integrations/supabase/client";

export type GatewayId = "razorpay";
export const GATEWAY_ORDER: GatewayId[] = ["razorpay"];

export interface GatewayInfo { id: GatewayId; label: string; enabled: boolean; configured: boolean; missing?: string[] }

export const GATEWAY_META: Record<GatewayId, { label: string; tagline: string; secrets: string[]; events: string; webhook: (base: string) => string }> = {
  razorpay: { label: "Razorpay", tagline: "UPI, cards, net banking & wallets", secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
    events: "payment.captured, payment.failed, order.paid, refund.processed", webhook: (b) => `${b}/functions/v1/verify-razorpay-payment` },
};
export const gatewayLabel = (id: string) => GATEWAY_META[id as GatewayId]?.label ?? id;

/** supabase-js hides the JSON error body of a non-2xx edge response in error.context - dig it out for a useful message. */
export async function functionErrorMessage(error: any, data: any): Promise<string> {
  if (data?.error) return String(data.error);
  try { const body = await error?.context?.json?.(); if (body?.error) return String(body.error); } catch { /* fall through */ }
  return error?.message || "Something went wrong";
}

export async function listGateways(schoolId: string): Promise<GatewayInfo[]> {
  const { data, error } = await supabase.functions.invoke("create-razorpay-order", { body: { action: "list_gateways", school_id: schoolId } });
  if (error || !data || (data as any).error) throw new Error(await functionErrorMessage(error, data));
  const rows = (data as { gateways: GatewayInfo[] }).gateways;
  return GATEWAY_ORDER.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as GatewayInfo[];
}

export type PayOutcome =
  | { status: "success"; receiptNo?: string }
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export interface VerifyResult { status: string; kind?: "fee" | "instalment"; receipt_no?: string; reason?: string; error?: string }

export async function verifyPayment(gateway: GatewayId, orderId: string, extra: Record<string, string> = {}): Promise<VerifyResult> {
  const { data, error } = await supabase.functions.invoke("verify-razorpay-payment", { body: { kind: "verify", gateway, order_id: orderId, ...extra } });
  if (error && !data) return { status: "error", error: await functionErrorMessage(error, data) };
  return (data as VerifyResult) ?? { status: "error", error: "No response" };
}

const scriptOnce = (src: string, ready: () => boolean): Promise<boolean> =>
  new Promise((resolve) => {
    if (ready()) return resolve(true);
    const s = document.createElement("script");
    s.src = src; s.onload = () => resolve(true); s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
const loadRazorpay = () => scriptOnce("https://checkout.razorpay.com/v1/checkout.js", () => !!(window as any).Razorpay);

const toOutcome = (r: VerifyResult): PayOutcome =>
  r.status === "success" ? { status: "success", receiptNo: r.receipt_no }
  : r.status === "pending" ? { status: "pending" }
  : r.status === "failed" ? { status: "failed", message: r.reason || "Payment failed" }
  : { status: "error", message: r.error || "We couldn't confirm this payment. If money was deducted it will be reconciled automatically - please contact the school if it doesn't update." };

export interface PayTarget { feeId?: string; itemId?: string }
export interface PayOptions { gateway: GatewayId; businessName: string; description: string; customer: { name?: string; email?: string | null; phone?: string | null } }

/**
 * Start paying a one-shot fee (feeId) or ONE instalment (itemId) through Razorpay.
 * Resolves when the Razorpay popup closes.
 */
export async function startPayment(target: PayTarget, o: PayOptions): Promise<PayOutcome> {
  const body: Record<string, unknown> = { gateway: o.gateway, customer: { name: o.customer.name, email: o.customer.email || undefined, phone: o.customer.phone || undefined } };
  if (target.itemId) body.item_id = target.itemId; else body.fee_payment_id = target.feeId;

  if (o.gateway === "razorpay" && !(await loadRazorpay())) return { status: "error", message: "Couldn't load the payment gateway. Please check your connection and try again." };
  const { data: order, error } = await supabase.functions.invoke("create-razorpay-order", { body });
  if (error || !order || (order as any).error) return { status: "error", message: await functionErrorMessage(error, order) };
  const { order_id, checkout } = order as { order_id: string; checkout: any };

  // Razorpay popup
  return new Promise<PayOutcome>((resolve) => {
    let settled = false;
    const finish = (r: PayOutcome) => { if (!settled) { settled = true; resolve(r); } };
    const rzp = new (window as any).Razorpay({
      key: checkout.key_id, amount: checkout.amount, currency: checkout.currency, order_id,
      name: o.businessName, description: o.description,
      prefill: { name: o.customer.name, email: o.customer.email || undefined, contact: o.customer.phone || undefined },
      theme: { color: "#12203a" },
      handler: async (resp: any) => finish(toOutcome(await verifyPayment("razorpay", order_id, { razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }))),
      modal: {
        ondismiss: async () => {   // closed without a handler call: ask the server what (if anything) happened - never assume
          const r = await verifyPayment("razorpay", order_id);
          if (r.status === "success" || r.status === "failed") finish(toOutcome(r)); else finish({ status: "cancelled" });
        },
      },
    });
    rzp.on("payment.failed", () => { void verifyPayment("razorpay", order_id); });   // recorded server-side; the popup stays open for a retry
    rzp.open();
  });
}

export async function downloadReceipt(transactionId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("verify-razorpay-payment", { body: { kind: "receipt", transaction_id: transactionId } });
  if (error || !data || (data as any).error) throw new Error(await functionErrorMessage(error, data));
  const { filename, pdf_base64 } = data as { filename: string; pdf_base64: string };
  const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── unified history ──
export interface HistoryRow {
  id: string; kind: "fee" | "instalment"; gateway: GatewayId; order_id: string; payment_id: string | null; amount: number; currency: string;
  status: "pending" | "success" | "failed" | "refunded" | "partially_refunded"; refunded_amount: number; receipt_no: string | null; method: string | null;
  failure_reason: string | null; needs_review: boolean; student_id: string; student_name: string | null; label: string; created_at: string; paid_at: string | null;
}
export async function fetchPaymentHistory(scope: { schoolId?: string; studentId?: string }): Promise<HistoryRow[]> {
  const { data, error } = await (supabase as any).rpc("get_payment_history", { p_school: scope.schoolId ?? null, p_student: scope.studentId ?? null, p_limit: 500 });
  if (error) throw new Error(error.message);
  return (data ?? []) as HistoryRow[];
}

// ── admin: gateway switches (RLS: finance staff of the school only) ──
export async function fetchGatewaySettings(schoolId: string): Promise<Record<GatewayId, boolean>> {
  const { data, error } = await (supabase as any).from("payment_gateway_settings").select("gateway, enabled").eq("school_id", schoolId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { gateway: GatewayId; enabled: boolean }[];
  // a school that never chose keeps working as before: Razorpay on
  const out = { razorpay: rows.length === 0 } as Record<GatewayId, boolean>;
  rows.forEach((r) => { out[r.gateway] = r.enabled; });
  return out;
}
export async function saveGatewaySettings(schoolId: string, state: Record<GatewayId, boolean>): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const rows = GATEWAY_ORDER.map((g, i) => ({ school_id: schoolId, gateway: g, enabled: !!state[g], sort_order: i + 1, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() }));
  const { error } = await (supabase as any).from("payment_gateway_settings").upsert(rows, { onConflict: "school_id,gateway" });
  if (error) throw new Error(error.message);
}
