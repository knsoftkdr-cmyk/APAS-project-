import { describe, it, expect } from "vitest";
import {
  CONFIG, evaluateMission, flattenMasteryRow, levelUpCandidates, pickTarget, tierOf, topicAverage, topicCandidates,
  type EvidenceRow, type MasteryRow, type MissionRecord, type TopicAgg,
} from "../../supabase/functions/_shared/competencyMissionModel";

const NOW = Date.parse("2026-10-12T10:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const row = (id: number, p: number, extra: Partial<MasteryRow> = {}): MasteryRow => ({
  learning_objective_id: id, p_mastery: p, opportunities_count: 3, last_evidence_at: iso(NOW - 2 * DAY),
  objective_text: `Skill ${id}`, subtopic_name: "Sub", topic_id: id, topic_name: `Topic ${id}`, subject: "Maths", ...extra,
});

describe("tiers and targets", () => {
  it("uses the same bands as the student_mastery_labeled view", () => {
    expect(tierOf(0.3, 0)).toBe("not_assessed");
    expect(tierOf(0.2, 2)).toBe("beginning");
    expect(tierOf(0.35, 2)).toBe("developing");
    expect(tierOf(0.6, 2)).toBe("proficient");
    expect(tierOf(0.85, 2)).toBe("mastered");
  });
  it("picks the next tier at least 0.10 away", () => {
    expect(pickTarget(0.2)).toEqual({ tier: "developing", value: 0.35 });
    expect(pickTarget(0.3)?.tier).toBe("proficient");          // 0.35 is only 0.05 away: skip the trivial step
    expect(pickTarget(0.45)?.tier).toBe("proficient");
    expect(pickTarget(0.55)?.tier).toBe("mastered");
    expect(pickTarget(0.8)?.tier).toBe("mastered");            // close, but nothing higher to chase
    expect(pickTarget(0.9)).toBeNull();
  });
});

describe("levelUpCandidates", () => {
  it("only offers skills the student has actually been assessed on", () => {
    const rows = [row(1, 0.5), row(2, 0.5, { opportunities_count: 0 })];
    expect(levelUpCandidates(rows, new Set(), 3, NOW).map((d) => d.learning_objective_id)).toEqual([1]);
  });
  it("never offers a mastered skill", () => {
    expect(levelUpCandidates([row(1, 0.9)], new Set(), 3, NOW)).toEqual([]);
  });
  it("skips a scope that is already live or already paid", () => {
    const rows = [row(1, 0.45), row(2, 0.45)];
    const out = levelUpCandidates(rows, new Set(["lo:1:proficient"]), 3, NOW);
    expect(out.map((d) => d.learning_objective_id)).toEqual([2]);
  });
  it("prefers weaker, recently practised skills close to a tier", () => {
    const rows = [
      row(1, 0.7),                                                       // proficient already
      row(2, 0.45),                                                      // developing, mid-way
      row(3, 0.2, { last_evidence_at: iso(NOW - 40 * DAY) }),            // weak but stale
    ];
    const ids = levelUpCandidates(rows, new Set(), 3, NOW).map((d) => d.learning_objective_id);
    expect(ids[0]).toBe(2);
    expect(ids).toHaveLength(3);
  });
  it("caps the number and takes at most one skill per topic", () => {
    const rows = [row(1, 0.4, { topic_id: 9 }), row(2, 0.41, { topic_id: 9 }), row(3, 0.42, { topic_id: 8 }), row(4, 0.43, { topic_id: 7 })];
    const out = levelUpCandidates(rows, new Set(), 2, NOW);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((d) => d.topic_id)).size).toBe(2);
  });
  it("sets sensible rewards and proof requirements by tier", () => {
    const d = levelUpCandidates([row(1, 0.45)], new Set(), 1, NOW)[0];
    expect(d).toMatchObject({ tier_to: "proficient", xp_reward: 60, min_evidence: 3, min_correct: 2, min_days: 2, scope_key: "lo:1:proficient" });
    const low = levelUpCandidates([row(2, 0.2)], new Set(), 1, NOW)[0];
    expect(low).toMatchObject({ tier_to: "developing", xp_reward: 25, min_days: 1 });
    const hi = levelUpCandidates([row(3, 0.7)], new Set(), 1, NOW)[0];
    expect(hi).toMatchObject({ tier_to: "mastered", xp_reward: 100 });
  });
  it("returns an empty list for a student with no mastery data", () => {
    expect(levelUpCandidates([], new Set(), 3, NOW)).toEqual([]);
  });
});

describe("topic quests", () => {
  const agg = (id: number, ps: (number | null)[]): TopicAgg => ({
    topic_id: id, topic_name: `T${id}`, subject: "Maths", objective_ids: ps.map((_, i) => id * 100 + i),
    mastery: new Map(ps.flatMap((p, i) => (p == null ? [] : [[id * 100 + i, { p, opps: 2 }] as const]))),
  });
  it("counts unattempted skills at the prior", () => {
    const a = agg(1, [0.9, 0.9, null, null]);
    expect(topicAverage(a.objective_ids, a.mastery).avg).toBeCloseTo((0.9 + 0.9 + 0.3 + 0.3) / 4);
    expect(topicAverage(a.objective_ids, a.mastery).attempted).toBe(2);
  });
  it("needs enough skills and enough attempted", () => {
    expect(topicCandidates([agg(1, [0.4, 0.4])], new Set(), 1)).toEqual([]);          // too few skills
    expect(topicCandidates([agg(2, [0.4, null, null, null])], new Set(), 1)).toEqual([]); // only 1 attempted
  });
  it("targets the next rung and requires coverage", () => {
    const d = topicCandidates([agg(3, [0.4, 0.4, 0.4, null, null])], new Set(), 1)[0];
    expect(d.kind).toBe("topic_quest");
    expect(d.target_value).toBe(0.5);
    expect(d.xp_reward).toBe(80);
    expect(d.meta.coverage_needed).toBe(3);        // ceil(5 * 0.6)
    expect(d.min_days).toBe(2);
  });
  it("offers nothing once a topic is already strong", () => {
    expect(topicCandidates([agg(4, [0.9, 0.9, 0.9, 0.9])], new Set(), 1)).toEqual([]);
  });
});

describe("evaluateMission (level_up)", () => {
  const created = NOW - 5 * DAY;
  const m: MissionRecord = {
    kind: "level_up", learning_objective_id: 1, start_value: 0.45, target_value: 0.6,
    min_evidence: 3, min_correct: 2, min_days: 2, meta: {}, created_at: iso(created), expires_at: iso(created + 21 * DAY),
  };
  const ev = (daysAgo: number, ok: boolean, id = 1): EvidenceRow => ({ learning_objective_id: id, is_correct: ok, responded_at: iso(NOW - daysAgo * DAY) });
  const mastery = (p: number) => new Map([[1, { p, opps: 5 }]]);

  it("completes only when mastery AND evidence AND days are all met", () => {
    const e = evaluateMission(m, mastery(0.7), [ev(3, true), ev(1, true), ev(1, false)], 0, NOW);
    expect(e.done).toBe(true);
    expect(e.progress).toBe(1);
  });
  it("does not complete from mastery alone, however high (the anti-gaming rule)", () => {
    const e = evaluateMission(m, mastery(0.95), [], 0, NOW);
    expect(e.done).toBe(false);
    expect(e.progress).toBeLessThan(1);
    expect(e.hint).toMatch(/more question/);
  });
  it("needs the answers on different days", () => {
    const sameDay = [ev(1, true), ev(1, true), ev(1, true)];
    const e = evaluateMission(m, mastery(0.7), sameDay, 0, NOW);
    expect(e.done).toBe(false);
    expect(e.days).toEqual({ have: 1, need: 2 });
    expect(e.hint).toMatch(/another day/);
  });
  it("needs enough correct answers", () => {
    const e = evaluateMission(m, mastery(0.7), [ev(3, true), ev(2, false), ev(1, false)], 0, NOW);
    expect(e.done).toBe(false);
    expect(e.correct.have).toBe(1);
  });
  it("ignores evidence from before the mission started or for other skills", () => {
    const e = evaluateMission(m, mastery(0.7), [ev(9, true), ev(8, true), ev(7, true), ev(3, true, 99)], 0, NOW);
    expect(e.evidence.have).toBe(0);
    expect(e.done).toBe(false);
  });
  it("reports progress between start and goal, below 1 until verified", () => {
    const e = evaluateMission(m, mastery(0.525), [], 0, NOW);
    expect(e.progress).toBeCloseTo(0.5, 2);
    expect(e.done).toBe(false);
  });
  it("expires after the deadline unless it was completed", () => {
    const late = NOW + 30 * DAY;
    expect(evaluateMission(m, mastery(0.5), [], 0, late).expired).toBe(true);
    expect(evaluateMission(m, mastery(0.7), [ev(3, true), ev(1, true), ev(1, true)], 0, late).expired).toBe(false);
  });
  it("counts days in the student's own time zone", () => {
    // two answers 3 hours apart across local midnight in India (UTC+5:30) are two days, but one UTC day
    const a: EvidenceRow = { learning_objective_id: 1, is_correct: true, responded_at: "2026-10-10T18:00:00Z" }; // 23:30 IST, 10th
    const b: EvidenceRow = { learning_objective_id: 1, is_correct: true, responded_at: "2026-10-10T19:00:00Z" }; // 00:30 IST, 11th
    const mm = { ...m, created_at: "2026-10-09T00:00:00Z", expires_at: "2026-11-09T00:00:00Z" };
    expect(evaluateMission(mm, mastery(0.7), [a, b, a], 330, NOW).days.have).toBe(2);
    expect(evaluateMission(mm, mastery(0.7), [a, b, a], 0, NOW).days.have).toBe(1);
  });
});

describe("evaluateMission (topic_quest)", () => {
  const created = NOW - 6 * DAY;
  const ids = [1, 2, 3, 4, 5];
  const m: MissionRecord = {
    kind: "topic_quest", learning_objective_id: null, start_value: 0.4, target_value: 0.5,
    min_evidence: 6, min_correct: 4, min_days: 2, meta: { objective_ids: ids, coverage_needed: 3 },
    created_at: iso(created), expires_at: iso(created + 21 * DAY),
  };
  const ev = (id: number, daysAgo: number, ok = true): EvidenceRow => ({ learning_objective_id: id, is_correct: ok, responded_at: iso(NOW - daysAgo * DAY) });
  const evidence = [ev(1, 4), ev(1, 3), ev(2, 3), ev(2, 2), ev(3, 1), ev(3, 1)];

  it("completes when the topic average, coverage, evidence and days are all met", () => {
    const mastery = new Map(ids.map((i) => [i, { p: 0.6, opps: 4 }]));
    const e = evaluateMission(m, mastery, evidence, 0, NOW);
    expect(e.done).toBe(true);
    expect(e.coverage).toEqual({ have: 5, need: 3 });
  });
  it("fails on coverage when only one skill was improved", () => {
    const mastery = new Map([[1, { p: 0.99, opps: 9 }], [2, { p: 0.3, opps: 0 }], [3, { p: 0.3, opps: 0 }], [4, { p: 0.3, opps: 0 }], [5, { p: 0.3, opps: 0 }]]);
    const e = evaluateMission({ ...m, target_value: 0.45 }, mastery, evidence, 0, NOW);
    expect(e.done).toBe(false);
  });
});

describe("flattenMasteryRow", () => {
  const raw = (wrap: (x: any) => any) => ({
    learning_objective_id: 7, p_mastery: "0.5", opportunities_count: 2, last_evidence_at: null,
    learning_objectives: wrap({
      objective_text: "Add fractions", subtopics: wrap({
        subtopic_name: "Fractions", topic_id: 4, topics: wrap({ id: 4, topic_name: "Number", curriculum_chapters: wrap({ units: wrap({ books: wrap({ subject: "Maths" }) }) }) }),
      }),
    }),
  });
  it("flattens object embeds and array embeds alike", () => {
    for (const wrap of [(x: any) => x, (x: any) => [x]]) {
      expect(flattenMasteryRow(raw(wrap))).toMatchObject({ learning_objective_id: 7, p_mastery: 0.5, topic_id: 4, topic_name: "Number", subject: "Maths", objective_text: "Add fractions" });
    }
  });
  it("returns null when the objective is missing", () => {
    expect(flattenMasteryRow({ learning_objective_id: 1, p_mastery: 0.5, learning_objectives: null })).toBeNull();
  });
  it("copes with a partly missing curriculum chain", () => {
    const r = flattenMasteryRow({ learning_objective_id: 1, p_mastery: 0.4, opportunities_count: 1, learning_objectives: { objective_text: "X", subtopics: null } });
    expect(r).toMatchObject({ topic_id: null, subject: null, objective_text: "X" });
  });
});

it("keeps the daily cap above the biggest single reward", () => {
  expect(CONFIG.dailyXpCap).toBeGreaterThan(Math.max(...Object.values(CONFIG.levelUpXp), ...Object.values(CONFIG.topic.xp)));
});
