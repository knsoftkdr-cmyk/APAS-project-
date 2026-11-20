// _shared/gateways/index.ts - the gateway registry (Razorpay is the only gateway). The ONLY place that picks a gateway adapter.
// Credentials never go to the browser, the database or the logs; the UI only learns whether the gateway is configured.
import { makeRazorpay } from "./razorpay.ts";
import { GATEWAY_IDS, type GatewayAdapter, type GatewayId } from "./types.ts";

export function getAdapter(id: GatewayId): GatewayAdapter {
  switch (id) {
    case "razorpay": return makeRazorpay();
  }
}
export const allAdapters = (): GatewayAdapter[] => GATEWAY_IDS.map(getAdapter);

/** Fees are held in INR; no currency conversion is performed. */
export const gatewayCurrency = (_id: GatewayId): string => "INR";
