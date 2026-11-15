// _shared/paymentHandlers.ts - the gateway-neutral payment flow. Called from the EXISTING edge functions:
//   create-razorpay-order    -> handleCreateOrder / handleListGateways
//   verify-razorpay-payment  -> handleVerify / handleReceipt / handleWebhook / handlePayuReturn
// (No new edge functions are needed: the project's function quota is already used up.)
//
// Trust model, identical for every gateway:
//   * the AMOUNT is read from the database by a server-only function, never from the browser
//   * the caller is authenticated, and the database checks they are the student's parent
//   * a payment is credited ONLY after the gateway itself confirms it (fetchStatus / signed webhook), by an idempotent
//     database function - so duplicate callbacks, retries and late failure events cannot double-credit or un-pay.
import { adminClient, bytesToBase64, buildInstalmentReceipt, callerClient, json, corsHeaders } from "./instalmentServer.ts";
import { verifyCheckoutSignature } from "./instalmentGateway.ts";
import { allAdapters, appBaseUrl, functionUrl, gatewayCurrency, getAdapter } from "./gateways/index.ts";
import { isGatewayId, toMinor, type Checkout, type Decision, type GatewayId } from "./gateways/types.ts";
import { buildFeeReceipt, emailReceipt } from "./paymentReceipts.ts";

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Which gateways exist, which the school switched on, which have their secrets set. Secret VALUES are never returned. */
export async function handleListGateways(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const school_id = str(body.school_id);
  if (!school_id) return json({ error: "school_id is required" }, 400);
  const { data: enabled, error } = await caller.client.rpc("payment_enabled_gateways", { p_school: school_id });   // authorises the caller
  if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
  const { data: isStaff } = await caller.client.rpc("is_fee_staff", { p_school: school_id });
  return json({
    gateways: allAdapters().map((a) => {
      const missing = a.missingConfig();
      return { id: a.id, label: a.label, enabled: (enabled as string[]).includes(a.id), configured: missing.length === 0, ...(isStaff ? { missing } : {}) };
    }),
  });
}

/** A parent starts paying a one-shot fee (fee_payment_id) or ONE instalment (item_id) through the chosen gateway. */
export async function handleCreateOrder(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const gateway = body.gateway === undefined ? "razorpay" : body.gateway;
  if (!isGatewayId(gateway)) return json({ error: "Unknown payment method" }, 400);
  const item_id = str(body.item_id), fee_payment_id = str(body.fee_payment_id);
  if (!item_id && !fee_payment_id) return json({ error: "fee_payment_id or item_id is required" }, 400);

  const adapter = getAdapter(gateway);
  const missing = adapter.missingConfig();
  if (missing.length) { console.error(`${gateway} is enabled but missing secrets: ${missing.join(", ")}`); return json({ error: `${adapter.label} is not set up yet. Please choose another payment method or contact the school.` }, 400); }

  const admin = adminClient();
  const isInstalment = !!item_id;
  let prep: any;
  if (isInstalment) {
    const chk = await admin.rpc("instalment_check_gateway", { p_item_id: item_id, p_gateway: gateway });
    if (chk.error) return json({ error: chk.error.message }, 400);
    const r = await admin.rpc("instalment_prepare_order", { p_item_id: item_id, p_user: caller.userId });
    if (r.error) return json({ error: r.error.message }, r.error.code === "42501" ? 403 : 400);
    prep = r.data;
  } else {
    const r = await admin.rpc("fee_prepare_order", { p_fee_id: fee_payment_id, p_user: caller.userId, p_gateway: gateway });
    if (r.error) return json({ error: r.error.message }, r.error.code === "42501" ? 403 : 400);
    prep = r.data;
  }
  const amountMinor = toMinor(Number(prep.amount));
  if (!(amountMinor > 0)) return json({ error: "Nothing is due" }, 400);
  const currency = gatewayCurrency(gateway);

  // customer details are only used to pre-fill the gateway's page; they never influence money
  const c = (body.customer ?? {}) as Record<string, unknown>;
  const ref = isInstalment ? String(item_id) : String(fee_payment_id);
  const merchantRef = `${isInstalment ? "i" : "f"}${ref.replace(/-/g, "").slice(0, 16)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 38);
  const created = await adapter.createOrder({
    merchantRef, amountMinor, currency,
    description: isInstalment ? `Instalment ${prep.seq} - ${prep.student_name}` : `School fees - ${prep.student_name}`,
    customer: { name: str(c.name), email: str(c.email), phone: str(c.phone) },
    appBaseUrl: appBaseUrl(req, gateway === "payu"), functionUrl: functionUrl(),
    notes: { kind: isInstalment ? "instalment" : "fee", ref, student_name: String(prep.student_name ?? ""), customer_id: caller.userId },
  });
  if (!created.ok) { console.error(`${gateway} createOrder failed:`, created.error); return json({ error: created.error }, 502); }

  const rec = isInstalment
    ? await admin.rpc("instalment_record_order", { p_item_id: item_id, p_order_id: created.orderId, p_amount: Number(prep.amount), p_user: caller.userId, p_gateway: gateway, p_currency: currency })
    : await admin.rpc("fee_record_order", { p_fee_id: fee_payment_id, p_gateway: gateway, p_order_id: created.orderId, p_amount: Number(prep.amount), p_currency: currency, p_user: caller.userId });
  if (rec.error) return json({ error: rec.error.message }, 500);

  const checkout: Checkout = created.checkout;
  return json({
    gateway, kind: isInstalment ? "instalment" : "fee", order_id: created.orderId, amount: amountMinor, currency, checkout,
    // kept so older screens that read the Razorpay-only shape keep working
    ...(checkout.type === "razorpay" ? { key_id: checkout.key_id } : {}),
    instalment_no: prep.seq, student_name: prep.student_name,
  });
}

/** Ask the gateway what happened to an order and apply it. Shared by the browser return, PayU's return and (indirectly) webhooks. */
async function settle(gateway: GatewayId, orderId: string, lookup: any): Promise<{ status: string; [k: string]: unknown }> {
  const admin = adminClient();
  const decision: Decision = await getAdapter(gateway).fetchStatus(orderId, { amountMinor: Number(lookup.amount_minor), currency: String(lookup.currency ?? "INR") });
  if (decision.kind === "success") {
    const { data, error } = await admin.rpc("payment_apply_success", { p_gateway: gateway, p_order_id: orderId, p_payment_id: decision.paymentId, p_amount_minor: Number(lookup.amount_minor), p_method: decision.method });
    if (error) throw new Error(error.message);
    if (!data.already_processed) await emailReceipt(admin, data.kind, data.transaction_id);
    return { status: "success", kind: data.kind, receipt_no: data.receipt_no, transaction_id: data.transaction_id, already_processed: data.already_processed };
  }
  if (decision.kind === "failed") {
    await admin.rpc("payment_apply_failure", { p_gateway: gateway, p_order_id: orderId, p_payment_id: decision.paymentId, p_reason: decision.reason });
    return { status: "failed", kind: lookup.kind, reason: decision.reason };
  }
  if (decision.kind === "pending") {
    if (decision.paymentId) await admin.rpc("payment_apply_pending", { p_gateway: gateway, p_order_id: orderId, p_payment_id: decision.paymentId });
    return { status: "pending", kind: lookup.kind };
  }
  console.error(`${gateway} verify mismatch:`, orderId, decision.reason);
  return { status: "mismatch", kind: lookup.kind, error: "The payment could not be matched to this fee. Please contact the school." };
}

/** Browser calls this when it comes back from checkout. The browser's word is not enough: the gateway is asked directly. */
export async function handleVerify(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const gateway = body.gateway === undefined ? "razorpay" : body.gateway;
  if (!isGatewayId(gateway)) return json({ error: "Unknown payment method" }, 400);
  const orderId = str(body.order_id) ?? str(body.razorpay_order_id);
  if (!orderId) return json({ error: "order_id is required" }, 400);
  const admin = adminClient();

  let lookup = (await admin.rpc("payment_lookup_order", { p_gateway: gateway, p_order_id: orderId, p_user: caller.userId })).data;
  // Orders opened by the previous (Razorpay-only) screen, still in flight during the upgrade, have no ledger row yet: adopt them.
  if (!lookup && gateway === "razorpay" && str(body.fee_payment_id)) {
    const { data: fee } = await admin.from("fee_payments").select("id, amount_due, amount_paid, razorpay_order_id").eq("id", body.fee_payment_id).maybeSingle();
    if (fee && fee.razorpay_order_id === orderId) {
      await admin.rpc("fee_record_order", { p_fee_id: fee.id, p_gateway: "razorpay", p_order_id: orderId, p_amount: Number(fee.amount_due) - Number(fee.amount_paid), p_currency: "INR", p_user: caller.userId });
      lookup = (await admin.rpc("payment_lookup_order", { p_gateway: gateway, p_order_id: orderId, p_user: caller.userId })).data;
    }
  }
  if (!lookup) return json({ error: "Payment not found" }, 404);   // also what another family's order looks like: no leak

  const paymentId = str(body.razorpay_payment_id) ?? str(body.payment_id);
  const signature = str(body.razorpay_signature);
  if (gateway === "razorpay" && (paymentId || signature)) {
    if (!(await verifyCheckoutSignature(orderId, paymentId ?? "", signature ?? "", Deno.env.get("RAZORPAY_KEY_SECRET") ?? ""))) {
      return json({ error: "Payment verification failed - signature mismatch" }, 400);
    }
  }
  try {
    const out = await settle(gateway, orderId, lookup);
    if (out.status === "mismatch") return json(out, 409);
    return json({ ...out, ...(out.status === "success" ? { success: true } : {}) });
  } catch (e) { console.error("verify failed:", (e as Error).message); return json({ error: (e as Error).message }, 502); }
}

/** Receipt PDF (base64) for one successful payment, fee or instalment. Visibility is decided by RLS as the caller. */
export async function handleReceipt(req: Request, body: Body): Promise<Response> {
  const caller = await callerClient(req);
  if (!caller) return json({ error: "Please sign in again" }, 401);
  const id = str(body.transaction_id);
  if (!id) return json({ error: "transaction_id is required" }, 400);
  const admin = adminClient();
  const inst = await caller.client.from("instalment_transactions").select("id").eq("id", id).maybeSingle();
  const fee = inst.data ? null : await caller.client.from("payment_transactions").select("id").eq("id", id).maybeSingle();
  if (!inst.data && !fee?.data) return json({ error: "Receipt not found" }, 404);
  const receipt = inst.data ? await buildInstalmentReceipt(admin, id) : await buildFeeReceipt(admin, id);
  if (!receipt) return json({ error: "A receipt is only available for a successful payment" }, 404);
  return json({ filename: receipt.filename, receipt_no: receipt.receiptNo, pdf_base64: bytesToBase64(receipt.pdf) });
}

/** Gateway -> server confirmation (works even if the parent closes the tab). `raw` is the untouched request body. */
export async function handleWebhook(req: Request, gateway: GatewayId, raw: string): Promise<Response> {
  try {
    const adapter = getAdapter(gateway);
    let action;
    try { action = await adapter.parseWebhook(req.headers, raw); }
    catch (e) { console.error(`${gateway} webhook not configured:`, (e as Error).message); return json({ error: "Webhook not configured" }, 503); }
    if (!action) return json({ error: "Invalid signature" }, 401);
    if (action.kind === "ignore") return json({ ok: true, ignored: action.reason });
    const admin = adminClient();

    if (action.kind === "refund") {
      const total = action.totalRefundedMinor ?? await adapter.cumulativeRefundMinor(action);   // the gateway's cumulative figure is the truth
      const { data, error } = await admin.rpc("payment_apply_refund", { p_gateway: gateway, p_payment_id: action.paymentId, p_total_refunded_minor: total });
      if (error) { console.error("refund apply failed:", error.message); return json({ error: error.message }, 500); }
      return json({ ok: true, result: data });
    }

    const lookup = (await admin.rpc("payment_lookup_order", { p_gateway: gateway, p_order_id: action.orderId })).data;
    if (!lookup) return json({ ok: true, ignored: "not one of our orders" });   // the gateway account may be shared with other apps

    if (action.kind === "payment_success") {
      if (action.amountMinor !== Number(lookup.amount_minor)) {
        console.error("webhook amount mismatch", gateway, action.orderId, action.amountMinor, lookup.amount_minor);
        return json({ ok: true, ignored: "amount mismatch - flagged in logs" });   // 200: retrying would never fix it
      }
      const { data, error } = await admin.rpc("payment_apply_success", { p_gateway: gateway, p_order_id: action.orderId, p_payment_id: action.paymentId, p_amount_minor: action.amountMinor, p_method: action.method });
      if (error) { console.error("success apply failed:", error.message); return json({ error: error.message }, 500); }   // 500 => the gateway retries
      if (!data.already_processed) await emailReceipt(admin, data.kind, data.transaction_id);
      return json({ ok: true, already_processed: data.already_processed });
    }
    const { data, error } = await admin.rpc("payment_apply_failure", { p_gateway: gateway, p_order_id: action.orderId, p_payment_id: action.paymentId, p_reason: action.reason });
    if (error) { console.error("failure apply failed:", error.message); return json({ error: error.message }, 500); }
    return json({ ok: true, result: data });
  } catch (err) {
    console.error(`${gateway} webhook:`, err);
    return json({ error: (err as Error).message }, 500);
  }
}

/** PayU posts the parent's browser back here (surl/furl). We do not trust the posted status: settle via PayU's own API, then send the
 *  browser on to the app. The redirect target comes ONLY from the APP_BASE_URL secret (never from the request: no open redirect). */
export async function handlePayuReturn(req: Request, raw: string): Promise<Response> {
  const { parseFormBody, verifyPayuResponse } = await import("./gateways/payu.ts");
  const p = parseFormBody(raw);
  const base = appBaseUrl(req, true);
  const back = (q: string) => base
    ? new Response(null, { status: 303, headers: { ...corsHeaders, Location: `${base}/parent/fee-payment?gw=payu&${q}` } })
    : new Response("Your payment is being processed. You can close this page and return to the app.", { status: 200, headers: { "Content-Type": "text/plain" } });
  const txnid = p.txnid;
  if (!txnid || !(await verifyPayuResponse(p, Deno.env.get("PAYU_SALT") ?? ""))) return back("error=invalid");
  try {
    const admin = adminClient();
    const lookup = (await admin.rpc("payment_lookup_order", { p_gateway: "payu", p_order_id: txnid })).data;
    if (!lookup) return back("error=unknown");
    await settle("payu", txnid, lookup);
  } catch (e) { console.error("payu return:", (e as Error).message); }   // the app screen re-verifies; webhooks also settle it
  return back(`order=${encodeURIComponent(txnid)}`);
}
