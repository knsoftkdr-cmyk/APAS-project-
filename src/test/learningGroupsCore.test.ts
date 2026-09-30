import { describe, it, expect } from "vitest";
import {
  assignTiers, clusterPeerGroups, compositeScore, summariseTiers, validateTierOptions,
  type StudentSignal, type Tier,
} from "../../supabase/functions/_shared/learningGroupsCore";

const T = (id: number, score: number) => ({ topic_id: id, topic_name: `Topic ${id}`, chapter_name: "Ch 1", score });
const S = (
  id: string, score: number | null, topics: ReturnType<typeof T>[] = [],
  extra: Partial<StudentSignal> = {},
): StudentSignal => ({ student_id: id, full_name: `Student ${id}`, score, topics, pace: null, risk: null, ...extra });

describe("clusterPeerGroups", () => {
  it("groups students who are weak in the same topics and separates different needs", () => {
    const students = [
      S("a1", 0.35, [T(1, 0.2), T(2, 0.3), T(3, 0.8)]),
      S("a2", 0.38, [T(1, 0.25), T(2, 0.35), T(3, 0.7)]),
      S("a3", 0.4, [T(1, 0.3), T(2, 0.4), T(3, 0.6)]),
      S("b1", 0.4, [T(4, 0.2), T(5, 0.3), T(1, 0.9)]),
      S("b2", 0.42, [T(4, 0.3), T(5, 0.35), T(1, 0.8)]),
    ];
    const r = clusterPeerGroups(students);
    const support = r.groups.filter((g) => g.kind === "support");
    expect(support).toHaveLength(2);
    const ids = support.map((g) => g.members.map((m) => m.student_id).sort().join(","));
    expect(ids.sort()).toEqual(["a1,a2,a3", "b1,b2"]);
    const gA = support.find((g) => g.members.some((m) => m.student_id === "a1"))!;
    expect(gA.shared_needs.map((n) => n.topic_id).sort()).toEqual([1, 2]);
    expect(gA.label).toContain("Topic");
    expect(gA.members.every((m) => m.fit === 1)).toBe(true);
  });

  it("leaves a student with a unique gap as an individual, not forced into a group", () => {
    const r = clusterPeerGroups([
      S("a1", 0.3, [T(1, 0.2), T(2, 0.3)]),
      S("a2", 0.3, [T(1, 0.2), T(2, 0.3)]),
      S("z", 0.4, [T(9, 0.1)]),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.individual.map((i) => i.student_id)).toEqual(["z"]);
  });

  it("never places students with no assessed data into any group", () => {
    const r = clusterPeerGroups([S("u1", null), S("u2", null), S("a", 0.3, [T(1, 0.2)]), S("b", 0.3, [T(1, 0.2)])]);
    expect(r.unassessed.map((u) => u.student_id).sort()).toEqual(["u1", "u2"]);
    expect(r.groups.flatMap((g) => g.members.map((m) => m.student_id))).not.toContain("u1");
  });

  it("forms an extension group from strong students with no gaps, and keeps on-track students out of it", () => {
    const r = clusterPeerGroups([
      S("s1", 0.9, [T(1, 0.9), T(2, 0.85)]),
      S("s2", 0.88, [T(1, 0.85), T(2, 0.9)]),
      S("ok", 0.65, [T(1, 0.6), T(2, 0.7)]),
    ]);
    const ext = r.groups.filter((g) => g.kind === "extension");
    expect(ext).toHaveLength(1);
    expect(ext[0].members.map((m) => m.student_id).sort()).toEqual(["s1", "s2"]);
    expect(r.on_track.map((s) => s.student_id)).toEqual(["ok"]);
  });

  it("respects maxGroupSize", () => {
    const many = Array.from({ length: 12 }, (_, i) => S(`s${String(i).padStart(2, "0")}`, 0.3, [T(1, 0.2), T(2, 0.3)]));
    const r = clusterPeerGroups(many, { maxGroupSize: 5 });
    expect(Math.max(...r.groups.map((g) => g.size))).toBeLessThanOrEqual(5);
    const placed = r.groups.reduce((n, g) => n + g.size, 0) + r.individual.length;
    expect(placed).toBe(12);
  });

  it("is deterministic regardless of input order", () => {
    const base = [
      S("a1", 0.35, [T(1, 0.2), T(2, 0.3)]), S("a2", 0.38, [T(1, 0.25), T(2, 0.35)]),
      S("b1", 0.4, [T(4, 0.2), T(5, 0.3)]), S("b2", 0.42, [T(4, 0.3), T(5, 0.35)]),
    ];
    const a = clusterPeerGroups(base);
    const b = clusterPeerGroups([...base].reverse());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("compositeScore", () => {
  it("uses mastery alone when there is no velocity data", () => {
    expect(compositeScore(0.6, null)).toBe(0.6);
  });
  it("blends 75% mastery and 25% pace, with pace capped", () => {
    expect(compositeScore(0.6, 0.2)).toBe(0.7);    // 0.45 + 0.25
    expect(compositeScore(0.6, 5)).toBe(0.7);      // capped
    expect(compositeScore(0.6, 0)).toBe(0.45);
    expect(compositeScore(0.6, -0.3)).toBe(0.45);  // negative gain floors at 0
  });
});

describe("assignTiers", () => {
  const none = new Map();
  const tierOf = (s: StudentSignal & { gain?: number | null }, prior = none) => assignTiers([s], prior)[0];

  it("places by threshold", () => {
    expect(tierOf(S("a", 0.3)).tier).toBe("remedial");
    expect(tierOf(S("b", 0.6)).tier).toBe("regular");
    expect(tierOf(S("c", 0.9)).tier).toBe("enrichment");
  });

  it("keeps un-assessed students provisional and never invents a change", () => {
    const fresh = tierOf(S("u", null));
    expect(fresh.tier).toBe("regular");
    expect(fresh.provisional).toBe(true);
    const kept = tierOf(S("u", null), new Map([["u", { tier: "remedial" as Tier, pinned: false }]]));
    expect(kept.tier).toBe("remedial");
    expect(kept.moved).toBeNull();
  });

  it("applies hysteresis so a student just past the line does not flip", () => {
    const prior = new Map([["a", { tier: "remedial" as Tier, pinned: false }]]);
    expect(tierOf(S("a", 0.47), prior).tier).toBe("remedial");   // above 0.45 but inside the 0.05 buffer
    expect(tierOf(S("a", 0.51), prior).tier).toBe("regular");    // clearly past
    const up = new Map([["e", { tier: "enrichment" as Tier, pinned: false }]]);
    expect(tierOf(S("e", 0.77), up).tier).toBe("enrichment");
    expect(tierOf(S("e", 0.7), up).tier).toBe("regular");
  });

  it("reports direction of movement", () => {
    const r = tierOf(S("a", 0.9), new Map([["a", { tier: "regular" as Tier, pinned: false }]]));
    expect(r.tier).toBe("enrichment");
    expect(r.moved).toBe("up");
    const d = tierOf(S("b", 0.2), new Map([["b", { tier: "regular" as Tier, pinned: false }]]));
    expect(d.moved).toBe("down");
  });

  it("high risk blocks enrichment and holds borderline students in remedial", () => {
    expect(tierOf(S("a", 0.9, [], { risk: "high" })).tier).toBe("regular");
    expect(tierOf(S("b", 0.55, [], { risk: "high" })).tier).toBe("remedial");
    expect(tierOf(S("c", 0.7, [], { risk: "high" })).tier).toBe("regular");
  });

  it("a teacher pin wins, but the rule-based suggestion stays visible", () => {
    const r = tierOf(S("a", 0.9), new Map([["a", { tier: "remedial" as Tier, pinned: true }]]));
    expect(r.tier).toBe("remedial");
    expect(r.pinned).toBe(true);
    expect(r.suggested_tier).toBe("enrichment");
  });

  it("uses measured pace to lift or lower the composite", () => {
    expect(tierOf({ ...S("a", 0.78), gain: 0.25 }).tier).toBe("enrichment"); // 0.585+0.25 = 0.835
    expect(tierOf({ ...S("b", 0.5), gain: 0 }).tier).toBe("remedial");       // 0.375
  });
});

describe("validateTierOptions", () => {
  it("accepts defaults and rejects overlapping thresholds", () => {
    expect(validateTierOptions({}).ok).toBe(true);
    expect(validateTierOptions({ remedialBelow: 0.7, enrichmentAtLeast: 0.75 }).ok).toBe(false);
    expect(validateTierOptions({ remedialBelow: 0 }).ok).toBe(false);
    expect(validateTierOptions({ remedialBelow: Number.NaN }).ok).toBe(false);
  });
});

describe("summariseTiers", () => {
  it("summarises focus topics per tier", () => {
    const sig = [
      S("a", 0.3, [T(1, 0.2), T(2, 0.6)]), S("b", 0.35, [T(1, 0.3), T(2, 0.7)]),
      S("c", 0.9, [T(1, 0.95), T(2, 0.9)]),
    ];
    const placements = assignTiers(sig, new Map());
    const sum = summariseTiers(placements, sig);
    const rem = sum.find((s) => s.tier === "remedial")!;
    expect(rem.count).toBe(2);
    expect(rem.focus_topics[0].topic_id).toBe(1);
    const enr = sum.find((s) => s.tier === "enrichment")!;
    expect(enr.student_ids).toEqual(["c"]);
  });
});
