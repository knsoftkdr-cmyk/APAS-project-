// _shared/gateways/stripe.ts - Stripe Checkout (hosted page; international cards and wallets).
// Flow: create a Checkout Session -> browser is redirected to Stripe -> comes back to the app -> the server RETRIEVES the session
// from Stripe and only then credits the fee. Webhooks (signed with STRIPE_WEBHOOK_SECRET) confirm it even if the tab is closed.
import { hmacSha256Hex, timingSafeEqualStr } from "../instalmentGateway.ts";
import { toMinor, type CreateOrderInput, type CreateOrderResult, type Decision, type FetchLike, type GatewayAdapter, type HookAction } from "./types.ts";

export interface StripeConfig { secretKey: string; webhookSecret?: string; currency: string; apiBase?: string }

/** Stripe's API takes form-encoded bodies with bracket notation for nesting: a[b][0][c]=1 */
export function stripeEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (item !== null && typeof item === "object") parts.push(stripeEncode(item as Record<string, unknown>, `${key}[${i}]`));
      else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
    });
    else if (typeof v === "object") parts.push(stripeEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key).replace(/%5B/g, "[").replace(/%5D/g, "]")}=${encodeURIComponent(String(v)).replace(/%7B/g, "{").replace(/%7D/g, "}")}`);
  }
  return parts.filter(Boolean).join("&");
}

/** Stripe-Signature: "t=1700000000,v1=<hex>,v1=<hex>". HMAC_SHA256(`${t}.${rawBody}`, whsec). Replays older than the tolerance are refused. */
export async function verifyStripeSignature(raw: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): Promise<boolean> {
  if (!raw || !header || !secret) return false;
  const items = header.split(",").map((s) => s.trim().split("="));
  const t = items.find(([k]) => k === "t")?.[1];
  const sigs = items.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0 || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = await hmacSha256Hex(`${t}.${raw}`, secret);
  return sigs.some((s) => timingSafeEqualStr(expected, s));
}

/** Decide from a retrieved Checkout Session. `paid` + exact amount/currency = success; everything else is never credited. */
export function decideStripeSession(session: any, expected: { amountMinor: number; currency: string }): Decision {
  if (!session || !session.id) return { kind: "pending", paymentId: null };
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (session.payment_status === "paid") {
    if (Number(session.amount_total) !== expected.amountMinor || String(session.currency ?? "").toLowerCase() !== expected.currency.toLowerCase()) {
      return { kind: "mismatch", reason: "Paid amount or currency does not match the order" };
    }
    if (!pi) return { kind: "mismatch", reason: "Paid session has no payment intent" };
    return { kind: "success", paymentId: pi, method: session.payment_method_types?.[0] ?? "card" };
  }
  if (session.status === "expired") return { kind: "failed", paymentId: pi, reason: "The checkout expired or was cancelled before payment" };
  return { kind: "pending", paymentId: pi };   // open, or complete-but-unpaid (delayed methods such as bank debits)
}

export function parseStripeEvent(event: any): HookAction {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object;
  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (obj?.payment_status !== "paid") return { kind: "ignore", reason: "session not paid yet" };   // async methods: wait for async_payment_succeeded
    const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id;
    if (!obj.id || !pi) return { kind: "ignore", reason: "session/payment intent missing" };
    return { kind: "payment_success", orderId: obj.id, paymentId: pi, amountMinor: Number(obj.amount_total), method: obj.payment_method_types?.[0] ?? "card" };
  }
  if (type === "checkout.session.async_payment_failed" || type === "checkout.session.expired") {
    if (!obj?.id) return { kind: "ignore", reason: "session missing" };
    return { kind: "payment_failed", orderId: obj.id, paymentId: typeof obj.payment_intent === "string" ? obj.payment_intent : null, reason: type.endsWith("expired") ? "Checkout expired before payment" : "Payment failed" };
  }
  if (type === "charge.refunded" || type === "charge.refund.updated") {
    const pi = obj?.payment_intent;
    if (!pi) return { kind: "ignore", reason: "refund without payment intent" };
    return { kind: "refund", paymentId: String(pi), totalRefundedMinor: Number(obj.amount_refunded ?? 0) };
  }
  return { kind: "ignore", reason: `event ${type || "unknown"} not handled` };
}

export function makeStripe(cfg: StripeConfig, doFetch: FetchLike = fetch): GatewayAdapter {
  const base = cfg.apiBase ?? "https://api.stripe.com/v1";
  const auth = { Authorization: `Bearer ${cfg.secretKey}` };
  return {
    id: "stripe", label: "Stripe",
    missingConfig: () => (cfg.secretKey ? [] : ["STRIPE_SECRET_KEY"]),
    async createOrder(i: CreateOrderInput): Promise<CreateOrderResult> {
      if (!i.appBaseUrl) return { ok: false, error: "The app's public address (APP_BASE_URL) is not configured for Stripe" };
      const body = stripeEncode({
        mode: "payment",
        client_reference_id: i.merchantRef,
        customer_email: i.customer.email || undefined,
        success_url: `${i.appBaseUrl}/parent/fee-payment?gw=stripe&order={CHECKOUT_SESSION_ID}`,
        cancel_url: `${i.appBaseUrl}/parent/fee-payment?gw=stripe&cancelled=1&order={CHECKOUT_SESSION_ID}`,
        line_items: [{ quantity: 1, price_data: { currency: i.currency.toLowerCase(), unit_amount: i.amountMinor, product_data: { name: i.description.slice(0, 120) } } }],
        metadata: { ...i.notes, merchant_ref: i.merchantRef },
        payment_intent_data: { metadata: { ...i.notes, merchant_ref: i.merchantRef } },
      });
      const res = await doFetch(`${base}/checkout/sessions`, { method: "POST", headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": i.merchantRef }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id || !data.url) return { ok: false, error: data?.error?.message || "Stripe could not start the payment" };
      return { ok: true, orderId: data.id, checkout: { type: "redirect", url: data.url } };
    },
    async fetchStatus(orderId, expected) {
      const res = await doFetch(`${base}/checkout/sessions/${encodeURIComponent(orderId)}`, { headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || "Could not confirm the payment with Stripe");
      return decideStripeSession(data, expected);
    },
    async parseWebhook(headers, raw) {
      if (!cfg.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
      if (!(await verifyStripeSignature(raw, headers.get("stripe-signature"), cfg.webhookSecret))) return null;
      return parseStripeEvent(JSON.parse(raw));
    },
    async cumulativeRefundMinor(a) { return a.totalRefundedMinor ?? 0; },   // Stripe puts the cumulative figure in the event
  };
}
