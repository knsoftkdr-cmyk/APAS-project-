import { describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { decideStripeSession, makeStripe, parseStripeEvent, stripeEncode, verifyStripeSignature } from "../../supabase/functions/_shared/gateways/stripe";
import { decidePayuVerify, makePayu, parseFormBody, payuAmount, payuRequestHash, payuResponseHash, payuVerifyHash, verifyPayuResponse } from "../../supabase/functions/_shared/gateways/payu";
import { cleanPhone, decideCashfreePayments, makeCashfree, parseCashfreeEvent, verifyCashfreeWebhook } from "../../supabase/functions/_shared/gateways/cashfree";
import { isGatewayId, toMinor } from "../../supabase/functions/_shared/gateways/types";

const sha512 = (s: string) => createHash("sha512").update(s).digest("hex");
const hmacHex = (m: string, k: string) => createHmac("sha256", k).update(m).digest("hex");
const hmacB64 = (m: string, k: string) => createHmac("sha256", k).update(m).digest("base64");
const jsonRes = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as unknown as Response;
const input = { merchantRef: "f1234abcd", amountMinor: 500000, currency: "INR", description: "School fees - Aarav", customer: { name: "Mr Rao", email: "rao@example.com", phone: "+91 98765 43210" }, appBaseUrl: "https://app.example.com", functionUrl: "https://x.supabase.co/functions/v1/verify-razorpay-payment", notes: { kind: "fee", customer_id: "u-1" } };

describe("shared", () => {
  it("money is integer minor units, no float drift", () => { expect(toMinor("5000.10")).toBe(500010); expect(toMinor(0.29)).toBe(29); expect(toMinor(19.99)).toBe(1999); });
  it("only the four gateways are valid ids", () => { expect(isGatewayId("stripe")).toBe(true); expect(isGatewayId("paypal")).toBe(false); expect(isGatewayId(undefined)).toBe(false); });
});

describe("Stripe", () => {
  it("encodes nested params in Stripe's bracket form", () => {
    const s = decodeURIComponent(stripeEncode({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "inr", unit_amount: 500000 } }], metadata: { a: "b" } }));
    expect(s).toContain("mode=payment"); expect(s).toContain("line_items[0][quantity]=1"); expect(s).toContain("line_items[0][price_data][unit_amount]=500000"); expect(s).toContain("metadata[a]=b");
  });
  it("keeps the {CHECKOUT_SESSION_ID} placeholder intact", () => { expect(stripeEncode({ success_url: "https://a/b?order={CHECKOUT_SESSION_ID}" })).toContain("{CHECKOUT_SESSION_ID}"); });
  const raw = JSON.stringify({ type: "x" }), now = 1_700_000_000, t = String(now);
  it("accepts a genuine signature", async () => { expect(await verifyStripeSignature(raw, `t=${t},v1=${hmacHex(`${t}.${raw}`, "whsec_1")}`, "whsec_1", now)).toBe(true); });
  it("accepts when one of several v1 signatures matches (secret rotation)", async () => { expect(await verifyStripeSignature(raw, `t=${t},v1=deadbeef,v1=${hmacHex(`${t}.${raw}`, "whsec_1")}`, "whsec_1", now)).toBe(true); });
  it("rejects forged / tampered / wrong-secret / missing / replayed signatures", async () => {
    const good = `t=${t},v1=${hmacHex(`${t}.${raw}`, "whsec_1")}`;
    expect(await verifyStripeSignature(raw + " ", good, "whsec_1", now)).toBe(false);
    expect(await verifyStripeSignature(raw, good, "whsec_2", now)).toBe(false);
    expect(await verifyStripeSignature(raw, null, "whsec_1", now)).toBe(false);
    expect(await verifyStripeSignature(raw, "garbage", "whsec_1", now)).toBe(false);
    expect(await verifyStripeSignature(raw, good, "whsec_1", now + 3600)).toBe(false);
  });
  const exp = { amountMinor: 500000, currency: "INR" };
  it("paid session for the exact amount = success with the payment intent id", () => {
    expect(decideStripeSession({ id: "cs_1", payment_status: "paid", amount_total: 500000, currency: "inr", payment_intent: "pi_1", payment_method_types: ["card"] }, exp)).toEqual({ kind: "success", paymentId: "pi_1", method: "card" });
  });
  it("paid but wrong amount or currency is a mismatch, never credited", () => {
    expect(decideStripeSession({ id: "cs_1", payment_status: "paid", amount_total: 100, currency: "inr", payment_intent: "pi_1" }, exp).kind).toBe("mismatch");
    expect(decideStripeSession({ id: "cs_1", payment_status: "paid", amount_total: 500000, currency: "usd", payment_intent: "pi_1" }, exp).kind).toBe("mismatch");
  });
  it("open / unpaid is pending; expired is failed", () => {
    expect(decideStripeSession({ id: "cs_1", status: "open", payment_status: "unpaid" }, exp).kind).toBe("pending");
    expect(decideStripeSession({ id: "cs_1", status: "complete", payment_status: "unpaid", payment_intent: "pi_1" }, exp).kind).toBe("pending");   // delayed method
    expect(decideStripeSession({ id: "cs_1", status: "expired", payment_status: "unpaid" }, exp).kind).toBe("failed");
  });
  it("maps webhook events", () => {
    expect(parseStripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 500000 } } })).toMatchObject({ kind: "payment_success", orderId: "cs_1", paymentId: "pi_1", amountMinor: 500000 });
    expect(parseStripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "unpaid", payment_intent: "pi_1" } } }).kind).toBe("ignore");
    expect(parseStripeEvent({ type: "checkout.session.async_payment_failed", data: { object: { id: "cs_1" } } }).kind).toBe("payment_failed");
    expect(parseStripeEvent({ type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount_refunded: 200000 } } })).toEqual({ kind: "refund", paymentId: "pi_1", totalRefundedMinor: 200000 });
    expect(parseStripeEvent({ type: "customer.created", data: { object: {} } }).kind).toBe("ignore");
  });
  it("createOrder sends the server-side amount with the secret key and returns a redirect", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ id: "cs_9", url: "https://checkout.stripe.com/c/pay/cs_9" }));
    const r = await makeStripe({ secretKey: "sk_test_x", currency: "inr" }, f as any).createOrder(input);
    expect(r).toEqual({ ok: true, orderId: "cs_9", checkout: { type: "redirect", url: "https://checkout.stripe.com/c/pay/cs_9" } });
    const [url, init] = f.mock.calls[0]; const body = decodeURIComponent(String(init.body));
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions"); expect(init.headers.Authorization).toBe("Bearer sk_test_x"); expect(init.headers["Idempotency-Key"]).toBe("f1234abcd");
    expect(body).toContain("unit_amount]=500000"); expect(body).toContain("currency]=inr"); expect(body).toContain("gw=stripe&order={CHECKOUT_SESSION_ID}");
  });
  it("createOrder surfaces Stripe's error and refuses without an app address", async () => {
    expect(await makeStripe({ secretKey: "k", currency: "inr" }, (async () => jsonRes({ error: { message: "Invalid API Key" } }, false)) as any).createOrder(input)).toEqual({ ok: false, error: "Invalid API Key" });
    expect((await makeStripe({ secretKey: "k", currency: "inr" }).createOrder({ ...input, appBaseUrl: null })).ok).toBe(false);
  });
  it("fetchStatus retrieves the session from Stripe", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ id: "cs_1", payment_status: "paid", amount_total: 500000, currency: "inr", payment_intent: "pi_1" }));
    expect((await makeStripe({ secretKey: "k", currency: "inr" }, f as any).fetchStatus("cs_1", exp)).kind).toBe("success");
    expect(f.mock.calls[0][0]).toBe("https://api.stripe.com/v1/checkout/sessions/cs_1");
  });
  it("reports missing secrets by NAME only", () => { expect(makeStripe({ secretKey: "", currency: "inr" }).missingConfig()).toEqual(["STRIPE_SECRET_KEY"]); expect(makeStripe({ secretKey: "k", currency: "inr" }).missingConfig()).toEqual([]); });
});

describe("PayU", () => {
  const salt = "SALT123", key = "KEY123";
  it("request hash matches the documented layout exactly", async () => {
    const p = { key, txnid: "T1", amount: "5000.00", productinfo: "fees", firstname: "Rao", email: "r@x.com" };
    expect(await payuRequestHash(p, salt)).toBe(sha512("KEY123|T1|5000.00|fees|Rao|r@x.com|||||||||||SALT123"));
  });
  const resp = { key, txnid: "T1", amount: "5000.00", productinfo: "fees", firstname: "Rao", email: "r@x.com", status: "success", udf1: "fee", mihpayid: "403993715", mode: "UPI" };
  it("a genuine response verifies", async () => {
    expect(await verifyPayuResponse({ ...resp, hash: await payuResponseHash(resp, salt) }, salt)).toBe(true);
  });
  it("response hash layout: SALT|status + 5 empty udf6-10 + udf5..udf1|email|firstname|productinfo|amount|txnid|key", async () => {
    expect(await payuResponseHash({ ...resp, udf1: "" }, salt)).toBe(sha512("SALT123|success|||||||||||r@x.com|Rao|fees|5000.00|T1|KEY123"));
  });
  it("rejects a tampered status, amount, wrong salt, missing hash", async () => {
    const hash = await payuResponseHash(resp, salt);
    expect(await verifyPayuResponse({ ...resp, hash, status: "failure" }, salt)).toBe(false);
    expect(await verifyPayuResponse({ ...resp, hash, amount: "1.00" }, salt)).toBe(false);
    expect(await verifyPayuResponse({ ...resp, hash }, "other")).toBe(false);
    expect(await verifyPayuResponse({ ...resp }, salt)).toBe(false);
  });
  it("additionalCharges is prefixed when PayU sends it", async () => {
    expect(await payuResponseHash({ ...resp, udf1: "", additionalCharges: "12.00" }, salt)).toBe(sha512("12.00|SALT123|success|||||||||||r@x.com|Rao|fees|5000.00|T1|KEY123"));
  });
  it("verify_payment hash", async () => { expect(await payuVerifyHash(key, "verify_payment", "T1", salt)).toBe(sha512("KEY123|verify_payment|T1|SALT123")); });
  it("amount formatting", () => { expect(payuAmount(500000)).toBe("5000.00"); expect(payuAmount(1999)).toBe("19.99"); });
  it("decides from verify_payment", () => {
    const wrap = (tx: any) => ({ status: 1, transaction_details: { T1: tx } });
    expect(decidePayuVerify(wrap({ status: "success", mihpayid: "99", amt: "5000.00", mode: "UPI" }), "T1", { amountMinor: 500000 })).toEqual({ kind: "success", paymentId: "99", method: "UPI" });
    expect(decidePayuVerify(wrap({ status: "success", mihpayid: "99", amt: "10.00" }), "T1", { amountMinor: 500000 }).kind).toBe("mismatch");
    expect(decidePayuVerify(wrap({ status: "failure", mihpayid: "99", error_Message: "Bank declined" }), "T1", { amountMinor: 500000 })).toEqual({ kind: "failed", paymentId: "99", reason: "Bank declined" });
    expect(decidePayuVerify(wrap({ status: "pending", mihpayid: "99" }), "T1", { amountMinor: 500000 }).kind).toBe("pending");
    expect(decidePayuVerify({ status: 0, transaction_details: {} }, "T1", { amountMinor: 500000 }).kind).toBe("pending");
  });
  it("createOrder builds a signed form pointing at PayU and back to our function", async () => {
    const r = await makePayu({ key, salt, env: "test", appBaseUrl: "https://app.example.com" }).createOrder(input);
    if (!r.ok || r.checkout.type !== "form_post") throw new Error("expected form");
    const f = r.checkout.fields;
    expect(r.checkout.url).toBe("https://test.payu.in/_payment"); expect(f.amount).toBe("5000.00"); expect(f.key).toBe(key); expect(f.txnid).toBe(r.orderId);
    expect(r.orderId.length).toBeLessThanOrEqual(25); expect(f.phone).toBe("9876543210");
    expect(f.surl).toBe("https://x.supabase.co/functions/v1/verify-razorpay-payment?gateway=payu&return=1");
    expect(f.hash).toBe(await payuRequestHash({ key, txnid: f.txnid, amount: f.amount, productinfo: f.productinfo, firstname: f.firstname, email: f.email, udf1: f.udf1 }, salt));
    expect(JSON.stringify(r)).not.toContain(salt);   // the salt never reaches the browser
  });
  it("live env uses the production hosts", async () => { const r = await makePayu({ key, salt, env: "live", appBaseUrl: "https://app.example.com" }).createOrder(input); expect(r.ok && r.checkout.type === "form_post" && r.checkout.url).toBe("https://secure.payu.in/_payment"); });
  it("is not configured without a valid APP_BASE_URL (its return redirect needs it)", () => {
    expect(makePayu({ key, salt, env: "test", appBaseUrl: "" }).missingConfig()).toEqual(["APP_BASE_URL"]);
    expect(makePayu({ key: "", salt: "", env: "test", appBaseUrl: "app.example.com" }).missingConfig()).toEqual(["PAYU_KEY", "PAYU_SALT", "APP_BASE_URL"]);
    expect(makePayu({ key, salt, env: "test", appBaseUrl: "https://app.example.com" }).missingConfig()).toEqual([]);
  });
  it("refuses an invalid email", async () => { expect((await makePayu({ key, salt, env: "test", appBaseUrl: "https://app.example.com" }).createOrder({ ...input, customer: { name: "A", email: "nope" } })).ok).toBe(false); });
  it("fetchStatus posts the hashed verify_payment command", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ status: 1, transaction_details: { T1: { status: "success", mihpayid: "7", amt: "5000.00", mode: "CC" } } }));
    expect((await makePayu({ key, salt, env: "test", appBaseUrl: "https://app.example.com" }, f as any).fetchStatus("T1", { amountMinor: 500000, currency: "INR" })).kind).toBe("success");
    const p = parseFormBody(String(f.mock.calls[0][1].body)); expect(p.command).toBe("verify_payment"); expect(p.var1).toBe("T1"); expect(p.hash).toBe(sha512("KEY123|verify_payment|T1|SALT123"));
  });
  it("webhook: valid hash accepted, forged rejected, other merchant key rejected", async () => {
    const adapter = makePayu({ key, salt, env: "test", appBaseUrl: "https://app.example.com" });
    const body = new URLSearchParams({ ...resp, hash: await payuResponseHash(resp, salt) }).toString();
    expect(await adapter.parseWebhook(new Headers(), body)).toEqual({ kind: "payment_success", orderId: "T1", paymentId: "403993715", amountMinor: 500000, method: "UPI" });
    expect(await adapter.parseWebhook(new Headers(), body.replace("success", "failure"))).toBeNull();
    const other = { ...resp, key: "OTHER" }; expect(await adapter.parseWebhook(new Headers(), new URLSearchParams({ ...other, hash: await payuResponseHash(other, salt) }).toString())).toBeNull();
  });
});

describe("Cashfree", () => {
  const secret = "cfsk_test";
  it("webhook signature = base64(HMAC_SHA256(timestamp + rawBody))", async () => {
    const raw = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}', ts = "1700000000";
    expect(await verifyCashfreeWebhook(raw, ts, hmacB64(ts + raw, secret), secret)).toBe(true);
    expect(await verifyCashfreeWebhook(raw + " ", ts, hmacB64(ts + raw, secret), secret)).toBe(false);
    expect(await verifyCashfreeWebhook(raw, "1700000001", hmacB64(ts + raw, secret), secret)).toBe(false);
    expect(await verifyCashfreeWebhook(raw, ts, null, secret)).toBe(false);
    expect(await verifyCashfreeWebhook(raw, ts, hmacB64(ts + raw, "other"), secret)).toBe(false);
  });
  const exp = { amountMinor: 500000 };
  it("decides from the order's payments", () => {
    const pay = (s: string, amt = 5000, id = 1, extra = {}) => ({ cf_payment_id: id, payment_status: s, payment_amount: amt, payment_method: { upi: {} }, ...extra });
    expect(decideCashfreePayments([pay("SUCCESS")], exp)).toEqual({ kind: "success", paymentId: "1", method: "upi" });
    expect(decideCashfreePayments([pay("FAILED", 5000, 1), pay("SUCCESS", 5000, 2)], exp)).toMatchObject({ kind: "success", paymentId: "2" });   // retry after failure
    expect(decideCashfreePayments([pay("SUCCESS", 10)], exp).kind).toBe("mismatch");
    expect(decideCashfreePayments([pay("PENDING")], exp).kind).toBe("pending");
    expect(decideCashfreePayments([pay("FAILED", 5000, 1, { error_details: { error_description: "Insufficient funds" } })], exp)).toEqual({ kind: "failed", paymentId: "1", reason: "Insufficient funds" });
    expect(decideCashfreePayments([pay("USER_DROPPED")], exp).kind).toBe("failed");
    expect(decideCashfreePayments([], exp)).toEqual({ kind: "pending", paymentId: null });
  });
  it("maps webhook events", () => {
    expect(parseCashfreeEvent({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "o1" }, payment: { cf_payment_id: 55, payment_amount: 5000, payment_method: { card: {} } } } })).toEqual({ kind: "payment_success", orderId: "o1", paymentId: "55", amountMinor: 500000, method: "card" });
    expect(parseCashfreeEvent({ type: "PAYMENT_FAILED_WEBHOOK", data: { order: { order_id: "o1" }, payment: { cf_payment_id: 55 }, error_details: { error_description: "declined" } } })).toMatchObject({ kind: "payment_failed", reason: "declined" });
    expect(parseCashfreeEvent({ type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_status: "SUCCESS", cf_payment_id: 55, order_id: "o1" } } })).toEqual({ kind: "refund", paymentId: "55", orderId: "o1" });
    expect(parseCashfreeEvent({ type: "REFUND_STATUS_WEBHOOK", data: { refund: { refund_status: "PENDING", cf_payment_id: 55 } } }).kind).toBe("ignore");
    expect(parseCashfreeEvent({ type: "PAYMENT_USER_DROPPED_WEBHOOK", data: {} }).kind).toBe("ignore");
  });
  it("cleans phone numbers", () => { expect(cleanPhone("+91 98765-43210")).toBe("9876543210"); expect(cleanPhone(undefined)).toBe(""); });
  it("createOrder sends credentials as headers, the server amount, and returns only the session id", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ order_id: "f1234abcd", payment_session_id: "session_abc", cf_order_id: 1 }));
    const r = await makeCashfree({ appId: "APP", secretKey: secret, env: "sandbox" }, f as any).createOrder(input);
    expect(r).toEqual({ ok: true, orderId: "f1234abcd", checkout: { type: "cashfree", payment_session_id: "session_abc", mode: "sandbox" } });
    const [url, init] = f.mock.calls[0]; const body = JSON.parse(init.body);
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders"); expect(init.headers["x-client-id"]).toBe("APP"); expect(init.headers["x-api-version"]).toBe("2023-08-01");
    expect(body.order_amount).toBe(5000); expect(body.customer_details.customer_phone).toBe("9876543210");
    expect(body.order_meta.notify_url).toContain("gateway=cashfree&hook=1"); expect(JSON.stringify(r)).not.toContain(secret);
  });
  it("production env uses the live host; missing phone is refused", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes({ order_id: "o", payment_session_id: "s" }));
    await makeCashfree({ appId: "A", secretKey: "S", env: "production" }, f as any).createOrder(input); expect(f.mock.calls[0][0]).toBe("https://api.cashfree.com/pg/orders");
    expect((await makeCashfree({ appId: "A", secretKey: "S", env: "sandbox" }).createOrder({ ...input, customer: { name: "A" } })).ok).toBe(false);
  });
  it("cumulative refund = sum of SUCCESS refunds of that payment only", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes([{ refund_status: "SUCCESS", cf_payment_id: 55, refund_amount: 1000 }, { refund_status: "SUCCESS", cf_payment_id: 55, refund_amount: 500.5 }, { refund_status: "PENDING", cf_payment_id: 55, refund_amount: 99 }, { refund_status: "SUCCESS", cf_payment_id: 77, refund_amount: 9 }]));
    expect(await makeCashfree({ appId: "A", secretKey: "S", env: "sandbox" }, f as any).cumulativeRefundMinor({ kind: "refund", paymentId: "55", orderId: "o1" })).toBe(150050);
  });
});
