// supabase/functions/_shared/irt.ts
//
// Item Response Theory + Computerized Adaptive Testing math for APAS.
// Pure TypeScript, zero imports, so it runs unchanged in Deno (edge functions)
// and in Node (vitest). Anything that touches the database lives in the edge
// functions; everything statistical lives here so it can be unit-tested.
//
// MODEL
//   Three-parameter logistic (3PL), logistic metric (no 1.702 constant):
//     P(correct | θ) = c + (1 - c) / (1 + exp(-a (θ - b)))
//   a = discrimination, b = difficulty (same scale as θ), c = pseudo-guessing.
//   In practice APAS fixes c (0.25 for a 4-option MCQ) and only estimates
//   b (Rasch stage) and then a and b (2PL stage) - see calibrateMML().
//
// SCALE
//   θ is relative to the cohort the items were calibrated on (population
//   prior N(0,1) during calibration). It is NOT an absolute national scale
//   until items are linked across cohorts/grades.

// ─────────────────────────────────────────────────────────────────────────
// Core item response function
// ─────────────────────────────────────────────────────────────────────────

export interface ItemParams {
  a: number;
  b: number;
  c: number;
}

export interface Prior {
  mean: number;
  sd: number;
}

export const GRID_MIN = -4;
export const GRID_MAX = 4;
export const GRID_POINTS = 81;

export function makeGrid(points = GRID_POINTS, min = GRID_MIN, max = GRID_MAX): number[] {
  const step = (max - min) / (points - 1);
  return Array.from({ length: points }, (_, i) => min + i * step);
}

const DEFAULT_GRID = makeGrid();
const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampP = (p: number) => clamp(p, EPS, 1 - EPS);

export function logistic(z: number): number {
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

export function probCorrect(theta: number, item: ItemParams): number {
  return item.c + (1 - item.c) * logistic(item.a * (theta - item.b));
}

/** Fisher information of a 3PL item at θ. Peaks near b; scales with a². */
export function itemInformation(theta: number, item: ItemParams): number {
  const P = clampP(probCorrect(theta, item));
  const Q = 1 - P;
  const ratio = (P - item.c) / (1 - item.c);
  return item.a * item.a * (Q / P) * ratio * ratio;
}

// ─────────────────────────────────────────────────────────────────────────
// Ability estimation - Expected A Posteriori (EAP)
//
// Chosen over maximum likelihood because MLE has no finite solution for
// all-correct / all-wrong patterns, which are the *normal* case in the first
// few items of a CAT. EAP is always defined and shrinks toward the prior
// when evidence is thin.
// ─────────────────────────────────────────────────────────────────────────

export interface ScoredResponse {
  item: ItemParams;
  correct: boolean;
}

export interface AbilityEstimate {
  theta: number;
  se: number;
}

export function estimateAbilityEAP(
  responses: ScoredResponse[],
  prior: Prior = { mean: 0, sd: 1 },
  grid: number[] = DEFAULT_GRID,
): AbilityEstimate {
  const logPost = grid.map((t) => {
    let lp = -0.5 * ((t - prior.mean) / prior.sd) ** 2;
    for (const r of responses) {
      const P = clampP(probCorrect(t, r.item));
      lp += r.correct ? Math.log(P) : Math.log(1 - P);
    }
    return lp;
  });

  const max = Math.max(...logPost);
  const w = logPost.map((lp) => Math.exp(lp - max));
  const total = w.reduce((s, x) => s + x, 0);

  let mean = 0;
  for (let k = 0; k < grid.length; k++) mean += (grid[k] * w[k]) / total;

  let variance = 0;
  for (let k = 0; k < grid.length; k++) variance += ((grid[k] - mean) ** 2 * w[k]) / total;

  return { theta: mean, se: Math.sqrt(variance) };
}

// ─────────────────────────────────────────────────────────────────────────
// Adaptive item selection
//
// Maximum Fisher information at the current θ̂, with three practical
// constraints layered on top:
//   1. BKT-aware need weighting - objectives the mastery engine is least
//      sure about (unassessed, or p_mastery near 0.5) get a boost. This is
//      the bridge between IRT (which picks difficulty) and BKT (which
//      knows which objectives still need evidence).
//   2. Content balancing - cap how many items any one learning objective
//      contributes so a scope test actually covers the scope.
//   3. Randomesque exposure control - choose randomly among the top-K most
//      informative items, so the single "best" item isn't shown to
//      everyone.
// ─────────────────────────────────────────────────────────────────────────

export interface CatCandidate {
  id: string;
  params: ItemParams;
  learningObjectiveId: number;
  pMastery?: number | null;
  opportunities?: number;
}

export interface SelectionOptions {
  randomesqueK?: number;
  rng?: () => number;
  loCounts?: Record<number, number>;
  maxPerObjective?: number;
  needWeight?: number;
}

/** 1 = totally uncertain about this objective, 0 = confident either way. */
export function objectiveUncertainty(pMastery: number | null | undefined, opportunities = 0): number {
  if (pMastery == null || opportunities === 0) return 1;
  return 1 - Math.abs(2 * pMastery - 1);
}

export function selectNextItem(
  theta: number,
  candidates: CatCandidate[],
  opts: SelectionOptions = {},
): CatCandidate | null {
  if (candidates.length === 0) return null;

  const {
    randomesqueK = 4,
    rng = Math.random,
    loCounts = {},
    maxPerObjective = Infinity,
    needWeight = 0.5,
  } = opts;

  let eligible = candidates.filter((c) => (loCounts[c.learningObjectiveId] ?? 0) < maxPerObjective);
  if (eligible.length === 0) eligible = candidates; // never dead-end on a balancing rule

  const scored = eligible
    .map((c) => ({
      c,
      score:
        itemInformation(theta, c.params) *
        (1 + needWeight * objectiveUncertainty(c.pMastery, c.opportunities ?? 0)),
    }))
    .sort((x, y) => y.score - x.score);

  const top = scored.slice(0, Math.max(1, Math.min(randomesqueK, scored.length)));
  return top[Math.floor(rng() * top.length)].c;
}

// ─────────────────────────────────────────────────────────────────────────
// Stopping rule
// ─────────────────────────────────────────────────────────────────────────

export type StopReason = "precision" | "max_items" | "bank_exhausted";

export function evaluateStopping(args: {
  administered: number;
  se: number;
  minItems: number;
  maxItems: number;
  seTarget: number;
  remainingCandidates: number;
}): { stop: boolean; reason: StopReason | null } {
  const { administered, se, minItems, maxItems, seTarget, remainingCandidates } = args;
  if (administered >= maxItems) return { stop: true, reason: "max_items" };
  if (remainingCandidates <= 0) return { stop: true, reason: "bank_exhausted" };
  if (administered >= minItems && se <= seTarget) return { stop: true, reason: "precision" };
  return { stop: false, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────
// Reporting helpers
// ─────────────────────────────────────────────────────────────────────────

export type AbilityBand = "foundation" | "developing" | "proficient" | "advanced";

export function abilityBand(theta: number): AbilityBand {
  if (theta < -1) return "foundation";
  if (theta < 0) return "developing";
  if (theta < 1) return "proficient";
  return "advanced";
}

/** Reporting scale: mean 500, SD 100 (relative to the calibration cohort). */
export function scaledScore(theta: number): number {
  return Math.round(500 + 100 * theta);
}

/** 0-100 progress indicator: 0 at the starting SE, 100 once the SE target is met. */
export function precisionPercent(se: number, seTarget: number, startSe = 1): number {
  if (startSe <= seTarget) return 100;
  return Math.round(clamp((startSe - se) / (startSe - seTarget), 0, 1) * 100);
}

// ─────────────────────────────────────────────────────────────────────────
// Cold-start difficulty prior
//
// A brand-new AI-authored item has no response data. Until calibration
// replaces it, seed b from the learning objective's declared difficulty and
// Bloom level so the very first CAT sessions are already roughly adaptive.
// ─────────────────────────────────────────────────────────────────────────

const DIFFICULTY_BASE: Record<string, number> = { easy: -1, medium: 0, hard: 1 };
const BLOOM_OFFSET: Record<string, number> = {
  remember: -0.3,
  understand: -0.15,
  apply: 0,
  analyze: 0.25,
  evaluate: 0.4,
  create: 0.5,
};

export function priorDifficulty(difficulty?: string | null, bloom?: string | null): number {
  const base = DIFFICULTY_BASE[(difficulty ?? "medium").toLowerCase()] ?? 0;
  const off = BLOOM_OFFSET[(bloom ?? "apply").toLowerCase()] ?? 0;
  return clamp(base + off, -2.5, 2.5);
}

// ─────────────────────────────────────────────────────────────────────────
// Item calibration - Marginal Maximum Likelihood via EM (Bock & Aitkin)
//
// Why MML and not "percent correct" or joint MLE:
//   CAT data is sparse (each student sees ~10 of hundreds of items) and the
//   items each student saw were chosen BASED ON their earlier answers.
//   Selection that depends only on already-observed responses is ignorable
//   for likelihood-based estimation, so MML stays unbiased. Classical
//   p-values are biased by adaptive routing (strong students get hard items),
//   and JMLE is inconsistent with so few items per person.
//
// Staged, because psychometrics needs data:
//   n <  minRasch  -> keep the prior (no update)
//   n >= minRasch  -> estimate b only, a held fixed        ("rasch")
//   n >= min2pl    -> estimate a and b, with a weakly-
//                     informative log-normal prior on a     ("2pl")
//   c is always fixed. Estimating guessing needs thousands of responses
//   per item; at school scale it just adds noise.
// ─────────────────────────────────────────────────────────────────────────

export interface CalibrationItemInput {
  id: string;
  a: number;
  b: number;
  c: number;
  /** Prior mean for b (the cold-start difficulty); pulls sparse items toward it. */
  bPrior: number;
}

export interface CalibrationResponse {
  /** One examinee "snapshot" - use the CAT session id. */
  unit: string;
  itemId: string;
  correct: boolean;
}

export interface CalibrationOptions {
  maxIterations?: number;
  tolerance?: number;
  minRasch?: number;
  min2pl?: number;
  /** SD of ln(a) prior. Smaller = stronger pull toward a = 1. */
  aLogPriorSd?: number;
  /** SD of the b prior around bPrior. */
  bPriorSd?: number;
  populationPrior?: Prior;
  grid?: number[];
}

export type CalibrationMode = "prior" | "rasch" | "2pl";

export interface CalibratedItem {
  id: string;
  a: number;
  b: number;
  c: number;
  bSe: number | null;
  n: number;
  nCorrect: number;
  mode: CalibrationMode;
}

export interface CalibrationResult {
  items: CalibratedItem[];
  iterations: number;
  converged: boolean;
  units: number;
  responses: number;
}

const A_MIN = 0.2;
const A_MAX = 3;
const B_LIM = 4;

export function calibrateMML(
  items: CalibrationItemInput[],
  responses: CalibrationResponse[],
  options: CalibrationOptions = {},
): CalibrationResult {
  const {
    maxIterations = 40,
    tolerance = 1e-3,
    minRasch = 30,
    min2pl = 200,
    aLogPriorSd = 0.5,
    bPriorSd = 1.5,
    populationPrior = { mean: 0, sd: 1 },
    grid = DEFAULT_GRID,
  } = options;

  const K = grid.length;
  const J = items.length;
  const itemIndex = new Map(items.map((it, i) => [it.id, i]));

  // Group by examinee unit, count n and correct per item.
  const byUnit = new Map<string, Array<[number, boolean]>>();
  const n = new Array<number>(J).fill(0);
  const nCorrect = new Array<number>(J).fill(0);
  let usedResponses = 0;
  for (const r of responses) {
    const j = itemIndex.get(r.itemId);
    if (j === undefined) continue;
    let arr = byUnit.get(r.unit);
    if (!arr) byUnit.set(r.unit, (arr = []));
    arr.push([j, r.correct]);
    n[j]++;
    if (r.correct) nCorrect[j]++;
    usedResponses++;
  }

  const mode: CalibrationMode[] = n.map((cnt) => (cnt >= min2pl ? "2pl" : cnt >= minRasch ? "rasch" : "prior"));
  const params = items.map((it) => ({ a: it.a, b: it.b, c: it.c }));
  const bSe: Array<number | null> = new Array(J).fill(null);

  // Population weights on the grid (normalized once).
  const logPop = grid.map((t) => -0.5 * ((t - populationPrior.mean) / populationPrior.sd) ** 2);

  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= maxIterations; iter++) {
    // Precompute log P and log Q per item per node.
    const logP: Float64Array[] = [];
    const logQ: Float64Array[] = [];
    for (let j = 0; j < J; j++) {
      const lp = new Float64Array(K);
      const lq = new Float64Array(K);
      for (let k = 0; k < K; k++) {
        const P = clampP(probCorrect(grid[k], params[j]));
        lp[k] = Math.log(P);
        lq[k] = Math.log(1 - P);
      }
      logP.push(lp);
      logQ.push(lq);
    }

    // E-step: expected examinees (nJK) and expected correct (rJK) per item per node.
    const nJK = new Float64Array(J * K);
    const rJK = new Float64Array(J * K);
    const post = new Float64Array(K);

    for (const resp of byUnit.values()) {
      let max = -Infinity;
      for (let k = 0; k < K; k++) {
        let v = logPop[k];
        for (const [j, x] of resp) v += x ? logP[j][k] : logQ[j][k];
        post[k] = v;
        if (v > max) max = v;
      }
      let sum = 0;
      for (let k = 0; k < K; k++) {
        post[k] = Math.exp(post[k] - max);
        sum += post[k];
      }
      for (let k = 0; k < K; k++) post[k] /= sum;
      for (const [j, x] of resp) {
        const base = j * K;
        for (let k = 0; k < K; k++) {
          nJK[base + k] += post[k];
          if (x) rJK[base + k] += post[k];
        }
      }
    }

    // M-step: Fisher scoring per item, MAP with priors.
    let maxDelta = 0;
    for (let j = 0; j < J; j++) {
      if (mode[j] === "prior") continue;
      const estimateA = mode[j] === "2pl";
      const c = params[j].c;
      let b = params[j].b;
      let u = Math.log(params[j].a);
      let lastInfo = { Huu: 0, Hub: 0, Hbb: 0 };

      for (let inner = 0; inner < 3; inner++) {
        const a = Math.exp(u);
        let gu = 0;
        let gb = 0;
        let Huu = 0;
        let Hub = 0;
        let Hbb = 0;
        for (let k = 0; k < K; k++) {
          const nk = nJK[j * K + k];
          if (nk < 1e-12) continue;
          const rk = rJK[j * K + k];
          const th = grid[k];
          const s = logistic(a * (th - b));
          const P = clampP(c + (1 - c) * s);
          const Pz = (1 - c) * s * (1 - s);
          const w = Pz / (P * (1 - P));
          const resid = rk - nk * P;
          const dzdu = a * (th - b);
          const dzdb = -a;
          const info = (nk * Pz * Pz) / (P * (1 - P));
          gu += resid * w * dzdu;
          gb += resid * w * dzdb;
          Huu += info * dzdu * dzdu;
          Hub += info * dzdu * dzdb;
          Hbb += info * dzdb * dzdb;
        }
        // Priors.
        const bPrec = 1 / (bPriorSd * bPriorSd);
        gb += -(b - items[j].bPrior) * bPrec;
        Hbb += bPrec;
        if (estimateA) {
          const aPrec = 1 / (aLogPriorSd * aLogPriorSd);
          gu += -u * aPrec;
          Huu += aPrec;
        }

        let du = 0;
        let db = 0;
        if (estimateA) {
          const det = Huu * Hbb - Hub * Hub + 1e-9;
          du = (Hbb * gu - Hub * gb) / det;
          db = (Huu * gb - Hub * gu) / det;
        } else {
          db = gb / Hbb;
        }
        du = clamp(du, -0.5, 0.5);
        db = clamp(db, -1, 1);
        u = clamp(u + du, Math.log(A_MIN), Math.log(A_MAX));
        b = clamp(b + db, -B_LIM, B_LIM);
        lastInfo = { Huu, Hub, Hbb };
      }

      const newA = Math.exp(u);
      maxDelta = Math.max(maxDelta, Math.abs(newA - params[j].a), Math.abs(b - params[j].b));
      params[j] = { a: newA, b, c };

      // Standard error of b from the (prior-augmented) information matrix.
      if (estimateA) {
        const det = lastInfo.Huu * lastInfo.Hbb - lastInfo.Hub * lastInfo.Hub + 1e-9;
        bSe[j] = Math.sqrt(Math.max(lastInfo.Huu / det, 0));
      } else {
        bSe[j] = Math.sqrt(1 / lastInfo.Hbb);
      }
    }

    if (maxDelta < tolerance) {
      converged = true;
      break;
    }
  }

  return {
    items: items.map((it, j) => ({
      id: it.id,
      a: params[j].a,
      b: params[j].b,
      c: params[j].c,
      bSe: bSe[j],
      n: n[j],
      nCorrect: nCorrect[j],
      mode: mode[j],
    })),
    iterations: Math.min(iter, maxIterations),
    converged,
    units: byUnit.size,
    responses: usedResponses,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Answer-key sanity check
//
// AI-authored MCQs are sometimes mis-keyed. Under CAT the usual
// item-total correlation is unreliable (the item is shown to examinees
// with θ ≈ b, so ability range is restricted), but a *within-item*
// comparison is not: on a correctly keyed item, the students who choose
// the key should be at least as able as those choosing any distractor.
// ─────────────────────────────────────────────────────────────────────────

export interface OptionObservation {
  option: string;
  theta: number;
}

export interface MiskeyResult {
  suspect: boolean;
  reason: string | null;
  stats: Record<string, { n: number; meanTheta: number }>;
}

export function detectMiskey(
  key: string,
  obs: OptionObservation[],
  opts: { minTotal?: number; minPerOption?: number; margin?: number } = {},
): MiskeyResult {
  const { minTotal = 20, minPerOption = 5, margin = 0.5 } = opts;

  const stats: Record<string, { n: number; meanTheta: number }> = {};
  for (const o of obs) {
    const s = (stats[o.option] ??= { n: 0, meanTheta: 0 });
    s.meanTheta += o.theta;
    s.n++;
  }
  for (const s of Object.values(stats)) s.meanTheta /= s.n;

  if (obs.length < minTotal) return { suspect: false, reason: null, stats };

  const keyN = stats[key]?.n ?? 0;
  if (keyN / obs.length < 0.1) {
    return { suspect: true, reason: "Keyed answer was almost never chosen", stats };
  }
  if (keyN >= minPerOption) {
    for (const [opt, s] of Object.entries(stats)) {
      if (opt === key || s.n < minPerOption) continue;
      if (s.meanTheta >= stats[key].meanTheta + margin) {
        return {
          suspect: true,
          reason: `Option ${opt} was chosen by markedly stronger students than the keyed answer`,
          stats,
        };
      }
    }
  }
  return { suspect: false, reason: null, stats };
}

/**
 * True when an item was answered correctly clearly LESS often than blind
 * guessing would achieve (one-sided ~2.3% test). A valid item can never do
 * that - the guessing floor c bounds P(correct) from below - so it means the
 * keyed answer is almost certainly wrong (or the item is broken).
 */
export function belowChance(nCorrect: number, n: number, c: number, z = 2, minN = 30): boolean {
  if (n < minN) return false;
  const p = nCorrect / n;
  return p + z * Math.sqrt((c * (1 - c)) / n) < c;
}