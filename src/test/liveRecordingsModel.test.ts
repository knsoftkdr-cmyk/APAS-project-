import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, MAX_COPY_ATTEMPTS, TUS_CHUNK, backoffMs, buildStoragePath, chunkPlan, cleanSettings, effectiveRecordEnabled,
  endedOccurrences, extensionFor, formatBytes, mapProviderState, meetConferenceFilter, occurrenceWindow, parseConferenceRecords,
  parseMeetingCode, parseRecordings, quotaAllows, recordingAccess, resolveOccurrenceDate, retentionExpiry, safeFileName, validateLinkUrl,
  type AccessRow,
} from "../../supabase/functions/_shared/liveRecordingsModel";

describe("parseMeetingCode", () => {
  it("extracts the code from Meet links", () => {
    expect(parseMeetingCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
    expect(parseMeetingCode("https://meet.google.com/ABC-DEFG-HIJ?authuser=1")).toBe("abc-defg-hij");
    expect(parseMeetingCode("  http://meet.google.com/abc-defg-hij/ ")).toBe("abc-defg-hij");
  });
  it("rejects anything that is not a plain Meet code link", () => {
    expect(parseMeetingCode("https://meet.google.com/lookup/abcd1234")).toBeNull();
    expect(parseMeetingCode("https://zoom.us/j/123456789")).toBeNull();
    expect(parseMeetingCode("https://evil.example/meet.google.com/abc-defg-hij")).toBeNull();
    expect(parseMeetingCode("")).toBeNull();
    expect(parseMeetingCode(null)).toBeNull();
  });
});

describe("effectiveRecordEnabled", () => {
  const on = { enabled: true, auto_record: true };
  it("is off whenever the school master switch is off", () => {
    expect(effectiveRecordEnabled(true, { enabled: false, auto_record: true })).toBe(false);
  });
  it("follows the school default unless the session decides", () => {
    expect(effectiveRecordEnabled(null, on)).toBe(true);
    expect(effectiveRecordEnabled(undefined, { enabled: true, auto_record: false })).toBe(false);
    expect(effectiveRecordEnabled(false, on)).toBe(false);
    expect(effectiveRecordEnabled(true, { enabled: true, auto_record: false })).toBe(true);
  });
});

describe("occurrences", () => {
  const s = { start: "2026-11-09T04:00:00.000Z", end: "2026-11-09T04:45:00.000Z", recurrenceEnd: "2026-11-20" };
  it("keeps the stored time of day and length on any date", () => {
    const w = occurrenceWindow(s.start, s.end, "2026-11-12");
    expect(new Date(w.start).toISOString()).toBe("2026-11-12T04:00:00.000Z");
    expect(w.end - w.start).toBe(45 * 60_000);
  });
  it("assigns a timestamp to the nearest in-range day", () => {
    expect(resolveOccurrenceDate(s, Date.parse("2026-11-12T04:10:00Z"))).toBe("2026-11-12");
    expect(resolveOccurrenceDate(s, Date.parse("2026-11-12T06:00:00Z"))).toBe("2026-11-12");   // an hour after class, same day
  });
  it("clamps into the schedule", () => {
    expect(resolveOccurrenceDate(s, Date.parse("2026-12-30T04:00:00Z"))).toBe("2026-11-20");
    expect(resolveOccurrenceDate(s, Date.parse("2026-11-01T04:00:00Z"))).toBe("2026-11-09");
  });
  it("lists occurrences that ended inside a window", () => {
    const days = endedOccurrences(s, Date.parse("2026-11-10T00:00:00Z"), Date.parse("2026-11-12T12:00:00Z"));
    expect(days).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  });
  it("a one-off session has exactly one occurrence", () => {
    const once = { ...s, recurrenceEnd: null };
    expect(endedOccurrences(once, 0, Date.parse("2027-01-01T00:00:00Z"))).toEqual(["2026-11-09"]);
  });
});

describe("retention, quota, retries", () => {
  it("computes expiry, and never for 0 days", () => {
    expect(retentionExpiry("2026-11-01T00:00:00.000Z", 30)).toBe("2026-12-01T00:00:00.000Z");
    expect(retentionExpiry("2026-11-01T00:00:00.000Z", 0)).toBeNull();
  });
  it("checks the quota including the new file", () => {
    const gb = 1024 ** 3;
    expect(quotaAllows(49 * gb, 1 * gb, 50)).toBe(true);
    expect(quotaAllows(49 * gb, 1 * gb + 1, 50)).toBe(false);
  });
  it("backs off then settles at an hour", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(backoffMs)).toEqual([60_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000, 3_600_000]);
    expect(MAX_COPY_ATTEMPTS).toBeGreaterThan(3);
  });
  it("plans inclusive byte ranges in 6 MiB chunks and resumes from an offset", () => {
    const total = TUS_CHUNK * 2 + 100;
    const all = chunkPlan(0, total, TUS_CHUNK, 99);
    expect(all).toHaveLength(3);
    expect(all[0]).toEqual({ start: 0, end: TUS_CHUNK - 1 });
    expect(all[2]).toEqual({ start: TUS_CHUNK * 2, end: total - 1 });
    expect(chunkPlan(TUS_CHUNK, total, TUS_CHUNK, 1)).toEqual([{ start: TUS_CHUNK, end: TUS_CHUNK * 2 - 1 }]);
    expect(chunkPlan(total, total, TUS_CHUNK, 5)).toEqual([]);
  });
});

describe("provider state mapping", () => {
  it("maps Meet recording states", () => {
    expect(mapProviderState("STARTED", "supabase_copy")).toEqual({ status: "recording", kind: "none" });
    expect(mapProviderState("ENDED", "supabase_copy")).toEqual({ status: "processing", kind: "none" });
    expect(mapProviderState("FILE_GENERATED", "supabase_copy")).toEqual({ status: "copying", kind: "none" });
    expect(mapProviderState("FILE_GENERATED", "drive_link")).toEqual({ status: "ready", kind: "drive" });
    expect(mapProviderState("STATE_UNSPECIFIED", "drive_link").status).toBe("processing");
  });
});

describe("storage naming (one object per recording, no traversal)", () => {
  it("builds a path from ids only", () => {
    expect(buildStoragePath("sch", "cls", "rec", "mp4")).toBe("sch/cls/rec.mp4");
  });
  it("sanitises file names and extensions", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("My Class (final).mp4")).toBe("My_Class__final_.mp4");
    expect(extensionFor("video/webm")).toBe("webm");
    expect(extensionFor("application/octet-stream", "x.exe")).toBe("mp4");
    expect(extensionFor(null, "lesson.MOV")).toBe("mov");
  });
});

describe("validateLinkUrl", () => {
  it("accepts https only", () => {
    expect(validateLinkUrl("https://drive.google.com/file/d/abc/view")).toMatchObject({ ok: true, kind: "drive" });
    expect(validateLinkUrl("https://example.com/v")).toMatchObject({ ok: true, kind: "other" });
    expect(validateLinkUrl("http://example.com/v")).toMatchObject({ ok: false });
    expect(validateLinkUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(validateLinkUrl("")).toMatchObject({ ok: false });
    expect(validateLinkUrl(42)).toMatchObject({ ok: false });
  });
});

describe("recordingAccess", () => {
  const ready: AccessRow = { status: "ready", visibility: "class", deleted_at: null, retention_expires_at: null };
  const perms = { student_access: true, teachers_can_manage: true, teachers_can_delete: false };
  it("lets a student watch a finished, class-visible recording only", () => {
    expect(recordingAccess("student", ready, perms)).toEqual({ view: true, manage: false, remove: false });
    expect(recordingAccess("student", { ...ready, status: "processing" }, perms).view).toBe(false);
    expect(recordingAccess("student", { ...ready, status: "copying" }, perms).view).toBe(false);
    expect(recordingAccess("student", { ...ready, visibility: "teachers" }, perms).view).toBe(false);
  });
  it("hides expired recordings from students even before cleanup runs", () => {
    const row = { ...ready, retention_expires_at: "2026-01-01T00:00:00Z" };
    expect(recordingAccess("student", row, perms, Date.parse("2026-02-01T00:00:00Z")).view).toBe(false);
    expect(recordingAccess("student", row, perms, Date.parse("2025-12-01T00:00:00Z")).view).toBe(true);
  });
  it("honours the school's student switch", () => {
    expect(recordingAccess("student", ready, { ...perms, student_access: false }).view).toBe(false);
  });
  it("gives teachers only the permissions the school granted", () => {
    expect(recordingAccess("teacher", { ...ready, visibility: "teachers" }, perms)).toEqual({ view: true, manage: true, remove: false });
    expect(recordingAccess("teacher", ready, { ...perms, teachers_can_manage: false, teachers_can_delete: true })).toEqual({ view: true, manage: false, remove: true });
  });
  it("gives staff everything and strangers nothing", () => {
    expect(recordingAccess("staff", ready, perms)).toEqual({ view: true, manage: true, remove: true });
    expect(recordingAccess(null, ready, perms)).toEqual({ view: false, manage: false, remove: false });
  });
  it("nobody sees a deleted recording", () => {
    const gone = { ...ready, deleted_at: "2026-11-01T00:00:00Z" };
    for (const m of ["student", "teacher", "staff"] as const) expect(recordingAccess(m, gone, perms).view).toBe(false);
    expect(recordingAccess("staff", { ...ready, status: "deleted" }, perms).view).toBe(false);
  });
});

describe("Google response parsing", () => {
  it("reads recordings with their Drive file", () => {
    const out = parseRecordings({ recordings: [
      { name: "conferenceRecords/c1/recordings/r1", state: "FILE_GENERATED", startTime: "2026-11-12T04:00:00Z", endTime: "2026-11-12T04:45:00Z",
        driveDestination: { file: "FILEID", exportUri: "https://drive.google.com/file/d/FILEID/view" } },
      { name: "conferenceRecords/c1/recordings/r2", state: "STARTED" },
      { nope: true },
    ] });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fileId: "FILEID", state: "FILE_GENERATED" });
    expect(out[1]).toMatchObject({ fileId: null, exportUri: null, state: "STARTED" });
  });
  it("tolerates empty or malformed bodies", () => {
    expect(parseRecordings({})).toEqual([]);
    expect(parseRecordings(null)).toEqual([]);
    expect(parseConferenceRecords({ conferenceRecords: [{ name: "conferenceRecords/c1", startTime: "t" }, {}] })).toHaveLength(1);
  });
  it("builds the conference filter Google documents", () => {
    expect(meetConferenceFilter("abc-defg-hij", "2026-11-08T00:00:00Z")).toBe('space.meeting_code = "abc-defg-hij" AND start_time>="2026-11-08T00:00:00Z"');
  });
});

describe("cleanSettings", () => {
  it("keeps current values for anything not sent", () => {
    const r = cleanSettings({ enabled: true }, DEFAULT_SETTINGS);
    expect(r.ok && r.value.enabled).toBe(true);
    expect(r.ok && r.value.retention_days).toBe(DEFAULT_SETTINGS.retention_days);
  });
  it("rejects out-of-range values and unknown modes", () => {
    expect(cleanSettings({ retention_days: -1 }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanSettings({ retention_days: 3651 }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanSettings({ retention_days: 1.5 }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanSettings({ storage_quota_gb: 0 }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanSettings({ max_upload_mb: 9 }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanSettings({ storage_mode: "s3" }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanSettings({ retention_days: 0 }, DEFAULT_SETTINGS).ok).toBe(true);
  });
  it("ignores non-boolean junk for switches", () => {
    const r = cleanSettings({ student_access: "yes" }, DEFAULT_SETTINGS);
    expect(r.ok && r.value.student_access).toBe(DEFAULT_SETTINGS.student_access);
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});
