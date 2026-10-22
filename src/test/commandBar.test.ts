import { describe, expect, it } from "vitest";
import {
  isSafeRoute, localDate, markReadConfirmView, markReadDoneView, notificationsView, toView, type BellNotification,
} from "@/lib/commandBar";

const n = (id: string, is_read: boolean, title = "T" + id): BellNotification => ({ id, title, is_read, created_at: "2026-10-20T10:00:00Z" });

describe("isSafeRoute (only in-app paths)", () => {
  it("accepts normal app routes", () => {
    for (const r of ["/attendance", "/admin?tab=students", "/exam/abc-123", "/adaptive-homework/generate"]) expect(isSafeRoute(r)).toBe(true);
  });
  it("rejects external, protocol-relative, script and malformed targets", () => {
    for (const r of ["https://evil.com", "//evil.com", "javascript:alert(1)", "/javascript:alert(1)", "evil", "", "/a\\b", "/a\nb", null, undefined, 5, "/" + "x".repeat(300)]) {
      expect(isSafeRoute(r as unknown)).toBe(false);
    }
  });
});

describe("toView", () => {
  it("keeps the status as the view kind", () => {
    expect(toView({ status: "answer", message: "m" }).kind).toBe("answer");
    expect(toView({ status: "preview", message: "m" }).kind).toBe("preview");
    expect(toView({ status: "error", message: "m" }).kind).toBe("error");
  });
  it("never renders navigate/client as their own kind", () => {
    expect(toView({ status: "navigate", message: "m", route: "/x" }).kind).toBe("answer");
    expect(toView({ status: "client", message: "" }).kind).toBe("answer");
  });
});

describe("notification commands", () => {
  it("answers from the unread list only", () => {
    const v = notificationsView([n("1", false), n("2", true), n("3", false)]);
    expect(v.message).toBe("You have 2 unread notifications.");
    expect(v.rows?.map((r) => r.title)).toEqual(["T1", "T3"]);
  });
  it("handles none, one, and many (capped at 5 rows)", () => {
    expect(notificationsView([]).message).toBe("You have no unread notifications.");
    expect(notificationsView([n("1", false)]).message).toBe("You have 1 unread notification.");
    expect(notificationsView(Array.from({ length: 9 }, (_, i) => n(String(i), false))).rows).toHaveLength(5);
  });
  it("mark-as-read needs confirmation, shows the exact target and count, and does nothing when there is nothing to do", () => {
    const v = markReadConfirmView([n("1", false), n("2", false), n("3", true)]);
    expect(v.kind).toBe("confirm");
    expect(v.confirmIntent).toBe("action.mark_notifications_read");
    expect(v.preview?.lines).toEqual([{ label: "Target", value: "Your own notifications only" }, { label: "Unread now", value: "2" }]);
    expect(v.preview?.consequences.length > 0).toBe(true);
    expect(markReadConfirmView([n("1", true)]).kind).toBe("answer");
    expect(markReadConfirmView([]).kind).toBe("answer");
  });
  it("done view reports the count", () => {
    expect(markReadDoneView(1)).toEqual({ kind: "done", message: "Marked 1 notification as read." });
    expect(markReadDoneView(3).message).toBe("Marked 3 notifications as read.");
  });
});

describe("localDate", () => {
  it("formats the LOCAL calendar date", () => {
    expect(localDate(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});
