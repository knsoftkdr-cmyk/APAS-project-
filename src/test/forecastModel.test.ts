import { describe, it, expect } from "vitest";
import { MIN_PAST_RECORDS, num, pct, summariseFees } from "../lib/forecastModel";

const TODAY = "2026-10-24";
const row = (grade: string | null, due: number | string | null, paid: number | string | null, date: string | null) => ({
  class_grade: grade,
  amount_due: due,
  amount_paid: paid,
  due_date: date,
});

describe("num / pct", () => {
  it("treats odd values as 0 and never divides by zero", () => {
    expect(num("abc")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num("12.5")).toBe(12.5);
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33);
  });
});

describe("summariseFees", () => {
  it("is all zero with no rows", () => {
    const s = summariseFees([], TODAY);
    expect(s.due).toBe(0);
    expect(s.expectedMore).toBeNull();
    expect(s.byClass).toEqual([]);
  });

  it("forecasts from the share collected on past dues", () => {
    const rows = [
      ...Array.from({ length: MIN_PAST_RECORDS }, () => row("Class 1", 100, 50, "2026-09-01")),
      row("Class 1", 100, 0, "2026-11-09"),
      row("Class 1", 100, 0, null),
    ];
    const s = summariseFees(rows, TODAY);
    expect(s.due).toBe(700);
    expect(s.paid).toBe(250);
    expect(s.collectedPct).toBe(36);
    expect(s.overdue).toBe(250);
    expect(s.upcomingDue).toBe(200);
    expect(s.pastRatePct).toBe(50);
    expect(s.expectedMore).toBe(100);
  });

  it("gives no forecast when there are too few past records", () => {
    const rows = Array.from({ length: MIN_PAST_RECORDS - 1 }, () => row("Class 1", 100, 0, "2026-09-01"));
    const s = summariseFees(rows, TODAY);
    expect(s.overdue).toBe(100 * (MIN_PAST_RECORDS - 1));
    expect(s.pastRatePct).toBeNull();
    expect(s.expectedMore).toBeNull();
  });

  it("does not count overpayment as negative overdue, and ignores bad amounts", () => {
    const s = summariseFees([row("Class 1", 100, 150, "2026-09-01"), row("Class 1", "x", null, "2026-09-01")], TODAY);
    expect(s.overdue).toBe(0);
    expect(s.due).toBe(100);
  });

  it("groups by class, biggest overdue first, and names a missing class", () => {
    const s = summariseFees(
      [row("Class 6", 50, 0, "2026-09-01"), row("Class 1", 100, 0, "2026-09-01"), row(null, 10, 0, "2026-11-30")],
      TODAY,
    );
    expect(s.byClass.map((c) => c.grade)).toEqual(["Class 1", "Class 6", "No class"]);
    expect(s.byClass[0].overdue).toBe(100);
  });
});
