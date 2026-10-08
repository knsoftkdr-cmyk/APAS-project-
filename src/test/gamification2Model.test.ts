import { describe, it, expect } from "vitest";
import {
  applyActivity, applyDailyCap, badgeProgress, badgesSatisfied, computeBaseline, displayStreak, generateMissions,
  levelInfo, localDate, missionProgressAfterRound, roundXp, sanitizeRound, steadyClimbPoints, weekStart,
  type BadgeStats, type HistoryRound, type StreakState,
} from "../../supabase/functions/_shared/gamification2Model";

const S = (o: Partial<StreakState> = {}): StreakState => ({
  current_streak: 0, longest_streak: 0, last_activity_date: null, streak_freezes: 0, freeze_earned_at_streak: 0, ...o,
});
const round = (o: Partial<ReturnType<typeof sanitizeRound> & object> = {}) =>
  ({ game_id: "quick-quiz", subject: "Maths", accuracy: 80, score: 80, max_score: 100, questions_attempted: 10, duration_seconds: 60, ...o });
const hist = (daysAgo: number, o: Partial<HistoryRound> = {}): HistoryRound => ({
  game_id: "quick-quiz", subject: "Maths", accuracy: 80, xp_awarded: 25,
  created_at: new Date(Date.UTC(2026, 9, 7, 12) - daysAgo * 86400000).toISOString(), ...o,
});
const TODAY = "2026-10-07";

describe("dates", () => {
  it("uses the student's timezone for the day boundary", () => {
    const ms = Date.UTC(2026, 9, 7, 20, 0); // 20:00 UTC = 01:30 next day in IST
    expect(localDate(ms, 0)).toBe("2026-10-07");
    expect(localDate(ms, 330)).toBe("2026-10-08");
  });
  it("finds the Monday of the week", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });
});

describe("sanitizeRound / xp", () => {
  it("rejects junk and clamps numbers", () => {
    expect(sanitizeRound(null)).toBeNull();
    expect(sanitizeRound({ game_id: "../x" })).toBeNull();
    const r = sanitizeRound({ game_id: "Quick-Quiz", accuracy: 250, questions_attempted: 10, subject: "  " })!;
    expect(r.game_id).toBe("quick-quiz");
    expect(r.accuracy).toBe(100);
    expect(r.subject).toBeNull();
  });
  it("gives only participation XP for tiny rounds", () => {
    expect(roundXp({ accuracy: 100, questions_attempted: 1 })).toBe(5);
  });
  it("scales with accuracy and adds a 90% bonus", () => {
    expect(roundXp({ accuracy: 50, questions_attempted: 10 })).toBe(20);
    expect(roundXp({ accuracy: 100, questions_attempted: 10 })).toBe(40);
  });
  it("applies the daily cap", () => {
    expect(applyDailyCap(40, 0)).toBe(40);
    expect(applyDailyCap(40, 180)).toBe(20);
    expect(applyDailyCap(40, 500)).toBe(0);
  });
});

describe("progression", () => {
  it("keeps the 200 XP/level curve and maps titles", () => {
    const l = levelInfo(0);
    expect(l.level).toBe(1); expect(l.title).toBe("Rookie"); expect(l.xp_to_next_level).toBe(200);
    expect(levelInfo(450).level).toBe(3);
    expect(levelInfo(450).title).toBe("Explorer");
    expect(levelInfo(450).next_title?.title).toBe("Challenger");
    expect(levelInfo(4000).title).toBe("Legend");
    expect(levelInfo(4000).next_title).toBeNull();
  });
});

describe("streaks", () => {
  it("starts at 1 and counts consecutive days", () => {
    expect(applyActivity(S(), TODAY).current_streak).toBe(1);
    expect(applyActivity(S({ current_streak: 4, longest_streak: 4, last_activity_date: "2026-10-06" }), TODAY).current_streak).toBe(5);
  });
  it("does nothing twice on the same day", () => {
    const r = applyActivity(S({ current_streak: 4, longest_streak: 4, last_activity_date: TODAY }), TODAY);
    expect(r.current_streak).toBe(4);
  });
  it("resets after a missed day without a freeze", () => {
    const r = applyActivity(S({ current_streak: 6, longest_streak: 6, last_activity_date: "2026-10-05" }), TODAY);
    expect(r.current_streak).toBe(1); expect(r.streak_broken).toBe(true); expect(r.longest_streak).toBe(6);
  });
  it("spends a freeze to bridge one missed day", () => {
    const r = applyActivity(S({ current_streak: 6, longest_streak: 6, last_activity_date: "2026-10-05", streak_freezes: 1 }), TODAY);
    expect(r.current_streak).toBe(7); expect(r.freezes_used).toBe(1);
    // reaching 7 earns a freeze back
    expect(r.freeze_earned).toBe(true); expect(r.streak_freezes).toBe(1);
  });
  it("cannot bridge a long gap even with freezes", () => {
    const r = applyActivity(S({ current_streak: 6, last_activity_date: "2026-10-01", streak_freezes: 2 }), TODAY);
    expect(r.current_streak).toBe(1);
  });
  it("earns a freeze every 7 days, capped at 2", () => {
    const r = applyActivity(S({ current_streak: 6, last_activity_date: "2026-10-06", streak_freezes: 2 }), TODAY);
    expect(r.current_streak).toBe(7); expect(r.streak_freezes).toBe(2); expect(r.freeze_earned).toBe(false);
  });
  it("displays an unsavable streak as 0 and a savable one as at risk", () => {
    expect(displayStreak(S({ current_streak: 5, last_activity_date: "2026-10-06" }), TODAY)).toMatchObject({ current: 5, at_risk: true });
    expect(displayStreak(S({ current_streak: 5, last_activity_date: "2026-10-04" }), TODAY).current).toBe(0);
    expect(displayStreak(S({ current_streak: 5, last_activity_date: "2026-10-05", streak_freezes: 1 }), TODAY)).toMatchObject({ current: 5, at_risk: true });
  });
});

describe("adaptive missions", () => {
  it("gives a new student gentle defaults", () => {
    const m = generateMissions(computeBaseline([], TODAY));
    expect(m.daily.find((x) => x.mission_key === "daily_rounds")!.target).toBe(1);
    expect(m.daily.find((x) => x.mission_key === "daily_accuracy")!.target).toBe(70);
    expect(m.weekly.find((x) => x.mission_key === "weekly_active_days")!.target).toBe(3);
  });
  it("raises targets for a more active student and aims accuracy just above their average", () => {
    const h = [0, 1, 2, 3].flatMap((d) => [hist(d + 1, { accuracy: 82 }), hist(d + 1, { accuracy: 84 }), hist(d + 1, { accuracy: 80 })]);
    const m = generateMissions(computeBaseline(h, TODAY));
    expect(m.daily.find((x) => x.mission_key === "daily_rounds")!.target).toBe(4);
    expect(m.daily.find((x) => x.mission_key === "daily_accuracy")!.target).toBe(85);
  });
  it("targets the subject the student is weakest in", () => {
    const h = [
      hist(1, { subject: "Maths", accuracy: 95 }), hist(2, { subject: "Maths", accuracy: 92 }),
      hist(1, { subject: "Science", accuracy: 50 }), hist(2, { subject: "Science", accuracy: 60 }),
    ];
    const b = computeBaseline(h, TODAY);
    expect(b.weak_subject?.subject).toBe("science");
    const weak = generateMissions(b).daily.find((x) => x.mission_key === "daily_weak_subject")!;
    expect(weak.meta.subject).toBe("science");
  });
  it("needs 2+ rounds before calling a subject weak", () => {
    const b = computeBaseline([hist(1, { subject: "Science", accuracy: 20 })], TODAY);
    expect(b.weak_subject).toBeNull();
  });
  it("advances each metric correctly and ignores non-active missions", () => {
    const r = round() as any;
    expect(missionProgressAfterRound({ metric: "rounds", target: 3, progress: 1, status: "active", meta: {} }, r, 30)).toBe(2);
    expect(missionProgressAfterRound({ metric: "rounds", target: 3, progress: 1, status: "completed", meta: {} }, r, 30)).toBeNull();
    expect(missionProgressAfterRound({ metric: "accuracy_round", target: 85, progress: 70, status: "active", meta: {} }, r, 30)).toBe(80);
    expect(missionProgressAfterRound({ metric: "accuracy_round", target: 85, progress: 90, status: "active", meta: {} }, r, 30)).toBeNull();
    expect(missionProgressAfterRound({ metric: "xp", target: 40, progress: 10, status: "active", meta: {} }, r, 30)).toBe(40);
    expect(missionProgressAfterRound({ metric: "weak_subject_round", target: 1, progress: 0, status: "active", meta: { subject: "science" } }, r, 30)).toBeNull();
    expect(missionProgressAfterRound({ metric: "weak_subject_round", target: 1, progress: 0, status: "active", meta: { subject: "maths" } }, r, 30)).toBe(1);
    expect(missionProgressAfterRound({ metric: "new_game", target: 1, progress: 0, status: "active", meta: { recent_game_ids: ["quick-quiz"] } }, r, 30)).toBeNull();
    expect(missionProgressAfterRound({ metric: "new_game", target: 1, progress: 0, status: "active", meta: { recent_game_ids: ["speed-tap"] } }, r, 30)).toBe(1);
    expect(missionProgressAfterRound({ metric: "active_days", target: 3, progress: 1, status: "active", meta: {} }, r, 30, 2)).toBe(2);
  });
});

describe("badges", () => {
  const stats = (o: Partial<BadgeStats> = {}): BadgeStats => ({
    total_rounds: 0, best_accuracy: 0, rounds_90: 0, rounds_100: 0, streak: 0, missions_claimed: 0,
    days_away_before_this: 0, beat_personal_best: false, steady_climb_points: 0, distinct_games: 0, ...o,
  });
  it("awards tiers as thresholds are met", () => {
    expect(badgesSatisfied(stats())).toEqual([]);
    const k = badgesSatisfied(stats({ total_rounds: 30, best_accuracy: 85, streak: 3 }));
    expect(k).toEqual(expect.arrayContaining(["g2_rounds_bronze", "g2_rounds_silver", "g2_accuracy_bronze", "g2_streak_bronze"]));
    expect(k).not.toContain("g2_rounds_gold");
  });
  it("comeback and personal best are adaptive", () => {
    expect(badgesSatisfied(stats({ days_away_before_this: 4 }))).toContain("g2_comeback");
    expect(badgesSatisfied(stats({ total_rounds: 8, beat_personal_best: true }))).toContain("g2_personal_best");
    expect(badgesSatisfied(stats({ total_rounds: 3, beat_personal_best: true }))).not.toContain("g2_personal_best");
  });
  it("reports progress capped at the target", () => {
    expect(badgeProgress("g2_rounds_silver", stats({ total_rounds: 10 }))).toEqual({ current: 10, target: 25 });
    expect(badgeProgress("g2_rounds_silver", stats({ total_rounds: 99 }))).toEqual({ current: 25, target: 25 });
    expect(badgeProgress("nope", stats())).toBeNull();
  });
  it("detects a steady climb across two weeks", () => {
    const h = [
      hist(1, { accuracy: 90 }), hist(2, { accuracy: 88 }), hist(3, { accuracy: 92 }),
      hist(8, { accuracy: 70 }), hist(9, { accuracy: 72 }), hist(10, { accuracy: 68 }),
    ];
    expect(steadyClimbPoints(h, TODAY)).toBe(20);
    expect(steadyClimbPoints(h.slice(0, 3), TODAY)).toBe(0);
  });
});
