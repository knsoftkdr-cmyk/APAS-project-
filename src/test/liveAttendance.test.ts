import { describe, expect, it, vi } from "vitest";

// The helpers under test are pure; the supabase client is only needed by the RPC wrappers.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  attendedPercent,
  classReportCsv,
  classifyAttendance,
  formatDuration,
  isMissingRpc,
  legacyStatusFor,
  normalizeResult,
  presenceState,
  sessionReportCsv,
  validateRules,
  type ClassReportRow,
  type SessionReportRow,
} from "@/lib/liveAttendance";

const rules = { present_min_percent: 75, partial_min_percent: 40 };

describe("classifyAttendance (same rule the database applies)", () => {
  it("is Present at or above the present threshold", () => {
    expect(classifyAttendance(75, rules)).toBe("present");
    expect(classifyAttendance(100, rules)).toBe("present");
  });
  it("is Partial from the partial threshold up to just below present", () => {
    expect(classifyAttendance(74.9, rules)).toBe("partial");
    expect(classifyAttendance(40, rules)).toBe("partial");
  });
  it("is Absent below the partial threshold", () => {
    expect(classifyAttendance(39.9, rules)).toBe("absent");
    expect(classifyAttendance(0, rules)).toBe("absent");
  });
  it("follows configured rules", () => {
    expect(classifyAttendance(66.7, { present_min_percent: 60, partial_min_percent: 30 })).toBe("present");
    expect(classifyAttendance(50, { present_min_percent: 90, partial_min_percent: 60 })).toBe("absent");
  });
});

describe("attendedPercent", () => {
  it("is time attended over the window, to one decimal", () => {
    expect(attendedPercent(3300, 3600)).toBe(91.7);
    expect(attendedPercent(1800, 3600)).toBe(50);
  });
  it("caps at 100 and never goes negative", () => {
    expect(attendedPercent(7200, 3600)).toBe(100);
    expect(attendedPercent(-5, 3600)).toBe(0);
  });
  it("is 0 for an empty window instead of NaN", () => {
    expect(attendedPercent(100, 0)).toBe(0);
  });
});

describe("legacy compatibility", () => {
  it("reads rows written before automatic attendance", () => {
    expect(normalizeResult(null, "joined")).toBe("present");
    expect(normalizeResult(undefined, "absent")).toBe("absent");
    expect(normalizeResult(null, "excused")).toBe("excused");
    expect(normalizeResult(null, null)).toBe("absent");
  });
  it("prefers the new result when present", () => {
    expect(normalizeResult("partial", "joined")).toBe("partial");
    expect(normalizeResult("absent", "joined")).toBe("absent");
  });
  it("keeps 'joined' for Present and Partial so the engagement score is unchanged", () => {
    expect(legacyStatusFor("present")).toBe("joined");
    expect(legacyStatusFor("partial")).toBe("joined");
    expect(legacyStatusFor("absent")).toBe("absent");
    expect(legacyStatusFor("excused")).toBe("excused");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(null)).toBe("0 min");
    expect(formatDuration(30)).toBe("<1 min");
    expect(formatDuration(39 * 60)).toBe("39 min");
    expect(formatDuration(65 * 60)).toBe("1 h 05 min");
    expect(formatDuration(120 * 60)).toBe("2 h 00 min");
  });
});

describe("validateRules", () => {
  const ok = { present_min_percent: 75, partial_min_percent: 40, late_grace_minutes: 10, heartbeat_timeout_seconds: 180, background_grace_minutes: 60 };
  it("accepts the defaults", () => expect(validateRules(ok)).toBeNull());
  it("rejects Partial above Present", () => expect(validateRules({ ...ok, partial_min_percent: 80 })).toMatch(/cannot be higher/));
  it("rejects out-of-range and non-integer values", () => {
    expect(validateRules({ ...ok, present_min_percent: 0 })).not.toBeNull();
    expect(validateRules({ ...ok, present_min_percent: 101 })).not.toBeNull();
    expect(validateRules({ ...ok, late_grace_minutes: -1 })).not.toBeNull();
    expect(validateRules({ ...ok, heartbeat_timeout_seconds: 30 })).not.toBeNull();
    expect(validateRules({ ...ok, background_grace_minutes: 241 })).not.toBeNull();
    expect(validateRules({ ...ok, present_min_percent: NaN })).not.toBeNull();
    expect(validateRules({ ...ok, present_min_percent: 74.5 })).not.toBeNull();
  });
});

describe("isMissingRpc", () => {
  it("recognises a function that is not deployed yet", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.live_attendance_join" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "x" })).toBe(true);
  });
  it("does not mistake a real error for a missing function", () => {
    expect(isMissingRpc({ code: "42501", message: "Not authorised" })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
  });
});

describe("CSV export", () => {
  const row: ClassReportRow = {
    student_id: "1", full_name: 'Asha "AK", Rao', roll_number: "7", sessions_held: 10, present: 6, partial: 2,
    absent: 1, excused: 1, late: 3, total_seconds: 7200, attended_percent: 88.9,
  };
  it("escapes quotes and commas and converts seconds to minutes", () => {
    const csv = classReportCsv([row]).split("\r\n");
    expect(csv[0]).toContain("Attended %");
    expect(csv[1]).toBe('7,"Asha ""AK"", Rao",10,6,2,1,1,3,120,88.9');
  });
  it("exports sessions", () => {
    const s: SessionReportRow = {
      session_id: "s", session_date: "2026-11-12", subject: "Maths", title: null, window_start: "2026-11-12T04:00:00Z",
      window_end: "2026-11-12T05:00:00Z", roster_size: 30, present: 20, partial: 5, absent: 4, excused: 1, late: 2,
    };
    const lines = sessionReportCsv([s]).split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("2026-11-12,Maths,,")).toBe(true);
    expect(lines[1].endsWith(",30,20,5,4,1,2")).toBe(true);
  });
});

describe("presenceState (never claims 'in class' for a student APAS has stopped hearing from)", () => {
  it("is in_class only for an open stay seen recently", () => {
    expect(presenceState({ in_class: true, seen_recently: true, join_count: 1 })).toBe("in_class");
  });
  it("is away for an open stay that has gone quiet", () => {
    expect(presenceState({ in_class: true, seen_recently: false, join_count: 1 })).toBe("away");
  });
  it("is left once every stay is closed, and none when nothing was tracked", () => {
    expect(presenceState({ in_class: false, seen_recently: false, join_count: 2 })).toBe("left");
    expect(presenceState({ in_class: false, seen_recently: false, join_count: 0 })).toBe("none");
  });
});
