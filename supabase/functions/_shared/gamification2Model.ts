// supabase/functions/_shared/gamification2Model.ts
//
// Gamification 2.0 - pure model (no I/O, unit-tested in src/test/gamification2Model.test.ts).
// Adaptive missions, streaks with freezes, tiered/adaptive badges and progression titles.
//
// Day boundaries use the student's own timezone: the client sends `tz_offset_minutes` (minutes EAST of UTC,
// e.g. India = 330) and all "today" / "this week" logic goes through localDate().
//
// The XP-per-level curve (200) is deliberately the same as hooks/useGamification.ts and the Leaderboard.

export const XP_PER_LEVEL = 200;
export const DAILY_ROUND_XP_CAP = 200;
export const MAX_FREEZES = 2;
export const FREEZE_EVERY_DAYS = 7;

export interface RoundInput {
  game_id: string;
  subject: string | null;
  accuracy: number;            // 0..100
  score: number;
  max_score: number;
  questions_attempted: number;
  duration_seconds: number;
}

export interface HistoryRound {
  game_id: string | null;
  subject: string | null;
  accuracy: number | null;
  xp_awarded: number;
  created_at: string;          // ISO
}

// ── dates ─────────────────────────────────────────────────────────────────────────────────────────

export function clampTz(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(840, Math.max(-720, n));
}

/** YYYY-MM-DD for `ms` in the timezone `tzOffsetMin` (minutes east of UTC). */
export function localDate(ms: number, tzOffsetMin = 0): string {
  return new Date(ms + clampTz(tzOffsetMin) * 60000).toISOString().slice(0, 10);
}

export function dayDiff(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate + "T00:00:00Z") - Date.parse(fromDate + "T00:00:00Z")) / 86400000);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const dow = new Date(date + "T00:00:00Z").getUTCDay();   // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

// ── sanitising client input ──────────────────────────────────────────────────────────────────────

const int = (v: unknown, lo: number, hi: number, d = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function sanitizeRound(input: unknown): RoundInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  const game_id = typeof r.game_id === "string" ? r.game_id.trim().toLowerCase().slice(0, 40) : "";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(game_id)) return null;
  const attempted = int(r.questions_attempted, 0, 200);
  const acc = Number(r.accuracy);
  const subject = typeof r.subject === "string" && r.subject.trim() ? r.subject.trim().slice(0, 60) : null;
  return {
    game_id,
    subject,
    accuracy: Number.isFinite(acc) ? Math.min(100, Math.max(0, Math.round(acc * 10) / 10)) : 0,
    score: int(r.score, -10000, 100000),
    max_score: int(r.max_score, 0, 100000),
    questions_attempted: attempted,
    duration_seconds: int(r.duration_seconds, 0, 3600),
  };
}

// ── XP ──────────────────────────────────────────────────────────────────────────────────────────────

/** Round XP before the daily cap. Rounds with <3 questions earn a small participation amount only. */
export function roundXp(r: Pick<RoundInput, "accuracy" | "questions_attempted">): number {
  if (r.questions_attempted < 3) return 5;
  return 10 + Math.round((r.accuracy / 100) * 20) + (r.accuracy >= 90 ? 10 : 0);
}

export function applyDailyCap(xp: number, alreadyToday: number): number {
  return Math.max(0, Math.min(xp, DAILY_ROUND_XP_CAP - Math.max(0, alreadyToday)));
}

// ── progression ─────────────────────────────────────────────────────────────────────────────────────

export const LEVEL_TITLES: { from: number; title: string; emoji: string }[] = [
  { from: 1, title: "Rookie", emoji: "🌱" },
  { from: 3, title: "Explorer", emoji: "🧭" },
  { from: 5, title: "Challenger", emoji: "⚔️" },
  { from: 8, title: "Strategist", emoji: "♟️" },
  { from: 12, title: "Master", emoji: "🎓" },
  { from: 20, title: "Legend", emoji: "👑" },
];

export const calcLevel = (xp: number) => Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;

export function levelInfo(totalXp: number) {
  const xp = Math.max(0, Math.round(totalXp));
  const level = calcLevel(xp);
  const idx = LEVEL_TITLES.reduce((acc, t, i) => (level >= t.from ? i : acc), 0);
  const next = LEVEL_TITLES[idx + 1] ?? null;
  return {
    total_xp: xp,
    level,
    xp_into_level: xp % XP_PER_LEVEL,
    xp_to_next_level: XP_PER_LEVEL - (xp % XP_PER_LEVEL),
    level_progress_pct: Math.round(((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100),
    title: LEVEL_TITLES[idx].title,
    emoji: LEVEL_TITLES[idx].emoji,
    next_title: next ? { title: next.title, at_level: next.from, levels_away: next.from - level } : null,
  };
}

// ── streaks ─────────────────────────────────────────────────────────────────────────────────────────

export interface StreakState {
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
  streak_freezes: number;
  freeze_earned_at_streak: number;
}

export interface StreakResult extends StreakState {
  freezes_used: number;       // freezes consumed to bridge missed days on this activity
  freeze_earned: boolean;
  streak_broken: boolean;
  days_away: number;          // whole days since the previous activity (0 when same day / first ever)
}

/** Streak after the student is active on `today`. A gap of N days needs N-1 freezes (max 2 bridged). */
export function applyActivity(s: StreakState, today: string): StreakResult {
  const base: StreakResult = { ...s, freezes_used: 0, freeze_earned: false, streak_broken: false, days_away: 0 };
  if (!s.last_activity_date) {
    return finalize({ ...base, current_streak: 1, last_activity_date: today });
  }
  const diff = dayDiff(s.last_activity_date, today);
  base.days_away = Math.max(0, diff);
  if (diff <= 0) {
    // same day (or clock skew): nothing changes, streak is at least 1
    return { ...base, current_streak: Math.max(1, s.current_streak), last_activity_date: s.last_activity_date };
  }
  const missed = diff - 1;
  if (missed === 0) return finalize({ ...base, current_streak: s.current_streak + 1, last_activity_date: today });
  if (missed <= s.streak_freezes && missed <= MAX_FREEZES) {
    return finalize({
      ...base,
      current_streak: s.current_streak + 1,
      streak_freezes: s.streak_freezes - missed,
      freezes_used: missed,
      last_activity_date: today,
    });
  }
  return finalize({
    ...base, current_streak: 1, streak_broken: s.current_streak > 1, freeze_earned_at_streak: 0, last_activity_date: today,
  });
}

function finalize(r: StreakResult): StreakResult {
  const out = { ...r };
  if (out.current_streak % FREEZE_EVERY_DAYS === 0 && out.current_streak > out.freeze_earned_at_streak) {
    out.freeze_earned_at_streak = out.current_streak;
    if (out.streak_freezes < MAX_FREEZES) { out.streak_freezes += 1; out.freeze_earned = true; }
  }
  out.longest_streak = Math.max(out.longest_streak, out.current_streak);
  return out;
}

/** What to SHOW without writing anything: a streak that can no longer be saved reads 0. */
export function displayStreak(s: StreakState, today: string) {
  if (!s.last_activity_date || s.current_streak <= 0) return { current: 0, at_risk: false, played_today: false };
  const diff = dayDiff(s.last_activity_date, today);
  if (diff <= 0) return { current: s.current_streak, at_risk: false, played_today: true };
  const missed = diff - 1;
  if (missed === 0) return { current: s.current_streak, at_risk: true, played_today: false };
  if (missed <= s.streak_freezes && missed <= MAX_FREEZES) return { current: s.current_streak, at_risk: true, played_today: false };
  return { current: 0, at_risk: false, played_today: false };
}

// ── adaptive missions ───────────────────────────────────────────────────────────────────────────────

export type MissionMetric = "rounds" | "accuracy_round" | "xp" | "weak_subject_round" | "new_game" | "active_days";

export interface MissionDraft {
  period: "daily" | "weekly";
  mission_key: string;
  title: string;
  description: string;
  metric: MissionMetric;
  target: number;
  xp_reward: number;
  meta: Record<string, unknown>;
}

export const KNOWN_GAME_IDS = ["quick-quiz", "match-pairs", "word-scramble", "category-sort", "speed-tap", "visual-memory"];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface Baseline {
  rounds_per_active_day: number;     // median over the last 14 days (0 when no history)
  avg_accuracy: number | null;
  xp_per_active_day: number;
  active_days_per_week: number;      // average over the last 4 weeks
  rounds_per_week: number;
  weak_subject: { subject: string; avg_accuracy: number; rounds: number } | null;
  recent_game_ids: string[];         // played in the last 7 days
  total_rounds_14d: number;
}

export function computeBaseline(history: HistoryRound[], today: string, tz = 0): Baseline {
  const within = (days: number) => history.filter((h) => {
    const d = dayDiff(localDate(Date.parse(h.created_at), tz), today);
    return d >= 0 && d < days;
  });
  const h14 = within(14);
  const byDay = new Map<string, HistoryRound[]>();
  for (const h of h14) {
    const k = localDate(Date.parse(h.created_at), tz);
    byDay.set(k, [...(byDay.get(k) ?? []), h]);
  }
  const accs = h14.map((h) => h.accuracy).filter((a): a is number => typeof a === "number");

  const subj = new Map<string, number[]>();
  for (const h of h14) {
    if (!h.subject || typeof h.accuracy !== "number") continue;
    const k = h.subject.toLowerCase();
    subj.set(k, [...(subj.get(k) ?? []), h.accuracy]);
  }
  let weak: Baseline["weak_subject"] = null;
  for (const [k, list] of subj) {
    if (list.length < 2) continue;
    const a = avg(list);
    if (!weak || a < weak.avg_accuracy) weak = { subject: k, avg_accuracy: Math.round(a), rounds: list.length };
  }
  // only worth a mission if it is genuinely below the student's overall level
  if (weak && accs.length && weak.avg_accuracy >= avg(accs) - 3 && weak.avg_accuracy >= 85) weak = null;

  const h28 = within(28);
  const weeks = new Map<string, Set<string>>();
  for (const h of h28) {
    const d = localDate(Date.parse(h.created_at), tz);
    const wk = weekStart(d);
    if (!weeks.has(wk)) weeks.set(wk, new Set());
    weeks.get(wk)!.add(d);
  }

  return {
    rounds_per_active_day: median([...byDay.values()].map((v) => v.length)),
    avg_accuracy: accs.length ? Math.round(avg(accs)) : null,
    xp_per_active_day: byDay.size ? avg([...byDay.values()].map((v) => v.reduce((s, x) => s + x.xp_awarded, 0))) : 0,
    active_days_per_week: weeks.size ? avg([...weeks.values()].map((s) => s.size)) : 0,
    rounds_per_week: weeks.size ? h28.length / weeks.size : 0,
    weak_subject: weak,
    recent_game_ids: [...new Set(within(7).map((h) => h.game_id).filter((g): g is string => !!g))],
    total_rounds_14d: h14.length,
  };
}

export function generateMissions(b: Baseline): { daily: MissionDraft[]; weekly: MissionDraft[] } {
  const isNew = b.total_rounds_14d === 0;

  const dailyRounds = isNew ? 1 : clamp(Math.ceil(b.rounds_per_active_day * 1.25), 1, 5);
  const accTarget = b.avg_accuracy == null ? 70 : clamp(Math.round((b.avg_accuracy + 5) / 5) * 5, 60, 95);

  const daily: MissionDraft[] = [
    {
      period: "daily", mission_key: "daily_rounds", metric: "rounds", target: dailyRounds,
      title: dailyRounds === 1 ? "Play a round" : `Play ${dailyRounds} rounds`,
      description: "Complete game rounds today.",
      xp_reward: 10 + 10 * dailyRounds, meta: { baseline_rounds: b.rounds_per_active_day },
    },
    {
      period: "daily", mission_key: "daily_accuracy", metric: "accuracy_round", target: accTarget,
      title: `Hit ${accTarget}% in a round`,
      description: b.avg_accuracy == null ? "Finish one round at or above this accuracy." : `Your recent average is ${b.avg_accuracy}% - aim a little higher.`,
      xp_reward: 25, meta: { baseline_accuracy: b.avg_accuracy },
    },
  ];

  if (b.weak_subject) {
    daily.push({
      period: "daily", mission_key: "daily_weak_subject", metric: "weak_subject_round", target: 1,
      title: `Strengthen ${b.weak_subject.subject}`,
      description: `Play a round in ${b.weak_subject.subject} (recent average ${b.weak_subject.avg_accuracy}%).`,
      xp_reward: 30, meta: { subject: b.weak_subject.subject },
    });
  } else {
    const untried = KNOWN_GAME_IDS.filter((g) => !b.recent_game_ids.includes(g));
    if (untried.length && !isNew && untried.length < KNOWN_GAME_IDS.length) {
      daily.push({
        period: "daily", mission_key: "daily_new_game", metric: "new_game", target: 1,
        title: "Try something new", description: "Play a game type you haven't played this week.",
        xp_reward: 25, meta: { recent_game_ids: b.recent_game_ids },
      });
    } else {
      const xpTarget = b.xp_per_active_day ? clamp(Math.round((b.xp_per_active_day * 1.2) / 5) * 5, 30, 150) : 40;
      daily.push({
        period: "daily", mission_key: "daily_xp", metric: "xp", target: xpTarget,
        title: `Earn ${xpTarget} XP from rounds`, description: "Game XP earned today counts.",
        xp_reward: 20, meta: {},
      });
    }
  }

  const days = b.active_days_per_week ? clamp(Math.ceil(b.active_days_per_week) + 1, 3, 6) : 3;
  const weeklyRounds = b.rounds_per_week ? clamp(Math.ceil(b.rounds_per_week * 1.2), 5, 30) : 5;
  const weekly: MissionDraft[] = [
    {
      period: "weekly", mission_key: "weekly_active_days", metric: "active_days", target: days,
      title: `Play on ${days} different days`, description: "Build the habit - any round counts.",
      xp_reward: 40 + 10 * days, meta: {},
    },
    {
      period: "weekly", mission_key: "weekly_rounds", metric: "rounds", target: weeklyRounds,
      title: `Complete ${weeklyRounds} rounds this week`, description: "Rounds from any game count.",
      xp_reward: 40 + 4 * weeklyRounds, meta: {},
    },
  ];
  return { daily, weekly };
}

export interface MissionRow {
  metric: string; target: number; progress: number; status: string; meta: Record<string, any> | null;
}

/** New progress for a mission after one round. Returns null when the mission isn't affected. */
export function missionProgressAfterRound(
  m: MissionRow, round: RoundInput, roundXpAwarded: number, activeDaysThisWeek?: number,
): number | null {
  if (m.status !== "active") return null;
  let next = m.progress;
  switch (m.metric) {
    case "rounds": next = m.progress + 1; break;
    case "accuracy_round": next = Math.max(m.progress, Math.floor(round.accuracy)); break;
    case "xp": next = m.progress + roundXpAwarded; break;
    case "weak_subject_round":
      next = m.meta?.subject && round.subject && round.subject.toLowerCase() === String(m.meta.subject).toLowerCase() ? m.progress + 1 : m.progress;
      break;
    case "new_game": {
      const recent: string[] = Array.isArray(m.meta?.recent_game_ids) ? m.meta!.recent_game_ids : [];
      next = recent.includes(round.game_id) ? m.progress : m.progress + 1;
      break;
    }
    case "active_days": next = Math.max(m.progress, activeDaysThisWeek ?? m.progress); break;
    default: return null;
  }
  next = Math.min(next, m.metric === "accuracy_round" ? 100 : Math.max(m.target, next));
  return next === m.progress ? null : next;
}

export const isMissionDone = (m: Pick<MissionRow, "progress" | "target">) => m.progress >= m.target;

// ── badges ──────────────────────────────────────────────────────────────────────────────────────────

export interface BadgeStats {
  total_rounds: number;
  best_accuracy: number;
  rounds_90: number;
  rounds_100: number;
  streak: number;               // longest streak
  missions_claimed: number;
  days_away_before_this: number;
  beat_personal_best: boolean;
  steady_climb_points: number;  // avg(last 7d) - avg(previous 7d), 0 if not enough data
  distinct_games: number;
}

const TIERS: Record<string, { stat: (s: BadgeStats) => number; target: number }> = {
  g2_rounds_bronze: { stat: (s) => s.total_rounds, target: 5 },
  g2_rounds_silver: { stat: (s) => s.total_rounds, target: 25 },
  g2_rounds_gold: { stat: (s) => s.total_rounds, target: 100 },
  g2_accuracy_bronze: { stat: (s) => s.best_accuracy, target: 80 },
  g2_accuracy_silver: { stat: (s) => s.rounds_90, target: 5 },
  g2_accuracy_gold: { stat: (s) => s.rounds_100, target: 3 },
  g2_streak_bronze: { stat: (s) => s.streak, target: 3 },
  g2_streak_silver: { stat: (s) => s.streak, target: 14 },
  g2_streak_gold: { stat: (s) => s.streak, target: 30 },
  g2_missions_bronze: { stat: (s) => s.missions_claimed, target: 5 },
  g2_missions_silver: { stat: (s) => s.missions_claimed, target: 25 },
  g2_missions_gold: { stat: (s) => s.missions_claimed, target: 75 },
  g2_comeback: { stat: (s) => s.days_away_before_this, target: 3 },
  g2_personal_best: { stat: (s) => (s.beat_personal_best && s.total_rounds >= 5 ? 5 : Math.min(4, s.total_rounds)), target: 5 },
  g2_steady_climber: { stat: (s) => Math.max(0, s.steady_climb_points), target: 10 },
  g2_explorer: { stat: (s) => s.distinct_games, target: 4 },
};

export function badgeProgress(key: string, s: BadgeStats): { current: number; target: number } | null {
  const t = TIERS[key];
  if (!t) return null;
  return { current: Math.min(t.target, Math.max(0, Math.round(t.stat(s)))), target: t.target };
}

export function badgesSatisfied(s: BadgeStats): string[] {
  return Object.keys(TIERS).filter((k) => {
    const p = badgeProgress(k, s)!;
    return p.current >= p.target;
  });
}

export function steadyClimbPoints(history: HistoryRound[], today: string, tz = 0): number {
  const pick = (from: number, to: number) => history
    .filter((h) => typeof h.accuracy === "number")
    .filter((h) => { const d = dayDiff(localDate(Date.parse(h.created_at), tz), today); return d >= from && d < to; })
    .map((h) => h.accuracy as number);
  const recent = pick(0, 7), prior = pick(7, 14);
  if (recent.length < 3 || prior.length < 3) return 0;
  return Math.round(avg(recent) - avg(prior));
}
