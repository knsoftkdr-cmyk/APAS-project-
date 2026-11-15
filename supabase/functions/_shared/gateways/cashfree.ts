// _shared/gateways/cashfree.ts - Cashfree Payments (PG API 2023-08-01, hosted checkout via the Cashfree JS SDK).
// Flow: server creates an order -> gets payment_session_id -> browser opens Cashfree checkout -> returns to the app -> the server
// fetches the order's payments from Cashfree. Webhooks are signed: base64(HMAC_SHA256(timestamp + rawBody, secret)).
import { timingSafeEqualStr } from "../instalmentGateway.ts";
import { toMinor, type CreateOrderInput, type CreateOrderResult, type Decision, type FetchLike, type GatewayAdapter, type HookAction } from "./types.ts";

export interface CashfreeConfig { appId: string; secretKey: string; env: "sandbox" | "production" }
export const CASHFREE_API_VERSION = "2023-08-01";
export const cashfreeBase = (env: "sandbox" | "production") => (env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");

export async function hmacSha256Base64(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  let bin = ""; sig.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
export async function verifyCashfreeWebhook(raw: string, timestamp: string | null, signature: string | null, secret: string): Promise<boolean> {
  if (!raw || !timestamp || !signature || !secret) return false;
  return timingSafeEqualStr(await hmacSha256Base64(timestamp + raw, secret), signature);
}

const methodOf = (pm: any): string | null => (pm && typeof pm === "object" ? Object.keys(pm)[0] ?? null : null);

/** Decide from GET /orders/{id}/payments. Any SUCCESS for the exact amount wins (customers retry after a failed attempt). */
export function decideCashfreePayments(payments: any[], expected: { amountMinor: number }): Decision {
  const list = Array.isArray(payments) ? payments : [];
  const ok = list.filter((p) => p?.payment_status === "SUCCESS");
  if (ok.length > 0) {
    const exact = ok.find((p) => toMinor(p.payment_amount) === expected.amountMinor);
    if (!exact) return { kind: "mismatch", reason: "Paid amount does not match the order" };
    return { kind: "success", paymentId: String(exact.cf_payment_id), method: methodOf(exact.payment_method) ?? exact.payment_group ?? null };
  }
  const pend = list.filter((p) => p?.payment_status === "PENDING");
  if (pend.length > 0) return { kind: "pending", paymentId: String(pend[pend.length - 1].cf_payment_id) };
  const bad = list.filter((p) => ["FAILED", "CANCELLED", "USER_DROPPED", "VOID"].includes(p?.payment_status));
  if (bad.length > 0) { const l = bad[bad.length - 1]; return { kind: "failed", paymentId: String(l.cf_payment_id), reason: l.error_details?.error_description || l.payment_message || "Payment failed" }; }
  return { kind: "pending", paymentId: null };   // nothing attempted yet
}

export function parseCashfreeEvent(body: any): HookAction {
  const type: string = body?.type ?? "";
  const d = body?.data;
  if (type === "PAYMENT_SUCCESS_WEBHOOK") {
    if (!d?.order?.order_id || !d?.payment?.cf_payment_id) return { kind: "ignore", reason: "payment missing" };
    return { kind: "payment_success", orderId: d.order.order_id, paymentId: String(d.payment.cf_payment_id), amountMinor: toMinor(d.payment.payment_amount), method: methodOf(d.payment.payment_method) ?? d.payment.payment_group ?? null };
  }
  if (type === "PAYMENT_FAILED_WEBHOOK") {
    if (!d?.order?.order_id) return { kind: "ignore", reason: "order missing" };
    return { kind: "payment_failed", orderId: d.order.order_id, paymentId: d.payment?.cf_payment_id ? String(d.payment.cf_payment_id) : null, reason: d.error_details?.error_description || d.payment?.payment_message || "Payment failed" };
  }
  if (type === "REFUND_STATUS_WEBHOOK") {
    if (d?.refund?.refund_status !== "SUCCESS" || !d?.refund?.cf_payment_id) return { kind: "ignore", reason: "refund not successful yet" };
    return { kind: "refund", paymentId: String(d.refund.cf_payment_id), orderId: d.refund.order_id };   // cumulative total is asked from Cashfree
  }
  return { kind: "ignore", reason: `event ${type || "unknown"} not handled` };
}

export const cleanPhone = (p?: string) => (p ?? "").replace(/\D/g, "").slice(-10);

export function makeCashfree(cfg: CashfreeConfig, doFetch: FetchLike = fetch): GatewayAdapter {
  const base = cashfreeBase(cfg.env);
  const headers = () => ({ "x-client-id": cfg.appId, "x-client-secret": cfg.secretKey, "x-api-version": CASHFREE_API_VERSION, "Content-Type": "application/json" });
  return {
    id: "cashfree", label: "Cashfree",
    missingConfig: () => [!cfg.appId && "CASHFREE_APP_ID", !cfg.secretKey && "CASHFREE_SECRET_KEY"].filter(Boolean) as string[],
    async createOrder(i: CreateOrderInput): Promise<CreateOrderResult> {
      const phone = cleanPhone(i.customer.phone);
      if (phone.length !== 10) return { ok: false, error: "Cashfree needs a 10-digit mobile number on the student's record" };
      if (!i.appBaseUrl) return { ok: false, error: "The app's public address (APP_BASE_URL) is not configured for Cashfree" };
      const orderId = i.merchantRef.slice(0, 45);
      const res = await doFetch(`${base}/orders`, { method: "POST", headers: headers(), body: JSON.stringify({
        order_id: orderId, order_amount: Number((i.amountMinor / 100).toFixed(2)), order_currency: i.currency,
        customer_details: { customer_id: (i.notes.customer_id || "parent").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "parent", customer_phone: phone, customer_name: i.customer.name || undefined, customer_email: i.customer.email || undefined },
        order_meta: { return_url: `${i.appBaseUrl}/parent/fee-payment?gw=cashfree&order={order_id}`, notify_url: `${i.functionUrl}?gateway=cashfree&hook=1` },
        order_note: i.description.slice(0, 100), order_tags: i.notes,
      }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.payment_session_id) return { ok: false, error: data?.message || "Cashfree could not start the payment" };
      return { ok: true, orderId: data.order_id ?? orderId, checkout: { type: "cashfree", payment_session_id: data.payment_session_id, mode: cfg.env } };
    },
    async fetchStatus(orderId, expected) {
      const res = await doFetch(`${base}/orders/${encodeURIComponent(orderId)}/payments`, { headers: headers() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as any)?.message || "Could not confirm the payment with Cashfree");
      return decideCashfreePayments(data as any[], expected);
    },
    async parseWebhook(h, raw) {
      if (!(await verifyCashfreeWebhook(raw, h.get("x-webhook-timestamp"), h.get("x-webhook-signature"), cfg.secretKey))) return null;
      return parseCashfreeEvent(JSON.parse(raw));
    },
    async cumulativeRefundMinor(a) {
      if (!a.orderId) return 0;
      const res = await doFetch(`${base}/orders/${encodeURIComponent(a.orderId)}/refunds`, { headers: headers() });
      const data = await res.json().catch(() => []);
      if (!res.ok || !Array.isArray(data)) throw new Error("Could not read refunds from Cashfree");
      return data.filter((r: any) => r.refund_status === "SUCCESS" && String(r.cf_payment_id) === a.paymentId).reduce((s: number, r: any) => s + toMinor(r.refund_amount), 0);
    },
  };
}
