// src/lib/forecastModel.ts
//
// Pure logic for the School Forecasts page (feature 59). No React, network or database code,
// so it can be unit tested from src/test/forecastModel.test.ts.
//
// Forecast rule: expected collection on upcoming dues = upcoming dues x the share already collected on dues
// whose due date has passed. It needs at least MIN_PAST_RECORDS past records, otherwise there is no forecast.

export const TARGET_STUDENTS_PER_TEACHER = 30;
export const MIN_PAST_RECORDS = 5;

export interface FeeRow {
  class_grade: string | null;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  due_date: string | null;
}

export interface FeeSummary {
  due: number;
  paid: number;
  collectedPct: number;
  overdue: number;
  upcomingDue: number;
  pastRatePct: number | null;
  expectedMore: number | null;
  byClass: { grade: string; due: number; paid: number; overdue: number }[];
}

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);

/** `today` and each due_date are YYYY-MM-DD strings. A row with no due date counts as upcoming. */
export function summariseFees(rows: FeeRow[], today: string): FeeSummary {
  let due = 0;
  let paid = 0;
  let overdue = 0;
  let upcomingDue = 0;
  let upcomingPaid = 0;
  let pastDue = 0;
  let pastPaid = 0;
  let pastCount = 0;
  const byClass = new Map<string, { grade: string; due: number; paid: number; overdue: number }>();

  for (const r of rows) {
    const d = num(r.amount_due);
    const p = num(r.amount_paid);
    const isPast = !!r.due_date && r.due_date < today;
    const isUpcoming = !r.due_date || r.due_date >= today;
    due += d;
    paid += p;
    const grade = r.class_grade?.trim() || "No class";
    const c = byClass.get(grade) ?? { grade, due: 0, paid: 0, overdue: 0 };
    c.due += d;
    c.paid += p;
    if (isPast) {
      pastDue += d;
      pastPaid += p;
      pastCount += 1;
      const owed = Math.max(0, d - p);
      overdue += owed;
      c.overdue += owed;
    }
    if (isUpcoming) {
      upcomingDue += d;
      upcomingPaid += p;
    }
    byClass.set(grade, c);
  }

  const pastRate = pastCount >= MIN_PAST_RECORDS && pastDue > 0 ? pastPaid / pastDue : null;
  const expectedMore = pastRate === null ? null : Math.max(0, upcomingDue * pastRate - upcomingPaid);

  return {
    due,
    paid,
    collectedPct: pct(paid, due),
    overdue,
    upcomingDue,
    pastRatePct: pastRate === null ? null : Math.round(pastRate * 100),
    expectedMore,
    byClass: [...byClass.values()].sort((a, b) => b.overdue - a.overdue || a.grade.localeCompare(b.grade)),
  };
}
