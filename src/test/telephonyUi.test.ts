import { describe, expect, it } from "vitest";
import { schoolLocalToIso, formatInSchoolTz } from "@/lib/telephony";

describe("school-timezone follow-up times", () => {
  it("treats the typed time as school local time (IST = UTC+5:30)", () => {
    expect(schoolLocalToIso("2026-11-20T15:30", "Asia/Kolkata")).toBe("2026-11-20T10:00:00.000Z");
  });
  it("handles a zone with DST", () => {
    expect(schoolLocalToIso("2026-07-01T09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(schoolLocalToIso("2026-01-15T09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
  });
  it("rejects garbage and unknown zones", () => {
    expect(schoolLocalToIso("", "Asia/Kolkata")).toBeNull();
    expect(schoolLocalToIso("2026-11-20T15:30", "Not/AZone")).toBeNull();
  });
  it("formats in the school zone", () => { expect(formatInSchoolTz("2026-11-20T10:00:00.000Z", "Asia/Kolkata")).toMatch(/3:30/); });
});
