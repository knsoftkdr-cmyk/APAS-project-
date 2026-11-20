// create-razorpay-order - the "start a payment" endpoint (Razorpay).
//   { fee_payment_id, gateway? }  one-shot fee      { item_id, gateway? }  one instalment      { action: "list_gateways", school_id }
// Returns { order_id, amount, currency, key_id, checkout }.
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
