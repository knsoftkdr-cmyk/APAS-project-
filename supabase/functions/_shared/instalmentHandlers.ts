// Instalment payment handlers. These live in _shared (not in their own edge functions) so the project does not need extra
// function slots: they are called from the EXISTING functions
//   create-razorpay-order    -> handleCreateInstalmentOrder   (body has item_id)
//   verify-razorpay-payment  -> handleVerifyInstalment        (body.kind = "instalment_verify")
//                            -> handleInstalmentReceipt       (body.kind = "instalment_receipt")
//                            -> handleRazorpayWebhook         (request carries an x-razorpay-signature header)
// Security is unchanged: the amount always comes from the database, the caller is authenticated and authorised by RLS /
// database functions, and a payment is only applied after Razorpay itself confirms it (idempotent writes).
import { decideFromGatewayPayments, parseWebhookEvent, toPaise, verifyCheckoutSignature, verifyWebhookSignature } from "./instalmentGateway.ts";
import {
  adminClient, buildInstalmentReceipt, bytesToBase64, callerClient, emailInstalmentReceipt, json, razorpayCreateOrder, razorpayOrderPayments, razorpayPayment,
} from "./instalmentServer.ts";

type Body = Record<string, unknown>;

/** A parent starts paying ONE instalment: creates a Razorpay order + a transaction record. Nothing is marked paid here. */
export async function handleCreateInstalmentOrder(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const item_id = body.item_id;
  if (!item_id || typeof item_id !== "string") return json({ error: "item_id is required" }, 400);

  const admin = adminClient();
  // Authorisation + amount + "is it payable?" are all decided inside the database, under a row lock.
  const { data: prep, error: prepErr } = await admin.rpc("instalment_prepare_order", { p_item_id: item_id, p_user: caller.userId });
  if (prepErr) return json({ error: prepErr.message }, prepErr.code === "42501" ? 403 : 400);

  const amountPaise = toPaise(Number(prep.amount));
  if (!(amountPaise > 0)) return json({ error: "Nothing is due on this instalment" }, 400);

  const created = await razorpayCreateOrder({
    amount: amountPaise, currency: "INR",
    receipt: `inst_${String(item_id).replace(/-/g, "")}`.slice(0, 40),
    notes: { kind: "instalment", item_id, plan_id: prep.plan_id, instalment_no: String(prep.seq), student_name: prep.student_name },
  });
  if (!created.ok) return json({ error: created.error }, 502);

  const { error: recErr } = await admin.rpc("instalment_record_order", { p_item_id: item_id, p_order_id: created.order.id, p_amount: Number(prep.amount), p_user: caller.userId });
  if (recErr) return json({ error: recErr.message }, 500);

  return json({
    order_id: created.order.id, amount: created.order.amount, currency: created.order.currency,
    key_id: Deno.env.get("RAZORPAY_KEY_ID"), instalment_no: prep.seq, student_name: prep.student_name,
  });
}

/** Browser calls this after checkout closes. The browser's word is not enough: Razorpay is asked directly. */
export async function handleVerifyInstalment(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const razorpay_order_id = body.razorpay_order_id as string | undefined;
  const razorpay_payment_id = body.razorpay_payment_id as string | undefined;
  const razorpay_signature = body.razorpay_signature as string | undefined;
  if (!razorpay_order_id) return json({ error: "razorpay_order_id is required" }, 400);

  // Row-level security: a parent only sees transactions of their own children, so another parent's order is "not found".
  const { data: txn } = await caller.client.from("instalment_transactions")
    .select("id, amount, status, razorpay_order_id").eq("razorpay_order_id", razorpay_order_id).maybeSingle();
  if (!txn) return json({ error: "Payment not found" }, 404);

  if (razorpay_signature || razorpay_payment_id) {
    const valid = await verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id ?? "", razorpay_signature ?? "", Deno.env.get("RAZORPAY_KEY_SECRET") ?? "");
    if (!valid) return json({ error: "Payment verification failed - signature mismatch" }, 400);
  }

  const decision = decideFromGatewayPayments(await razorpayOrderPayments(razorpay_order_id), { orderId: razorpay_order_id, amountPaise: toPaise(Number(txn.amount)) });
  const admin = adminClient();

  if (decision.kind === "success") {
    const { data, error } = await admin.rpc("instalment_apply_payment_success", {
      p_order_id: razorpay_order_id, p_payment_id: decision.paymentId, p_amount_paise: toPaise(Number(txn.amount)), p_method: decision.method,
    });
    if (error) return json({ error: error.message }, 500);
    if (!data.already_processed) await emailInstalmentReceipt(admin, data.transaction_id);
    return json({ status: "success", receipt_no: data.receipt_no, transaction_id: data.transaction_id, already_processed: data.already_processed });
  }
  if (decision.kind === "failed") {
    await admin.rpc("instalment_apply_payment_failure", { p_order_id: razorpay_order_id, p_payment_id: decision.paymentId, p_reason: decision.reason });
    return json({ status: "failed", reason: decision.reason });
  }
  if (decision.kind === "pending") {
    if (decision.paymentId) await admin.rpc("instalment_apply_payment_pending", { p_order_id: razorpay_order_id, p_payment_id: decision.paymentId });
    return json({ status: "pending" });
  }
  console.error("instalment verify mismatch:", razorpay_order_id, decision.reason);
  return json({ status: "mismatch", error: "The payment could not be matched to this instalment. Please contact the school." }, 409);
}

/** Receipt PDF (base64) for ONE successful instalment payment. Visibility is decided by RLS as the caller. */
export async function handleInstalmentReceipt(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const transaction_id = body.transaction_id;
  if (!transaction_id || typeof transaction_id !== "string") return json({ error: "transaction_id is required" }, 400);

  const { data: visible } = await caller.client.from("instalment_transactions").select("id").eq("id", transaction_id).maybeSingle();
  if (!visible) return json({ error: "Receipt not found" }, 404);

  const receipt = await buildInstalmentReceipt(adminClient(), transaction_id);
  if (!receipt) return json({ error: "A receipt is only available for a successful payment" }, 404);
  return json({ filename: receipt.filename, receipt_no: receipt.receiptNo, pdf_base64: bytesToBase64(receipt.pdf) });
}

/** Razorpay -> server confirmation (works even if the parent closes the tab). `raw` is the untouched request body. */
export async function handleRazorpayWebhook(req: Request, raw: string): Promise<Response> {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) { console.error("RAZORPAY_WEBHOOK_SECRET is not set - refusing all webhooks"); return json({ error: "Webhook not configured" }, 503); }
  if (!(await verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), secret))) return json({ error: "Invalid signature" }, 401);

  try {
    const action = parseWebhookEvent(JSON.parse(raw));
    if (action.kind === "ignore") return json({ ok: true, ignored: action.reason });
    const admin = adminClient();

    if (action.kind === "refund") {
      const gw = await razorpayPayment(action.paymentId);   // the gateway's cumulative refunded amount is the truth
      const { data, error } = await admin.rpc("instalment_apply_refund", { p_payment_id: action.paymentId, p_total_refunded_paise: Number(gw.amount_refunded ?? 0) });
      if (error) { console.error("refund apply failed:", error.message); return json({ error: error.message }, 500); }
      return json({ ok: true, result: data });
    }

    const { data: txn } = await admin.from("instalment_transactions").select("id, amount").eq("razorpay_order_id", action.orderId).maybeSingle();
    if (!txn) return json({ ok: true, ignored: "not an instalment order" });   // the one-shot fee flow shares this Razorpay account

    if (action.kind === "payment_success") {
      if (action.amountPaise !== toPaise(Number(txn.amount))) {
        console.error("webhook amount mismatch", action.orderId, action.amountPaise, txn.amount);
        return json({ ok: true, ignored: "amount mismatch - flagged in logs" });   // 200: retrying would never fix it
      }
      const { data, error } = await admin.rpc("instalment_apply_payment_success", {
        p_order_id: action.orderId, p_payment_id: action.paymentId, p_amount_paise: action.amountPaise, p_method: action.method,
      });
      if (error) { console.error("success apply failed:", error.message); return json({ error: error.message }, 500); }   // 500 => Razorpay retries
      if (!data.already_processed) await emailInstalmentReceipt(admin, data.transaction_id);
      return json({ ok: true, already_processed: data.already_processed });
    }

    const { data, error } = await admin.rpc("instalment_apply_payment_failure", { p_order_id: action.orderId, p_payment_id: action.paymentId, p_reason: action.reason });
    if (error) { console.error("failure apply failed:", error.message); return json({ error: error.message }, 500); }
    return json({ ok: true, result: data });
  } catch (err) {
    console.error("razorpay webhook:", err);
    return json({ error: (err as Error).message }, 500);
  }
}
