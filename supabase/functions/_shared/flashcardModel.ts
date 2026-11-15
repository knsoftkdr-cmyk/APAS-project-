// supabase/functions/_shared/flashcardModel.ts
//
// Pure rules for AI Auto Flashcards (no I/O, no Deno / browser APIs, so the edge handler, the React app and the
// unit tests all share one implementation).
//
//   * what a card is, and the four card types
//   * the generation prompt (built ONLY from the student's own syllabus material)
//   * validation + GROUNDING: a generated card is kept only if the passage it cites really occurs in the source
//     text that was sent to the model, and its answer is made of words found in that material
//   * the Easy / Medium / Difficult -> SM-2 style scheduler
//   * study-queue ordering (due first, difficult more often, a few new cards per session)

export const CARD_TYPES = ["definition", "concept", "fact", "qa"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const RATINGS = ["easy", "medium", "difficult"] as const;
export type Rating = (typeof RATINGS)[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  definition: "Definition",
  concept: "Concept",
  fact: "Important fact",
  qa: "Question & answer",
};

export const isCardType = (v: unknown): v is CardType => typeof v === "string" && (CARD_TYPES as readonly string[]).includes(v);
export const isRating = (v: unknown): v is Rating => typeof v === "string" && (RATINGS as readonly string[]).includes(v);

// ── limits ──────────────────────────────────────────────────────────────────────────────────────────
export const MIN_CARDS = 3;
export const MAX_CARDS = 15;
export const DEFAULT_CARDS = 10;
export const MAX_SOURCE_CHARS = 9000;       // text sent to the model per topic
export const MIN_SOURCE_CHARS = 200;        // below this there is not enough material to build honest cards
export const NEW_CARDS_PER_SESSION = 5;     // new cards mixed into a study session (so it never feels like a wall)
export const MAX_QUEUE = 30;
export const RELEARN_MINUTES = 10;          // a Difficult card is shown again after this long
export const MAX_INTERVAL_DAYS = 180;
export const MAX_REPORTS_BEFORE_RETIRE = 3;

// ── text helpers ────────────────────────────────────────────────────────────────────────────────────

/** Lower-cases, folds unicode forms/quotes/dashes, drops punctuation and collapses whitespace. */
export function norm(input: unknown): string {
  return String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201c\u201d`"']/g, "")
    .replace(/[^\p{L}\p{N}%°+\-×÷=<>/^.]+/gu, " ")
    .replace(/(?<![\p{N}])\.|\.(?![\p{N}])/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "was", "were", "be", "it", "its", "this", "that",
  "for", "with", "as", "by", "at", "from", "which", "who", "what", "when", "where", "how", "why", "can", "has", "have",
  "had", "do", "does", "not", "but", "also", "into", "than", "then", "they", "their", "there", "these", "those", "such",
]);

const words = (s: string) => norm(s).split(" ").filter(Boolean);
const contentWords = (s: string) => words(s).filter((w) => w.length >= 3 && !STOP.has(w));

/** Stable fingerprint of a question (two independent 32-bit FNV-1a hashes -> 16 hex chars). */
export function questionHash(question: string): string {
  const t = norm(question);
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ── source material ─────────────────────────────────────────────────────────────────────────────────

export interface SourceChunk { page?: number | null; text: string; content_type?: string | null }
export interface SourceBundle { text: string; pages: number[]; chunks: number; grounding: "textbook" | "syllabus" }

/** Textbook text that TEACHES. Worksheets / exercises / assessments hold questions, not facts, so they come last. */
const TEACHING_RANK: Record<string, number> = { LESSON_CONCEPT: 0, EXAMPLE: 1 };

/**
 * Picks the textbook chunks to send, teaching text first, in page order, until the character budget is used.
 * Returns null when there is not enough real material - the caller must say so instead of inventing cards.
 */
export function buildSource(chunks: SourceChunk[], outline: string, budget = MAX_SOURCE_CHARS): SourceBundle | null {
  const clean = chunks
    .map((c) => ({ ...c, text: String(c.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((c) => c.text.length >= 40);

  const teaching = clean.filter((c) => (TEACHING_RANK[String(c.content_type ?? "")] ?? 9) < 9);
  const pool = teaching.length ? teaching : clean;
  const ordered = [...pool].sort((a, b) =>
    (TEACHING_RANK[String(a.content_type ?? "")] ?? 9) - (TEACHING_RANK[String(b.content_type ?? "")] ?? 9) ||
    (a.page ?? 1e9) - (b.page ?? 1e9));

  const picked: typeof clean = [];
  let used = 0;
  for (const c of ordered) {
    if (used + c.text.length > budget) {
      const room = budget - used;
      if (room >= 200 && picked.length === 0) picked.push({ ...c, text: c.text.slice(0, room) });   // one big chunk: truncate, don't drop
      continue;
    }
    picked.push(c);
    used += c.text.length;
  }
  picked.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9));

  const text = picked.map((c) => (c.page != null ? `[p.${c.page}] ${c.text}` : c.text)).join("\n\n");
  if (text.replace(/\[p\.\d+\]/g, "").trim().length >= MIN_SOURCE_CHARS) {
    return { text, pages: [...new Set(picked.map((c) => c.page).filter((p): p is number => typeof p === "number"))], chunks: picked.length, grounding: "textbook" };
  }

  // No usable textbook text: fall back to the syllabus outline (topic / concept descriptions + learning objectives).
  const o = String(outline ?? "").replace(/[ \t]+/g, " ").trim();
  if (o.length >= MIN_SOURCE_CHARS) return { text: o.slice(0, budget), pages: [], chunks: 0, grounding: "syllabus" };
  return null;
}

// ── generation prompt ───────────────────────────────────────────────────────────────────────────────

export interface PromptInput {
  classLabel: string;
  level: number;                      // -3 nursery ... 12
  subject: string;
  chapter: string;
  topic: string;
  curriculumName?: string | null;
  source: SourceBundle;
  types: CardType[];
  count: number;
  objectives: { id: number; text: string }[];
  avoid: string[];                    // questions the student / class already has for this topic
}

function languageGuidance(level: number): string {
  if (level <= 2) return "Write for a young child: very short sentences (under 12 words), everyday words, no jargon.";
  if (level <= 6) return "Write for a primary-school child: short, clear sentences and simple words; explain any new term in plain language.";
  if (level <= 10) return "Write for a middle-school student: clear sentences, correct subject terms as used in the textbook.";
  return "Write for a senior-school student: precise subject vocabulary as used in the textbook.";
}

const TYPE_RULES: Record<CardType, string> = {
  definition: 'definition: "What is / What do we call ...?" - the answer is a definition that appears in the material.',
  concept: 'concept: "Why / How does ... work?" - the answer explains an idea or process the material explains.',
  fact: 'fact: one important fact worth remembering (a name, number, date, rule, property) stated in the material.',
  qa: 'qa: a direct exam-style question whose answer is stated in the material.',
};

export function buildPrompt(p: PromptInput): { system: string; prompt: string } {
  const system =
    "You create revision flashcards for school students from the textbook material you are given. " +
    "You output strict JSON only. No markdown, no commentary. You never use outside knowledge: " +
    "every card must be answerable from, and quoted evidence taken from, the material.";
  const count = Math.max(MIN_CARDS, Math.min(MAX_CARDS, p.count));
  const types = p.types.length ? p.types : [...CARD_TYPES];
  const objectives = p.objectives.slice(0, 12).map((o) => `  ${o.id}: ${o.text}`).join("\n");
  const avoid = p.avoid.slice(-25).map((q) => `- ${q.slice(0, 110)}`).join("\n");

  const prompt = [
    `Student: ${p.classLabel}. Subject: ${p.subject}${p.curriculumName ? ` (${p.curriculumName})` : ""}. Chapter: ${p.chapter}. Topic: ${p.topic}.`,
    languageGuidance(p.level),
    "",
    `Make up to ${count} flashcards using ONLY the MATERIAL below. Spread them across these card types:`,
    ...types.map((t) => `- ${TYPE_RULES[t]}`),
    "",
    "Rules:",
    "1. Each card is self-contained: the question must make sense without seeing the material (never write \"according to the passage/text\").",
    "2. The answer must be correct according to the material and short (1-3 sentences). Do not add facts that are not in the material.",
    "3. \"evidence\" must be a passage copied word-for-word from the material (30-300 characters) that proves the answer. Do not include the [p.N] markers in it.",
    "4. If the material does not support a good card of some type, skip it. Fewer correct cards are better than more doubtful ones.",
    "5. No two cards may ask the same thing. Do not repeat these existing questions:",
    avoid || "- (none)",
    "6. \"objective_id\" is the id of the learning objective below that the card best supports, or null if none fits.",
    "7. \"difficulty\" is easy, medium or hard for a student of this class.",
    "8. \"hint\" is an optional gentle clue (max 12 words) that does NOT give the answer away.",
    "",
    objectives ? `Learning objectives (id: text):\n${objectives}\n` : "",
    `Return JSON: {"cards":[{"type":"definition|concept|fact|qa","question":"...","answer":"...","hint":"...","evidence":"...","difficulty":"easy|medium|hard","objective_id":null}]}`,
    "",
    "MATERIAL:",
    p.source.text,
  ].join("\n");

  return { system, prompt };
}

// ── parse + validate ────────────────────────────────────────────────────────────────────────────────

/** Accepts {cards:[...]}, a bare array, or JSON wrapped in a code fence. Returns [] for anything unusable. */
export function parseGenerated(text: string): unknown[] {
  let t = String(text ?? "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(t);
  if (v === undefined) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) v = tryParse(t.slice(a, b + 1));
    if (v === undefined) { const c = t.indexOf("["), d = t.lastIndexOf("]"); if (c >= 0 && d > c) v = tryParse(t.slice(c, d + 1)); }
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray((v as { cards?: unknown }).cards)) return (v as { cards: unknown[] }).cards;
  return [];
}

export interface ValidCard {
  card_type: CardType;
  question: string;
  answer: string;
  hint: string | null;
  difficulty: "easy" | "medium" | "hard";
  source_excerpt: string;
  learning_objective_id: number | null;
  question_hash: string;
}
export type CardVerdict = { ok: true; card: ValidCard } | { ok: false; reason: string };

const SELF_REFERENCE = /\b(according to (the|this) (passage|text|material|excerpt|chapter)|in (the|this) (passage|text|excerpt)|the (passage|excerpt) (says|states|mentions))\b/i;
const AI_TALK = /\b(as an ai|language model|i cannot|i can't)\b/i;

/**
 * Is the quoted evidence really in the source? Exact match after normalisation, or - to survive OCR line breaks and
 * hyphenation - at least 90% of the evidence's words appearing in order-insensitive form AND as a contiguous run of >= 6 words.
 */
export function evidenceInSource(evidence: string, source: string): boolean {
  const e = norm(evidence.replace(/\[p\.\d+\]/g, " "));
  const s = norm(source.replace(/\[p\.\d+\]/g, " "));
  if (e.length < 20) return false;
  if (s.includes(e)) return true;
  const ew = e.split(" ");
  if (ew.length < 6) return false;
  const sw = s.split(" ");
  const sset = new Set(sw);
  if (ew.filter((w) => sset.has(w)).length / ew.length < 0.9) return false;
  // contiguous run of 6 evidence words must appear in the source, so a bag-of-words shuffle can't pass
  const joined = ` ${sw.join(" ")} `;
  for (let i = 0; i + 6 <= ew.length; i++) if (joined.includes(` ${ew.slice(i, i + 6).join(" ")} `)) return true;
  return false;
}

/** Share of the answer's content words that occur in the source (or the question). Guards against invented answers. */
export function answerSupport(answer: string, question: string, source: string): number {
  const aw = [...new Set(contentWords(answer))];
  if (!aw.length) return 0;
  const pool = new Set([...contentWords(source), ...contentWords(question)]);
  // numbers/short tokens count too: a wrong figure must not slip through
  const nums = [...new Set(words(answer).filter((w) => /\d/.test(w)))];
  const numbersOk = nums.every((n) => norm(source).includes(n) || norm(question).includes(n));
  if (!numbersOk) return 0;
  return aw.filter((w) => pool.has(w)).length / aw.length;
}

export const MIN_ANSWER_SUPPORT = 0.6;

export interface ValidateCtx { source: SourceBundle; allowedTypes: CardType[]; objectiveIds: Set<number> }

export function validateCard(raw: unknown, ctx: ValidateCtx): CardVerdict {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_an_object" };
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? r.card_type ?? "").toLowerCase().trim();
  if (!isCardType(type)) return { ok: false, reason: "bad_type" };
  if (!ctx.allowedTypes.includes(type)) return { ok: false, reason: "type_not_requested" };

  const question = String(r.question ?? "").replace(/\s+/g, " ").trim();
  const answer = String(r.answer ?? "").replace(/\s+/g, " ").trim();
  const evidence = String(r.evidence ?? "").replace(/\s+/g, " ").trim();
  if (question.length < 8 || question.length > 300) return { ok: false, reason: "question_length" };
  if (answer.length < 1 || answer.length > 600) return { ok: false, reason: "answer_length" };
  if (norm(question) === norm(answer)) return { ok: false, reason: "question_equals_answer" };
  if (SELF_REFERENCE.test(question) || AI_TALK.test(question) || AI_TALK.test(answer)) return { ok: false, reason: "not_self_contained" };
  if (!/[?]$|^(complete|name|state|define|give|write|list|fill)\b/i.test(question) && type !== "fact") return { ok: false, reason: "not_a_question" };

  if (!evidenceInSource(evidence, ctx.source.text)) return { ok: false, reason: "evidence_not_in_source" };
  if (answerSupport(answer, question, ctx.source.text) < MIN_ANSWER_SUPPORT) return { ok: false, reason: "answer_not_supported" };
  // the question must not simply contain the whole answer (a "give-away" card teaches nothing)
  if (norm(answer).length >= 12 && norm(question).includes(norm(answer))) return { ok: false, reason: "answer_in_question" };

  let hint: string | null = String(r.hint ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  if (hint && norm(answer).length >= 6 && norm(hint).includes(norm(answer))) hint = null;   // a hint that IS the answer is dropped, the card is kept

  const diff = String(r.difficulty ?? "medium").toLowerCase();
  const difficulty = diff === "easy" || diff === "hard" ? diff : "medium";
  const oid = Number(r.objective_id);
  const learning_objective_id = Number.isInteger(oid) && ctx.objectiveIds.has(oid) ? oid : null;

  return {
    ok: true,
    card: {
      card_type: type, question, answer, hint, difficulty,
      source_excerpt: evidence.slice(0, 400), learning_objective_id, question_hash: questionHash(question),
    },
  };
}

export interface ValidationReport { cards: ValidCard[]; rejected: Record<string, number>; total: number }

/** Validates a batch, drops duplicates (within the batch and against `existingHashes`), keeps at most `max`. */
export function validateBatch(rawCards: unknown[], ctx: ValidateCtx, existingHashes: Set<string>, max: number): ValidationReport {
  const out: ValidCard[] = [];
  const rejected: Record<string, number> = {};
  const seen = new Set(existingHashes);
  for (const raw of rawCards) {
    const v = validateCard(raw, ctx);
    if (!v.ok) { rejected[v.reason] = (rejected[v.reason] ?? 0) + 1; continue; }
    if (seen.has(v.card.question_hash)) { rejected.duplicate = (rejected.duplicate ?? 0) + 1; continue; }
    seen.add(v.card.question_hash);
    if (out.length < max) out.push(v.card);
  }
  return { cards: out, rejected, total: rawCards.length };
}

// ── scheduling (Easy / Medium / Difficult -> SM-2 style) ────────────────────────────────────────────

export interface CardSchedule { ease_factor: number; interval_days: number; repetitions: number; lapses: number }
export interface ScheduleResult extends CardSchedule { due_at: Date; correct: boolean }

export const NEW_SCHEDULE: CardSchedule = { ease_factor: 2.5, interval_days: 0, repetitions: 0, lapses: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Difficult  -> back in RELEARN_MINUTES, repetition ladder resets, ease drops, lapse counted.
 * Medium     -> 1 day, then 3 days, then previous x ease x 0.85 (grows slowly).
 * Easy       -> 3 days, then 7 days, then previous x ease x 1.3 (grows fast); ease rises.
 * For the SAME previous state: easy interval >= medium interval >= difficult interval, always.
 */
export function nextSchedule(prev: CardSchedule | null, rating: Rating, now: Date): ScheduleResult {
  const p = prev ?? NEW_SCHEDULE;
  let { ease_factor: ease, interval_days: interval, repetitions: reps, lapses } = p;

  if (rating === "difficult") {
    reps = 0;
    lapses += 1;
    ease = clamp(ease - 0.2, 1.3, 3.0);
    interval = 0;
    return { ease_factor: round2(ease), interval_days: 0, repetitions: 0, lapses, due_at: new Date(now.getTime() + RELEARN_MINUTES * 60_000), correct: false };
  }

  reps += 1;
  if (rating === "medium") {
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.max(p.interval_days + 1, Math.round(p.interval_days * ease * 0.85));
  } else {
    interval = reps === 1 ? 3 : reps === 2 ? 7 : Math.max(p.interval_days + 2, Math.round(p.interval_days * ease * 1.3));
    ease = clamp(ease + 0.15, 1.3, 3.0);
  }
  interval = clamp(interval, 1, MAX_INTERVAL_DAYS);
  return { ease_factor: round2(ease), interval_days: interval, repetitions: reps, lapses, due_at: new Date(now.getTime() + interval * 86_400_000), correct: true };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "in 10 min" / "tomorrow" / "in 3 days" / "in 2 weeks" - used on the rating buttons. */
export function intervalLabel(from: Date, to: Date): string {
  const mins = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

// ── card state + progress ───────────────────────────────────────────────────────────────────────────

export interface Progress {
  times_seen: number; times_correct: number; interval_days: number; repetitions: number;
  last_rating: Rating | null; due_at: string | Date; ease_factor?: number; lapses?: number;
}
export type CardState = "new" | "learning" | "reviewing" | "mastered";

/** new = never rated; learning = last rating Difficult or fewer than 2 good repetitions; mastered = interval >= 21 days. */
export function cardState(p: Progress): CardState {
  if (p.times_seen === 0) return "new";
  if (p.last_rating === "difficult" || p.repetitions < 2) return "learning";
  return p.interval_days >= 21 ? "mastered" : "reviewing";
}

export interface DeckStats {
  total: number; new: number; learning: number; reviewing: number; mastered: number;
  due_now: number; due_today: number; due_next_7_days: number;
  reviews: number; correct: number; accuracy: number | null;
}

export function summarizeDeck(rows: Progress[], now: Date): DeckStats {
  const s: DeckStats = { total: rows.length, new: 0, learning: 0, reviewing: 0, mastered: 0, due_now: 0, due_today: 0, due_next_7_days: 0, reviews: 0, correct: 0, accuracy: null };
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  for (const r of rows) {
    s[cardState(r)] += 1;
    s.reviews += r.times_seen;
    s.correct += r.times_correct;
    const due = new Date(r.due_at);
    if (due <= now) s.due_now += 1;                                       // mutually exclusive buckets, like the Daily Review forecast
    else if (due <= endOfToday) s.due_today += 1;
    else if (due <= in7) s.due_next_7_days += 1;
  }
  s.accuracy = s.reviews > 0 ? Math.round((s.correct / s.reviews) * 100) : null;
  return s;
}

// ── study queue ─────────────────────────────────────────────────────────────────────────────────────

export interface QueueCard { id: string; progress: Progress | null }

/** Higher = shown sooner. Overdue time, lapses and a low ease factor (the student finds it hard) all raise it. */
export function dueUrgency(p: Progress, now: Date): number {
  const overdueDays = Math.max(0, (now.getTime() - new Date(p.due_at).getTime()) / 86_400_000);
  const lapses = p.lapses ?? 0;
  const hard = (p.ease_factor ?? 2.5) < 2.0 ? 1 : 0;
  const justMissed = p.last_rating === "difficult" ? 2 : 0;
  return overdueDays + lapses * 0.5 + hard * 0.5 + justMissed;
}

/** Due cards (most urgent first), then up to `newLimit` never-seen cards. */
export function orderStudyQueue<T extends QueueCard>(cards: T[], now: Date, limit = MAX_QUEUE, newLimit = NEW_CARDS_PER_SESSION): T[] {
  const due = cards
    .filter((c) => c.progress && c.progress.times_seen > 0 && new Date(c.progress.due_at) <= now)
    .sort((a, b) => dueUrgency(b.progress!, now) - dueUrgency(a.progress!, now));
  const fresh = cards.filter((c) => !c.progress || c.progress.times_seen === 0).slice(0, newLimit);
  return [...due, ...fresh].slice(0, limit);
}

/**
 * Inside one study session a Difficult card is put back a few cards later (at most `maxRepeats` times) so the student
 * sees it again before the session ends; Easy / Medium cards leave the session.
 */
export function requeueAfterRating<T extends { id: string }>(queue: T[], index: number, rating: Rating, repeats: Map<string, number>, maxRepeats = 2, gap = 4): T[] {
  if (rating !== "difficult") return queue;
  const card = queue[index];
  if (!card) return queue;
  const used = repeats.get(card.id) ?? 0;
  if (used >= maxRepeats) return queue;
  repeats.set(card.id, used + 1);
  const next = [...queue];
  next.splice(Math.min(next.length, index + 1 + gap), 0, card);
  return next;
}

/** Daily Review integration: a Difficult card brings its objective's MCQ review forward; Easy/Medium never delay it. */
export function pullForwardDays(rating: Rating): number | null {
  return rating === "difficult" ? 1 : null;
}
