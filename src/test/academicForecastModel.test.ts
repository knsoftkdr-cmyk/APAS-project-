import { describe, it, expect } from "vitest";
import {
  forecastSeries, projectStudent, buildForecastOverview, monthKey, MIN_TESTS,
} from "../../supabase/functions/_shared/academicForecastModel";

const D = 86400000;
const t0 = Date.UTC(2026, 0, 15);
const monthly = (scores: number[], perMonth = 2) =>
  scores.flatMap((s, m) => Array.from({ length: perMonth }, (_, k) => ({ pct: s, at: Date.UTC(2026, m, 5 + k * 3) })));

describe("forecastSeries", () => {
  it("refuses to forecast with too few tests", () => {
    const f = forecastSeries(monthly([50], 2));
    expect(f.ok).toBe(false);
    expect(f.reason).toMatch(String(MIN_TESTS));
    expect(f.projection).toEqual([]);
  });
  it("refuses with fewer than 3 months even with many tests", () => {
    const f = forecastSeries(monthly([50, 55], 5));
    expect(f.ok).toBe(false);
    expect(f.months_with_data).toBe(2);
  });
  it("detects an improving trend and projects upward within 0-100", () => {
    const f = forecastSeries(monthly([50, 55, 60, 65, 70]));
    expect(f.ok).toBe(true);
    expect(f.direction).toBe("improving");
    expect(f.projection).toHaveLength(3);
    expect(f.projection[0].pct).toBeGreaterThan(70);
    expect(f.projection[0].pct).toBeLessThanOrEqual(100);
  });
  it("detects a decline and keeps low <= pct <= high", () => {
    const f = forecastSeries(monthly([80, 74, 70, 61, 55]));
    expect(f.direction).toBe("declining");
    for (const p of f.projection) { expect(p.low).toBeLessThanOrEqual(p.pct); expect(p.high).toBeGreaterThanOrEqual(p.pct); }
  });
  it("damps the trend: later months grow by less each step", () => {
    const f = forecastSeries(monthly([40, 50, 60, 70]));
    const [a, b, c] = f.projection.map((p) => p.pct);
    expect(b - a).toBeLessThan(a - 70 + 0.001 + 20);
    expect(c - b).toBeLessThanOrEqual(b - a + 0.2);
  });
  it("flat scores are stable", () => {
    expect(forecastSeries(monthly([60, 60, 60, 60])).direction).toBe("stable");
  });
  it("noisier data gives a wider range", () => {
    const calm = forecastSeries(monthly([60, 61, 60, 61, 60]));
    const noisy = forecastSeries(monthly([40, 80, 45, 85, 50]));
    const w = (f: typeof calm) => f.projection[0].high - f.projection[0].low;
    expect(w(noisy)).toBeGreaterThan(w(calm));
  });
});

describe("projectStudent", () => {
  it("needs at least 3 tests", () => {
    expect(projectStudent([{ pct: 50, at: t0 }, { pct: 60, at: t0 + D }])).toBeNull();
  });
  it("projects a falling student below their recent average", () => {
    const p = projectStudent([80, 70, 60, 50].map((pct, i) => ({ pct, at: t0 + i * 7 * D })))!;
    expect(p.next_pct).toBeLessThan(p.recent_avg);
    expect(p.slope_per_test).toBeLessThan(0);
  });
});

describe("buildForecastOverview", () => {
  const tests = [
    ...monthly([70, 60, 50, 40]).map((p) => ({ ...p, studentId: "s1", subject: "Maths" })),
    ...monthly([60, 62, 61, 63]).map((p) => ({ ...p, studentId: "s2", subject: "Maths" })),
    ...monthly([55, 56, 57, 58]).map((p) => ({ ...p, studentId: "s2", subject: "Science" })),
  ];
  const input = {
    tests,
    classes: [{ id: "c1", name: "Class 6", section: "A", studentIds: ["s1", "s2"] }],
    studentNames: new Map([["s1", "Asha"], ["s2", "Ravi"]]),
    scope: "school" as const,
  };
  it("builds school, subject and class forecasts", () => {
    const o = buildForecastOverview(input);
    expect(o.school.ok).toBe(true);
    expect(o.subjects.map((s) => s.label)).toEqual(["Maths", "Science"]);
    expect(o.classes[0].label).toBe("Class 6 A");
    expect(o.classes[0].students).toBe(2);
  });
  it("flags the falling student on the watch-list", () => {
    const o = buildForecastOverview(input);
    expect(o.watchlist.some((w) => w.student_id === "s1")).toBe(true);
    expect(o.watchlist.every((w) => w.student_id !== "s2")).toBe(true);
  });
  it("says so when there is no data", () => {
    const o = buildForecastOverview({ ...input, tests: [] });
    expect(o.school.ok).toBe(false);
    expect(o.signals.some((s) => s.severity === "info")).toBe(true);
  });
  it("monthKey is UTC year-month", () => {
    expect(monthKey(Date.UTC(2026, 8, 30, 23))).toBe("2026-09");
  });
});
