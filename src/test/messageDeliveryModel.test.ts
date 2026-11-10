import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  chunkIds, countFor, deriveStatus, filterRows, normalizeStatus, overallStatus, percent, reportKey,
  searchRows, sortRecipients, statusOfMessage, summarize, summaryFromRpc, uniqueRecipients,
  type DeliveryRow, type DeliveryStatus,
} from "@/lib/messageDeliveryModel";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

const row = (id: string, status: DeliveryStatus): DeliveryRow => ({
  message_id: `m-${id}`, recipient_id: id, recipient_role: "student", delivery_status: status,
  sent_at: null, delivered_at: null, read_at: null, created_at: null,
});

describe("status rules", () => {
  it("read beats delivered beats pending, and inserting alone is never delivered", () => {
    expect(deriveStatus({ is_read: false, delivered_at: null })).toBe("pending");
    expect(deriveStatus({ is_read: false, delivered_at: "2026-11-05T10:00:00Z" })).toBe("delivered");
    expect(deriveStatus({ is_read: true, delivered_at: null })).toBe("read"); // legacy history
    expect(deriveStatus({ is_read: true, delivered_at: "2026-11-05T10:00:00Z" })).toBe("read");
  });
  it("anything unexpected is pending, never delivered or read", () => {
    expect(normalizeStatus("garbage")).toBe("pending");
    expect(normalizeStatus(undefined)).toBe("pending");
    expect(normalizeStatus(null)).toBe("pending");
  });
  it("prefers the server column but falls back to is_read before the migration is applied", () => {
    expect(statusOfMessage({ delivery_status: "delivered", is_read: false })).toBe("delivered");
    expect(statusOfMessage({ is_read: true })).toBe("read");
    expect(statusOfMessage({ is_read: false })).toBe("pending");
  });
});

describe("broadcast reports", () => {
  // 100 recipients: 40 never received it (offline), 35 received but not opened, 25 opened
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => row(`p${i}`, "pending")),
    ...Array.from({ length: 35 }, (_, i) => row(`d${i}`, "delivered")),
    ...Array.from({ length: 25 }, (_, i) => row(`r${i}`, "read")),
  ];
  it("counts every recipient independently and the parts add up", () => {
    const s = summarize(rows);
    expect(s).toEqual({ total: 100, pending: 40, delivered: 35, read: 25 });
    expect(s.pending + s.delivered + s.read).toBe(s.total);
  });
  it("filters All / Pending / Delivered / Read", () => {
    expect(filterRows(rows, "all").length).toBe(100);
    expect(filterRows(rows, "pending").length).toBe(40);
    expect(filterRows(rows, "delivered").length).toBe(35);
    expect(filterRows(rows, "read").length).toBe(25);
    const s = summarize(rows);
    expect(countFor(s, "all")).toBe(100);
    expect(countFor(s, "read")).toBe(25);
  });
  it("a broadcast is not 'delivered' while anyone is still pending", () => {
    expect(overallStatus(summarize(rows))).toBe("pending");
    expect(overallStatus(summarize(rows.filter((r) => r.delivery_status !== "pending")))).toBe("delivered");
    expect(overallStatus(summarize(rows.filter((r) => r.delivery_status === "read")))).toBe("read");
    expect(overallStatus(summarize([]))).toBe("pending");
  });
  it("lists pending recipients first, then A-Z by name", () => {
    const names: Record<string, string> = { a: "Zoya", b: "Anil", c: "Meera", d: "Bala" };
    const sorted = sortRecipients(
      [row("a", "read"), row("b", "delivered"), row("c", "pending"), row("d", "pending")],
      (id) => names[id],
    );
    expect(sorted.map((r) => r.recipient_id)).toEqual(["d", "c", "b", "a"]);
  });
  it("searches by recipient name", () => {
    const names: Record<string, string> = { a: "Zoya Khan", b: "Anil Rao" };
    expect(searchRows([row("a", "read"), row("b", "read")], "rao", (id) => names[id]).map((r) => r.recipient_id)).toEqual(["b"]);
    expect(searchRows([row("a", "read")], "  ", (id) => names[id]).length).toBe(1);
  });
  it("percent is safe for empty totals", () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 3)).toBe(33);
  });
  it("keys: one report per broadcast, one per direct message", () => {
    expect(reportKey({ id: "m1", batch_id: "b1" })).toBe("b1");
    expect(reportKey({ id: "m1", batch_id: null })).toBe("m1");
  });
  it("parses RPC counts that arrive as strings (bigint) and ignores junk", () => {
    expect(summaryFromRpc({ total_recipients: "100", pending_count: "40", delivered_count: 35, read_count: "25" }))
      .toEqual({ total: 100, pending: 40, delivered: 35, read: 25 });
    expect(summaryFromRpc({ total_recipients: "x", pending_count: -3 })).toEqual({ total: 0, pending: 0, delivered: 0, read: 0 });
  });
});

describe("duplicates", () => {
  it("one record per recipient even if listed twice", () => {
    expect(uniqueRecipients([{ id: "a" }, { id: "b" }, { id: "a" }]).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("ack ids are de-duplicated and chunked", () => {
    expect(chunkIds(["a", "a", "b", "", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(chunkIds([])).toEqual([]);
  });
});

describe("migration safety (supabase/migrations/20261105000000_message_delivery_tracking.sql)", () => {
  const sql = read("supabase/migrations/20261105000000_message_delivery_tracking.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("is additive: no drops, deletes, truncates or history rewrites", () => {
    expect(/DROP\s+(TABLE|COLUMN|POLICY)/i.test(code)).toBe(false);
    expect(/DELETE\s+FROM/i.test(code)).toBe(false);
    expect(/TRUNCATE/i.test(code)).toBe(false);
    expect(/UPDATE\s+public\.teacher_messages\s+SET\s+(is_read|message)/i.test(code)).toBe(false);
    expect(/ALTER\s+TABLE[^;]*DISABLE\s+ROW\s+LEVEL/i.test(code)).toBe(false);
  });
  it("derives status from is_read + delivered_at so it cannot drift or be written", () => {
    expect(/delivery_status\s+text\s+GENERATED\s+ALWAYS/i.test(code)).toBe(true);
    expect(code.includes("WHEN is_read THEN 'read'")).toBe(true);
    expect(code.includes("WHEN delivered_at IS NOT NULL THEN 'delivered'")).toBe(true);
  });
  it("does not stamp history with the migration time", () => {
    expect(/ADD COLUMN IF NOT EXISTS sent_at timestamptz,/.test(code)).toBe(true);
    expect(/ADD COLUMN IF NOT EXISTS sent_at timestamptz\s+DEFAULT/i.test(code)).toBe(false);
  });
  it("delivery ack only touches the caller's own, still-unconfirmed rows (idempotent)", () => {
    const ack = code.slice(code.indexOf("FUNCTION public.ack_message_delivery"), code.indexOf("get_message_delivery_summaries"));
    expect(ack.includes("recipient_id = auth.uid()")).toBe(true);
    expect(ack.includes("delivered_at IS NULL")).toBe(true);
    expect(ack.includes("auth.uid() IS NULL")).toBe(true);
  });
  it("only the sender can read a report", () => {
    const reports = code.slice(code.indexOf("FUNCTION public.get_message_delivery_summaries"));
    expect((reports.match(/m\.sender_id = auth\.uid\(\)/g) || []).length).toBe(2);
    expect(reports.includes("SECURITY DEFINER")).toBe(true);
  });
  it("functions are not callable by anon", () => {
    for (const fn of ["ack_message_delivery(uuid[])", "get_message_delivery_summaries(text[])", "get_message_delivery_report(text)"]) {
      expect(code.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon`)).toBe(true);
      expect(code.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`)).toBe(true);
    }
  });
  it("guard trigger blocks client-written delivery fields and forged reads", () => {
    expect(code.includes("NEW.delivered_at := NULL")).toBe(true);
    expect(code.includes("NEW.delivered_at := OLD.delivered_at")).toBe(true);
    expect(code.includes("NEW.is_read := OLD.is_read")).toBe(true);
    expect(code.includes("auth.uid() = NEW.recipient_id")).toBe(true);
  });
});

describe("wiring", () => {
  it("no page marks a message delivered/read at insert time", () => {
    for (const f of ["Admin", "Teacher", "Parent", "Student", "Driver"]) {
      const src = read(`src/pages/${f}CommunicationCenter.tsx`);
      // optional type declarations (`delivered_at?:`) are fine; object-literal writes (`delivered_at:`) are not
      expect(/\b(delivered_at|delivery_status|read_at)\s*:/.test(src.replace(/\/\/.*$/gm, ""))).toBe(false);
    }
  });
  it("the recipient's app confirms delivery on realtime INSERT and on catch-up", () => {
    const ctx = read("src/contexts/NotificationContext.tsx");
    expect(ctx.includes("ackPendingDeliveries(user.id)")).toBe(true);
    expect(ctx.includes("ackMessageDeliveries([row.id])")).toBe(true);
    // acked before the "already viewing this thread" early return, so an open thread still confirms
    expect(ctx.indexOf("ackMessageDeliveries([row.id])")).toBeLessThan(ctx.indexOf("Already viewing this exact conversation"));
  });
  it("existing read behaviour is unchanged in every Communication Center", () => {
    for (const f of ["Admin", "Teacher", "Parent", "Student", "Driver"]) {
      expect(read(`src/pages/${f}CommunicationCenter.tsx`).includes('update({ is_read: true })')).toBe(true);
    }
  });
  it("admin and teacher pages render the delivery report for sent messages", () => {
    for (const f of ["Admin", "Teacher"]) {
      const src = read(`src/pages/${f}CommunicationCenter.tsx`);
      expect(src.includes("<DeliverySummaryChip")).toBe(true);
      expect(src.includes("<DeliveryReportDialog")).toBe(true);
      expect(src.includes("<DeliveryTick")).toBe(true);
    }
  });
  it("admin broadcasts de-duplicate recipients before inserting", () => {
    const src = read("src/pages/AdminCommunicationCenter.tsx");
    expect(src.indexOf("uniqueRecipients(recipients)")).toBeGreaterThan(0);
    expect(src.indexOf("uniqueRecipients(recipients)")).toBeLessThan(src.indexOf("recipients.map(r => ({"));
  });
  it("the report dialog exposes totals, the three counts and the four filters", () => {
    const ui = read("src/components/communication/MessageDeliveryReport.tsx");
    expect(ui.includes("DELIVERY_FILTERS.map")).toBe(true);
    expect(ui.includes('["pending", "delivered", "read"]')).toBe(true);
    expect(ui.includes("summary.total")).toBe(true);
  });
});
