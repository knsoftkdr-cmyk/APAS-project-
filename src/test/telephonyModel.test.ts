import { describe, expect, it, vi } from "vitest";
import {
  callbackToken, formatDuration, formatPhone, normalizePhone, safeEqual, verifyCallbackToken, withinCallWindow,
} from "../../supabase/functions/_shared/telephonyModel";
import {
  ExotelProvider, exotelConfigFromEnv, mapExotelStatus, normalizeExotel, parseExotelTime,
} from "../../supabase/functions/_shared/telephony/exotel";
import { AirtelIqProvider } from "../../supabase/functions/_shared/telephony/airtelIq";
import { getProvider } from "../../supabase/functions/_shared/telephony/providers";
import { ProviderError, ProviderNotConfigured } from "../../supabase/functions/_shared/telephonyModel";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"], ["98765 43210", "+919876543210"], ["09876543210", "+919876543210"], ["+91-98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"], ["(+91) 98765 43210", "+919876543210"], ["0091 9876543210", "+919876543210"],
  ])("accepts %s", (raw, e164) => { expect(normalizePhone(raw)).toEqual({ ok: true, e164 }); });
  it.each([["12345"], ["5876543210"], ["abcdefghij"], [""], ["   "], ["+91 12345 67890"], ["98765"], ["987654321012"], ["9876543210; DROP"]])("rejects %s", (raw) => {
    expect(normalizePhone(raw).ok).toBe(false);
  });
  it("rejects non-strings", () => { expect(normalizePhone(null).ok).toBe(false); expect(normalizePhone(9876543210).ok).toBe(false); });
  it("accepts a valid international number", () => { expect(normalizePhone("+44 7911 123456")).toEqual({ ok: true, e164: "+447911123456" }); });
  it("formats for display", () => { expect(formatPhone("+919876543210")).toBe("+91 98765 43210"); });
});

describe("formatDuration / calling window", () => {
  it("formats like the spec example", () => { expect(formatDuration(275)).toBe("4 minutes 35 seconds"); expect(formatDuration(60)).toBe("1 minute"); expect(formatDuration(5)).toBe("5 seconds"); expect(formatDuration(null)).toBe("—"); });
  it("reads the window in the school's timezone", () => {
    const at = new Date("2026-11-13T04:00:00Z"); // 09:30 IST
    expect(withinCallWindow(at, "Asia/Kolkata", "09:00", "21:00")).toBe(true);
    expect(withinCallWindow(new Date("2026-11-13T03:00:00Z"), "Asia/Kolkata", "09:00", "21:00")).toBe(false); // 08:30 IST
    expect(withinCallWindow(new Date("2026-11-13T15:30:00Z"), "Asia/Kolkata", "09:00", "21:00")).toBe(false); // 21:00 IST exactly
  });
});

describe("webhook tokens", () => {
  it("accepts only the token for that call", async () => {
    const t = await callbackToken("s3cret-value", "call:abc");
    expect(await verifyCallbackToken("s3cret-value", "call:abc", t)).toBe(true);
    expect(await verifyCallbackToken("s3cret-value", "call:other", t)).toBe(false);
    expect(await verifyCallbackToken("different-secret", "call:abc", t)).toBe(false);
    expect(await verifyCallbackToken("", "call:abc", t)).toBe(false);
    expect(await verifyCallbackToken("s3cret-value", "call:abc", "short")).toBe(false);
    expect(await verifyCallbackToken("s3cret-value", "call:abc", undefined)).toBe(false);
  });
  it("safeEqual compares correctly", () => { expect(safeEqual("abc", "abc")).toBe(true); expect(safeEqual("abc", "abd")).toBe(false); expect(safeEqual("abc", "ab")).toBe(false); });
});

describe("Exotel status mapping (documented statuses)", () => {
  it.each([["queued", "initiating"], ["in-progress", "connected"], ["completed", "completed"], ["busy", "busy"], ["no-answer", "missed"], ["failed", "failed"]])(
    "%s -> %s", (s, e) => { expect(mapExotelStatus(s)).toBe(e); });
  it("an 'answered' event with no status means connected; unknown stays null", () => { expect(mapExotelStatus(undefined, "answered")).toBe("connected"); expect(mapExotelStatus("weird")).toBeNull(); });
});

describe("normalizeExotel", () => {
  it("reads a status callback", () => {
    const ev = normalizeExotel({ CallSid: "abc123def", EventType: "terminal", Status: "completed", From: "+919000000001", To: "+919876543210", Duration: "280", ConversationDuration: "275",
      StartTime: "2026-11-13 10:00:00", EndTime: "2026-11-13 10:04:40", RecordingUrl: "https://recordings.example.com/a.mp3", Direction: "outbound-api", CustomField: "call-uuid" })!;
    expect(ev).toMatchObject({ providerCallId: "abc123def", status: "completed", direction: "outbound", durationSeconds: 280, conversationSeconds: 275, customField: "call-uuid" });
    expect(ev.startedAt).toBe("2026-11-13T04:30:00.000Z"); // IST read as +05:30
    expect(ev.recordingUrl).toBe("https://recordings.example.com/a.mp3");
  });
  it("reads a Call Details response ({ Call: {...} })", () => {
    const ev = normalizeExotel({ Call: { Sid: "xyz98765", Status: "no-answer", Direction: "inbound", Duration: 0, Details: { ConversationDuration: 0 } } })!;
    expect(ev).toMatchObject({ providerCallId: "xyz98765", status: "missed", direction: "inbound", durationSeconds: 0, conversationSeconds: 0 });
  });
  it("rejects payloads without a usable call id and non-https recordings", () => {
    expect(normalizeExotel({ Status: "completed" })).toBeNull();
    expect(normalizeExotel({ CallSid: "../../etc", Status: "completed" })).toBeNull();
    expect(normalizeExotel({ CallSid: "abc123def", Status: "completed", RecordingUrl: "http://insecure/a.mp3" })!.recordingUrl).toBeNull();
  });
  it("same event twice has the same dedupe key; a different status does not", () => {
    const a = normalizeExotel({ CallSid: "abc123def", EventType: "terminal", Status: "completed", Duration: 10 })!;
    const b = normalizeExotel({ CallSid: "abc123def", EventType: "terminal", Status: "completed", Duration: 10 })!;
    const c = normalizeExotel({ CallSid: "abc123def", EventType: "answered", Status: "in-progress" })!;
    expect(a.dedupeKey).toBe(b.dedupeKey); expect(a.dedupeKey).not.toBe(c.dedupeKey);
  });
  it("time parsing", () => { expect(parseExotelTime("2026-11-13T10:00:00Z")).toBe("2026-11-13T10:00:00.000Z"); expect(parseExotelTime("garbage")).toBeNull(); expect(parseExotelTime(null)).toBeNull(); });
});

const cfg = { accountSid: "acme1", apiKey: "KEY", apiToken: "TOKEN", subdomain: "api.exotel.com" };
const input = { staffPhone: "+919000000001", parentPhone: "+919876543210", callerId: "+911140000000", callbackUrl: "https://x.supabase.co/functions/v1/log-audit?telephony=exotel&cid=c&t=tok", customField: "call-uuid", record: false };
const okRes = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("ExotelProvider.initiateCall (official Connect Two Numbers request)", () => {
  it("posts the documented form fields with Basic auth to the documented URL", async () => {
    const f = vi.fn().mockReturnValue(okRes({ Call: { Sid: "callsid12345", Status: "queued" } }));
    const r = await new ExotelProvider(cfg, f).initiateCall({ ...input, record: true });
    expect(r).toEqual({ providerCallId: "callsid12345", status: "initiating" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.exotel.com/v1/Accounts/acme1/Calls/connect");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("KEY:TOKEN")}`);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body);
    expect(body.get("From")).toBe("+919000000001"); expect(body.get("To")).toBe("+919876543210"); expect(body.get("CallerId")).toBe("+911140000000");
    expect(body.get("StatusCallback")).toBe(input.callbackUrl); expect(body.getAll("StatusCallbackEvents[]")).toEqual(["terminal", "answered"]);
    expect(body.get("StatusCallbackContentType")).toBe("application/json"); expect(body.get("CustomField")).toBe("call-uuid");
    expect(body.get("Record")).toBe("true");
  });
  it("does not ask for recording unless requested", async () => {
    const f = vi.fn().mockReturnValue(okRes({ Call: { Sid: "callsid12345", Status: "queued" } }));
    await new ExotelProvider(cfg, f).initiateCall(input);
    expect(new URLSearchParams(f.mock.calls[0][1].body).has("Record")).toBe(false);
  });
  it.each([[401, /credentials/], [429, /rate limit/i], [409, /busy or switched off/], [400, /refused/], [500, /Exotel error/]])("maps HTTP %s to a clear error", async (status, msg) => {
    const f = vi.fn().mockReturnValue(okRes({ RestException: { Message: "" } }, status));
    await expect(new ExotelProvider(cfg, f).initiateCall(input)).rejects.toThrow(msg);
  });
  it("does NOT retry on a network failure (a retry could ring the parent twice)", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(new ExotelProvider(cfg, f).initiateCall(input)).rejects.toBeInstanceOf(ProviderError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects a 200 with no call id", async () => {
    await expect(new ExotelProvider(cfg, vi.fn().mockReturnValue(okRes({ nothing: true }))).initiateCall(input)).rejects.toThrow(/did not return a call id/);
  });
  it("refuses to dial when credentials are missing (never pretends)", async () => {
    const f = vi.fn();
    await expect(new ExotelProvider({ accountSid: "a" }, f).initiateCall(input)).rejects.toBeInstanceOf(ProviderNotConfigured);
    expect(f).not.toHaveBeenCalled();
  });
  it("rejects a malformed subdomain", () => { expect(() => new ExotelProvider({ ...cfg, subdomain: "evil.com/path?x=" }).assertConfigured()).toThrow(/valid host/); });
  it("Call Details uses the documented GET URL", async () => {
    const f = vi.fn().mockReturnValue(okRes({ Call: { Sid: "callsid12345", Status: "completed", Duration: 12 } }));
    const ev = await new ExotelProvider(cfg, f).getCallDetails("callsid12345");
    expect(f.mock.calls[0][0]).toBe("https://api.exotel.com/v1/Accounts/acme1/Calls/callsid12345.json?details=true");
    expect(ev.durationSeconds).toBe(12);
  });
  it("env config defaults the subdomain", () => { expect(exotelConfigFromEnv(() => undefined).subdomain).toBe("api.exotel.com"); expect(exotelConfigFromEnv((k) => (k === "EXOTEL_SUBDOMAIN" ? "api.in.exotel.com" : undefined)).subdomain).toBe("api.in.exotel.com"); });
});

describe("Airtel IQ readiness", () => {
  it("is selectable but honestly not integrated", async () => {
    const p = getProvider("airtel_iq", () => undefined);
    expect(p).toBeInstanceOf(AirtelIqProvider);
    expect(() => p.assertConfigured()).toThrow(/not integrated/);
    await expect(p.initiateCall({ ...input })).rejects.toBeInstanceOf(ProviderNotConfigured);
    expect(p.processWebhook({})).toBeNull();
  });
  it("unknown provider is refused", () => { expect(() => getProvider("nope", () => undefined)).toThrow(/Unknown/); });
});
