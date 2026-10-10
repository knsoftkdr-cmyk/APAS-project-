import { describe, it, expect } from "vitest";
import { describeDevice, isUuid, mergeSessions, sessionIdFromJwt } from "../../supabase/functions/_shared/sessionModel";

const NOW = Date.parse("2026-10-10T10:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

describe("describeDevice", () => {
  it("names desktop browsers", () => {
    const d = describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit Chrome/120 Safari/537");
    expect(d).toMatchObject({ label: "Chrome on Windows", kind: "desktop" });
  });
  it("tells Edge from Chrome", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120").browser).toBe("Edge");
  });
  it("recognises phones and tablets", () => {
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537").kind).toBe("mobile");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/120 Safari/537").kind).toBe("tablet");
    expect(describeDevice("Mozilla/5.0 (iPad; CPU OS 17) Safari/604").kind).toBe("tablet");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604").label).toBe("Safari on iPhone");
  });
  it("labels the native app", () => {
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14) wv", true)).toMatchObject({ kind: "app", label: "APAS app on Android" });
  });
  it("copes with nothing", () => {
    expect(describeDevice(null).label).toBe("Unknown device");
  });
});

describe("sessionIdFromJwt", () => {
  it("reads the session_id claim, with or without Bearer", () => {
    expect(sessionIdFromJwt(jwt({ session_id: S1 }))).toBe(S1);
    expect(sessionIdFromJwt(`Bearer ${jwt({ session_id: S1 })}`)).toBe(S1);
  });
  it("returns null for a missing / malformed claim or garbage", () => {
    expect(sessionIdFromJwt(jwt({ sub: "x" }))).toBeNull();
    expect(sessionIdFromJwt(jwt({ session_id: "not-a-uuid" }))).toBeNull();
    expect(sessionIdFromJwt("garbage")).toBeNull();
    expect(sessionIdFromJwt(undefined)).toBeNull();
  });
  it("validates uuids", () => { expect(isUuid(S1)).toBe(true); expect(isUuid("x")).toBe(false); expect(isUuid(5)).toBe(false); });
});

describe("mergeSessions", () => {
  const auth = [
    { id: S1, created_at: ago(600), refreshed_at: ago(5), user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537", ip: "1.2.3.4/32" },
    { id: S2, created_at: ago(3000), refreshed_at: ago(200), user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604", ip: null },
    { id: S3, created_at: ago(9000), not_after: ago(10) },                                  // expired
  ];

  it("drops expired logins and puts this device first", () => {
    const out = mergeSessions(auth, [], S2, NOW);
    expect(out.map((d) => d.session_id)).toEqual([S2, S1]);
    expect(out[0].current).toBe(true);
  });
  it("falls back to the auth user agent / address when we have no row, stripping the /32", () => {
    const out = mergeSessions(auth, [], null, NOW);
    expect(out.find((d) => d.session_id === S1)).toMatchObject({ label: "Chrome on Windows", ip_address: "1.2.3.4" });
  });
  it("prefers our recorded label, address and last_seen", () => {
    const own = [{ session_id: S1, device_label: "APAS app on Android", kind: "app", ip_address: "9.9.9.9", first_seen: ago(700), last_seen: ago(1) }];
    const d = mergeSessions(auth, own, null, NOW).find((x) => x.session_id === S1)!;
    expect(d).toMatchObject({ label: "APAS app on Android", kind: "app", ip_address: "9.9.9.9", first_seen: ago(700), last_seen: ago(1) });
  });
  it("hides sessions we recorded as revoked", () => {
    const own = [{ session_id: S2, revoked_at: ago(1) }];
    expect(mergeSessions(auth, own, null, NOW).map((d) => d.session_id)).toEqual([S1]);
  });
  it("orders others by most recent activity", () => {
    expect(mergeSessions(auth, [], null, NOW).map((d) => d.session_id)).toEqual([S1, S2]);
  });
  it("handles empty input", () => { expect(mergeSessions([], [], null, NOW)).toEqual([]); });
});
