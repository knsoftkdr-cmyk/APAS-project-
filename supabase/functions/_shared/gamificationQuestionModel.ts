// supabase/functions/_shared/gamificationQuestionModel.ts
//
// Pure logic (no Deno / Supabase / React imports) behind class-strict, never-repeating Gamification content.
// Used by _shared/handlers/gamificationQuestions.ts and unit-tested in src/test/gamificationQuestionModel.test.ts.
//
//   * classKey / gradeLevel      "Class 4", "4th", "IV" -> "4"; same rules as SQL public.class_key() and src/lib/Classsubjects.ts
//   * fingerprint                stable id for an item's *content* (case / spacing / punctuation / option order insensitive)
//   * validateItem               structure + class guard for AI-generated items (never trusted blindly)
//   * pickUnseen                 unseen-first selection
//   * serveItems                 orchestrator: candidates -> (generate if short) -> atomic claim; IO is injected so the
//                                whole flow (races, exhaustion, AI failure) is testable without a database.

export type GameType = "quick-quiz" | "word-scramble" | "match-pairs" | "category-sort" | "speed-tap" | "visual-memory";
export const GAME_TYPES: GameType[] = ["quick-quiz", "word-scramble", "match-pairs", "category-sort", "speed-tap", "visual-memory"];
export const isGameType = (v: unknown): v is GameType => typeof v === "string" && (GAME_TYPES as string[]).includes(v);

export type Difficulty = "easy" | "medium" | "hard";
export type AgeBand = "early_learners" | "explorers" | "thinkers" | "advanced";

// ── class / grade ──────────────────────────────────────────────────────────────────────────────────

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12" };

/** "Class 4", "class 4", "Grade 4", "4", "4th", "IV" -> "4". Nursery / LKG / UKG stay as words. */
export function classKey(raw?: string | null): string {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/\b(class|grade|std|standard)\b\.?/g, "")
    .replace(/\s+/g, "")
    .replace(/^(\d+)(st|nd|rd|th)$/, "$1");
  return ROMAN[s] ?? s;
}

/** nursery -3, lkg -2, ukg -1, "1".."12" -> number. null = not a class we recognise (the caller must refuse, never guess). */
export function gradeLevel(key: string): number | null {
  if (key === "nursery") return -3;
  if (key === "lkg") return -2;
  if (key === "ukg") return -1;
  if (/^\d{1,2}$/.test(key)) { const n = Number(key); return n >= 1 && n <= 12 ? n : null; }
  return null;
}

export function classLabel(key: string): string {
  if (key === "nursery") return "Nursery";
  if (key === "lkg") return "LKG";
  if (key === "ukg") return "UKG";
  return /^\d+$/.test(key) ? `Class ${key}` : key;
}

export function bandForGrade(level: number): AgeBand {
  return level <= 2 ? "early_learners" : level <= 6 ? "explorers" : level <= 10 ? "thinkers" : "advanced";
}

export const subjectKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function difficultyFromAccuracy(avg: number | null | undefined): Difficulty {
  if (avg == null || !Number.isFinite(avg) || avg < 50) return "easy";
  return avg < 75 ? "medium" : "hard";
}

// ── fingerprints ───────────────────────────────────────────────────────────────────────────────────

/** Folds case, unicode forms, quotes, sentence punctuation and spacing around operators; keeps maths symbols meaningful. */
export function normalizeText(input: unknown): string {
  let t = String(input ?? "").normalize("NFKC").toLowerCase();
  t = t.replace(/[\u2212\u2013\u2014]/g, "-").replace(/\*/g, "×");
  t = t.replace(/[?!,;:"'`\u201c\u201d\u2018\u2019\u00bf\u00a1]/g, " ");
  t = t.replace(/\.(?=\s|$)/g, " ");
  t = t.replace(/\s*([+\-×÷=<>/^%])\s*/g, "$1");
  return t.replace(/\s+/g, " ").trim();
}

function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const digest = (s: string) => cyrb53(s, 0).toString(36) + cyrb53(s, 7).toString(36);

// deno-lint-ignore no-explicit-any
type Any = any;

/** Fingerprint of an item's content. Identical content => identical fingerprint, regardless of formatting. */
export function fingerprintOf(gameType: GameType, p: Any): string {
  switch (gameType) {
    case "quick-quiz": return `q:${digest(normalizeText(p.question))}`;
    case "word-scramble": return `w:${digest(normalizeText(p.word))}`;
    case "match-pairs": return `p:${digest([normalizeText(p.a), normalizeText(p.b)].sort().join("|"))}`;
    case "category-sort": return `c:${digest(normalizeText(p.rule) + "|" + [normalizeText(p.leftLabel), normalizeText(p.rightLabel)].sort().join("|"))}`;
    case "speed-tap": return `s:${digest(normalizeText(p.instruction))}`;
    case "visual-memory": return `v:${digest((p.items as string[]).map(normalizeText).sort().join("|"))}`;
  }
}

// ── how much each game consumes ────────────────────────────────────────────────────────────────────

export interface ServeSpec { count: number; min: number }

/** `count` = what the game wants; `min` = fewest it can play properly (below this we refuse instead of burning items). */
export function serveSpec(gameType: GameType, band: AgeBand): ServeSpec {
  switch (gameType) {
    case "quick-quiz": return { count: 10, min: 5 };
    case "word-scramble": return { count: 10, min: 5 };
    case "match-pairs": return { count: band === "early_learners" ? 6 : band === "explorers" ? 8 : 12, min: 4 };
    case "category-sort": return { count: 3, min: 1 };
    case "speed-tap": return { count: 3, min: 1 };
    case "visual-memory": return { count: 4, min: 2 };
  }
}

// ── validation + class guard ───────────────────────────────────────────────────────────────────────

export type Checked<T> = { ok: true; item: T } | { ok: false; reason: string };
const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const uniq = (xs: string[]) => new Set(xs.map(normalizeText)).size === xs.length;

/** Largest whole number a child of this grade should meet. Conservative on purpose: wrong-class content is worse than a missing question. */
export function maxNumberForGrade(level: number): number {
  if (level <= 0) return 20;
  if (level === 1) return 100;
  if (level === 2) return 1000;
  if (level === 3) return 10000;
  if (level === 4) return 100000;
  if (level === 5) return 10000000;
  return Number.POSITIVE_INFINITY;
}

const ADVANCED_TERMS = ["derivative", "integral", "calculus", "trigonometr", "logarithm", "quadratic", "polynomial", "determinant", "matrix", "√", "sin(", "cos(", "tan("];
const UPPER_PRIMARY_TERMS = ["decimal", "percent", "algebra", "equation", "prime number", "lcm", "hcf", "square root"];

/**
 * Rejects text that visibly belongs to another class: an explicit other-class mention, numbers too large for the grade,
 * or topics well above it. A heuristic safety net on top of the prompt and the model's own `class` claim - it cannot
 * prove curriculum fit, it can only catch the obvious mistakes.
 */
export function classGuard(texts: string[], level: number, ownKey: string): string | null {
  const blob = texts.join(" \n ").toLowerCase();
  for (const m of blob.matchAll(/\b(?:class|grade|std|standard)\s*([0-9]{1,2}|[ivx]{1,4})\b/g)) {
    const k = classKey(m[1]);
    if (k !== ownKey) return `mentions another class (${m[0]})`;
  }
  const cap = maxNumberForGrade(level);
  if (Number.isFinite(cap)) {
    const stripped = blob.replace(/\b(?:class|grade|std|standard)\s*\d{1,2}\b/g, "");
    for (const m of stripped.matchAll(/\d[\d,]*/g)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(n) && n > cap) return `number ${n} is above the Class limit`;
    }
  }
  if (level <= 5) for (const t of ADVANCED_TERMS) if (blob.includes(t)) return `advanced topic "${t}"`;
  if (level <= 2) for (const t of UPPER_PRIMARY_TERMS) if (blob.includes(t)) return `upper-primary topic "${t}"`;
  return null;
}

export interface ValidateCtx { classKey: string; level: number }

function checkQuiz(p: Any): Checked<Any> {
  const question = str(p?.question, 260);
  const options = Array.isArray(p?.options) ? p.options.map((o: unknown) => str(o, 90)) : [];
  const ci = Number(p?.correctIndex);
  if (question.length < 4) return bad("question too short");
  if (options.length !== 4 || options.some((o: string) => !o)) return bad("needs exactly 4 non-empty options");
  if (!uniq(options)) return bad("duplicate options");
  if (!Number.isInteger(ci) || ci < 0 || ci > 3) return bad("correctIndex out of range");
  return { ok: true, item: { question, options, correctIndex: ci } };
}

function checkWord(p: Any): Checked<Any> {
  const word = str(p?.word, 20).toUpperCase();
  const hint = str(p?.hint, 140);
  if (!/^\p{L}{3,12}$/u.test(word)) return bad("word must be 3-12 letters, no spaces");
  if (hint.length < 5) return bad("hint too short");
  if (normalizeText(hint).includes(normalizeText(word))) return bad("hint gives the word away");
  return { ok: true, item: { word, hint } };
}

function checkPair(p: Any): Checked<Any> {
  const a = str(p?.a, 40), b = str(p?.b, 40);
  if (!a || !b) return bad("empty pair side");
  if (normalizeText(a) === normalizeText(b)) return bad("both sides identical");
  return { ok: true, item: { a, b } };
}

function checkSort(p: Any): Checked<Any> {
  const rule = str(p?.rule, 120), leftLabel = str(p?.leftLabel, 30), rightLabel = str(p?.rightLabel, 30);
  const clean = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 30)).filter(Boolean) : []);
  const leftItems = clean(p?.leftItems), rightItems = clean(p?.rightItems);
  if (!rule || !leftLabel || !rightLabel) return bad("missing rule or labels");
  if (normalizeText(leftLabel) === normalizeText(rightLabel)) return bad("labels identical");
  if (leftItems.length < 3 || leftItems.length > 8 || rightItems.length < 3 || rightItems.length > 8) return bad("each side needs 3-8 items");
  if (!uniq([...leftItems, ...rightItems])) return bad("an item appears twice / on both sides");
  return { ok: true, item: { rule, leftLabel, rightLabel, leftItems, rightItems } };
}

function checkSpeed(p: Any): Checked<Any> {
  const instruction = str(p?.instruction, 120);
  const clean = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 30)).filter(Boolean) : []);
  const targets = clean(p?.targets), distractors = clean(p?.distractors);
  if (!instruction) return bad("missing instruction");
  if (targets.length < 4 || targets.length > 10 || distractors.length < 4 || distractors.length > 10) return bad("needs 4-10 targets and 4-10 distractors");
  if (!uniq([...targets, ...distractors])) return bad("a target is also a distractor");
  return { ok: true, item: { instruction, targets, distractors } };
}

function checkVisual(p: Any): Checked<Any> {
  const items = Array.isArray(p?.items) ? p.items.map((x: unknown) => str(x, 30)).filter(Boolean) : [];
  if (items.length < 4 || items.length > 8) return bad("needs 4-8 items to memorise");
  if (!uniq(items)) return bad("duplicate items");
  const qs = Array.isArray(p?.questions) ? p.questions : [];
  const questions: Any[] = [];
  for (const q of qs) { const c = checkQuiz(q); if (c.ok) questions.push(c.item); }
  if (questions.length < 1) return bad("needs at least one valid question");
  return { ok: true, item: { items, questions: questions.slice(0, 3) } };
}

/** Structure + class guard. Generated items must also declare the class they were written for, and it must be the student's. */
export function validateItem(gameType: GameType, raw: Any, ctx: ValidateCtx, opts: { requireClassClaim?: boolean; trusted?: boolean } = {}): Checked<Any> {
  if (!raw || typeof raw !== "object") return bad("not an object");
  const checked =
    gameType === "quick-quiz" ? checkQuiz(raw) :
    gameType === "word-scramble" ? checkWord(raw) :
    gameType === "match-pairs" ? checkPair(raw) :
    gameType === "category-sort" ? checkSort(raw) :
    gameType === "speed-tap" ? checkSpeed(raw) : checkVisual(raw);
  if (!checked.ok) return checked;

  if (opts.requireClassClaim) {
    const claimed = classKey(typeof raw.class === "string" || typeof raw.class === "number" ? String(raw.class) : "");
    if (claimed !== ctx.classKey) return bad(`written for class "${claimed || "?"}", not "${ctx.classKey}"`);
  }
  if (opts.trusted) return checked; // teacher-approved question_bank rows: structure only, the bank is authoritative for its class
  const it = checked.item;
  const texts: string[] =
    gameType === "quick-quiz" ? [it.question, ...it.options] :
    gameType === "word-scramble" ? [it.word, it.hint] :
    gameType === "match-pairs" ? [it.a, it.b] :
    gameType === "category-sort" ? [it.rule, it.leftLabel, it.rightLabel, ...it.leftItems, ...it.rightItems] :
    gameType === "speed-tap" ? [it.instruction, ...it.targets, ...it.distractors] :
    [...it.items, ...it.questions.flatMap((q: Any) => [q.question, ...q.options])];
  const why = classGuard(texts, ctx.level, ctx.classKey);
  return why ? bad(why) : checked;
}

// ── selection ──────────────────────────────────────────────────────────────────────────────────────

export interface Candidate {
  fingerprint: string;
  payload: Any;
  source: "bank" | "pool" | "ai";
  poolItemId?: string | null;
  /** class the item is tagged for; anything not equal to the student's class is dropped */
  classKey: string;
}

export function shuffled<T>(xs: T[], rng: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Unseen-first: drops seen fingerprints and in-list duplicates (and anything tagged for another class), then shuffles. */
export function pickUnseen(cands: Candidate[], seen: ReadonlySet<string>, count: number, ownClassKey: string, rng: () => number = Math.random): Candidate[] {
  if (count <= 0) return [];
  const taken = new Set<string>();
  const ok: Candidate[] = [];
  for (const c of cands) {
    if (c.classKey !== ownClassKey) continue;       // defence in depth: SQL already filters by class
    if (seen.has(c.fingerprint) || taken.has(c.fingerprint)) continue;
    taken.add(c.fingerprint);
    ok.push(c);
  }
  return shuffled(ok, rng).slice(0, count);
}

// ── AI generation prompt + parsing ─────────────────────────────────────────────────────────────────

const SHAPES: Record<GameType, string> = {
  "quick-quiz": `{"class":"<class>","question":"...","options":["...","...","...","..."],"correctIndex":0-3}  (exactly 4 distinct options; exactly one correct)`,
  "word-scramble": `{"class":"<class>","word":"ONEWORD","hint":"a clue that does NOT contain the word"}  (3-12 letters, one word)`,
  "match-pairs": `{"class":"<class>","a":"term","b":"its match"}  (short; a and b differ)`,
  "category-sort": `{"class":"<class>","rule":"Sort the items","leftLabel":"Group A","rightLabel":"Group B","leftItems":["3-6 items"],"rightItems":["3-6 items"]}  (no item in both groups)`,
  "speed-tap": `{"class":"<class>","instruction":"Tap all the ...","targets":["4-8 items that match"],"distractors":["4-8 items that do not"]}`,
  "visual-memory": `{"class":"<class>","items":["4-6 short things to memorise"],"questions":[{"question":"... (about the items shown)","options":["...","...","...","..."],"correctIndex":0-3}]}  (1-2 questions per set)`,
};

export function buildGenerationPrompt(a: {
  gameType: GameType; classLabel: string; subject: string; difficulty: Difficulty; count: number;
  curriculum: string[]; avoid: string[]; seed: number; curriculumName?: string | null;
}): { system: string; prompt: string } {
  const system = "You write school game content. Output strict JSON only: {\"items\":[...]}. No markdown, no commentary.";
  const prompt = [
    `Create ${a.count} DIFFERENT "${a.gameType}" items for a ${a.classLabel} student studying ${a.subject}${a.curriculumName ? ` (${a.curriculumName} curriculum)` : ""}.`,
    `Difficulty: ${a.difficulty}. Content MUST suit ${a.classLabel} exactly: nothing from a higher class, no numbers or ideas beyond what ${a.classLabel} students are taught.`,
    a.curriculum.length ? `Base items on these ${a.classLabel} ${a.subject} topics / learning objectives (mix them):\n- ${a.curriculum.join("\n- ")}` : `Use typical ${a.classLabel} ${a.subject} content.`,
    `Vary wording, examples, numerical values and sub-topics from item to item. Each item must stand alone and have a single clearly correct answer.`,
    a.avoid.length ? `Do NOT repeat or lightly reword any of these already used items:\n- ${a.avoid.join("\n- ")}` : "",
    `Every item must include "class": "${a.classLabel}".`,
    `Item shape: ${SHAPES[a.gameType]}`,
    `Variation seed (ignore, just be different): ${a.seed}`,
  ].filter(Boolean).join("\n\n");
  return { system, prompt };
}

/** Tolerant: accepts {"items":[...]}, a bare array, or fenced JSON. Returns [] when nothing usable. */
export function parseGeneratedItems(text: string): Any[] {
  const cleaned = String(text ?? "").replace(/```(?:json)?/gi, "").trim();
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  let v = tryParse(cleaned);
  if (v == null) {
    const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) v = tryParse(cleaned.slice(a, b + 1));
  }
  if (v == null) {
    const a = cleaned.indexOf("["), b = cleaned.lastIndexOf("]");
    if (a >= 0 && b > a) v = tryParse(cleaned.slice(a, b + 1));
  }
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.items)) return v.items;
  return [];
}

/** Validates a raw AI batch into candidates; invalid items are dropped and counted, duplicates inside the batch collapse. */
export function candidatesFromGenerated(gameType: GameType, raw: Any[], ctx: ValidateCtx): { items: Candidate[]; rejected: { reason: string }[] } {
  const items: Candidate[] = [];
  const rejected: { reason: string }[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const v = validateItem(gameType, r, ctx, { requireClassClaim: true });
    if (!v.ok) { rejected.push({ reason: v.reason }); continue; }
    const fingerprint = fingerprintOf(gameType, v.item);
    if (seen.has(fingerprint)) { rejected.push({ reason: "duplicate inside batch" }); continue; }
    seen.add(fingerprint);
    items.push({ fingerprint, payload: v.item, source: "ai", classKey: ctx.classKey });
  }
  return { items, rejected };
}

// ── serve orchestrator ─────────────────────────────────────────────────────────────────────────────

export interface ServeDeps {
  /** Eligible items for this exact school + class + subject + game type (pool rows, question bank). */
  loadCandidates(): Promise<Candidate[]>;
  /** Fingerprints this student has already been served for this class + subject (any game type). */
  loadSeen(): Promise<Set<string>>;
  /** Ask the AI for `need` new items. May throw. Must already be validated + class-tagged (the closure knows readable stems to avoid). */
  generate(need: number): Promise<Candidate[]>;
  /** Persist generated items so every student in the same school + class can reuse them. Idempotent. */
  savePool(items: Candidate[]): Promise<Candidate[]>;
  /** ATOMIC: records history rows and returns only the fingerprints THIS call inserted (unique constraint arbitrates races). */
  claim(items: Candidate[]): Promise<string[]>;
}

export type GenerationStatus = "not_needed" | "ok" | "partial" | "failed";
export interface ServeResult {
  items: Candidate[];
  served: number;
  requested: number;
  min: number;
  exhausted: boolean;       // no fresh set of at least `min` items exists: nothing was served and nothing was consumed
  short: boolean;           // served fewer than requested (low pool, or a lost race for the last few items)
  generation: GenerationStatus;
  generationError?: string;
}

export async function serveItems(deps: ServeDeps, spec: ServeSpec, ownClassKey: string, rng: () => number = Math.random): Promise<ServeResult> {
  const got: Candidate[] = [];
  let generation: GenerationStatus = "not_needed";
  let generationError: string | undefined;
  let generationTried = false;

  for (let attempt = 0; attempt < 4 && got.length < spec.count; attempt++) {
    const [seen, cands] = await Promise.all([deps.loadSeen(), deps.loadCandidates()]);
    for (const g of got) seen.add(g.fingerprint);
    const available = pickUnseen(cands, seen, spec.count - got.length, ownClassKey, rng);

    // Not enough fresh items for a full game: top up with newly generated ones once. Previous-session questions are never reused.
    if (available.length < spec.count - got.length && !generationTried) {
      generationTried = true;
      try {
        const fresh = await deps.generate(Math.max(spec.count * 2, 12));
        const saved = fresh.length ? await deps.savePool(fresh) : [];
        generation = saved.length >= (spec.count - got.length - available.length) ? "ok" : saved.length ? "partial" : "failed";
        if (!saved.length) generationError = "No new questions could be created for this class right now.";
      } catch (e) {
        generation = "failed";
        generationError = e instanceof Error ? e.message : String(e);
      }
      attempt--; // re-read candidates after generation without spending an attempt
      continue;
    }

    // Do not burn items on a set that can't be played: only claim when the whole fresh set reaches `min`.
    if (got.length + available.length < spec.min) break;
    if (!available.length) break;

    const won = new Set(await deps.claim(available));
    for (const c of available) if (won.has(c.fingerprint)) got.push(c);
    // lost races (another request claimed the same item first) simply loop and top up
  }

  // `min` is checked BEFORE claiming, so a normal call never consumes items it can't play. The only way to end up with
  // 1..min-1 claimed items is losing a race for the last few; those are already recorded as served, so they are returned, not wasted.
  const exhausted = got.length === 0;
  return {
    items: got,
    served: got.length,
    requested: spec.count,
    min: spec.min,
    exhausted,
    short: !exhausted && got.length < spec.count,
    generation,
    generationError,
  };
}

/** Message shown to the student when no fresh questions could be served. */
export function exhaustedMessage(subject: string, generation: GenerationStatus): string {
  return generation === "failed"
    ? `You've used every ${subject} question we have for your class, and we couldn't create new ones right now. Try another subject, or check back a little later.`
    : `You've played every ${subject} question available for your class so far. Try another subject, or check back soon for new ones.`;
}
