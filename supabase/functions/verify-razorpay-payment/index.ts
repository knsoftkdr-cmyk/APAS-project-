// verify-razorpay-payment - the ONE "confirm / receive payment results" endpoint for every gateway (name is historical; see
// create-razorpay-order). verify_jwt is OFF for this function so gateways can call it; every path authenticates itself:
//   - webhooks:   the gateway's own signature (Razorpay x-razorpay-signature, Stripe-Signature, Cashfree x-webhook-signature, PayU hash)
//   - browser:    the caller's Supabase token, then the gateway is asked directly - the browser's claim is never believed
//   POST ?gateway=<id>&hook=1     webhook          POST ?gateway=payu&return=1   PayU browser return
//   { kind: "verify", gateway, order_id, ... }     { kind: "receipt", transaction_id }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json } from "../_shared/instalmentServer.ts";
import { handlePayuReturn, handleReceipt, handleVerify, handleWebhook } from "../_shared/paymentHandlers.ts";
import { isGatewayId } from "../_shared/gateways/types.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const gw = url.searchParams.get("gateway");
    // Razorpay's webhook is recognised by its header, so webhooks already registered keep working with no URL change.
    if (req.headers.get("x-razorpay-signature")) return await handleWebhook(req, "razorpay", await req.text());
    if (isGatewayId(gw) && url.searchParams.get("hook")) return await handleWebhook(req, gw, await req.text());
    if (gw === "payu" && url.searchParams.get("return")) return await handlePayuReturn(req, await req.text());

    const body = await req.json();
    switch (body?.kind) {
      case "receipt": case "instalment_receipt": return await handleReceipt(req, body);
      case "verify": case "instalment_verify": return await handleVerify(req, body);
      default: {
        // previous Razorpay-only request shape: { fee_payment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }
        if (!body?.razorpay_order_id || !body?.razorpay_payment_id || !body?.razorpay_signature) return json({ error: "Missing required fields" }, 400);
        return await handleVerify(req, { ...body, gateway: "razorpay" });
      }
    }
  } catch (err) {
    console.error("verify-razorpay-payment:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
