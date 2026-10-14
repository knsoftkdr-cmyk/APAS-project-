// supabase/functions/_shared/competencyMissionModel.ts
//
// Pure rules for Competency Missions (no I/O; unit-tested in src/test/competencyMissionModel.test.ts).
//
// The principle: a mission is only ever completed by the student's VERIFIED mastery (the BKT score in student_mastery and
// the graded answers in mastery_evidence_log), never by a count of taps, minutes or points the browser reports.
// To keep that meaningful it also needs enough answers, enough correct ones, and answers on several different days.

// deno-lint-ignore-file no-explicit-any
import { localDate } from "./gamification2Model.ts";

export type Tier = "not_assessed" | "beginning" | "developing" | "proficient" | "mastered";
export type MissionKind = "level_up" | "topic_quest";

export const TIER_THRESHOLDS = { developing: 0.35, proficient: 0.60, mastered: 0.85 } as const;
export const TIER_LABEL: Record<Tier, string> = {
  not_assessed: "Not assessed", beginning: "Beginning", developing: "Developing", proficient: "Proficient", mastered: "Mastered",
};

export const CONFIG = {
  maxLevelUp: 3,
  maxTopicQuests: 1,
  expiryDays: 21,
  minGap: 0.10,                       // skip a target that is less than this above where the student already is
  dailyXpCap: 400,                    // most competency XP that can be claimed in one local day
  priorMastery: 0.30,                 // BKT default prior for a skill the student has not been assessed on
  levelUpXp: { developing: 25, proficient: 60, mastered: 100 } as Record<string, number>,
  levelUp: { minEvidence: 3, minCorrect: 2 },
  topic: {
    ladder: [0.50, 0.65, 0.80], minGap: 0.08, minObjectives: 3, minAttempted: 2, coverageShare: 0.6,
    minEvidence: 6, minCorrect: 4, xp: { 50: 80, 65: 120, 80: 180 } as Record<number, number>,
  },
} as const;

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const pct = (p: number) => Math.round(p * 100);
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Same bands as the student_mastery_labeled view. */
export function tierOf(p: number, opportunities: number): Tier {
  if (!opportunities) return "not_assessed";
  if (p >= TIER_THRESHOLDS.mastered) return "mastered";
  if (p >= TIER_THRESHOLDS.proficient) return "proficient";
  if (p >= TIER_THRESHOLDS.developing) return "developing";
  return "beginning";
}

/** The next tier worth chasing: the first one at least `minGap` above p (or mastered, if p is already close to it). */
export function pickTarget(p: number): { tier: "developing" | "proficient" | "mastered"; value: number } | null {
  if (p >= TIER_THRESHOLDS.mastered) return null;
  for (const tier of ["developing", "proficient", "mastered"] as const) {
    const v = TIER_THRESHOLDS[tier];
    if (v - p >= CONFIG.minGap) return { tier, value: v };
  }
  return { tier: "mastered", value: TIER_THRESHOLDS.mastered };
}

export const minDaysFor = (tierTo: string) => (tierTo === "developing" ? 1 : 2);

// ── input shapes ───────────────────────────────────────────────────────────────────────────────────────────
export interface MasteryRow {
  learning_objective_id: number;
  p_mastery: number;
  opportunities_count: number;
  last_evidence_at: string | null;
  objective_text: string;
  subtopic_name: string | null;
  topic_id: number | null;
  topic_name: string | null;
  subject: string | null;
}

const one = (v: any) => (Array.isArray(v) ? v[0] : v);

/** Row of student_mastery with the curriculum embedded -> flat MasteryRow (tolerates object-or-array embeds). */
export function flattenMasteryRow(r: any): MasteryRow | null {
  const lo = one(r?.learning_objectives);
  if (!lo) return null;
  const st = one(lo.subtopics);
  const tp = one(st?.topics);
  const ch = one(tp?.curriculum_chapters);
  const un = one(ch?.units);
  const bk = one(un?.books);
  return {
    learning_objective_id: Number(r.learning_objective_id),
    p_mastery: Number(r.p_mastery),
    opportunities_count: Number(r.opportunities_count ?? 0),
    last_evidence_at: r.last_evidence_at ?? null,
    objective_text: String(lo.objective_text ?? ""),
    subtopic_name: st?.subtopic_name ?? null,
    topic_id: st?.topic_id != null ? Number(st.topic_id) : tp?.id != null ? Number(tp.id) : null,
    topic_name: tp?.topic_name ?? null,
    subject: bk?.subject ?? null,
  };
}

export interface MissionDraft {
  kind: MissionKind;
  scope_key: string;
  title: string;
  description: string;
  subject: string | null;
  topic_id: number | null;
  topic_name: string | null;
  learning_objective_id: number | null;
  tier_from: Tier | null;
  tier_to: string | null;
  start_value: number;
  target_value: number;
  xp_reward: number;
  min_evidence: number;
  min_correct: number;
  min_days: number;
  meta: Record<string, any>;
}

const proof = (minEvidence: number, minCorrect: number, minDays: number) =>
  `Prove it with at least ${minEvidence} answers (${minCorrect} correct)${minDays > 1 ? ` on ${minDays} different days, so it really sticks` : ""}.`;

// ── generation ─────────────────────────────────────────────────────────────────────────────────────────────

const WEAKNESS: Record<Tier, number> = { not_assessed: 0, beginning: 1, developing: 0.8, proficient: 0.5, mastered: 0 };

/** Skills the student has already been assessed on and could realistically level up, best candidates first. */
export function levelUpCandidates(rows: MasteryRow[], excludeScopes: Set<string>, limit: number, now = Date.now()): MissionDraft[] {
  const scored: { draft: MissionDraft; score: number; topic: number | null; id: number }[] = [];
  for (const r of rows) {
    if (!r.opportunities_count || r.p_mastery >= TIER_THRESHOLDS.mastered || !r.objective_text) continue;
    const target = pickTarget(r.p_mastery);
    if (!target) continue;
    const scope = `lo:${r.learning_objective_id}:${target.tier}`;
    if (excludeScopes.has(scope)) continue;

    const tier = tierOf(r.p_mastery, r.opportunities_count);
    const closeness = 1 - clamp((target.value - r.p_mastery) / 0.45);
    const recent = r.last_evidence_at && now - Date.parse(r.last_evidence_at) <= 14 * 86_400_000 ? 1 : 0;
    const score = 0.45 * WEAKNESS[tier] + 0.35 * closeness + 0.2 * recent;
    const days = minDaysFor(target.tier);
    const { minEvidence, minCorrect } = CONFIG.levelUp;
    scored.push({
      score, topic: r.topic_id, id: r.learning_objective_id,
      draft: {
        kind: "level_up", scope_key: scope,
        title: `Level up: ${shorten(r.objective_text, 70)}`,
        description: `Move this skill from ${TIER_LABEL[tier]} to ${TIER_LABEL[target.tier]}. ${proof(minEvidence, minCorrect, days)}`,
        subject: r.subject, topic_id: r.topic_id, topic_name: r.topic_name, learning_objective_id: r.learning_objective_id,
        tier_from: tier, tier_to: target.tier, start_value: r.p_mastery, target_value: target.value,
        xp_reward: CONFIG.levelUpXp[target.tier], min_evidence: minEvidence, min_correct: minCorrect, min_days: days, meta: {},
      },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  const out: MissionDraft[] = [];
  const topics = new Set<number | null>();
  for (const s of scored) {                      // at most one per topic, for variety
    if (out.length >= limit) break;
    if (s.topic != null && topics.has(s.topic)) continue;
    topics.add(s.topic);
    out.push(s.draft);
  }
  return out;
}

export interface TopicAgg {
  topic_id: number;
  topic_name: string | null;
  subject: string | null;
  objective_ids: number[];                         // every active objective in the topic
  mastery: Map<number, { p: number; opps: number }>; // the student's rows for those objectives
}

export function topicAverage(objectiveIds: number[], mastery: Map<number, { p: number; opps: number }>) {
  if (!objectiveIds.length) return { avg: 0, attempted: 0 };
  let sum = 0, attempted = 0;
  for (const id of objectiveIds) {
    const m = mastery.get(id);
    sum += m && m.opps > 0 ? m.p : CONFIG.priorMastery;
    if (m && m.opps > 0) attempted++;
  }
  return { avg: sum / objectiveIds.length, attempted };
}

export function topicCandidates(topics: TopicAgg[], excludeScopes: Set<string>, limit: number): MissionDraft[] {
  const T = CONFIG.topic;
  const scored: { draft: MissionDraft; score: number; id: number }[] = [];
  for (const t of topics) {
    if (t.objective_ids.length < T.minObjectives) continue;
    const { avg, attempted } = topicAverage(t.objective_ids, t.mastery);
    if (attempted < T.minAttempted) continue;
    const target = T.ladder.find((v) => v - avg >= T.minGap);
    if (target == null) continue;
    const key = Math.round(target * 100);
    const scope = `topic:${t.topic_id}:${key}`;
    if (excludeScopes.has(scope)) continue;
    const coverage = Math.ceil(t.objective_ids.length * T.coverageShare);
    scored.push({
      id: t.topic_id, score: 1 - avg,                 // weakest topics first
      draft: {
        kind: "topic_quest", scope_key: scope,
        title: `Topic quest: ${t.topic_name ?? "this topic"}`,
        description: `Lift your overall mastery of this topic to ${key}% across at least ${coverage} of its ${t.objective_ids.length} skills. ${proof(T.minEvidence, T.minCorrect, 2)}`,
        subject: t.subject, topic_id: t.topic_id, topic_name: t.topic_name, learning_objective_id: null,
        tier_from: null, tier_to: null, start_value: avg, target_value: target, xp_reward: T.xp[key],
        min_evidence: T.minEvidence, min_correct: T.minCorrect, min_days: 2,
        meta: { objective_ids: t.objective_ids, objective_count: t.objective_ids.length, coverage_needed: coverage },
      },
    });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored.slice(0, limit).map((s) => s.draft);
}

// ── evaluation ─────────────────────────────────────────────────────────────────────────────────────────────

export interface MissionRecord {
  kind: MissionKind;
  learning_objective_id: number | null;
  start_value: number;
  target_value: number;
  min_evidence: number;
  min_correct: number;
  min_days: number;
  meta: Record<string, any> | null;
  created_at: string;
  expires_at: string;
}
export interface EvidenceRow { learning_objective_id: number; is_correct: boolean; responded_at: string }

export interface Evaluation {
  current: number;
  progress: number;                    // 0..1, held below 1 until every requirement is met
  done: boolean;
  expired: boolean;
  evidence: { have: number; need: number };
  correct: { have: number; need: number };
  days: { have: number; need: number };
  coverage: { have: number; need: number } | null;
  hint: string;
}

export function evaluateMission(
  m: MissionRecord, mastery: Map<number, { p: number; opps: number }>, evidence: EvidenceRow[], tz: number, now = Date.now(),
): Evaluation {
  const ids = m.kind === "level_up"
    ? (m.learning_objective_id != null ? [m.learning_objective_id] : [])
    : ((m.meta?.objective_ids as number[] | undefined) ?? []);
  const idSet = new Set(ids);
  const started = Date.parse(m.created_at);
  const mine = evidence.filter((e) => idSet.has(Number(e.learning_objective_id)) && Date.parse(e.responded_at) >= started);

  let current: number;
  let coverage: Evaluation["coverage"] = null;
  if (m.kind === "level_up") {
    const row = ids.length ? mastery.get(ids[0]) : undefined;
    current = row ? row.p : m.start_value;
  } else {
    const { avg, attempted } = topicAverage(ids, mastery);
    current = avg;
    coverage = { have: attempted, need: Number(m.meta?.coverage_needed ?? 0) };
  }

  const evHave = mine.length;
  const okHave = mine.filter((e) => e.is_correct).length;
  const dayHave = new Set(mine.map((e) => localDate(Date.parse(e.responded_at), tz))).size;

  const reached = current >= m.target_value;
  const metEvidence = evHave >= m.min_evidence && okHave >= m.min_correct && dayHave >= m.min_days;
  const metCoverage = !coverage || coverage.have >= coverage.need;
  const done = reached && metEvidence && metCoverage;

  const span = Math.max(0.01, m.target_value - m.start_value);
  const raw = clamp((current - m.start_value) / span);
  const progress = done ? 1 : Math.min(raw, 0.95);
  const expired = !done && now > Date.parse(m.expires_at);

  let hint: string;
  if (done) hint = "Mastery verified. Claim your reward!";
  else if (!reached) hint = `Keep practising: your mastery is ${pct(current)}% and the goal is ${pct(m.target_value)}%.`;
  else if (!metCoverage) hint = `Practise ${coverage!.need - coverage!.have} more skill${coverage!.need - coverage!.have === 1 ? "" : "s"} in this topic.`;
  else if (okHave < m.min_correct || evHave < m.min_evidence) {
    const more = Math.max(m.min_evidence - evHave, m.min_correct - okHave, 1);
    hint = `You've reached the goal. Answer ${more} more question${more === 1 ? "" : "s"} to confirm it.`;
  } else hint = `You've reached the goal. Come back on another day to lock it in (${dayHave} of ${m.min_days} days).`;

  return {
    current, progress, done, expired,
    evidence: { have: evHave, need: m.min_evidence }, correct: { have: okHave, need: m.min_correct },
    days: { have: dayHave, need: m.min_days }, coverage, hint,
  };
}
