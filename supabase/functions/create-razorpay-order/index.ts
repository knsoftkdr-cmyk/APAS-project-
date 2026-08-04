import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fee_payment_id } = await req.json();

    if (!fee_payment_id) {
      return new Response(
        JSON.stringify({ error: "fee_payment_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load the fee record server-side so the amount is authoritative —
    // never trust an amount sent from the browser.
    const { data: fee, error: feeError } = await supabaseAdmin
      .from("fee_payments")
      .select("id, amount_due, amount_paid, student_name")
      .eq("id", fee_payment_id)
      .single();

    if (feeError || !fee) {
      return new Response(
        JSON.stringify({ error: "Fee record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const balance = Number(fee.amount_due) - Number(fee.amount_paid);
    if (balance <= 0) {
      return new Response(
        JSON.stringify({ error: "This fee record has no outstanding balance" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const auth = btoa(`${keyId}:${keySecret}`);

    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(balance * 100), // Razorpay expects paise
        currency: "INR",
        receipt: fee.id,
        notes: { fee_payment_id: fee.id, student_name: fee.student_name },
      }),
    });

    const order = await orderRes.json();

    if (!orderRes.ok) {
      return new Response(
        JSON.stringify({ error: order.error?.description || "Razorpay order creation failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record the order id against this fee record so verify-razorpay-payment
    // can double-check the order actually belongs to it.
    await supabaseAdmin
      .from("fee_payments")
      .update({ razorpay_order_id: order.id })
      .eq("id", fee.id);

    return new Response(
      JSON.stringify({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: keyId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
