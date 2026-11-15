import { describe, expect, it, vi } from "vitest";

// pure helpers only: the network layer is mocked out
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useExamIntelligence", () => ({ invokeFn: vi.fn() }));

import {
  daysUntilExpiry, formatBytes, formatRecordingDuration, groupBySubject, matchesSearch, usagePercent, validateUploadFile,
  type Recording,
} from "@/lib/liveRecordings";

const rec = (o: Partial<Recording>): Recording => ({
  id: "1", session_id: "s", session_date: "2026-11-10", class_id: "c", class_label: "5 A", subject: "Maths", title: "Fractions",
  notes: null, source: "auto", status: "ready", storage_kind: "supabase", size_bytes: 1, duration_seconds: 2700, started_at: null,
  ended_at: null, visibility: "class", pinned: false, course_id: null, course_title: null, lesson_id: null, lesson_title: null,
  retention_expires_at: null, created_at: "2026-11-10T05:00:00Z", last_error: null, can_manage: false, can_delete: false, playable: true, ...o,
});

describe("formatting", () => {
  it("formats durations and sizes", () => {
    expect(formatRecordingDuration(null)).toBe("");
    expect(formatRecordingDuration(40)).toBe("1 min");
    expect(formatRecordingDuration(2700)).toBe("45 min");
    expect(formatRecordingDuration(3900)).toBe("1 h 05 min");
    expect(formatBytes(1024 ** 2 * 300)).toBe("300 MB");
  });
  it("computes usage percent safely", () => {
    expect(usagePercent(25, 100)).toBe(25);
    expect(usagePercent(500, 100)).toBe(100);
    expect(usagePercent(5, 0)).toBe(0);
  });
});

describe("daysUntilExpiry", () => {
  const now = Date.parse("2026-11-14T00:00:00Z");
  it("counts whole days", () => expect(daysUntilExpiry({ retention_expires_at: "2026-11-24T00:00:00Z", pinned: false }, now)).toBe(10));
  it("is null when pinned or unlimited", () => {
    expect(daysUntilExpiry({ retention_expires_at: "2026-11-24T00:00:00Z", pinned: true }, now)).toBeNull();
    expect(daysUntilExpiry({ retention_expires_at: null, pinned: false }, now)).toBeNull();
  });
  it("never goes negative", () => expect(daysUntilExpiry({ retention_expires_at: "2026-11-01T00:00:00Z", pinned: false }, now)).toBe(0));
});

describe("grouping and search", () => {
  const list = [
    rec({ id: "a", subject: "Science", session_date: "2026-11-01" }),
    rec({ id: "b", subject: "Maths", session_date: "2026-11-05" }),
    rec({ id: "c", subject: "Maths", session_date: "2026-11-09" }),
    rec({ id: "d", subject: null, session_date: "2026-11-02" }),
  ];
  it("groups by subject alphabetically with Other last and newest first", () => {
    const g = groupBySubject(list);
    expect(g.map((x) => x.subject)).toEqual(["Maths", "Science", "Other"]);
    expect(g[0].items.map((x) => x.id)).toEqual(["c", "b"]);
  });
  it("searches across title, subject, course and lesson", () => {
    expect(matchesSearch(rec({ title: "Photosynthesis" }), "photo")).toBe(true);
    expect(matchesSearch(rec({ lesson_title: "Algebra basics" }), "ALGEBRA")).toBe(true);
    expect(matchesSearch(rec({ course_title: "Grade 5 Maths" }), "grade 5")).toBe(true);
    expect(matchesSearch(rec({}), "zzz")).toBe(false);
    expect(matchesSearch(rec({}), "  ")).toBe(true);
  });
});

describe("validateUploadFile", () => {
  it("accepts video within the limit", () => expect(validateUploadFile({ type: "video/mp4", size: 100 * 1024 * 1024 }, 1024)).toBeNull());
  it("rejects other types, empty files and oversize files", () => {
    expect(validateUploadFile({ type: "application/pdf", size: 10 }, 1024)).toMatch(/MP4/);
    expect(validateUploadFile({ type: "video/mp4", size: 0 }, 1024)).toMatch(/empty/);
    expect(validateUploadFile({ type: "video/mp4", size: 2 * 1024 * 1024 * 1024 }, 1024)).toMatch(/1024 MB/);
  });
});
