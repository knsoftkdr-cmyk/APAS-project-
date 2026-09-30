// supabase/functions/_shared/learningGroupsCore.ts
//
// Pure grouping logic for Peer Group Identification and Dynamic Student Grouping.
// No imports and no I/O on purpose: it is used by the edge-function handlers
// (peerGroups.ts, dynamicGroups.ts, teacherCopilot.ts) and unit-tested from vitest.
//
// Scores are BKT mastery on a 0..1 scale (student_mastery.p_mastery, averaged),
// the same scale get_class_mastery / cohort_student_scores use, so a "weak" topic
// here (< 0.5) is the same "weak spot" the Class Mastery dashboard already shows.

export type Pace = "slow" | "average" | "fast" | "insufficient_data";
export type RiskLevel = "high" | "medium" | "low" | "insufficient_data";
export type Tier = "remedial" | "regular" | "enrichment";

export const TIER_ORDER: Tier[] = ["remedial", "regular", "enrichment"];

export interface TopicScore {
  topic_id: number;
  topic_name: string;
  chapter_name: string;
  score: number; // 0..1
}

export interface StudentSignal {
  student_id: string;
  full_name: string;
  /** Average mastery over assessed objectives; null = not enough assessed objectives. */
  score: number | null;
  topics: TopicScore[];
  pace: Pace | null;
  risk: RiskLevel | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Peer groups: students who are weak in the same things
// ─────────────────────────────────────────────────────────────────────────────

export interface PeerGroupOptions {
  weakBelow: number;        // a topic is a "gap" under this score
  strongAtLeast: number;    // student with no gaps and >= this is an extension candidate
  similarity: number;       // min average Jaccard similarity to merge clusters
  maxGroupSize: number;     // a merge that would exceed this is skipped
  sharedShare: number;      // a topic is a group's shared need when this share of members are weak in it
}

export const DEFAULT_PEER_OPTIONS: PeerGroupOptions = {
  weakBelow: 0.5,
  strongAtLeast: 0.8,
  similarity: 0.4,
  maxGroupSize: 10,
  sharedShare: 0.5,
};

export interface SharedNeed {
  topic_id: number;
  topic_name: string;
  chapter_name: string;
  weak_count: number;
  member_count: number;
  avg_score: number;
}

export interface PeerGroupMember {
  student_id: string;
  full_name: string;
  score: number | null;
  pace: Pace | null;
  risk: RiskLevel | null;
  /** Share of the group's shared needs this student is weak in (0..1). */
  fit: number;
  weak_topic_ids: number[];
}

export interface PeerGroup {
  id: string;
  kind: "support" | "extension";
  label: string;
  cohesion: number; // mean pairwise similarity of members, 0..1
  size: number;
  avg_score: number | null;
  pace_mix: Record<string, number>;
  shared_needs: SharedNeed[];
  members: PeerGroupMember[];
}

export interface PeerGroupResult {
  groups: PeerGroup[];
  /** Have gaps, but nobody else in the class shares them closely enough to group. */
  individual: Array<{ student_id: string; full_name: string; score: number | null; weak_topics: TopicScore[] }>;
  /** Assessed, no gaps, not strong enough for extension. */
  on_track: Array<{ student_id: string; full_name: string; score: number | null }>;
  /** Too little assessed evidence to place anyone anywhere honestly. */
  unassessed: Array<{ student_id: string; full_name: string }>;
  options: PeerGroupOptions;
}

const round = (n: number, dp = 3) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function weakSet(s: StudentSignal, weakBelow: number): Set<number> {
  return new Set(s.topics.filter((t) => t.score < weakBelow).map((t) => t.topic_id));
}

export function clusterPeerGroups(
  students: StudentSignal[],
  overrides: Partial<PeerGroupOptions> = {},
): PeerGroupResult {
  const opts: PeerGroupOptions = { ...DEFAULT_PEER_OPTIONS, ...overrides };

  const unassessed = students.filter((s) => s.score === null)
    .map((s) => ({ student_id: s.student_id, full_name: s.full_name }));
  const assessed = students.filter((s) => s.score !== null)
    // stable order so results are deterministic regardless of DB row order
    .sort((a, b) => a.student_id.localeCompare(b.student_id));

  const weak = new Map<string, Set<number>>();
  for (const s of assessed) weak.set(s.student_id, weakSet(s, opts.weakBelow));

  const withGaps = assessed.filter((s) => (weak.get(s.student_id)?.size ?? 0) > 0);
  const noGaps = assessed.filter((s) => (weak.get(s.student_id)?.size ?? 0) === 0);

  // ── Average-linkage agglomerative clustering on Jaccard similarity of weak-topic sets ──
  let clusters: StudentSignal[][] = withGaps.map((s) => [s]);
  const sim = (x: StudentSignal, y: StudentSignal) => jaccard(weak.get(x.student_id)!, weak.get(y.student_id)!);
  const linkage = (A: StudentSignal[], B: StudentSignal[]) => {
    let sum = 0;
    for (const a of A) for (const b of B) sum += sim(a, b);
    return sum / (A.length * B.length);
  };

  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[i].length + clusters[j].length > opts.maxGroupSize) continue;
        const l = linkage(clusters[i], clusters[j]);
        if (l > best + 1e-12) { best = l; bi = i; bj = j; }
      }
    }
    if (bi < 0 || best < opts.similarity) break;
    clusters[bi] = [...clusters[bi], ...clusters[bj]];
    clusters.splice(bj, 1);
  }

  const groups: PeerGroup[] = [];
  const individual: PeerGroupResult["individual"] = [];

  clusters.forEach((members) => {
    if (members.length < 2) {
      const s = members[0];
      individual.push({
        student_id: s.student_id, full_name: s.full_name, score: s.score,
        weak_topics: s.topics.filter((t) => t.score < opts.weakBelow).sort((a, b) => a.score - b.score),
      });
      return;
    }
    groups.push(buildSupportGroup(members, weak, opts));
  });

  // Strong students with no gaps share a need too: to be stretched. Group them (chunked by size).
  const extension = noGaps.filter((s) => (s.score as number) >= opts.strongAtLeast);
  const onTrack = noGaps.filter((s) => (s.score as number) < opts.strongAtLeast);
  for (let i = 0; i < extension.length; i += opts.maxGroupSize) {
    const chunk = extension.slice(i, i + opts.maxGroupSize);
    if (chunk.length < 2) { onTrack.push(...chunk); continue; }
    groups.push(buildExtensionGroup(chunk));
  }

  groups.sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === "support" ? -1 : 1) ||
    (a.avg_score ?? 1) - (b.avg_score ?? 1) || a.id.localeCompare(b.id));
  groups.forEach((g, i) => { g.id = `pg-${i + 1}`; });

  individual.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));

  return {
    groups,
    individual,
    on_track: onTrack.map((s) => ({ student_id: s.student_id, full_name: s.full_name, score: s.score }))
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0)),
    unassessed,
    options: opts,
  };
}

function paceMix(members: StudentSignal[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const m of members) {
    const k = m.pace ?? "insufficient_data";
    mix[k] = (mix[k] ?? 0) + 1;
  }
  return mix;
}

function avg(nums: number[]): number | null {
  return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

function buildSupportGroup(members: StudentSignal[], weak: Map<string, Set<number>>, opts: PeerGroupOptions): PeerGroup {
  const tally = new Map<number, { t: TopicScore; count: number; scores: number[] }>();
  for (const m of members) {
    for (const t of m.topics) {
      if (t.score >= opts.weakBelow) continue;
      const e = tally.get(t.topic_id) ?? { t, count: 0, scores: [] };
      e.count++; e.scores.push(t.score);
      tally.set(t.topic_id, e);
    }
  }
  const need = Math.max(2, Math.ceil(members.length * opts.sharedShare));
  let shared = [...tally.values()].filter((e) => e.count >= need);
  // Clustering guarantees overlap on average, but not necessarily a majority topic; fall back to the most common.
  if (shared.length === 0) shared = [...tally.values()].filter((e) => e.count >= 2);
  shared.sort((a, b) => b.count - a.count || (avg(a.scores) ?? 0) - (avg(b.scores) ?? 0) || a.t.topic_id - b.t.topic_id);
  const sharedNeeds: SharedNeed[] = shared.slice(0, 6).map((e) => ({
    topic_id: e.t.topic_id, topic_name: e.t.topic_name, chapter_name: e.t.chapter_name,
    weak_count: e.count, member_count: members.length, avg_score: avg(e.scores) ?? 0,
  }));
  const sharedIds = new Set(sharedNeeds.map((n) => n.topic_id));

  let pairSum = 0, pairs = 0;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    pairSum += jaccard(weak.get(members[i].student_id)!, weak.get(members[j].student_id)!); pairs++;
  }

  const top = sharedNeeds.slice(0, 2).map((n) => n.topic_name);
  return {
    id: "pg-tmp",
    kind: "support",
    label: top.length ? `Support: ${top.join(" & ")}` : "Support group",
    cohesion: pairs ? round(pairSum / pairs) : 0,
    size: members.length,
    avg_score: avg(members.map((m) => m.score as number)),
    pace_mix: paceMix(members),
    shared_needs: sharedNeeds,
    members: members.map((m) => {
      const w = weak.get(m.student_id)!;
      const hit = [...sharedIds].filter((id) => w.has(id)).length;
      return {
        student_id: m.student_id, full_name: m.full_name, score: m.score, pace: m.pace, risk: m.risk,
        fit: sharedIds.size ? round(hit / sharedIds.size, 2) : 0,
        weak_topic_ids: [...w],
      };
    }).sort((a, b) => b.fit - a.fit || (a.score ?? 1) - (b.score ?? 1)),
  };
}

function buildExtensionGroup(members: StudentSignal[]): PeerGroup {
  // Their shared "need" is depth: the topics where they are strongest as a group.
  const tally = new Map<number, { t: TopicScore; scores: number[] }>();
  for (const m of members) for (const t of m.topics) {
    const e = tally.get(t.topic_id) ?? { t, scores: [] };
    e.scores.push(t.score); tally.set(t.topic_id, e);
  }
  const strongest = [...tally.values()]
    .filter((e) => e.scores.length >= 2)
    .sort((a, b) => (avg(b.scores) ?? 0) - (avg(a.scores) ?? 0) || a.t.topic_id - b.t.topic_id)
    .slice(0, 3)
    .map((e) => ({
      topic_id: e.t.topic_id, topic_name: e.t.topic_name, chapter_name: e.t.chapter_name,
      weak_count: 0, member_count: members.length, avg_score: avg(e.scores) ?? 0,
    }));
  return {
    id: "pg-tmp",
    kind: "extension",
    label: "Extension: ready for deeper work",
    cohesion: 1,
    size: members.length,
    avg_score: avg(members.map((m) => m.score as number)),
    pace_mix: paceMix(members),
    shared_needs: strongest,
    members: members.map((m) => ({
      student_id: m.student_id, full_name: m.full_name, score: m.score, pace: m.pace, risk: m.risk,
      fit: 1, weak_topic_ids: [],
    })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic tiers: remedial / regular / enrichment
// ─────────────────────────────────────────────────────────────────────────────

export interface TierOptions {
  remedialBelow: number;      // composite under this -> remedial
  enrichmentAtLeast: number;  // composite at/over this -> enrichment
  hysteresis: number;         // a student must clear the boundary by this much to leave a tier
  highRiskMargin: number;     // high early-warning risk keeps a student remedial up to remedialBelow + this
}

export const DEFAULT_TIER_OPTIONS: TierOptions = {
  remedialBelow: 0.45,
  enrichmentAtLeast: 0.8,
  hysteresis: 0.05,
  highRiskMargin: 0.15,
};

/** Learning-velocity gain per attempt that counts as "fast" (matches get_class_velocity: >= 0.20). */
const FAST_GAIN = 0.2;

export interface PriorPlacement { tier: Tier; pinned: boolean }

export interface TierPlacement {
  student_id: string;
  full_name: string;
  tier: Tier;
  previous_tier: Tier | null;
  moved: "up" | "down" | null;
  composite: number | null;
  mastery: number | null;
  pace: Pace | null;
  risk: RiskLevel | null;
  reasons: string[];
  pinned: boolean;
  provisional: boolean;
  /** What the rules say now; differs from `tier` only when a teacher has pinned the student. */
  suggested_tier: Tier;
}

export function validateTierOptions(o: Partial<TierOptions>): { ok: true; value: TierOptions } | { ok: false; error: string } {
  const v = { ...DEFAULT_TIER_OPTIONS, ...o };
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: `${k} must be a number` };
  }
  if (v.remedialBelow <= 0 || v.remedialBelow >= 1) return { ok: false, error: "remedial_below must be between 0 and 1" };
  if (v.enrichmentAtLeast <= 0 || v.enrichmentAtLeast > 1) return { ok: false, error: "enrichment_at_least must be between 0 and 1" };
  if (v.remedialBelow + v.hysteresis >= v.enrichmentAtLeast - v.hysteresis) {
    return { ok: false, error: "remedial_below and enrichment_at_least are too close together (leave room for the regular group)" };
  }
  if (v.hysteresis < 0 || v.hysteresis > 0.2) return { ok: false, error: "hysteresis must be between 0 and 0.2" };
  if (v.highRiskMargin < 0 || v.highRiskMargin > 0.3) return { ok: false, error: "high_risk_margin must be between 0 and 0.3" };
  return { ok: true, value: v };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Composite = 75% mastery + 25% learning pace. Pace is a normalised mastery gain per attempt; a student with no
 * velocity data is scored on mastery alone (no penalty for missing data).
 */
export function compositeScore(mastery: number, gainPerAttempt: number | null): number {
  if (gainPerAttempt === null || !Number.isFinite(gainPerAttempt)) return round(mastery);
  return round(0.75 * mastery + 0.25 * clamp01(gainPerAttempt / FAST_GAIN));
}

export function assignTiers(
  students: Array<StudentSignal & { gain?: number | null }>,
  prior: Map<string, PriorPlacement>,
  overrides: Partial<TierOptions> = {},
): TierPlacement[] {
  const o: TierOptions = { ...DEFAULT_TIER_OPTIONS, ...overrides };

  return students.map((s) => {
    const before = prior.get(s.student_id) ?? null;
    const previous = before?.tier ?? null;
    const reasons: string[] = [];

    // No evidence: never invent a tier. Keep the previous one, or start provisional in "regular".
    if (s.score === null) {
      const tier: Tier = previous ?? "regular";
      return {
        student_id: s.student_id, full_name: s.full_name, tier, previous_tier: previous, moved: null,
        composite: null, mastery: null, pace: s.pace, risk: s.risk,
        reasons: ["Not enough assessed objectives yet" + (previous ? " - kept in current group" : " - placed in Regular until there is evidence")],
        pinned: !!before?.pinned, provisional: true, suggested_tier: tier,
      } satisfies TierPlacement;
    }

    const composite = compositeScore(s.score, s.gain ?? null);
    const highRisk = s.risk === "high";

    // Raw rule, no memory of the past.
    let raw: Tier;
    if (composite < o.remedialBelow || (highRisk && composite < o.remedialBelow + o.highRiskMargin)) raw = "remedial";
    else if (composite >= o.enrichmentAtLeast && !highRisk) raw = "enrichment";
    else raw = "regular";

    // Hysteresis: a student only leaves a tier once clearly past the boundary, so they don't flip week to week.
    let tier = raw;
    if (previous === "remedial" && raw !== "remedial" && composite < o.remedialBelow + o.hysteresis && !highRisk) {
      tier = "remedial";
      reasons.push(`Stays in Remedial until above ${round(o.remedialBelow + o.hysteresis, 2)} (currently ${composite})`);
    } else if (previous === "enrichment" && raw !== "enrichment" && composite >= o.enrichmentAtLeast - o.hysteresis && !highRisk) {
      tier = "enrichment";
      reasons.push(`Stays in Enrichment until below ${round(o.enrichmentAtLeast - o.hysteresis, 2)} (currently ${composite})`);
    }

    if (tier === raw) {
      if (raw === "remedial") {
        reasons.push(composite < o.remedialBelow
          ? `Performance ${composite} is below ${o.remedialBelow}`
          : `High early-warning risk with performance ${composite}`);
      } else if (raw === "enrichment") {
        reasons.push(`Performance ${composite} is at or above ${o.enrichmentAtLeast}`);
      } else {
        reasons.push(highRisk && composite >= o.remedialBelow + o.highRiskMargin
          ? `Performance ${composite} in the regular range`
          : `Performance ${composite} is between ${o.remedialBelow} and ${o.enrichmentAtLeast}`);
      }
    }
    if (s.pace === "slow" && tier !== "remedial") reasons.push("Learning pace is slow - worth monitoring");
    if (s.pace === "fast" && tier === "regular") reasons.push("Learning pace is fast - close to enrichment");
    if (highRisk && tier !== "remedial") reasons.push("High early-warning risk");

    let final: Tier = tier;
    let pinned = false;
    if (before?.pinned) {
      final = before.tier; pinned = true;
      if (final !== tier) reasons.unshift(`Pinned to ${final} by teacher (rules currently suggest ${tier})`);
      else reasons.unshift("Pinned by teacher");
    }

    const moved = previous && previous !== final
      ? (TIER_ORDER.indexOf(final) > TIER_ORDER.indexOf(previous) ? "up" : "down")
      : null;

    return {
      student_id: s.student_id, full_name: s.full_name, tier: final, previous_tier: previous, moved,
      composite, mastery: round(s.score), pace: s.pace, risk: s.risk, reasons,
      pinned, provisional: false, suggested_tier: tier,
    } satisfies TierPlacement;
  });
}

export interface TierSummary {
  tier: Tier;
  count: number;
  avg_composite: number | null;
  /** Remedial: topics most members are weak in. Regular: lowest-scoring topics. Enrichment: strongest topics to extend. */
  focus_topics: Array<{ topic_id: number; topic_name: string; chapter_name: string; avg_score: number; members: number }>;
  student_ids: string[];
}

export function summariseTiers(placements: TierPlacement[], signals: StudentSignal[], weakBelow = 0.5): TierSummary[] {
  const sig = new Map(signals.map((s) => [s.student_id, s]));
  return TIER_ORDER.map((tier) => {
    const inTier = placements.filter((p) => p.tier === tier);
    const tally = new Map<number, { t: TopicScore; scores: number[] }>();
    for (const p of inTier) for (const t of sig.get(p.student_id)?.topics ?? []) {
      const e = tally.get(t.topic_id) ?? { t, scores: [] };
      e.scores.push(t.score); tally.set(t.topic_id, e);
    }
    let rows = [...tally.values()].map((e) => ({ ...e, mean: avg(e.scores) ?? 0, weak: e.scores.filter((x) => x < weakBelow).length }));
    if (tier === "remedial") rows = rows.filter((r) => r.weak >= 1).sort((a, b) => b.weak - a.weak || a.mean - b.mean);
    else if (tier === "regular") rows = rows.sort((a, b) => a.mean - b.mean);
    else rows = rows.filter((r) => r.scores.length >= 1).sort((a, b) => b.mean - a.mean);
    const comps = inTier.map((p) => p.composite).filter((c): c is number => c !== null);
    return {
      tier,
      count: inTier.length,
      avg_composite: avg(comps),
      focus_topics: rows.slice(0, 4).map((r) => ({
        topic_id: r.t.topic_id, topic_name: r.t.topic_name, chapter_name: r.t.chapter_name, avg_score: r.mean,
        members: tier === "remedial" ? r.weak : r.scores.length,
      })),
      student_ids: inTier.map((p) => p.student_id),
    };
  });
}
