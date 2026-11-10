// _shared/instalmentGateway.ts
// Pure, dependency-free helpers for instalment payment verification. Used by create-instalment-order,
// verify-instalment-payment, razorpay-webhook and instalment-receipt, and unit-tested with vitest (src/test/instalmentGateway.test.ts).
//
// Principle: an instalment is marked paid ONLY from the gateway's own word (a signed callback + the payment fetched from
// Razorpay with the server's API keys), never from anything the browser says.

export const toPaise = (rupees: number): number => Math.round(Number(rupees) * 100);

/** Constant-time string comparison (avoids leaking how many leading characters of a signature were right). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Checkout handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return timingSafeEqualStr(await hmacSha256Hex(`${orderId}|${paymentId}`, keySecret), signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret). The RAW body must be used, not re-serialised JSON. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): Promise<boolean> {
  if (!rawBody || !signature || !webhookSecret) return false;
  return timingSafeEqualStr(await hmacSha256Hex(rawBody, webhookSecret), signature);
}

export interface GatewayPayment {
  id: string;
  order_id?: string | null;
  status: string; // created | authorized | captured | refunded | failed
  amount: number; // paise
  method?: string | null;
  error_description?: string | null;
  amount_refunded?: number | null; // paise, cumulative
}

export type GatewayDecision =
  | { kind: "success"; paymentId: string; method: string | null }
  | { kind: "pending"; paymentId: string | null }
  | { kind: "failed"; paymentId: string | null; reason: string }
  | { kind: "mismatch"; reason: string };

/**
 * Decide what the gateway says about an order, from the payments Razorpay lists for it.
 *  - any CAPTURED payment for the exact expected amount => success (even if earlier attempts failed: customers retry)
 *  - captured but for another amount, or for another order => mismatch (never credited)
 *  - authorized / created (still being processed) => pending
 *  - only failed attempts => failed
 *  - nothing yet => pending
 */
export function decideFromGatewayPayments(payments: GatewayPayment[], expected: { orderId: string; amountPaise: number }): GatewayDecision {
  const list = (payments ?? []).filter((p) => p && p.id);
  const foreign = list.find((p) => p.order_id && p.order_id !== expected.orderId);
  if (foreign) return { kind: "mismatch", reason: "Payment belongs to a different order" };

  const captured = list.filter((p) => p.status === "captured" || p.status === "refunded");
  if (captured.length > 0) {
    const exact = captured.find((p) => Number(p.amount) === expected.amountPaise);
    if (exact) return { kind: "success", paymentId: exact.id, method: exact.method ?? null };
    return { kind: "mismatch", reason: "Captured amount does not match the instalment" };
  }
  const inFlight = list.filter((p) => p.status === "authorized" || p.status === "created");
  if (inFlight.length > 0) return { kind: "pending", paymentId: inFlight[inFlight.length - 1].id };
  const failed = list.filter((p) => p.status === "failed");
  if (failed.length > 0) {
    const last = failed[failed.length - 1];
    return { kind: "failed", paymentId: last.id, reason: last.error_description || "Payment failed" };
  }
  return { kind: "pending", paymentId: null };
}

export type WebhookAction =
  | { kind: "payment_success"; orderId: string; paymentId: string; amountPaise: number; method: string | null }
  | { kind: "payment_failed"; orderId: string; paymentId: string; reason: string }
  | { kind: "refund"; paymentId: string }
  | { kind: "ignore"; reason: string };

/** Map a (signature-verified) Razorpay webhook payload to the single action we take for it. */
export function parseWebhookEvent(body: any): WebhookAction {
  const event: string = body?.event ?? "";
  const pay = body?.payload?.payment?.entity;
  switch (event) {
    case "payment.captured":
    case "order.paid":
      if (!pay?.id || !pay?.order_id) return { kind: "ignore", reason: "payment entity missing" };
      if (pay.status && pay.status !== "captured") return { kind: "ignore", reason: `status ${pay.status}` };
      return { kind: "payment_success", orderId: pay.order_id, paymentId: pay.id, amountPaise: Number(pay.amount), method: pay.method ?? null };
    case "payment.failed":
      if (!pay?.id || !pay?.order_id) return { kind: "ignore", reason: "payment entity missing" };
      return { kind: "payment_failed", orderId: pay.order_id, paymentId: pay.id, reason: pay.error_description || pay.error_reason || "Payment failed" };
    case "refund.processed":
    case "refund.created": {
      const paymentId = body?.payload?.refund?.entity?.payment_id ?? pay?.id;
      if (!paymentId) return { kind: "ignore", reason: "refund without payment id" };
      return { kind: "refund", paymentId };
    }
    default:
      return { kind: "ignore", reason: `event ${event || "unknown"} not handled` };
  }
}
