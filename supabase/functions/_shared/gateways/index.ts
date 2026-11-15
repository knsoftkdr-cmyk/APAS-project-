// _shared/gateways/index.ts - the gateway registry. The ONLY place that reads gateway credentials (Supabase secrets / env).
// Credentials never go to the browser, the database or the logs; the UI only learns whether a gateway is configured.
import { makeCashfree } from "./cashfree.ts";
import { makePayu } from "./payu.ts";
import { makeRazorpay } from "./razorpay.ts";
import { makeStripe } from "./stripe.ts";
import { GATEWAY_IDS, type GatewayAdapter, type GatewayId } from "./types.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

export function getAdapter(id: GatewayId): GatewayAdapter {
  switch (id) {
    case "razorpay": return makeRazorpay();
    case "stripe":   return makeStripe({ secretKey: env("STRIPE_SECRET_KEY"), webhookSecret: env("STRIPE_WEBHOOK_SECRET") || undefined, currency: "inr" });
    case "payu":     return makePayu({ key: env("PAYU_KEY"), salt: env("PAYU_SALT"), env: env("PAYU_ENV") === "live" ? "live" : "test", appBaseUrl: env("APP_BASE_URL") });
    case "cashfree": return makeCashfree({ appId: env("CASHFREE_APP_ID"), secretKey: env("CASHFREE_SECRET_KEY"), env: env("CASHFREE_ENV") === "production" ? "production" : "sandbox" });
  }
}
export const allAdapters = (): GatewayAdapter[] => GATEWAY_IDS.map(getAdapter);

/** Currency each gateway charges in. Fees are held in INR; no currency conversion is performed. */
export const gatewayCurrency = (_id: GatewayId): string => "INR";

/** Public address of the web app (redirect gateways send the parent back here). PayU's return target is env-only (see handlers). */
export function appBaseUrl(req: Request, envOnly = false): string | null {
  const raw = env("APP_BASE_URL") || (envOnly ? "" : req.headers.get("origin") ?? "");
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}
export const functionUrl = () => `${env("SUPABASE_URL")}/functions/v1/verify-razorpay-payment`;
