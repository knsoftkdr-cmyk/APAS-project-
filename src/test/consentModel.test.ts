import { describe, it, expect } from "vitest";
import {
  CONSENT_CATEGORIES, applyDecision, describeChange, historyForChild, isComplete, isConsentCategory,
  statusFor, summariseChild, type ConsentHistoryEntry, type ConsentRecord,
} from "../lib/consentModel";

const rec = (student_id: string, category: ConsentRecord["category"], status: ConsentRecord["status"]): ConsentRecord => ({
  student_id, category, status, updated_at: "2026-10-20T10:00:00Z",
});

describe("consent categories", () => {
  it("lists activities, photos, field trips and data use, each with text for parents", () => {
    expect(CONSENT_CATEGORIES.map((c) => c.key)).toEqual(["activities", "photos", "field_trips", "data_use"]);
    for (const c of CONSENT_CATEGORIES) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
  it("recognises only real categories", () => {
    expect(isConsentCategory("photos")).toBe(true);
    expect(isConsentCategory("passwords")).toBe(false);
    expect(isConsentCategory(undefined)).toBe(false);
  });
});

describe("statusFor", () => {
  it("is pending when nothing is saved", () => {
    expect(statusFor([], "kid1", "photos")).toBe("pending");
  });
  it("returns the saved decision for that child and category only", () => {
    const records = [rec("kid1", "photos", "granted"), rec("kid2", "photos", "denied")];
    expect(statusFor(records, "kid1", "photos")).toBe("granted");
    expect(statusFor(records, "kid2", "photos")).toBe("denied");
    expect(statusFor(records, "kid1", "field_trips")).toBe("pending");
  });
});

describe("summariseChild / isComplete", () => {
  it("counts every category, with unanswered ones as pending", () => {
    const records = [rec("kid1", "photos", "granted"), rec("kid1", "data_use", "denied"), rec("kid2", "activities", "granted")];
    expect(summariseChild(records, "kid1")).toEqual({ granted: 1, denied: 1, pending: 2, total: 4 });
    expect(summariseChild([], "kid1")).toEqual({ granted: 0, denied: 0, pending: 4, total: 4 });
  });
  it("is complete only when all four are answered", () => {
    const all = CONSENT_CATEGORIES.map((c) => rec("kid1", c.key, "granted"));
    expect(isComplete(all, "kid1")).toBe(true);
    expect(isComplete(all.slice(1), "kid1")).toBe(false);
    expect(isComplete(all, "kid2")).toBe(false);
  });
});

describe("applyDecision", () => {
  it("adds a new decision without touching others", () => {
    const before = [rec("kid1", "photos", "granted")];
    const after = applyDecision(before, "kid1", "field_trips", "denied", "2026-10-21T00:00:00Z");
    expect(after).toHaveLength(2);
    expect(statusFor(after, "kid1", "photos")).toBe("granted");
    expect(statusFor(after, "kid1", "field_trips")).toBe("denied");
  });
  it("replaces an earlier decision for the same child and category", () => {
    const before = [rec("kid1", "photos", "granted")];
    const after = applyDecision(before, "kid1", "photos", "denied", "2026-10-21T00:00:00Z");
    expect(after).toHaveLength(1);
    expect(statusFor(after, "kid1", "photos")).toBe("denied");
  });
  it("does not change the list it was given", () => {
    const before = [rec("kid1", "photos", "granted")];
    applyDecision(before, "kid1", "photos", "denied", "2026-10-21T00:00:00Z");
    expect(before[0].status).toBe("granted");
  });
});

describe("history", () => {
  const entry = (id: string, student_id: string, changed_at: string): ConsentHistoryEntry => ({
    id, student_id, category: "photos", old_status: "pending", new_status: "granted", changed_at,
  });
  it("shows one child's changes, newest first", () => {
    const list = [entry("a", "kid1", "2026-10-01T00:00:00Z"), entry("b", "kid2", "2026-10-05T00:00:00Z"), entry("c", "kid1", "2026-10-09T00:00:00Z")];
    expect(historyForChild(list, "kid1").map((e) => e.id)).toEqual(["c", "a"]);
  });
  it("describes a change in plain words", () => {
    expect(describeChange(entry("a", "kid1", "2026-10-01T00:00:00Z"))).toBe("Photos and videos: No answer yet to Allowed");
  });
});

describe("consent center wiring", () => {
  it("is a parent-only route with a parent sidebar link", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync("src/App.tsx", "utf8");
    const line = app.split("\n").find((l) => l.includes('path="/consent-center"')) ?? "";
    expect(line.includes("ProtectedRoute")).toBe(true);
    expect(line.includes('allowedRoles={["parent"]}')).toBe(true);
    const sidebar = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
    expect(sidebar.includes('path: "/consent-center"')).toBe(true);
    expect(sidebar.includes('"Consent Center"')).toBe(true);
  });
  it("migration is additive and keeps clients away from the history table and trigger function", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261025000000_parent_consent_center.sql", "utf8");
    expect(/DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE[^;]*DROP\s+COLUMN/i.test(sql)).toBe(false);
    expect(sql.includes("ENABLE ROW LEVEL SECURITY")).toBe(true);
    expect(sql.includes("SET search_path = public")).toBe(true);
    expect(/REVOKE ALL ON FUNCTION public\.log_parent_consent_change/.test(sql)).toBe(true);
  });
});
