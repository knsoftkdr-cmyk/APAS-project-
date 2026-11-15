// _shared/gateways/payu.ts - PayU India (hosted payment page, form POST).
// Flow: server builds a signed form (SHA-512 hash with the merchant salt) -> browser POSTs it to PayU -> PayU POSTs the result back to
// surl/furl (our verify function) -> we IGNORE the posted status for crediting and ask PayU's verify_payment API instead.
import { timingSafeEqualStr } from "../instalmentGateway.ts";
import { toMinor, type CreateOrderInput, type CreateOrderResult, type Decision, type FetchLike, type GatewayAdapter, type HookAction } from "./types.ts";

/** appBaseUrl = the APP_BASE_URL secret. PayU sends the parent's browser back to OUR function, which must then redirect into the app, and
 *  that target is only ever taken from this secret (never from the request), so PayU is not "configured" without it. */
export interface PayuConfig { key: string; salt: string; env: "test" | "live"; appBaseUrl: string }

export async function sha512Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const payuHosts = (env: "test" | "live") => env === "live"
  ? { pay: "https://secure.payu.in/_payment", api: "https://info.payu.in/merchant/postservice?form=2" }
  : { pay: "https://test.payu.in/_payment", api: "https://test.payu.in/merchant/postservice?form=2" };

export const payuAmount = (minor: number) => (minor / 100).toFixed(2);

/** sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT) */
export async function payuRequestHash(p: { key: string; txnid: string; amount: string; productinfo: string; firstname: string; email: string; udf1?: string; udf2?: string; udf3?: string; udf4?: string; udf5?: string }, salt: string): Promise<string> {
  return sha512Hex([p.key, p.txnid, p.amount, p.productinfo, p.firstname, p.email, p.udf1 ?? "", p.udf2 ?? "", p.udf3 ?? "", p.udf4 ?? "", p.udf5 ?? "", "", "", "", "", "", salt].join("|"));
}
/** Response hash is the request hash in REVERSE: sha512([additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key) */
export async function payuResponseHash(p: Record<string, string>, salt: string): Promise<string> {
  const g = (k: string) => p[k] ?? "";
  const parts = [salt, g("status"), "", "", "", "", "", g("udf5"), g("udf4"), g("udf3"), g("udf2"), g("udf1"), g("email"), g("firstname"), g("productinfo"), g("amount"), g("txnid"), g("key")];
  return sha512Hex((p.additionalCharges ? `${p.additionalCharges}|` : "") + parts.join("|"));
}
export async function verifyPayuResponse(p: Record<string, string>, salt: string): Promise<boolean> {
  if (!p.hash || !salt) return false;
  return timingSafeEqualStr(await payuResponseHash(p, salt), String(p.hash).toLowerCase());
}
export const payuVerifyHash = (key: string, command: string, var1: string, salt: string) => sha512Hex(`${key}|${command}|${var1}|${salt}`);

/** Decide from PayU's verify_payment response: { status: 1, transaction_details: { <txnid>: { status, mihpayid, amt, mode, error_Message } } } */
export function decidePayuVerify(resp: any, txnid: string, expected: { amountMinor: number }): Decision {
  const tx = resp?.transaction_details?.[txnid];
  if (!tx || typeof tx !== "object") return { kind: "pending", paymentId: null };   // no attempt recorded yet
  const status = String(tx.status ?? "").toLowerCase();
  const paymentId = tx.mihpayid ? String(tx.mihpayid) : null;
  if (status === "success") {
    if (toMinor(tx.amt ?? tx.transaction_amount ?? NaN) !== expected.amountMinor) return { kind: "mismatch", reason: "Paid amount does not match the order" };
    if (!paymentId) return { kind: "mismatch", reason: "Paid transaction has no PayU id" };
    return { kind: "success", paymentId, method: tx.mode ?? null };
  }
  if (status === "pending" || status === "in progress" || status === "initiated") return { kind: "pending", paymentId };
  if (["failure", "failed", "bounced", "dropped", "usercancelled", "cancelled"].includes(status)) {
    return { kind: "failed", paymentId, reason: tx.error_Message || tx.field9 || "Payment failed" };
  }
  return { kind: "pending", paymentId };
}

export function parseFormBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

export function makePayu(cfg: PayuConfig, doFetch: FetchLike = fetch): GatewayAdapter {
  const hosts = payuHosts(cfg.env);
  return {
    id: "payu", label: "PayU",
    missingConfig: () => [!cfg.key && "PAYU_KEY", !cfg.salt && "PAYU_SALT", !/^https?:\/\//i.test(cfg.appBaseUrl) && "APP_BASE_URL"].filter(Boolean) as string[],
    async createOrder(i: CreateOrderInput): Promise<CreateOrderResult> {
      if (!i.customer.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.customer.email)) return { ok: false, error: "PayU needs a valid email address on the student's record" };
      const txnid = i.merchantRef.replace(/[^a-zA-Z0-9]/g, "").slice(0, 25);   // PayU: <= 25 alphanumeric characters
      const amount = payuAmount(i.amountMinor);
      const productinfo = i.description.replace(/[|<>"']/g, " ").slice(0, 100);
      const firstname = (i.customer.name || "Parent").replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 60) || "Parent";
      const base = { key: cfg.key, txnid, amount, productinfo, firstname, email: i.customer.email, udf1: i.notes.kind ?? "" };
      const hash = await payuRequestHash(base, cfg.salt);
      const ret = `${i.functionUrl}?gateway=payu&return=1`;
      return {
        ok: true, orderId: txnid,
        checkout: { type: "form_post", url: hosts.pay, fields: { ...base, phone: (i.customer.phone || "").replace(/\D/g, "").slice(-10), surl: ret, furl: ret, hash } },
      };
    },
    async fetchStatus(txnid, expected) {
      const hash = await payuVerifyHash(cfg.key, "verify_payment", txnid, cfg.salt);
      const res = await doFetch(hosts.api, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ key: cfg.key, command: "verify_payment", var1: txnid, hash }).toString() });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error("Could not confirm the payment with PayU");
      return decidePayuVerify(data, txnid, expected);
    },
    async parseWebhook(_headers, raw) {
      // PayU's server-to-server webhook posts the same fields (and hash) as the browser return.
      const p = parseFormBody(raw);
      if (!(await verifyPayuResponse(p, cfg.salt))) return null;
      if (p.key !== cfg.key) return null;
      const status = (p.status ?? "").toLowerCase();
      if (status === "success") return { kind: "payment_success", orderId: p.txnid, paymentId: p.mihpayid, amountMinor: toMinor(p.amount), method: p.mode ?? null };
      if (status === "failure") return { kind: "payment_failed", orderId: p.txnid, paymentId: p.mihpayid || null, reason: p.error_Message || p.field9 || "Payment failed" };
      return { kind: "ignore", reason: `status ${status}` };
    },
    // PayU does not push refund events to merchants; refunds are issued in the PayU dashboard and reconciled by the admin.
    async cumulativeRefundMinor() { return 0; },
  };
}
