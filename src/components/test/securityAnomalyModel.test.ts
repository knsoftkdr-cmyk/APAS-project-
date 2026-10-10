import { describe, it, expect } from "vitest";
import {
  detectAnomalies, deviceKey, ipPrefix, maskIdentifier, normalizeIdentifier, cleanIp,
  type SecEvent,
} from "../../supabase/functions/_shared/securityAnomalyModel";

const NOW = Date.parse("2026-10-09T10:00:00Z"); // 15:30 IST
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
let n = 0;
const ev = (p: Partial<SecEvent>): SecEvent => ({
  id: `e${++n}`, user_id: "u1", school_id: "s1", role: "teacher", event_type: "login_success",
  identifier_hash: "h1", ip_address: "10.0.0.5", device_key: "chrome|windows", metadata: {}, created_at: at(1), ...p,
});
const daysAgo = (d: number, extra: Partial<SecEvent> = {}) => ev({ created_at: at(d * 1440), ...extra });
const baseline = (count = 6, extra: Partial<SecEvent> = {}) => Array.from({ length: count }, (_, i) => daysAgo(i + 2, extra));
const rules = (a: ReturnType<typeof detectAnomalies>) => a.map((x) => x.rule);

describe("helpers", () => {
  it("normalises student emails to the bare id", () => {
    expect(normalizeIdentifier(" S123@Student.APAS.local ")).toBe("s123");
    expect(normalizeIdentifier("Teacher@School.com")).toBe("teacher@school.com");
  });
  it("masks identifiers", () => { expect(maskIdentifier("Teacher@x.com")).toBe("te***"); expect(maskIdentifier("")).toBe(""); });
  it("takes the first forwarded address", () => { expect(cleanIp("1.2.3.4, 5.6.7.8")).toBe("1.2.3.4"); expect(cleanIp("unknown")).toBeNull(); });
  it("groups addresses by network", () => {
    expect(ipPrefix("192.168.4.77")).toBe("192.168.4");
    expect(ipPrefix("2401:4900:1:2:3:4:5:6")).toBe("2401:4900:1:2");
    expect(ipPrefix(null)).toBeNull();
  });
  it("labels devices coarsely", () => {
    expect(deviceKey("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537")).toBe("chrome|windows");
    expect(deviceKey("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/604")).toBe("safari|ios");
    expect(deviceKey(undefined)).toBe("unknown|unknown");
  });
});

describe("brute force / spraying", () => {
  const fails = (count: number, extra: Partial<SecEvent> = {}) =>
    Array.from({ length: count }, (_, i) => ev({ event_type: "login_failed", user_id: null, at: undefined, created_at: at(10 - i), ...extra } as any));

  it("flags 5 failures on one id inside 15 minutes", () => {
    const a = detectAnomalies({ recent: fails(5), history: [] });
    expect(rules(a)).toContain("brute_force");
    expect(a.find((x) => x.rule === "brute_force")!.severity).toBe("high");
  });
  it("is critical at double the threshold", () => {
    expect(detectAnomalies({ recent: fails(10), history: [] }).find((x) => x.rule === "brute_force")!.severity).toBe("critical");
  });
  it("ignores failures spread over hours", () => {
    const spread = Array.from({ length: 5 }, (_, i) => ev({ event_type: "login_failed", user_id: null, created_at: at(i * 60) }));
    expect(rules(detectAnomalies({ recent: spread, history: [] }))).not.toContain("brute_force");
  });
  it("flags one address failing against many ids", () => {
    const spray = Array.from({ length: 8 }, (_, i) => ev({ event_type: "login_failed", user_id: null, identifier_hash: `id${i}`, ip_address: "9.9.9.9", created_at: at(8 - i) }));
    expect(rules(detectAnomalies({ recent: spray, history: [] }))).toContain("password_spray");
  });
  it("gives the same dedupe key on a re-scan", () => {
    const f = fails(5);
    expect(detectAnomalies({ recent: f, history: [] })[0].dedupe_key).toBe(detectAnomalies({ recent: f, history: [] })[0].dedupe_key);
  });
});

describe("login anomalies", () => {
  it("flags a success right after repeated failures", () => {
    const f = [20, 15, 10].map((m) => ev({ event_type: "login_failed", user_id: null, created_at: at(m) }));
    const a = detectAnomalies({ recent: [...f, ev({ created_at: at(2) })], history: [] });
    expect(rules(a)).toContain("success_after_failures");
  });
  it("flags a new device AND network once a baseline exists", () => {
    const a = detectAnomalies({ recent: [ev({ ip_address: "203.0.113.9", device_key: "firefox|linux" })], history: baseline() });
    const hit = a.find((x) => x.rule === "new_device_and_network");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("medium");
  });
  it("raises it to high for privileged roles", () => {
    const a = detectAnomalies({
      recent: [ev({ role: "principal", ip_address: "203.0.113.9", device_key: "firefox|linux" })],
      history: baseline(6, { role: "principal" }),
    });
    expect(a.find((x) => x.rule === "new_device_and_network")!.severity).toBe("high");
  });
  it("does not flag a new network on a known device (phones roam)", () => {
    expect(rules(detectAnomalies({ recent: [ev({ ip_address: "203.0.113.9" })], history: baseline() }))).not.toContain("new_device_and_network");
  });
  it("does not flag anything without a baseline", () => {
    expect(detectAnomalies({ recent: [ev({ ip_address: "203.0.113.9", device_key: "firefox|linux" })], history: baseline(2) })).toEqual([]);
  });
  it("flags three networks inside an hour", () => {
    const r = ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((ip, i) => ev({ ip_address: ip, created_at: at(30 - i * 10) }));
    expect(rules(detectAnomalies({ recent: r, history: baseline() }))).toContain("rapid_network_change");
  });
  it("flags an overnight staff login that is unusual for them, but not for students", () => {
    const night = new Date(Date.parse("2026-10-09T21:30:00Z")).toISOString(); // 03:00 IST
    const staff = detectAnomalies({ recent: [ev({ created_at: night })], history: baseline() });
    expect(rules(staff)).toContain("odd_hours_login");
    const student = detectAnomalies({ recent: [ev({ created_at: night, role: "student" })], history: baseline(6, { role: "student" }) });
    expect(rules(student)).not.toContain("odd_hours_login");
  });
  it("does not flag overnight logins when that is their normal", () => {
    const night = "2026-10-09T21:30:00Z";
    const habitual = Array.from({ length: 6 }, (_, i) => ev({ created_at: new Date(Date.parse(night) - (i + 1) * 86_400_000).toISOString() }));
    expect(rules(detectAnomalies({ recent: [ev({ created_at: night })], history: habitual }))).not.toContain("odd_hours_login");
  });
});

describe("data access", () => {
  const exportsN = (count: number, extra: Partial<SecEvent["metadata"]> = {}) =>
    Array.from({ length: count }, (_, i) => ev({ event_type: "data_export", created_at: at(count - i), metadata: { resource: "admission_applicants", ...extra } }));

  it("flags a burst of exports", () => {
    expect(rules(detectAnomalies({ recent: exportsN(5), history: [] }))).toContain("bulk_export");
  });
  it("scales the threshold to the user's own habit", () => {
    const heavyUser = Array.from({ length: 4 }, (_, i) => ev({ event_type: "data_export", created_at: at(3 * 1440 + i) }));
    expect(rules(detectAnomalies({ recent: exportsN(8), history: heavyUser }))).not.toContain("bulk_export"); // needs 12
    expect(rules(detectAnomalies({ recent: exportsN(12), history: heavyUser }))).toContain("bulk_export");
  });
  it("flags one very large export", () => {
    const a = detectAnomalies({ recent: exportsN(1, { count: 6000 }), history: [] });
    expect(a.find((x) => x.rule === "large_export")!.severity).toBe("high");
    expect(rules(detectAnomalies({ recent: exportsN(1, { count: 40 }), history: [] }))).not.toContain("large_export");
  });
  it("flags mass record access, with a higher floor for leadership", () => {
    const views = (count: number, role: string) => Array.from({ length: count }, (_, i) =>
      ev({ role, event_type: "record_view", created_at: at(30 - i * 0.2), metadata: { resource: "student_profile", resource_id: `st${i}` } }));
    expect(rules(detectAnomalies({ recent: views(30, "teacher"), history: [] }))).toContain("mass_record_access");
    expect(rules(detectAnomalies({ recent: views(30, "principal"), history: [] }))).not.toContain("mass_record_access");
    expect(rules(detectAnomalies({ recent: views(60, "principal"), history: [] }))).toContain("mass_record_access");
  });
  it("counts repeat views of the same record once", () => {
    const same = Array.from({ length: 40 }, (_, i) => ev({ event_type: "record_view", created_at: at(40 - i), metadata: { resource_id: "st1" } }));
    expect(rules(detectAnomalies({ recent: same, history: [] }))).not.toContain("mass_record_access");
  });
});

it("orders the most severe first", () => {
  const f = Array.from({ length: 10 }, (_, i) => ev({ event_type: "login_failed", user_id: null, created_at: at(10 - i) }));
  const night = ev({ created_at: "2026-10-09T21:30:00Z" });
  const a = detectAnomalies({ recent: [...f, night], history: baseline() });
  expect(a[0].severity).toBe("critical");
  expect(a[a.length - 1].severity).toBe("low");
});
