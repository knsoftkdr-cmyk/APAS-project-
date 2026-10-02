// supabase/functions/_shared/academicForecastModel.ts
//
// Pure logic (no imports, no I/O) behind the Academic Forecasting Engine. Served through the
// already-deployed `predict-performance` edge function (action "forecast_overview") - see
// _shared/handlers/academicForecast.ts and CONSOLIDATION.md. Also reused by the Student Learning Twin.
//
// What it is: a transparent statistical projection, not a trained model. Monthly average scores are
// fitted with a recency-weighted linear trend, and the trend is damped so it does not run away.
// The 80% range comes from how far the fit missed the actual data. With too little data it says so.

export const FORECAST_MODEL_VERSION = "1.0";
export const RECENCY_DECAY = 0.8;      // weight of each older month relative to the next newer one
export const TREND_DAMPING = 0.85;     // each step ahead keeps this share of the previous step's trend
export const Z_80 = 1.2816;
export const MIN_MONTHS = 3;           // calendar months with at least one test
export const MIN_TESTS = 5;
export const STABLE_BAND = 1.0;        // |slope| below this many points/month counts as stable
export const HORIZON_MONTHS = 3;
export const STUDENT_MIN_TESTS = 3;
export const STUDENT_WINDOW = 8;       // most recent tests used for a student's own projection
export const LOW_SCORE = 40;

export interface TestPoint {
  studentId: string;   // students.id
  subject: string;
  pct: number;         // 0-100
  at: number;          // epoch ms
}

export interface SeriesPoint { month: string; pct: number; n: number }
export interface ProjectionPoint { month: string; pct: number; low: number; high: number }
export type Direction = "improving" | "declining" | "stable";
export type Confidence = "low" | "medium" | "high";

export interface Forecast {
  ok: boolean;
  reason?: string;
  tests: number;
  months_with_data: number;
  history: SeriesPoint[];
  projection: ProjectionPoint[];
  slope_per_month: number | null;
  direction: Direction | null;
  confidence: Confidence | null;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthIndex = (key: string): number => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};
const monthFromIndex = (idx: number): string => {
  const y = Math.floor(idx / 12);
  return `${y}-${String((idx % 12) + 1).padStart(2, "0")}`;
};

/** Weighted least squares line through (x, y) with weights w. Needs >= 2 distinct x. */
export function weightedFit(xs: number[], ys: number[], ws: number[]) {
  const sw = ws.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((a, x, i) => a + x * ws[i], 0) / sw;
  const my = ys.reduce((a, y, i) => a + y * ws[i], 0) / sw;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += ws[i] * (xs[i] - mx) ** 2;
    sxy += ws[i] * (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  // weighted residual spread, corrected for the two fitted parameters
  let sse = 0;
  for (let i = 0; i < xs.length; i++) sse += ws[i] * (ys[i] - (intercept + slope * xs[i])) ** 2;
  const n = xs.length;
  const sd = n > 2 ? Math.sqrt((sse / sw) * (n / (n - 2))) : 0;
  return { slope, intercept, sd };
}

/** Sum of damping^1..damping^h: how many "trend steps" h months ahead are worth. */
const dampedSteps = (h: number) => {
  let s = 0, p = 1;
  for (let k = 1; k <= h; k++) { p *= TREND_DAMPING; s += p; }
  return s;
};

export function directionOf(slope: number): Direction {
  if (slope > STABLE_BAND) return "improving";
  if (slope < -STABLE_BAND) return "declining";
  return "stable";
}

const EMPTY = (reason: string, tests = 0, months = 0, history: SeriesPoint[] = []): Forecast => ({
  ok: false, reason, tests, months_with_data: months, history, projection: [],
  slope_per_month: null, direction: null, confidence: null,
});

/** Forecast a group (school, subject, class...) from its tests. */
export function forecastSeries(points: { pct: number; at: number }[]): Forecast {
  if (points.length < MIN_TESTS) {
    return EMPTY(`Needs at least ${MIN_TESTS} tests to forecast (found ${points.length}).`, points.length);
  }
  const byMonth = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    const k = monthKey(p.at);
    const a = byMonth.get(k) ?? { sum: 0, n: 0 };
    a.sum += p.pct; a.n++;
    byMonth.set(k, a);
  }
  const keys = [...byMonth.keys()].sort();
  const history: SeriesPoint[] = keys.map((k) => {
    const a = byMonth.get(k)!;
    return { month: k, pct: round1(a.sum / a.n), n: a.n };
  });
  if (keys.length < MIN_MONTHS) {
    return EMPTY(`Needs at least ${MIN_MONTHS} months of data to forecast a trend (found ${keys.length}).`, points.length, keys.length, history);
  }

  const xs = keys.map(monthIndex);
  const ys = keys.map((k) => byMonth.get(k)!.sum / byMonth.get(k)!.n);
  const last = xs.length - 1;
  const ws = xs.map((_, i) => Math.pow(RECENCY_DECAY, last - i));
  const fit = weightedFit(xs, ys, ws);
  const level = fit.intercept + fit.slope * xs[last];

  const projection: ProjectionPoint[] = [];
  for (let h = 1; h <= HORIZON_MONTHS; h++) {
    const centre = level + fit.slope * dampedSteps(h);
    const half = Z_80 * fit.sd * Math.sqrt(1 + h / 2);
    projection.push({
      month: monthFromIndex(xs[last] + h),
      pct: round1(clamp(centre)),
      low: round1(clamp(centre - half)),
      high: round1(clamp(centre + half)),
    });
  }
  const confidence: Confidence =
    keys.length >= 6 && fit.sd < 8 ? "high" : keys.length >= 4 && fit.sd < 14 ? "medium" : "low";

  return {
    ok: true, tests: points.length, months_with_data: keys.length, history, projection,
    slope_per_month: round1(fit.slope), direction: directionOf(fit.slope), confidence,
  };
}

export interface StudentProjection {
  next_pct: number;
  low: number;
  high: number;
  recent_avg: number;
  slope_per_test: number;
  tests_used: number;
}

/** One student's next-test projection from their most recent tests (oldest -> newest order not required). */
export function projectStudent(points: { pct: number; at: number }[]): StudentProjection | null {
  if (points.length < STUDENT_MIN_TESTS) return null;
  const recent = [...points].sort((a, b) => a.at - b.at).slice(-STUDENT_WINDOW);
  const xs = recent.map((_, i) => i);
  const ys = recent.map((p) => p.pct);
  const last = xs.length - 1;
  const ws = xs.map((i) => Math.pow(RECENCY_DECAY, last - i));
  const fit = weightedFit(xs, ys, ws);
  const level = fit.intercept + fit.slope * last;
  const centre = level + fit.slope * TREND_DAMPING;
  const half = Z_80 * fit.sd * 1.2;
  return {
    next_pct: round1(clamp(centre)),
    low: round1(clamp(centre - half)),
    high: round1(clamp(centre + half)),
    recent_avg: round1(ys.reduce((a, b) => a + b, 0) / ys.length),
    slope_per_test: round1(fit.slope),
    tests_used: recent.length,
  };
}

// ── Overview across school / subject / class / student ────────────────────────────────────────────

export interface ForecastInput {
  tests: TestPoint[];
  classes: { id: string; name: string; section: string | null; studentIds: string[] }[];
  studentNames: Map<string, string>;
  scope: "school" | "teacher";
}

export interface GroupForecast { key: string; label: string; students: number; forecast: Forecast }
export interface WatchStudent {
  student_id: string;
  name: string;
  subject: string;
  projected_pct: number;
  recent_avg: number;
  change: number;
  reason: "low_projection" | "falling";
}
export interface ForecastSignal { severity: "warning" | "info"; message: string; subject?: string; class_id?: string }

export interface ForecastOverview {
  model_version: string;
  scope: "school" | "teacher";
  generated_at: string;
  school: Forecast;
  subjects: GroupForecast[];
  classes: GroupForecast[];
  watchlist: WatchStudent[];
  signals: ForecastSignal[];
  assumptions: Record<string, number | string>;
}

const label = (c: { name: string; section: string | null }) => (c.section ? `${c.name} ${c.section}` : c.name);

export function buildForecastOverview(input: ForecastInput, now = Date.now()): ForecastOverview {
  const { tests, classes, studentNames } = input;

  const school = forecastSeries(tests);

  // subjects
  const bySubject = new Map<string, TestPoint[]>();
  for (const t of tests) {
    const l = bySubject.get(t.subject) ?? [];
    l.push(t);
    bySubject.set(t.subject, l);
  }
  const subjects: GroupForecast[] = [...bySubject.entries()]
    .map(([subject, pts]) => ({
      key: subject, label: subject,
      students: new Set(pts.map((p) => p.studentId)).size,
      forecast: forecastSeries(pts),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // classes (by roster)
  const testsByStudent = new Map<string, TestPoint[]>();
  for (const t of tests) {
    const l = testsByStudent.get(t.studentId) ?? [];
    l.push(t);
    testsByStudent.set(t.studentId, l);
  }
  const classGroups: GroupForecast[] = classes
    .map((c) => {
      const pts = c.studentIds.flatMap((id) => testsByStudent.get(id) ?? []);
      return {
        key: c.id, label: label(c),
        students: new Set(pts.map((p) => p.studentId)).size,
        forecast: forecastSeries(pts),
      };
    })
    .filter((g) => g.forecast.tests > 0)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  // student watch-list: per student per subject
  const watchlist: WatchStudent[] = [];
  const perStudentSubject = new Map<string, TestPoint[]>();
  for (const t of tests) {
    const k = `${t.studentId}\u0000${t.subject}`;
    const l = perStudentSubject.get(k) ?? [];
    l.push(t);
    perStudentSubject.set(k, l);
  }
  for (const [k, pts] of perStudentSubject) {
    const proj = projectStudent(pts);
    if (!proj) continue;
    const [studentId, subject] = k.split("\u0000");
    const change = round1(proj.next_pct - proj.recent_avg);
    const reason = proj.next_pct < LOW_SCORE ? "low_projection" : change <= -10 ? "falling" : null;
    if (!reason) continue;
    watchlist.push({
      student_id: studentId, name: studentNames.get(studentId) ?? "Student", subject,
      projected_pct: proj.next_pct, recent_avg: proj.recent_avg, change, reason,
    });
  }
  watchlist.sort((a, b) => a.projected_pct - b.projected_pct);

  // signals (only when the forecast is trustworthy enough to say something)
  const signals: ForecastSignal[] = [];
  for (const g of subjects) {
    const f = g.forecast;
    if (f.ok && f.direction === "declining" && f.confidence !== "low") {
      signals.push({ severity: "warning", subject: g.label,
        message: `${g.label} is trending down (${f.slope_per_month} points/month); projected ${f.projection[0].pct}% next month.` });
    }
  }
  for (const g of classGroups) {
    const f = g.forecast;
    if (f.ok && f.direction === "declining" && f.confidence !== "low") {
      signals.push({ severity: "warning", class_id: g.key,
        message: `${g.label} is trending down (${f.slope_per_month} points/month); projected ${f.projection[0].pct}% next month.` });
    }
  }
  if (!school.ok) signals.push({ severity: "info", message: school.reason ?? "Not enough data to forecast yet." });

  return {
    model_version: FORECAST_MODEL_VERSION, scope: input.scope, generated_at: new Date(now).toISOString(),
    school, subjects, classes: classGroups, watchlist: watchlist.slice(0, 50), signals,
    assumptions: {
      recency_decay_per_month: RECENCY_DECAY, trend_damping: TREND_DAMPING, interval: "80%",
      min_months: MIN_MONTHS, min_tests: MIN_TESTS, horizon_months: HORIZON_MONTHS,
      student_min_tests: STUDENT_MIN_TESTS, low_score_threshold: LOW_SCORE,
    },
  };
}
