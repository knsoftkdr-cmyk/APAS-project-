// Client side of multi-gateway payments (Razorpay, Stripe, PayU, Cashfree). No secrets live here: the browser only receives public
// keys / one-time session ids from the server and never decides a payment's outcome - every result comes from the server,
// which asks the gateway itself (create-razorpay-order + verify-razorpay-payment serve ALL gateways).
import { supabase } from "@/integrations/supabase/client";

export type GatewayId = "razorpay" | "stripe" | "payu" | "cashfree";
export const GATEWAY_ORDER: GatewayId[] = ["razorpay", "stripe", "payu", "cashfree"];

export interface GatewayInfo { id: GatewayId; label: string; enabled: boolean; configured: boolean; missing?: string[] }

export const GATEWAY_META: Record<GatewayId, { label: string; tagline: string; secrets: string[]; events: string; webhook: (base: string) => string }> = {
  razorpay: { label: "Razorpay", tagline: "UPI, cards, net banking & wallets", secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
    events: "payment.captured, payment.failed, order.paid, refund.processed", webhook: (b) => `${b}/functions/v1/verify-razorpay-payment` },
  stripe: { label: "Stripe", tagline: "International cards & wallets (charged in INR)", secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "APP_BASE_URL"],
    events: "checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded", webhook: (b) => `${b}/functions/v1/verify-razorpay-payment?gateway=stripe&hook=1` },
  payu: { label: "PayU", tagline: "UPI, cards & net banking (India)", secrets: ["PAYU_KEY", "PAYU_SALT", "PAYU_ENV (test or live)", "APP_BASE_URL"],
    events: "Success and Failure webhooks (Dashboard > Webhooks). Refunds are reconciled manually.", webhook: (b) => `${b}/functions/v1/verify-razorpay-payment?gateway=payu&hook=1` },
  cashfree: { label: "Cashfree", tagline: "UPI, cards, net banking & pay later", secrets: ["CASHFREE_APP_ID", "CASHFREE_SECRET_KEY", "CASHFREE_ENV (sandbox or production)", "APP_BASE_URL"],
    events: "PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, REFUND_STATUS_WEBHOOK", webhook: (b) => `${b}/functions/v1/verify-razorpay-payment?gateway=cashfree&hook=1` },
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
  | { status: "redirecting" }          // the browser is leaving for the gateway's page; the result is settled when it comes back
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
const loadCashfree = () => scriptOnce("https://sdk.cashfree.com/js/v3/cashfree.js", () => !!(window as any).Cashfree);

const toOutcome = (r: VerifyResult): PayOutcome =>
  r.status === "success" ? { status: "success", receiptNo: r.receipt_no }
  : r.status === "pending" ? { status: "pending" }
  : r.status === "failed" ? { status: "failed", message: r.reason || "Payment failed" }
  : { status: "error", message: r.error || "We couldn't confirm this payment. If money was deducted it will be reconciled automatically - please contact the school if it doesn't update." };

export interface PayTarget { feeId?: string; itemId?: string }
export interface PayOptions { gateway: GatewayId; businessName: string; description: string; customer: { name?: string; email?: string | null; phone?: string | null } }

/**
 * Start paying a one-shot fee (feeId) or ONE instalment (itemId) through the chosen gateway.
 * Razorpay resolves when its popup closes; Stripe / PayU / Cashfree take the browser to the gateway ("redirecting") and the result is
 * settled by readGatewayReturn() when the parent comes back.
 */
export async function startPayment(target: PayTarget, o: PayOptions): Promise<PayOutcome> {
  const body: Record<string, unknown> = { gateway: o.gateway, customer: { name: o.customer.name, email: o.customer.email || undefined, phone: o.customer.phone || undefined } };
  if (target.itemId) body.item_id = target.itemId; else body.fee_payment_id = target.feeId;

  if (o.gateway === "razorpay" && !(await loadRazorpay())) return { status: "error", message: "Couldn't load the payment gateway. Please check your connection and try again." };
  const { data: order, error } = await supabase.functions.invoke("create-razorpay-order", { body });
  if (error || !order || (order as any).error) return { status: "error", message: await functionErrorMessage(error, order) };
  const { order_id, checkout } = order as { order_id: string; checkout: any };

  if (checkout.type === "redirect") { window.location.assign(checkout.url); return { status: "redirecting" }; }
  if (checkout.type === "form_post") {
    const f = document.createElement("form");
    f.method = "POST"; f.action = checkout.url; f.style.display = "none";
    Object.entries(checkout.fields as Record<string, string>).forEach(([k, v]) => { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); });
    document.body.appendChild(f); f.submit();
    return { status: "redirecting" };
  }
  if (checkout.type === "cashfree") {
    if (!(await loadCashfree())) return { status: "error", message: "Couldn't load the payment gateway. Please check your connection and try again." };
    const cf = (window as any).Cashfree({ mode: checkout.mode });
    await cf.checkout({ paymentSessionId: checkout.payment_session_id, redirectTarget: "_self" });
    return { status: "redirecting" };
  }

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

/** After Stripe / PayU / Cashfree send the parent back with ?gw=...&order=..., settle it with the server. null = not a gateway return. */
export async function readGatewayReturn(): Promise<{ gateway: GatewayId; orderId: string; outcome: PayOutcome; kind?: "fee" | "instalment" } | null> {
  const q = new URLSearchParams(window.location.search);
  const gw = q.get("gw"), order = q.get("order");
  if (!gw || !GATEWAY_ORDER.includes(gw as GatewayId)) return null;
  const clean = () => { q.delete("gw"); q.delete("order"); q.delete("cancelled"); q.delete("error"); const s = q.toString(); window.history.replaceState(window.history.state, "", window.location.pathname + (s ? `?${s}` : "")); };
  if (!order) { const err = q.get("error"); clean(); return { gateway: gw as GatewayId, orderId: "", outcome: { status: "error", message: err ? "We couldn't confirm this payment. If money was deducted it will be reconciled automatically." : "Missing payment reference" } }; }
  const cancelled = q.get("cancelled") === "1";
  clean();
  const r = await verifyPayment(gw as GatewayId, order);
  const outcome = cancelled && r.status !== "success" ? ({ status: "cancelled" } as PayOutcome) : toOutcome(r);
  return { gateway: gw as GatewayId, orderId: order, outcome, kind: r.kind };
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
  // a school that never chose keeps working as before: Razorpay only
  const out = { razorpay: rows.length === 0, stripe: false, payu: false, cashfree: false } as Record<GatewayId, boolean>;
  rows.forEach((r) => { out[r.gateway] = r.enabled; });
  return out;
}
export async function saveGatewaySettings(schoolId: string, state: Record<GatewayId, boolean>): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const rows = GATEWAY_ORDER.map((g, i) => ({ school_id: schoolId, gateway: g, enabled: !!state[g], sort_order: i + 1, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() }));
  const { error } = await (supabase as any).from("payment_gateway_settings").upsert(rows, { onConflict: "school_id,gateway" });
  if (error) throw new Error(error.message);
}
