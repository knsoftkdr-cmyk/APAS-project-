import { describe, expect, it } from "vitest";
import {
  audienceLabelFor, canCancel, canEdit, canScheduleMessages, countByStatus, deliveryReportKey, filterByStatus,
  friendlyError, fromLocalInputValue, isDueSoon, isMissingBackend, normalizeRecipients, normalizeStatus,
  recipientSummary, schedulePresets, sortForDisplay, timeUntil, toLocalInputValue, validateSchedule,
  type ScheduledMessage,
} from "@/lib/scheduledMessagesModel";

const NOW = new Date(2026, 10, 12, 10, 0, 0); // 12 Nov 2026 10:00 local (a Thursday)
const local = (d: Date) => toLocalInputValue(d);
const plus = (min: number) => new Date(NOW.getTime() + min * 60_000);

const msg = (o: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  id: "m1", school_id: "s", sender_id: "u1", sender_role: "teacher", message: "hi", message_type: "general",
  attachment_url: null, attachment_name: null, audience_label: null, scheduled_for: plus(60).toISOString(),
  status: "scheduled", batch_id: "b1", recipient_count: 1, attempts: 0, last_error: null, sent_at: null,
  cancelled_at: null, cancelled_by: null, created_at: "", updated_at: "", ...o,
});

describe("who can schedule", () => {
  it("only roles that have a composer", () => {
    for (const r of ["teacher", "admin", "principal", "hod", "school_admin"]) expect(canScheduleMessages(r)).toBe(true);
    for (const r of ["parent", "student", "driver", "knsoft_admin", "", null, undefined]) expect(canScheduleMessages(r as any)).toBe(false);
  });
});

describe("edit / cancel rules", () => {
  it("only the sender edits, only while scheduled", () => {
    expect(canEdit(msg(), "u1")).toBe(true);
    expect(canEdit(msg(), "u2")).toBe(false);
    expect(canEdit(msg(), undefined)).toBe(false);
    for (const status of ["sent", "cancelled", "failed"] as const) expect(canEdit(msg({ status }), "u1")).toBe(false);
  });
  it("sender or school admins cancel, only while scheduled; hod and teachers cannot cancel others'", () => {
    expect(canCancel(msg(), "u1", "teacher")).toBe(true);
    expect(canCancel(msg(), "u9", "admin")).toBe(true);
    expect(canCancel(msg(), "u9", "principal")).toBe(true);
    expect(canCancel(msg(), "u9", "school_admin")).toBe(true);
    expect(canCancel(msg(), "u9", "hod")).toBe(false);
    expect(canCancel(msg(), "u9", "teacher")).toBe(false);
    for (const status of ["sent", "cancelled", "failed"] as const) expect(canCancel(msg({ status }), "u1", "admin")).toBe(false);
  });
});

describe("status helpers", () => {
  it("unknown status is treated as scheduled", () => {
    expect(normalizeStatus("garbage")).toBe("scheduled");
    expect(normalizeStatus("sent")).toBe("sent");
  });
  it("counts, filters and sorts", () => {
    const list = [
      msg({ id: "a", status: "scheduled", scheduled_for: plus(300).toISOString() }),
      msg({ id: "b", status: "scheduled", scheduled_for: plus(60).toISOString() }),
      msg({ id: "c", status: "sent", scheduled_for: plus(-60).toISOString() }),
      msg({ id: "d", status: "sent", scheduled_for: plus(-600).toISOString() }),
      msg({ id: "e", status: "cancelled" }),
    ];
    expect(countByStatus(list)).toEqual({ scheduled: 2, sent: 2, cancelled: 1, failed: 0 });
    expect(filterByStatus(list, "sent").map((m) => m.id)).toEqual(["c", "d"]);
    expect(sortForDisplay(filterByStatus(list, "scheduled"), "scheduled").map((m) => m.id)).toEqual(["b", "a"]); // soonest first
    expect(sortForDisplay(filterByStatus(list, "sent"), "sent").map((m) => m.id)).toEqual(["c", "d"]);          // newest first
  });
  it("a due-but-undelivered message is flagged as sending", () => {
    expect(isDueSoon(msg({ scheduled_for: plus(-1).toISOString() }), NOW)).toBe(true);
    expect(isDueSoon(msg({ scheduled_for: plus(1).toISOString() }), NOW)).toBe(false);
    expect(isDueSoon(msg({ status: "sent", scheduled_for: plus(-1).toISOString() }), NOW)).toBe(false);
  });
  it("delivery report key matches the existing report: batch for broadcasts, row id for one recipient", () => {
    expect(deliveryReportKey(msg({ status: "sent", recipient_count: 5, batch_id: "B" }), null)).toBe("B");
    expect(deliveryReportKey(msg({ status: "sent", recipient_count: 1 }), "row-1")).toBe("row-1");
    expect(deliveryReportKey(msg({ status: "sent", recipient_count: 1 }), null)).toBeNull();
    expect(deliveryReportKey(msg({ status: "scheduled", recipient_count: 5 }), null)).toBeNull();
  });
});

describe("local date/time handling", () => {
  it("round-trips a datetime-local value", () => {
    expect(toLocalInputValue(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05T09:07");
    const d = fromLocalInputValue("2026-01-05T09:07")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 0, 5, 9, 7]);
  });
  it("rejects empty, malformed and impossible dates", () => {
    for (const v of ["", null, undefined, "tomorrow", "2026-13-01T10:00", "2026-02-31T10:00", "2026-01-05 09:07", "2026-01-05T25:00"]) {
      expect(fromLocalInputValue(v as any)).toBeNull();
    }
  });
  it("presets are always in the future, and Monday is the NEXT Monday", () => {
    for (const now of [NOW, new Date(2026, 10, 16, 9, 0), new Date(2026, 10, 16, 23, 59), new Date(2026, 11, 31, 23, 30)]) {
      const p = schedulePresets(now);
      for (const x of p) expect(x.at.getTime()).toBeGreaterThan(now.getTime());
      const monday = p.find((x) => x.id === "monday-8")!.at;
      expect(monday.getDay()).toBe(1);
      expect(monday.getHours()).toBe(8);
    }
    // On a Monday the preset is a week later, not today
    const mon = schedulePresets(new Date(2026, 10, 16, 7, 0)).find((x) => x.id === "monday-8")!.at;
    expect(mon.getDate()).toBe(23);
  });
  it("timeUntil", () => {
    expect(timeUntil(plus(-5), NOW)).toBe("due now");
    expect(timeUntil(plus(45), NOW)).toBe("in 45 min");
    expect(timeUntil(plus(135), NOW)).toBe("in 2h 15m");
    expect(timeUntil(plus(120), NOW)).toBe("in 2h");
    expect(timeUntil(plus(3 * 24 * 60), NOW)).toBe("in 3 days");
    expect(timeUntil(plus(24 * 60), NOW)).toBe("in 1 day");
  });
});

describe("validateSchedule", () => {
  const ok = { text: "Hello", hasAttachment: false, localValue: local(plus(120)), recipientCount: 3 };
  it("accepts a good draft and returns the parsed time", () => {
    const v = validateSchedule(ok, NOW);
    expect(v.ok).toBe(true);
    expect(v.when!.getTime()).toBe(fromLocalInputValue(ok.localValue)!.getTime());
  });
  it("needs a message or an attachment", () => {
    expect(validateSchedule({ ...ok, text: "   " }, NOW).errors.message).toBeTruthy();
    expect(validateSchedule({ ...ok, text: "", hasAttachment: true }, NOW).ok).toBe(true);
    expect(validateSchedule({ ...ok, text: "x".repeat(4001) }, NOW).errors.message).toMatch(/too long/);
    expect(validateSchedule({ ...ok, text: "x".repeat(4000) }, NOW).ok).toBe(true);
  });
  it("time must be at least a minute ahead and within a year", () => {
    expect(validateSchedule({ ...ok, localValue: "" }, NOW).errors.when).toMatch(/Choose a date/);
    expect(validateSchedule({ ...ok, localValue: "nope" }, NOW).errors.when).toMatch(/not valid/);
    expect(validateSchedule({ ...ok, localValue: local(plus(-30)) }, NOW).errors.when).toBeTruthy();
    expect(validateSchedule({ ...ok, localValue: local(plus(0)) }, NOW).errors.when).toBeTruthy();
    expect(validateSchedule({ ...ok, localValue: local(plus(2)) }, NOW).ok).toBe(true);
    expect(validateSchedule({ ...ok, localValue: local(plus(400 * 24 * 60)) }, NOW).errors.when).toMatch(/one year/);
    expect(validateSchedule({ ...ok, localValue: "" }, NOW).when).toBeNull();
  });
  it("needs recipients, capped at 5000", () => {
    expect(validateSchedule({ ...ok, recipientCount: 0 }, NOW).errors.recipients).toBeTruthy();
    expect(validateSchedule({ ...ok, recipientCount: 5000 }, NOW).ok).toBe(true);
    expect(validateSchedule({ ...ok, recipientCount: 5001 }, NOW).errors.recipients).toBeTruthy();
  });
  it("reports every problem at once", () => {
    const v = validateSchedule({ text: "", hasAttachment: false, localValue: "", recipientCount: 0 }, NOW);
    expect(Object.keys(v.errors).sort()).toEqual(["message", "recipients", "when"]);
  });
});

describe("recipients and labels", () => {
  it("normalizeRecipients de-duplicates and drops junk, keeping the first role", () => {
    expect(normalizeRecipients([
      { id: "a", role: "student" }, { id: "a", role: "parent" }, { id: "", role: "x" }, { id: "b", role: "" }, { id: "c", role: "teacher" },
    ])).toEqual([{ id: "a", role: "student" }, { id: "c", role: "teacher" }]);
  });
  it("audience label only for groups", () => {
    expect(audienceLabelFor({ kind: "group", name: "All Parents" })).toBe("All Parents");
    expect(audienceLabelFor({ kind: "individual", name: "Sam" })).toBeNull();
  });
  it("recipient summary", () => {
    expect(recipientSummary({ audience_label: "All Parents", recipient_count: 12 })).toBe("All Parents · 12 recipients");
    expect(recipientSummary({ audience_label: "Class 5 - A", recipient_count: 1 })).toBe("Class 5 - A · 1 recipient");
    expect(recipientSummary({ audience_label: null, recipient_count: 1 }, "Sam")).toBe("Sam");
    expect(recipientSummary({ audience_label: null, recipient_count: 4 })).toBe("4 recipients");
  });
});

describe("error mapping", () => {
  it("detects a missing backend (migration not applied)", () => {
    expect(isMissingBackend({ code: "PGRST202" })).toBe(true);
    expect(isMissingBackend({ code: "42P01" })).toBe(true);
    expect(isMissingBackend({ message: "Could not find the function public.schedule_message" })).toBe(true);
    expect(isMissingBackend({ code: "42501", message: "nope" })).toBe(false);
    expect(isMissingBackend(null)).toBe(false);
  });
  it("friendlyError keeps the server's human sentences and maps the rest", () => {
    expect(friendlyError({ message: "Choose a date and time in the future" })).toBe("Choose a date and time in the future");
    expect(friendlyError({ code: "42501", message: "permission denied for table x" })).toMatch(/permission/);
    expect(friendlyError({ code: "PGRST202" })).toMatch(/not set up/);
    expect(friendlyError(null)).toBeTruthy();
  });
});
