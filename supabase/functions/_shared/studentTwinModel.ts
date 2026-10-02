// supabase/functions/_shared/studentTwinModel.ts
//
// Pure logic (no I/O) behind the Student Digital Learning Twin. Used by _shared/handlers/studentTwin.ts,
// which `get-mastery-history` routes to via action "student_twin" (see mergedRouter.ts).
//
// What it is: a transparent summary of the evidence we hold about one learner, not a trained model.
//  - Ability per subject = recency-weighted average of test scores, optionally blended with the
//    adaptive-practice (IRT) ability once there are enough adaptive items.
//  - Preferences (strengths / challenges) are named only with enough tests and a clear margin.
//  - Every risk flag and every next step states the evidence it came from.
// With too little data it says so instead of guessing.

import { projectStudent, directionOf, weightedFit, monthKey } from "./academicForecastModel.ts";
import type { Direction } from "./academicForecastModel.ts";

export const TWIN_MODEL_VERSION = "1.0";
export const RECENCY_DECAY = 0.8;          // each older test counts this much relative to the next newer one
export const MIN_TESTS_OVERALL = 3;        // total tests needed before an overall ability is stated
export const MIN_TESTS_SUBJECT_PREF = 3;   // tests in a subject before it can be called a strength/challenge
export const PREFERENCE_MARGIN = 10;       // points above/below overall needed to name a preference
export const ADAPTIVE_MIN_ITEMS = 5;       // adaptive items needed before adaptive ability is blended in
export const ADAPTIVE_WEIGHT = 0.3;        // share of subject ability taken from adaptive practice
export const MASTERED_P = 0.8;             // p(mastery) at or above this counts as mastered
export const STALE_DAYS = 30;              // mastered skill not practised for this long counts as stale
export const RISK_HIGH_ABILITY = 40;
export const RISK_WATCH_ABILITY = 55;
export const ATTENDANCE_WARN = 75;
export const ATTENDANCE_LOW = 60;
export const STALE_WARN_PCT = 50;
export const MONTHLY_MIN_MONTHS = 3;
const DAY = 86400000;

export interface TwinInput {
  now: number;
  tests: { subject: string; pct: number; at: number }[];
  mastery: { p: number; opportunities: number; lastAt: number | null }[];
  adaptive: { subject: string; theta: number; items: number }[];
  attendance: { present: number; total: number } | null;
  vark: string | null;
  history: { date: string; overall: number | null }[];
}

export interface TwinSubject {
  subject: string;
  ability: number | null;
  tests: number;
  adaptive_items: number;
  sources: ("tests" | "adaptive")[];
  projected_next: number | null;
  projected_low: number | null;
  projected_high: number | null;
  trend: Direction | null;
  slope_per_test: number | null;
}
export interface TwinNextStep { action: string; reason: string; subject?: string }
export interface StudentTwinResult {
  model_version: string;
  generated_at: string;
  sufficient_data: boolean;
  overall_ability: number | null;
  subjects: TwinSubject[];
  preferences: {
    strengths: { subject: string; margin: number }[];
    challenges: { subject: string; margin: number }[];
    recorded_learning_style: string | null;
    note: string;
  };
  progression: {
    direction: Direction | null;
    slope_per_month: number | null;
    basis: "monthly_tests" | "recent_tests" | "none";
    history: { date: string; overall: number | null }[];
  };
  retention: { tracked: number; mastered: number; mastered_pct: number | null; stale_pct: number | null };
  engagement: { tests_last_30_days: number; attendance_pct: number | null };
  risk: { level: "low" | "medium" | "high" | "unknown"; reasons: string[] };
  next_steps: TwinNextStep[];
  assumptions: Record<string, number | string>;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Logistic map from an IRT ability (theta) to a 0-100 scale. 0 -> 50. */
export function thetaToPct(theta: number): number {
  return 100 / (1 + Math.exp(-theta));
}

/** Recency-weighted mean of scores, oldest -> newest. */
function recencyMean(sortedPct: number[]): number {
  const last = sortedPct.length - 1;
  let sw = 0, s = 0;
  for (let i = 0; i <= last; i++) {
    const w = Math.pow(RECENCY_DECAY, last - i);
    sw += w; s += w * sortedPct[i];
  }
  return s / sw;
}

export function buildStudentTwin(input: TwinInput): StudentTwinResult {
  const { now, mastery, attendance, vark, history } = input;
  const tests = input.tests.filter((t) => t.subject && Number.isFinite(t.pct) && Number.isFinite(t.at));
  const totalTests = tests.length;
  const sufficient = totalTests >= MIN_TESTS_OVERALL;

  // ── subjects ───────────────────────────────────────────────────────────────────────────────
  const testsBySubject = new Map<string, { pct: number; at: number }[]>();
  for (const t of tests) {
    const l = testsBySubject.get(t.subject) ?? [];
    l.push({ pct: clamp(t.pct), at: t.at });
    testsBySubject.set(t.subject, l);
  }
  const adaptiveBySubject = new Map<string, { theta: number; items: number }>();
  for (const a of input.adaptive) {
    if (!a.subject || !Number.isFinite(a.theta)) continue;
    const prev = adaptiveBySubject.get(a.subject);
    // several books can share a subject: keep the one with the most evidence
    if (!prev || a.items > prev.items) adaptiveBySubject.set(a.subject, { theta: a.theta, items: a.items });
  }

  const names = new Set<string>([...testsBySubject.keys()]);
  for (const [s, a] of adaptiveBySubject) if (a.items >= ADAPTIVE_MIN_ITEMS) names.add(s);

  const subjects: TwinSubject[] = [...names].sort().map((subject) => {
    const pts = (testsBySubject.get(subject) ?? []).sort((a, b) => a.at - b.at);
    const ad = adaptiveBySubject.get(subject);
    const useAdaptive = !!ad && ad.items >= ADAPTIVE_MIN_ITEMS;
    const sources: ("tests" | "adaptive")[] = [];
    let ability: number | null = null;
    if (pts.length) {
      sources.push("tests");
      ability = recencyMean(pts.map((p) => p.pct));
    }
    if (useAdaptive) {
      sources.push("adaptive");
      const ap = thetaToPct(ad!.theta);
      ability = ability === null ? ap : (1 - ADAPTIVE_WEIGHT) * ability + ADAPTIVE_WEIGHT * ap;
    }
    const proj = projectStudent(pts);
    return {
      subject,
      ability: ability === null ? null : round1(ability),
      tests: pts.length,
      adaptive_items: ad?.items ?? 0,
      sources,
      projected_next: proj ? proj.next_pct : null,
      projected_low: proj ? proj.low : null,
      projected_high: proj ? proj.high : null,
      trend: proj ? directionOf(proj.slope_per_test) : null,
      slope_per_test: proj ? proj.slope_per_test : null,
    };
  });

  // ── overall ability (only with enough tests) ───────────────────────────────────────────────
  let overall: number | null = null;
  if (sufficient) {
    let sw = 0, s = 0;
    for (const sub of subjects) {
      if (sub.ability === null) continue;
      const w = Math.max(1, sub.tests);
      sw += w; s += w * sub.ability;
    }
    overall = sw > 0 ? round1(s / sw) : null;
  }

  // ── preferences ────────────────────────────────────────────────────────────────────────────
  const eligible = subjects.filter((s) => s.tests >= MIN_TESTS_SUBJECT_PREF && s.ability !== null);
  const strengths: { subject: string; margin: number }[] = [];
  const challenges: { subject: string; margin: number }[] = [];
  if (overall !== null) {
    for (const s of eligible) {
      const margin = round1(s.ability! - overall);
      if (margin >= PREFERENCE_MARGIN) strengths.push({ subject: s.subject, margin });
      else if (margin <= -PREFERENCE_MARGIN) challenges.push({ subject: s.subject, margin });
    }
  }
  strengths.sort((a, b) => b.margin - a.margin);
  challenges.sort((a, b) => a.margin - b.margin);
  let prefNote: string;
  if (overall === null || eligible.length < 2) {
    prefNote = `Not enough evidence yet to name strengths or challenges (needs at least ${MIN_TESTS_SUBJECT_PREF} tests in two or more subjects).`;
  } else if (!strengths.length && !challenges.length) {
    prefNote = `No subject stands out by ${PREFERENCE_MARGIN} points or more from the overall level.`;
  } else {
    prefNote = `Based on subjects with at least ${MIN_TESTS_SUBJECT_PREF} tests, compared with the overall level.`;
  }

  // ── progression ────────────────────────────────────────────────────────────────────────────
  let direction: Direction | null = null;
  let slopeMonth: number | null = null;
  let basis: "monthly_tests" | "recent_tests" | "none" = "none";
  if (sufficient) {
    const byMonth = new Map<string, { sum: number; n: number }>();
    for (const t of tests) {
      const k = monthKey(t.at);
      const a = byMonth.get(k) ?? { sum: 0, n: 0 };
      a.sum += clamp(t.pct); a.n++;
      byMonth.set(k, a);
    }
    if (byMonth.size >= MONTHLY_MIN_MONTHS) {
      const keys = [...byMonth.keys()].sort();
      const idx = keys.map((k) => { const [y, m] = k.split("-").map(Number); return y * 12 + (m - 1); });
      const ys = keys.map((k) => byMonth.get(k)!.sum / byMonth.get(k)!.n);
      const last = keys.length - 1;
      const ws = keys.map((_, i) => Math.pow(RECENCY_DECAY, last - i));
      const fit = weightedFit(idx, ys, ws);
      slopeMonth = round1(fit.slope);
      direction = directionOf(fit.slope);
      basis = "monthly_tests";
    } else {
      const slopes = subjects.filter((s) => s.slope_per_test !== null).map((s) => s.slope_per_test!);
      if (slopes.length) {
        direction = directionOf(slopes.reduce((a, b) => a + b, 0) / slopes.length);
        basis = "recent_tests";
      }
    }
  }

  // ── retention ──────────────────────────────────────────────────────────────────────────────
  const tracked = mastery.filter((m) => Number.isFinite(m.p));
  const mastered = tracked.filter((m) => m.p >= MASTERED_P);
  const stale = mastered.filter((m) => m.lastAt === null || now - m.lastAt > STALE_DAYS * DAY);
  const retention = {
    tracked: tracked.length,
    mastered: mastered.length,
    mastered_pct: tracked.length ? Math.round((mastered.length / tracked.length) * 100) : null,
    stale_pct: mastered.length ? Math.round((stale.length / mastered.length) * 100) : null,
  };

  // ── engagement ─────────────────────────────────────────────────────────────────────────────
  const engagement = {
    tests_last_30_days: tests.filter((t) => t.at >= now - 30 * DAY && t.at <= now).length,
    attendance_pct: attendance && attendance.total > 0 ? Math.round((attendance.present / attendance.total) * 100) : null,
  };

  // ── risk ───────────────────────────────────────────────────────────────────────────────────
  const reasons: string[] = [];
  let points = 0;
  let level: "low" | "medium" | "high" | "unknown" = "unknown";
  if (sufficient && overall !== null) {
    if (overall < RISK_HIGH_ABILITY) {
      points += 3; reasons.push(`Overall ability is ${overall}%, below ${RISK_HIGH_ABILITY}%.`);
    } else if (overall < RISK_WATCH_ABILITY) {
      points += 1; reasons.push(`Overall ability is ${overall}%, below ${RISK_WATCH_ABILITY}%.`);
    }
    if (overall >= RISK_HIGH_ABILITY) {
      for (const s of eligible) {
        if (s.ability! < RISK_HIGH_ABILITY) { points += 1; reasons.push(`${s.subject} ability is ${s.ability}%, below ${RISK_HIGH_ABILITY}%.`); }
      }
    }
    if (direction === "declining") { points += 1; reasons.push("Scores are trending downward."); }
    const att = engagement.attendance_pct;
    if (att !== null && att < ATTENDANCE_LOW) { points += 2; reasons.push(`Attendance over the last 30 days is ${att}%, below ${ATTENDANCE_LOW}%.`); }
    else if (att !== null && att < ATTENDANCE_WARN) { points += 1; reasons.push(`Attendance over the last 30 days is ${att}%, below ${ATTENDANCE_WARN}%.`); }
    if (retention.stale_pct !== null && retention.stale_pct >= STALE_WARN_PCT) {
      points += 1; reasons.push(`${retention.stale_pct}% of mastered skills have not been practised in ${STALE_DAYS}+ days.`);
    }
    level = points >= 3 ? "high" : points >= 1 ? "medium" : "low";
    if (level === "low") reasons.push("No risk signals in the available evidence.");
  } else {
    reasons.push(`Only ${totalTests} test${totalTests === 1 ? "" : "s"} recorded; at least ${MIN_TESTS_OVERALL} are needed to assess risk.`);
  }

  // ── next steps (each with its reason) ──────────────────────────────────────────────────────
  const next_steps: TwinNextStep[] = [];
  if (!sufficient) {
    next_steps.push({
      action: "Complete more tests so a learning profile can be built",
      reason: `Only ${totalTests} test${totalTests === 1 ? "" : "s"} recorded; at least ${MIN_TESTS_OVERALL} are needed before ability is estimated.`,
    });
  } else {
    const weak = [...subjects].filter((s) => s.ability !== null && s.tests >= 2).sort((a, b) => a.ability! - b.ability!)[0];
    if (weak && weak.ability! < 60) {
      next_steps.push({ action: `Revise ${weak.subject} fundamentals`, reason: `${weak.subject} ability is ${weak.ability}%, the lowest subject.`, subject: weak.subject });
    }
    for (const s of subjects) {
      if (s.trend === "declining" && s !== weak && next_steps.length < 4) {
        next_steps.push({ action: `Review recent ${s.subject} topics`, reason: `${s.subject} scores are falling (${s.slope_per_test} points per test).`, subject: s.subject });
      }
    }
    if (retention.stale_pct !== null && retention.stale_pct >= STALE_WARN_PCT) {
      next_steps.push({ action: "Revise previously mastered skills", reason: `${retention.stale_pct}% of mastered skills have not been practised in ${STALE_DAYS}+ days.` });
    }
    if (engagement.attendance_pct !== null && engagement.attendance_pct < ATTENDANCE_WARN) {
      next_steps.push({ action: "Work on regular attendance", reason: `Attendance over the last 30 days is ${engagement.attendance_pct}%.` });
    }
    if (strengths.length) {
      next_steps.push({ action: `Try enrichment work in ${strengths[0].subject}`, reason: `${strengths[0].subject} is ${strengths[0].margin} points above the overall level.`, subject: strengths[0].subject });
    }
    if (!next_steps.length) {
      next_steps.push({ action: "Keep up the current study routine", reason: "No weak subjects, falling trends or stale skills were found in the available evidence." });
    }
  }

  return {
    model_version: TWIN_MODEL_VERSION,
    generated_at: new Date(now).toISOString(),
    sufficient_data: sufficient,
    overall_ability: overall,
    subjects,
    preferences: { strengths, challenges, recorded_learning_style: vark || null, note: prefNote },
    progression: { direction, slope_per_month: slopeMonth, basis, history },
    retention,
    engagement,
    risk: { level, reasons },
    next_steps: next_steps.slice(0, 5),
    assumptions: {
      recency_decay: RECENCY_DECAY,
      min_tests_overall: MIN_TESTS_OVERALL,
      min_tests_subject_preference: MIN_TESTS_SUBJECT_PREF,
      preference_margin: PREFERENCE_MARGIN,
      adaptive_min_items: ADAPTIVE_MIN_ITEMS,
      adaptive_weight: ADAPTIVE_WEIGHT,
      mastered_threshold: MASTERED_P,
      stale_days: STALE_DAYS,
    },
  };
}