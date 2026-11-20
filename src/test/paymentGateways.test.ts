import { describe, expect, it } from "vitest";
import { isGatewayId, toMinor, GATEWAY_IDS } from "../../supabase/functions/_shared/gateways/types";
import { GATEWAY_META, GATEWAY_ORDER, gatewayLabel } from "@/lib/paymentGateways";

describe("shared", () => {
  it("money is integer minor units, no float drift", () => { expect(toMinor("5000.10")).toBe(500010); expect(toMinor(0.29)).toBe(29); expect(toMinor(19.99)).toBe(1999); });
});

describe("Razorpay is the only gateway", () => {
  it("only 'razorpay' is a valid gateway id", () => {
    expect(GATEWAY_IDS).toEqual(["razorpay"]);
    expect(isGatewayId("razorpay")).toBe(true);
    for (const removed of ["stripe", "payu", "cashfree", "paypal", undefined, null]) expect(isGatewayId(removed)).toBe(false);
  });
  it("the client knows only Razorpay", () => {
    expect(GATEWAY_ORDER).toEqual(["razorpay"]);
    expect(Object.keys(GATEWAY_META)).toEqual(["razorpay"]);
    expect(gatewayLabel("razorpay")).toBe("Razorpay");
    expect(gatewayLabel("stripe")).toBe("stripe");   // old history rows still display something sensible
  });
  it("the Razorpay webhook URL needs no query string (already-registered webhooks keep working)", () => {
    expect(GATEWAY_META.razorpay.webhook("https://x.supabase.co")).toBe("https://x.supabase.co/functions/v1/verify-razorpay-payment");
  });
});
