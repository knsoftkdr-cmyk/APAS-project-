// _shared/gateways/razorpay.ts - Razorpay (existing gateway) behind the common adapter interface. Reuses the existing helpers.
import { decideFromGatewayPayments, parseWebhookEvent, toPaise, verifyWebhookSignature } from "../instalmentGateway.ts";
import { razorpayCreateOrder, razorpayOrderPayments, razorpayPayment } from "../instalmentServer.ts";
import type { CreateOrderInput, GatewayAdapter } from "./types.ts";

export function makeRazorpay(): GatewayAdapter {
  const keyId = () => Deno.env.get("RAZORPAY_KEY_ID") ?? "";
  return {
    id: "razorpay", label: "Razorpay",
    missingConfig: () => ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"].filter((k) => !Deno.env.get(k)),
    async createOrder(i: CreateOrderInput) {
      const r = await razorpayCreateOrder({ amount: i.amountMinor, currency: i.currency, receipt: i.merchantRef.slice(0, 40), notes: i.notes });
      if (!r.ok) return { ok: false as const, error: r.error ?? "Razorpay order creation failed" };
      return { ok: true as const, orderId: r.order.id as string, checkout: { type: "razorpay" as const, key_id: keyId(), order_id: r.order.id as string, amount: r.order.amount as number, currency: r.order.currency as string } };
    },
    async fetchStatus(orderId, expected) {
      return decideFromGatewayPayments(await razorpayOrderPayments(orderId), { orderId, amountPaise: expected.amountMinor });
    },
    async parseWebhook(headers, raw) {
      const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
      if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not set");
      if (!(await verifyWebhookSignature(raw, headers.get("x-razorpay-signature"), secret))) return null;
      const a = parseWebhookEvent(JSON.parse(raw));
      if (a.kind === "payment_success") return { kind: "payment_success", orderId: a.orderId, paymentId: a.paymentId, amountMinor: a.amountPaise, method: a.method };
      if (a.kind === "payment_failed") return { kind: "payment_failed", orderId: a.orderId, paymentId: a.paymentId, reason: a.reason };
      if (a.kind === "refund") return { kind: "refund", paymentId: a.paymentId };
      return { kind: "ignore", reason: a.reason };
    },
    async cumulativeRefundMinor(a) { return Number((await razorpayPayment(a.paymentId)).amount_refunded ?? 0); },
  };
}
export { toPaise };
