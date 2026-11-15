// create-razorpay-order - the ONE "start a payment" endpoint for every gateway (the name is historical: it began as Razorpay-only
// and the project's edge-function quota is full, so it now serves Razorpay, Stripe, PayU and Cashfree).
//   { fee_payment_id, gateway? }  one-shot fee      { item_id, gateway? }  one instalment      { action: "list_gateways", school_id }
// A body with only { fee_payment_id } behaves as before (Razorpay) and still returns { order_id, amount, currency, key_id }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json } from "../_shared/instalmentServer.ts";
import { handleCreateOrder, handleListGateways } from "../_shared/paymentHandlers.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === "list_gateways") return await handleListGateways(req, body);
    return await handleCreateOrder(req, body);
  } catch (err) {
    console.error("create-razorpay-order:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
