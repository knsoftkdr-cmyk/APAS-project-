import { describe, it, expect } from "vitest";
import { buildStudentTwin, thetaToPct, type TwinInput } from "../../supabase/functions/_shared/studentTwinModel";

const D = 86400000;
const now = Date.UTC(2026, 9, 1);
const seq = (subject: string, scores: number[], gapDays = 7, endAgo = 3) =>
  scores.map((pct, i) => ({ subject, pct, at: now - (endAgo + (scores.length - 1 - i) * gapDays) * D }));
const base = (over: Partial<TwinInput> = {}): TwinInput => ({
  now, tests: [], mastery: [], adaptive: [], attendance: null, vark: null, history: [], ...over,
});

describe("buildStudentTwin", () => {
  it("says there is not enough data instead of guessing", () => {
    const t = buildStudentTwin(base({ tests: seq("Maths", [50]) }));
    expect(t.sufficient_data).toBe(false);
    expect(t.overall_ability).toBeNull();
    expect(t.risk.level).toBe("unknown");
    expect(t.next_steps[0].action).toMatch(/more tests/i);
  });
  it("weights recent tests more heavily", () => {
    const t = buildStudentTwin(base({ tests: seq("Maths", [40, 50, 90]) }));
    const plain = (40 + 50 + 90) / 3;
    expect(t.subjects[0].ability!).toBeGreaterThan(plain);
  });
  it("blends adaptive ability when enough items exist", () => {
    const tests = seq("Maths", [50, 50, 50]);
    const without = buildStudentTwin(base({ tests })).subjects[0].ability!;
    const withAd = buildStudentTwin(base({ tests, adaptive: [{ subject: "Maths", theta: 2, items: 10 }] }));
    expect(withAd.subjects[0].sources).toEqual(["tests", "adaptive"]);
    expect(withAd.subjects[0].ability!).toBeGreaterThan(without);
    const ignored = buildStudentTwin(base({ tests, adaptive: [{ subject: "Maths", theta: 2, items: 3 }] }));
    expect(ignored.subjects[0].ability).toBe(without);
  });
  it("thetaToPct is 50 at zero and monotonic", () => {
    expect(thetaToPct(0)).toBeCloseTo(50);
    expect(thetaToPct(1)).toBeGreaterThan(thetaToPct(0));
  });
  it("names a preference only with enough tests and a clear margin", () => {
    const strong = buildStudentTwin(base({ tests: [...seq("Maths", [90, 92, 91]), ...seq("Hindi", [50, 52, 51]), ...seq("Art", [70, 70, 70])] }));
    expect(strong.preferences.strengths.map((s) => s.subject)).toEqual(["Maths"]);
    expect(strong.preferences.challenges.map((s) => s.subject)).toEqual(["Hindi"]);
    const thin = buildStudentTwin(base({ tests: [...seq("Maths", [90, 92]), ...seq("Hindi", [50, 52])] }));
    expect(thin.preferences.strengths).toEqual([]);
    expect(thin.preferences.note).toMatch(/not enough evidence/i);
  });
  it("flags high risk with a stated reason for low ability", () => {
    const t = buildStudentTwin(base({ tests: seq("Maths", [30, 32, 28]) }));
    expect(t.risk.level).toBe("high");
    expect(t.risk.reasons.join(" ")).toMatch(/Overall ability/);
  });
  it("every next step carries a reason", () => {
    const t = buildStudentTwin(base({
      tests: [...seq("Maths", [50, 45, 40]), ...seq("Art", [90, 92, 94])],
      mastery: [{ p: 0.9, opportunities: 3, lastAt: now - 60 * D }, { p: 0.4, opportunities: 2, lastAt: now - 50 * D }],
      attendance: { present: 10, total: 20 },
    }));
    expect(t.next_steps.length).toBeGreaterThan(0);
    for (const n of t.next_steps) expect(n.reason.length).toBeGreaterThan(5);
    expect(t.retention.stale_pct).toBe(100);
    expect(t.engagement.attendance_pct).toBe(50);
  });
  it("low risk for a steady strong learner", () => {
    const t = buildStudentTwin(base({
      tests: seq("Maths", [80, 82, 84, 85]), mastery: [{ p: 0.9, opportunities: 5, lastAt: now - 2 * D }],
      attendance: { present: 19, total: 20 },
    }));
    expect(t.risk.level).toBe("low");
  });
});
