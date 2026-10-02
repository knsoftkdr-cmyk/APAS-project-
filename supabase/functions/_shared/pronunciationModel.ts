// supabase/functions/_shared/pronunciationModel.ts
//
// Pure logic (no imports, no I/O) behind Pronunciation Assessment. Used by _shared/handlers/pronunciation.ts,
// which `get-mastery-history` routes to via the `pronunciation_*` actions (see mergedRouter.ts).
//
// HOW IT WORKS (and what it is not)
// The student reads a reference text aloud; the browser's speech recogniser turns the audio into words
// ("what was heard"). This model lines those words up against the reference and scores the match. So it
// measures how recognisable and complete the speech was, word by word. It does NOT analyse phonemes, stress
// or intonation, and a recogniser can occasionally mishear a clearly spoken word. Results are practice
// feedback, not an exam grade, and the response says so.
//
//  - Words are aligned with an edit-distance alignment (so one skipped word does not ruin the rest).
//  - Each reference word is: correct, close (nearly right), mispronounced (heard as something else) or missed.
//  - Accuracy = average word score. Completeness = share of reference words that were spoken.
//  - Fluency (speaking pace) and clarity (recogniser confidence) are included only when the client supplied them.

export const PRONUNCIATION_MODEL_VERSION = "1.0";
export const CLOSE_MIN_SIMILARITY = 0.7;   // heard word at least this similar to the reference counts as "close"
export const EXTRA_WORD_PENALTY = 2;       // overall points lost per unexpected extra word ...
export const EXTRA_WORD_PENALTY_MAX = 10;  // ... up to this many
export const PACE_OK_MIN = 70;             // words per minute considered a comfortable pace: 70 to 170
export const PACE_OK_MAX = 170;
export const MIN_WORDS_FOR_PACE = 5;       // shorter texts are dominated by start/stop time, so no pace score
export const MIN_SECONDS_FOR_PACE = 2;
export const WEIGHTS = { accuracy: 0.6, completeness: 0.2, fluency: 0.1, clarity: 0.1 } as const;

export type WordStatus = "correct" | "close" | "mispronounced" | "missed";
export type ScoreBand = "excellent" | "good" | "developing" | "needs_practice";

export interface WordResult {
  ref: string;            // reference word, as written
  heard: string | null;   // what the recogniser produced for it (null when missed)
  status: WordStatus;
  similarity: number;     // 0-1 character similarity between ref and heard
  score: number;          // 0-100
}

export interface PronunciationInput {
  reference: string;
  transcript: string;
  durationSeconds?: number | null;   // time spent speaking (not the whole page visit)
  confidence?: number | null;        // recogniser confidence 0-1 for the whole utterance
}

export interface PronunciationResult {
  model_version: string;
  overall: number;
  band: ScoreBand;
  accuracy: number;
  completeness: number;
  fluency: number | null;
  clarity: number | null;
  words_per_minute: number | null;
  words: WordResult[];
  extra_words: string[];
  counts: { total: number; correct: number; close: number; mispronounced: number; missed: number };
  notes: string[];
}

const round = (v: number) => Math.round(v);
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Lower-case, Unicode-normalise and drop punctuation. Keeps letters + combining marks (Indic vowel signs) + digits. */
export function normaliseWord(w: string): string {
  return w.normalize("NFC").toLowerCase().replace(/['\u2018\u2019\u02bc]/g, "").replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** Splits text into display words and their normalised comparison forms (empty tokens dropped). */
export function tokenise(text: string): { display: string; norm: string }[] {
  return text
    .split(/\s+/)
    .map((display) => ({ display: display.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, ""), norm: normaliseWord(display) }))
    .filter((t) => t.norm.length > 0);
}

/** Character-level similarity in [0, 1] (1 = identical), by code point so Indic scripts compare fairly. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const x = Array.from(a), y = Array.from(b);
  if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

type Op = { kind: "match"; r: number; h: number } | { kind: "miss"; r: number } | { kind: "extra"; h: number };

/** Minimum-cost alignment of reference words to heard words. */
function align(ref: string[], heard: string[]): Op[] {
  const n = ref.length, m = heard.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i][0] = i;
  for (let j = 1; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + (1 - similarity(ref[i - 1], heard[j - 1])),
        cost[i - 1][j] + 1,
        cost[i][j - 1] + 1,
      );
    }
  }
  const ops: Op[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(cost[i][j] - (cost[i - 1][j - 1] + (1 - similarity(ref[i - 1], heard[j - 1])))) < 1e-9) {
      ops.push({ kind: "match", r: i - 1, h: j - 1 }); i--; j--;
    } else if (i > 0 && Math.abs(cost[i][j] - (cost[i - 1][j] + 1)) < 1e-9) {
      ops.push({ kind: "miss", r: i - 1 }); i--;
    } else {
      ops.push({ kind: "extra", h: j - 1 }); j--;
    }
  }
  return ops.reverse();
}

export function bandOf(score: number): ScoreBand {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "developing";
  return "needs_practice";
}

/** 100 inside the comfortable range, falling away linearly outside it (never below 0). */
export function paceScore(wpm: number): number {
  if (wpm >= PACE_OK_MIN && wpm <= PACE_OK_MAX) return 100;
  if (wpm < PACE_OK_MIN) return clamp((wpm / PACE_OK_MIN) * 100);
  return clamp(100 - ((wpm - PACE_OK_MAX) / PACE_OK_MAX) * 100);
}

export function assessPronunciation(input: PronunciationInput): PronunciationResult {
  const ref = tokenise(input.reference);
  const heard = tokenise(input.transcript);
  const notes: string[] = [];

  const empty = (): PronunciationResult => ({
    model_version: PRONUNCIATION_MODEL_VERSION, overall: 0, band: "needs_practice", accuracy: 0, completeness: 0,
    fluency: null, clarity: null, words_per_minute: null,
    words: ref.map((r) => ({ ref: r.display, heard: null, status: "missed", similarity: 0, score: 0 })),
    extra_words: [], counts: { total: ref.length, correct: 0, close: 0, mispronounced: 0, missed: ref.length }, notes,
  });
  if (!ref.length) { notes.push("There was no reference text to compare against."); return empty(); }
  if (!heard.length) { notes.push("No speech was recognised. Check the microphone and try again."); return empty(); }

  const ops = align(ref.map((r) => r.norm), heard.map((h) => h.norm));
  const words: WordResult[] = new Array(ref.length);
  const extra: string[] = [];
  for (const op of ops) {
    if (op.kind === "miss") {
      words[op.r] = { ref: ref[op.r].display, heard: null, status: "missed", similarity: 0, score: 0 };
    } else if (op.kind === "extra") {
      extra.push(heard[op.h].display);
    } else {
      const sim = similarity(ref[op.r].norm, heard[op.h].norm);
      const status: WordStatus = sim === 1 ? "correct" : sim >= CLOSE_MIN_SIMILARITY ? "close" : "mispronounced";
      const score = status === "correct" ? 100 : status === "close" ? round(sim * 100) : round(sim * 50);
      words[op.r] = { ref: ref[op.r].display, heard: heard[op.h].display, status, similarity: Math.round(sim * 100) / 100, score };
    }
  }

  const count = (s: WordStatus) => words.filter((w) => w.status === s).length;
  const counts = { total: ref.length, correct: count("correct"), close: count("close"), mispronounced: count("mispronounced"), missed: count("missed") };
  const accuracy = round(words.reduce((a, w) => a + w.score, 0) / ref.length);
  const completeness = round(((ref.length - counts.missed) / ref.length) * 100);

  // optional signals
  let wpm: number | null = null;
  let fluency: number | null = null;
  const dur = input.durationSeconds;
  if (typeof dur === "number" && Number.isFinite(dur) && dur >= MIN_SECONDS_FOR_PACE && heard.length >= MIN_WORDS_FOR_PACE) {
    wpm = round((heard.length / dur) * 60);
    fluency = round(paceScore(wpm));
  } else if (heard.length < MIN_WORDS_FOR_PACE) {
    notes.push("Speaking pace is not scored for very short texts.");
  }
  let clarity: number | null = null;
  if (typeof input.confidence === "number" && Number.isFinite(input.confidence) && input.confidence > 0) {
    clarity = round(clamp(input.confidence * 100));
  }

  // weighted overall over the parts that exist
  const parts: [number, number][] = [[accuracy, WEIGHTS.accuracy], [completeness, WEIGHTS.completeness]];
  if (fluency !== null) parts.push([fluency, WEIGHTS.fluency]);
  if (clarity !== null) parts.push([clarity, WEIGHTS.clarity]);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  let overall = parts.reduce((a, [v, w]) => a + v * w, 0) / wsum;
  overall -= Math.min(EXTRA_WORD_PENALTY_MAX, extra.length * EXTRA_WORD_PENALTY);
  overall = round(clamp(overall));

  if (extra.length) notes.push(`${extra.length} extra word${extra.length === 1 ? "" : "s"} heard that are not in the text.`);

  return {
    model_version: PRONUNCIATION_MODEL_VERSION, overall, band: bandOf(overall), accuracy, completeness,
    fluency, clarity, words_per_minute: wpm, words, extra_words: extra, counts, notes,
  };
}

// ── history ────────────────────────────────────────────────────────────────────────────────────────

export interface AttemptSummaryRow {
  language: string;
  overall: number;
  created_at: string;
  words?: { ref: string; status: WordStatus }[] | null;
}
export interface HistorySummary {
  attempts: number;
  average: number | null;
  best: number | null;
  recent_average: number | null;       // last 5 attempts
  earlier_average: number | null;      // the 5 before those
  direction: "improving" | "declining" | "steady" | null;
  tricky_words: { word: string; times_missed: number; attempts_seen: number }[];
}

/** `rows` newest first. A change of 5+ points between recent and earlier counts as movement. */
export function summariseHistory(rows: AttemptSummaryRow[], trickyLimit = 8): HistorySummary {
  if (!rows.length) return { attempts: 0, average: null, best: null, recent_average: null, earlier_average: null, direction: null, tricky_words: [] };
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const scores = rows.map((r) => r.overall);
  const recent = scores.slice(0, 5), earlier = scores.slice(5, 10);
  const recentAvg = avg(recent), earlierAvg = avg(earlier);
  let direction: HistorySummary["direction"] = null;
  if (recentAvg !== null && earlierAvg !== null) {
    direction = recentAvg - earlierAvg >= 5 ? "improving" : earlierAvg - recentAvg >= 5 ? "declining" : "steady";
  }
  const tally = new Map<string, { bad: number; seen: number }>();
  for (const r of rows) {
    for (const w of r.words ?? []) {
      const key = normaliseWord(w.ref);
      if (!key) continue;
      const t = tally.get(key) ?? { bad: 0, seen: 0 };
      t.seen++;
      if (w.status === "mispronounced" || w.status === "missed") t.bad++;
      tally.set(key, t);
    }
  }
  const tricky = [...tally.entries()]
    .filter(([, t]) => t.bad >= 2)
    .sort((a, b) => b[1].bad - a[1].bad || a[0].localeCompare(b[0]))
    .slice(0, trickyLimit)
    .map(([word, t]) => ({ word, times_missed: t.bad, attempts_seen: t.seen }));
  return { attempts: rows.length, average: avg(scores), best: Math.max(...scores), recent_average: recentAvg, earlier_average: earlierAvg, direction, tricky_words: tricky };
}
