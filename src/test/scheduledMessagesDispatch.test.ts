import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildDispatchBody, dispatchFailure, isAuthorizedCron, runPool, safeEqual, type DispatchClaim,
} from "../../supabase/functions/_shared/scheduledMessagesDispatch";

const claim = (o: Partial<DispatchClaim> = {}): DispatchClaim => ({
  scheduled_message_id: "sm1", message_id: "row1", recipient_id: "r1", sender_id: "s1",
  audience_label: null, message: "Exam on Monday", attachment_name: null, recipient_count: 1, ...o,
});

describe("push/email payload (same wording as a live send)", () => {
  it("direct message", () => {
    expect(buildDispatchBody(claim(), "Tina Teacher")).toEqual({
      source_table: "teacher_messages", source_id: "row1", recipient_id: "r1",
      title: "New message from Tina Teacher", body: "Exam on Monday",
    });
  });
  it("broadcast names the audience", () => {
    const b = buildDispatchBody(claim({ recipient_count: 30, audience_label: "Class 5 - A" }), "Tina Teacher");
    expect(b.title).toBe("Tina Teacher sent a message to Class 5 - A");
    expect(buildDispatchBody(claim({ recipient_count: 30, audience_label: null }), "Tina").title).toBe("Tina sent a message");
  });
  it("attachment-only and empty bodies", () => {
    expect(buildDispatchBody(claim({ message: "", attachment_name: "plan.pdf" }), "T").body).toBe("📎 plan.pdf");
    expect(buildDispatchBody(claim({ message: "  ", attachment_name: null }), "T").body).toBe("New message");
  });
  it("falls back when the sender has no name, and truncates long text", () => {
    expect(buildDispatchBody(claim(), "").title).toBe("New message from Your school");
    expect(buildDispatchBody(claim(), null).title).toBe("New message from Your school");
    const long = buildDispatchBody(claim({ message: "x".repeat(2000) }), "T").body;
    expect(long.length).toBe(500);
    expect(long.endsWith("…")).toBe(true);
  });
  it("source_id is the teacher_messages row, so the channel log links to the message", () => {
    expect(buildDispatchBody(claim({ message_id: "abc" }), "T").source_id).toBe("abc");
  });
});

describe("cron authorization", () => {
  it("requires a configured secret and an exact match", () => {
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCron("s3cret", "s3creT")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret ")).toBe(false);
    expect(isAuthorizedCron("s3cret", "")).toBe(false);
    expect(isAuthorizedCron("s3cret", null)).toBe(false);
    expect(isAuthorizedCron(undefined, "anything")).toBe(false);   // secret not configured: nobody gets in
    expect(isAuthorizedCron("", "")).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});

describe("runPool", () => {
  it("processes every item exactly once with bounded concurrency", async () => {
    let inFlight = 0, peak = 0;
    const seen: number[] = [];
    const r = await runPool([...Array(40).keys()], 5, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((res) => setTimeout(res, 2));
      seen.push(n); inFlight--;
    });
    expect(r.ok).toBe(40);
    expect(r.errors).toHaveLength(0);
    expect([...seen].sort((a, b) => a - b)).toEqual([...Array(40).keys()]);
    expect(peak).toBeLessThanOrEqual(5);
  });
  it("a failing item never abandons the rest of the batch", async () => {
    const r = await runPool([1, 2, 3, 4, 5], 2, async (n) => { if (n === 3) throw new Error("boom"); });
    expect(r.ok).toBe(4);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].item).toBe(3);
  });
  it("handles an empty batch", async () => {
    expect(await runPool([], 4, async () => {})).toEqual({ ok: 0, errors: [] });
  });
});

describe("dispatch-message reply interpretation", () => {
  it("flags transport errors and {success:false}, passes success", () => {
    expect(dispatchFailure({ message: "502" }, null)).toBe("502");
    expect(dispatchFailure(null, { success: false, message: "bad" })).toBe("bad");
    expect(dispatchFailure(null, { success: false })).toMatch(/failure/);
    expect(dispatchFailure(null, { success: true })).toBeNull();
    expect(dispatchFailure(null, null)).toBeNull();
  });
});

// The cron handler must stay wired in through the existing anchor (no new edge function) and keep its secret check.
describe("wiring", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
  it("is routed through calibrate-irt-cron under job 'scheduled_messages'", () => {
    const anchor = read("supabase/functions/calibrate-irt-cron/index.ts");
    expect(anchor).toMatch(/scheduled_messages:\s*\{\s*handler:\s*handleScheduledMessagesCron\s*\}/);
    expect(fs.existsSync(path.resolve(process.cwd(), "supabase/functions/process-scheduled-messages"))).toBe(false);
  });
  it("handler checks the cron secret before touching the database, and never retries a claimed dispatch", () => {
    const h = read("supabase/functions/_shared/handlers/scheduledMessagesCron.ts");
    expect(h.indexOf("isAuthorizedCron")).toBeLessThan(h.indexOf("createClient("));
    expect(h).toMatch(/claim_scheduled_dispatches/);
    expect(h).toMatch(/record_scheduled_dispatch_error/);
  });
  it("migration schedules the worker the same way the existing cron jobs do", () => {
    const sql = read("supabase/migrations/20261111000000_scheduled_messages.sql");
    expect(sql).toMatch(/x-cron-secret/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/teacher_messages_scheduled_once_idx/);
  });
});
