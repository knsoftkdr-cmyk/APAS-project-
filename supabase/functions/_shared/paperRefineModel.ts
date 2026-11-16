// supabase/functions/_shared/paperRefineModel.ts
//
// CHAT TO REFINE QUESTIONS - pure model (no Deno / DOM globals), shared by the Teacher Copilot edge handler
// (_shared/handlers/teacherCopilot.ts), the paper-save handler (_shared/handlers/buildManualPaper.ts) and the
// browser (src/lib/paperRefine.ts). One definition of "a valid question" for all three, so what the AI is
// allowed to propose, what the UI shows and what the server will save can never drift apart.
//
// Nothing here trusts the model: every suggestion is re-validated, scoped to the active paper, and checked
// against the paper's marks before it can reach the teacher.

export const QUESTION_TYPES = ["mcq", "descriptive", "case_based", "hots", "competency", "scenario"] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export const WRITTEN_TYPES: readonly QuestionType[] = ["descriptive", "case_based", "hots", "competency", "scenario"];
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = typeof DIFFICULTIES[number];
export const BLOOM_LEVELS = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;
export const OPTION_KEYS = ["A", "B", "C", "D"] as const;

export const MAX_PAPER_QUESTIONS = 100;
export const MAX_SUGGESTIONS = 20;
export const MAX_STEM = 2000;
export const MAX_TEXT = 4000;
export const MAX_MARKS = 100;

export interface SubQuestion { id: string; text: string; max_marks: number }

/** A question as it sits in a paper (existing or proposed). */
export interface PaperQuestion {
  key: string;                          // "mcq:<uuid>" | "extended:<uuid>" | "draft:<uuid>"
  type: QuestionType;
  stem: string;
  options?: Record<string, string>;
  correct_option?: string;
  explanation?: string | null;
  context_passage?: string | null;
  sub_questions?: SubQuestion[];
  model_answer?: string | null;
  difficulty: Difficulty | null;
  bloom_level: string | null;
  marks: number;
  topic?: string | null;
  learning_objective_id?: number | null;
}

export interface PaperObjective { id: number; text: string }

export interface PaperContext {
  title: string;
  class_name: string | null;
  subject: string | null;
  chapter: string | null;
  total_marks: number;                  // current sum of question marks
  target_total_marks: number | null;    // teacher-configured total to preserve (null = not locked)
  duration_minutes: number | null;
  instructions: string[];
  objectives: PaperObjective[];
  questions: PaperQuestion[];
}

export type SuggestionAction = "revise" | "add" | "marks";

export interface QuestionDraft {
  type: QuestionType;
  stem: string;
  options?: Record<string, string>;
  correct_option?: string;
  explanation?: string | null;
  context_passage?: string | null;
  sub_questions?: SubQuestion[];
  model_answer?: string | null;
  difficulty: Difficulty;
  bloom_level: string | null;
  marks: number;
  learning_objective_id: number | null;
}

export interface Suggestion {
  id: string;
  action: SuggestionAction;
  target_key: string | null;            // null for "add"
  target_number: number | null;         // 1-based position in the paper when the suggestion was made
  reason: string;
  proposed: QuestionDraft;              // for "marks": the original question with the new marks
  original_marks: number | null;
  original_difficulty: Difficulty | null;
  marks_delta: number;
  similar_to: number[];                 // paper question numbers this looks like (warning only)
}

export type FindingType = "duplicate" | "coverage" | "balance" | "quality" | "difficulty" | "marks" | "other";
export interface Finding { type: FindingType; text: string; question_numbers: number[] }

export interface TotalCheck { current: number; target: number | null; projected: number; ok: boolean }

export interface RefineResult {
  reply: string;
  clarification: string | null;
  findings: Finding[];
  suggestions: Suggestion[];
  rejected: string[];                   // human-readable reasons for suggestions that were dropped
  total_check: TotalCheck;
  warnings: string[];
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const round1 = (n: number) => Math.round(n * 10) / 10;

export const isQuestionType = (v: unknown): v is QuestionType => (QUESTION_TYPES as readonly string[]).includes(v as string);
export const isDifficulty = (v: unknown): v is Difficulty => (DIFFICULTIES as readonly string[]).includes(v as string);

export function sumMarks(qs: Array<{ marks: number }>): number {
  return round1(qs.reduce((s, q) => s + (Number(q.marks) || 0), 0));
}

// ── paper context (client-supplied, so treated as untrusted) ───────────────────────────────────────────
export function sanitizePaperContext(raw: unknown): { ok: true; paper: PaperContext } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "paper must be an object" };
  const rawQs = Array.isArray(raw.questions) ? raw.questions : null;
  if (!rawQs) return { ok: false, error: "paper.questions must be an array" };
  if (rawQs.length > MAX_PAPER_QUESTIONS) return { ok: false, error: `A paper can have at most ${MAX_PAPER_QUESTIONS} questions` };

  const questions: PaperQuestion[] = [];
  const seen = new Set<string>();
  for (const q of rawQs) {
    if (!isObj(q)) return { ok: false, error: "Each paper question must be an object" };
    const key = str(q.key, 80);
    if (!key || seen.has(key)) return { ok: false, error: "Each paper question needs a unique key" };
    seen.add(key);
    const type = isQuestionType(q.type) ? q.type : null;
    const stem = str(q.stem, MAX_STEM);
    const marks = Number(q.marks);
    if (!type || !stem || !(marks > 0) || marks > MAX_MARKS) return { ok: false, error: "A paper question has an invalid type, text or marks" };
    const out: PaperQuestion = {
      key, type, stem, marks,
      difficulty: isDifficulty(q.difficulty) ? q.difficulty : null,
      bloom_level: typeof q.bloom_level === "string" && (BLOOM_LEVELS as readonly string[]).includes(q.bloom_level) ? q.bloom_level : null,
      topic: str(q.topic, 200) || null,
      learning_objective_id: Number.isInteger(Number(q.learning_objective_id)) && Number(q.learning_objective_id) > 0 ? Number(q.learning_objective_id) : null,
    };
    if (isObj(q.options)) {
      out.options = {};
      for (const k of OPTION_KEYS) if (typeof q.options[k] === "string") out.options[k] = str(q.options[k], 500);
    }
    if (typeof q.correct_option === "string") out.correct_option = q.correct_option;
    out.explanation = str(q.explanation, MAX_TEXT) || null;
    out.model_answer = str(q.model_answer, MAX_TEXT) || null;
    out.context_passage = str(q.context_passage, MAX_TEXT) || null;
    if (Array.isArray(q.sub_questions)) {
      out.sub_questions = q.sub_questions.filter(isObj).slice(0, 10).map((s, i) => ({
        id: str(s.id, 20) || String.fromCharCode(97 + i), text: str(s.text, 1000), max_marks: Number(s.max_marks) || 0,
      }));
    }
    questions.push(out);
  }

  const target = raw.target_total_marks == null || raw.target_total_marks === "" ? null : Number(raw.target_total_marks);
  if (target !== null && !(target > 0 && target <= 10000)) return { ok: false, error: "target_total_marks must be a positive number" };
  const duration = raw.duration_minutes == null || raw.duration_minutes === "" ? null : Number(raw.duration_minutes);

  const objectives: PaperObjective[] = (Array.isArray(raw.objectives) ? raw.objectives : []).filter(isObj)
    .map((o) => ({ id: Number(o.id), text: str(o.text, 300) })).filter((o) => Number.isInteger(o.id) && o.id > 0 && o.text).slice(0, 60);

  return {
    ok: true,
    paper: {
      title: str(raw.title, 200), class_name: str(raw.class_name, 80) || null, subject: str(raw.subject, 120) || null,
      chapter: str(raw.chapter, 200) || null,
      total_marks: sumMarks(questions), target_total_marks: target,
      duration_minutes: duration !== null && duration > 0 && duration <= 1000 ? duration : null,
      instructions: (Array.isArray(raw.instructions) ? raw.instructions : []).map((s) => str(s, 300)).filter(Boolean).slice(0, 15),
      objectives, questions,
    },
  };
}

// ── duplicate / similarity detection (deterministic; the model adds the semantic view on top) ──────────
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "is", "are", "was", "were", "what", "which", "who",
  "how", "why", "for", "with", "by", "at", "as", "that", "this", "it", "be", "from", "if", "then", "find", "write", "state", "give"]);

export function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));
}

/** Jaccard similarity of two question stems, 0..1. */
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

export interface DuplicatePair { a: number; b: number; similarity: number; identical: boolean }

/** 1-based question-number pairs whose wording overlaps >= threshold. Never removes anything. */
export function findDuplicateCandidates(questions: Array<{ stem: string }>, threshold = 0.6): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
    const s = similarity(questions[i].stem, questions[j].stem);
    const identical = questions[i].stem.trim().toLowerCase() === questions[j].stem.trim().toLowerCase();
    if (identical || s >= threshold) out.push({ a: i + 1, b: j + 1, similarity: identical ? 1 : Math.round(s * 100) / 100, identical });
  }
  return out;
}

// ── model output parsing ───────────────────────────────────────────────────────────────────────────────
/** Pulls the first JSON object out of a model reply (handles ```json fences and chatter around it). */
export function extractJson(text: string): unknown | null {
  if (typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    if (start < 0) continue;
    // scan for the matching closing brace so trailing prose doesn't break the parse
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") inStr = false; continue; }
      if (ch === "\"") inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(c.slice(start, i + 1)); } catch { break; } } }
    }
  }
  return null;
}

// ── question validation ────────────────────────────────────────────────────────────────────────────────
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Validates ONE question draft (from the model, or typed by the teacher in the editor) against the APAS schema
 * used by question_bank (MCQ) and question_bank_extended (written). Returns the cleaned draft or the reasons.
 */
export function validateQuestionDraft(
  raw: unknown, opts: { allowedObjectiveIds?: ReadonlySet<number>; fallbackObjectiveId?: number | null } = {},
): { ok: true; value: QuestionDraft } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["question is not an object"] };

  const type = isQuestionType(raw.type) ? raw.type : null;
  if (!type) errors.push(`unsupported question type "${String(raw.type)}" (allowed: ${QUESTION_TYPES.join(", ")})`);
  const stem = str(raw.stem, MAX_STEM);
  if (!stem) errors.push("question text is empty");
  const marks = Number(raw.marks);
  if (!(marks > 0) || marks > MAX_MARKS || !Number.isFinite(marks)) errors.push("marks must be a number above 0 and at most 100");
  else if (Math.round(marks * 2) !== marks * 2) errors.push("marks must be a multiple of 0.5");
  const difficulty = isDifficulty(raw.difficulty) ? raw.difficulty : null;
  if (!difficulty) errors.push(`difficulty must be one of ${DIFFICULTIES.join(", ")}`);
  const bloom = typeof raw.bloom_level === "string" && (BLOOM_LEVELS as readonly string[]).includes(raw.bloom_level.toLowerCase()) ? raw.bloom_level.toLowerCase() : null;

  const draft: QuestionDraft = {
    type: (type ?? "descriptive"), stem, difficulty: difficulty ?? "medium", bloom_level: bloom, marks: Number.isFinite(marks) ? marks : 0,
    explanation: str(raw.explanation, MAX_TEXT) || null, model_answer: str(raw.model_answer, MAX_TEXT) || null,
    context_passage: str(raw.context_passage, MAX_TEXT) || null, learning_objective_id: null,
  };

  const lo = Number(raw.learning_objective_id);
  if (Number.isInteger(lo) && lo > 0 && (!opts.allowedObjectiveIds || opts.allowedObjectiveIds.has(lo))) draft.learning_objective_id = lo;
  else draft.learning_objective_id = opts.fallbackObjectiveId ?? null;

  if (type === "mcq") {
    if (!isObj(raw.options)) errors.push("an MCQ needs options");
    else {
      const options: Record<string, string> = {};
      for (const k of Object.keys(raw.options)) {
        if (!(OPTION_KEYS as readonly string[]).includes(k)) { errors.push(`option key "${k}" is not one of A-D`); continue; }
        const v = str(raw.options[k], 500);
        if (!v) errors.push(`option ${k} is empty`); else options[k] = v;
      }
      const keys = Object.keys(options);
      if (keys.length < 2) errors.push("an MCQ needs at least 2 options");
      const texts = keys.map((k) => norm(options[k]));
      if (new Set(texts).size !== texts.length) errors.push("two options have the same text");
      // contiguous from A so "A, C" can't happen
      if (keys.length && !keys.sort().every((k, i) => k === OPTION_KEYS[i])) errors.push("options must be labelled A, B, C, D in order");
      const correct = typeof raw.correct_option === "string" ? raw.correct_option.trim().toUpperCase() : "";
      if (!correct || !(correct in options)) errors.push("correct_option must be one of the option labels");
      else draft.correct_option = correct;
      draft.options = Object.fromEntries(OPTION_KEYS.filter((k) => k in options).map((k) => [k, options[k]]));
    }
    if (!draft.explanation) errors.push("an MCQ needs a short explanation of the correct answer");
    draft.model_answer = null; draft.context_passage = null;
  } else if (type) {
    if (!draft.model_answer) errors.push("a written question needs a suggested answer / marking guidance (model_answer)");
    if (Array.isArray(raw.sub_questions) && raw.sub_questions.length) {
      const subs = raw.sub_questions.filter(isObj).slice(0, 10).map((s, i) => ({
        id: str(s.id, 20) || String.fromCharCode(97 + i), text: str(s.text, 1000), max_marks: Number(s.max_marks),
      }));
      if (subs.some((s) => !s.text || !(s.max_marks > 0))) errors.push("every sub-question needs text and marks above 0");
      else if (Number.isFinite(marks) && round1(subs.reduce((t, s) => t + s.max_marks, 0)) !== marks) errors.push("sub-question marks must add up to the question's marks");
      else draft.sub_questions = subs;
    }
    draft.options = undefined; draft.correct_option = undefined;
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: draft };
}

// ── whole-response validation ──────────────────────────────────────────────────────────────────────────
const FINDING_TYPES: readonly FindingType[] = ["duplicate", "coverage", "balance", "quality", "difficulty", "marks", "other"];

function draftFromQuestion(q: PaperQuestion): QuestionDraft {
  return {
    type: q.type, stem: q.stem, options: q.options, correct_option: q.correct_option, explanation: q.explanation ?? null,
    context_passage: q.context_passage ?? null, sub_questions: q.sub_questions, model_answer: q.model_answer ?? null,
    difficulty: q.difficulty ?? "medium", bloom_level: q.bloom_level, marks: q.marks, learning_objective_id: q.learning_objective_id ?? null,
  };
}

export function projectedTotal(paper: PaperContext, suggestions: Suggestion[]): number {
  return round1(paper.total_marks + suggestions.reduce((s, x) => s + x.marks_delta, 0));
}

export function totalCheck(paper: PaperContext, suggestions: Suggestion[]): TotalCheck {
  const projected = projectedTotal(paper, suggestions);
  return {
    current: paper.total_marks, target: paper.target_total_marks, projected,
    ok: paper.target_total_marks === null ? true : projected === paper.target_total_marks,
  };
}

/**
 * Turns whatever the model returned into safe, paper-scoped suggestions. Anything malformed or pointing outside the
 * active paper is dropped (and reported) instead of being passed on. Returns null when the output is unusable as a whole.
 */
export function validateRefineResponse(raw: unknown, paper: PaperContext, newId: () => string): RefineResult | null {
  if (!isObj(raw)) return null;
  const warnings: string[] = [];
  const rejected: string[] = [];
  const allowedLo = new Set(paper.objectives.map((o) => o.id));
  const modalLo = (() => {
    const c = new Map<number, number>();
    for (const q of paper.questions) if (q.learning_objective_id) c.set(q.learning_objective_id, (c.get(q.learning_objective_id) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? paper.objectives[0]?.id ?? null;
  })();
  for (const q of paper.questions) if (q.learning_objective_id) allowedLo.add(q.learning_objective_id);

  const reply = str(raw.reply, MAX_TEXT);
  const clarification = str(raw.clarification, 1000) || null;

  const findings: Finding[] = (Array.isArray(raw.findings) ? raw.findings : []).filter(isObj).slice(0, 30).map((f) => ({
    type: (FINDING_TYPES as readonly string[]).includes(f.type as string) ? (f.type as FindingType) : "other",
    text: str(f.text, 800),
    question_numbers: (Array.isArray(f.question_numbers) ? f.question_numbers : []).map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= paper.questions.length).slice(0, 20),
  })).filter((f) => f.text);

  const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  if (raw.suggestions !== undefined && !Array.isArray(raw.suggestions)) return null;
  if (rawSuggestions.length > MAX_SUGGESTIONS) warnings.push(`The AI proposed ${rawSuggestions.length} changes; only the first ${MAX_SUGGESTIONS} are shown.`);

  const suggestions: Suggestion[] = [];
  const touched = new Set<string>();
  rawSuggestions.slice(0, MAX_SUGGESTIONS).forEach((s, idx) => {
    const label = `Suggestion ${idx + 1}`;
    if (!isObj(s)) { rejected.push(`${label}: not an object`); return; }
    const action = s.action === "revise" || s.action === "add" || s.action === "marks" ? s.action : null;
    if (!action) { rejected.push(`${label}: unknown action "${String(s.action)}"`); return; }
    const reason = str(s.reason, 800) || "No reason given";

    let target: PaperQuestion | null = null;
    if (action !== "add") {
      const n = Number(s.question_number);
      if (!Number.isInteger(n) || n < 1 || n > paper.questions.length) { rejected.push(`${label}: refers to question ${String(s.question_number)}, which is not in this paper`); return; }
      target = paper.questions[n - 1];
      if (touched.has(target.key)) { rejected.push(`${label}: question ${n} already has another suggestion in this reply`); return; }
    }

    if (action === "marks") {
      const m = Number(s.marks);
      if (!(m > 0) || m > MAX_MARKS || Math.round(m * 2) !== m * 2) { rejected.push(`${label}: invalid marks`); return; }
      if (m === target!.marks && !s.difficulty) { rejected.push(`${label}: marks unchanged`); return; }
      const diff = isDifficulty(s.difficulty) ? s.difficulty : (target!.difficulty ?? "medium");
      const hasSubs = !!target!.sub_questions?.length && round1(target!.sub_questions!.reduce((t, x) => t + x.max_marks, 0)) !== m;
      if (hasSubs) { rejected.push(`${label}: question ${paper.questions.indexOf(target!) + 1} has sub-questions whose marks would no longer add up`); return; }
      const proposed = { ...draftFromQuestion(target!), marks: m, difficulty: diff };
      touched.add(target!.key);
      suggestions.push({
        id: newId(), action, target_key: target!.key, target_number: paper.questions.indexOf(target!) + 1, reason, proposed,
        original_marks: target!.marks, original_difficulty: target!.difficulty, marks_delta: round1(m - target!.marks), similar_to: [],
      });
      return;
    }

    const v = validateQuestionDraft(s.question, { allowedObjectiveIds: allowedLo, fallbackObjectiveId: target?.learning_objective_id ?? modalLo });
    if (!v.ok) { rejected.push(`${label}: ${v.errors.join("; ")}`); return; }
    const d = v.value;
    if (action === "revise" && d.stem.trim() === target!.stem.trim() && JSON.stringify(d.options ?? null) === JSON.stringify(target!.options ?? null)
      && d.type === target!.type && d.marks === target!.marks && d.difficulty === target!.difficulty && (d.correct_option ?? null) === (target!.correct_option ?? null)) {
      rejected.push(`${label}: identical to the original`); return;
    }
    if (target) touched.add(target.key);
    const others = paper.questions.map((q, i) => ({ q, n: i + 1 })).filter((x) => x.q.key !== target?.key);
    const similar = others.filter((x) => similarity(x.q.stem, d.stem) >= 0.7).map((x) => x.n);
    suggestions.push({
      id: newId(), action, target_key: target?.key ?? null, target_number: target ? paper.questions.indexOf(target) + 1 : null, reason, proposed: d,
      original_marks: target?.marks ?? null, original_difficulty: target?.difficulty ?? null,
      marks_delta: round1(d.marks - (target?.marks ?? 0)), similar_to: similar,
    });
  });

  // Two "add" suggestions with the same wording would put the same question in the paper twice.
  const adds = suggestions.filter((s) => s.action === "add");
  for (let i = 0; i < adds.length; i++) for (let j = i + 1; j < adds.length; j++) {
    if (similarity(adds[i].proposed.stem, adds[j].proposed.stem) >= 0.85) warnings.push("Two of the new questions are almost identical - review them before accepting both.");
  }

  const check = totalCheck(paper, suggestions);
  if (paper.target_total_marks !== null && suggestions.length && !check.ok) {
    warnings.push(`Accepting every suggestion would change the paper's total from ${paper.total_marks} to ${check.projected} marks (target ${paper.target_total_marks}).`);
  }

  if (!reply && !clarification && !suggestions.length && !findings.length) return null;
  return { reply, clarification, findings, suggestions, rejected, total_check: check, warnings };
}

// ── applying a decision to a paper (browser side; pure so it is unit-tested) ───────────────────────────────
export function draftToQuestion(d: QuestionDraft, key: string, topic: string | null = null): PaperQuestion {
  return {
    key, type: d.type, stem: d.stem, options: d.options, correct_option: d.correct_option, explanation: d.explanation ?? null,
    context_passage: d.context_passage ?? null, sub_questions: d.sub_questions, model_answer: d.model_answer ?? null,
    difficulty: d.difficulty, bloom_level: d.bloom_level, marks: d.marks, topic, learning_objective_id: d.learning_objective_id,
  };
}

export type ApplyResult =
  | { ok: true; questions: PaperQuestion[]; previous: PaperQuestion | null; added: PaperQuestion | null }
  | { ok: false; error: string };

/**
 * Applies ONE approved suggestion to the paper. Never mutates the input. A revision replaces the question in place under a new
 * draft key (the original is returned as `previous` so the caller can keep it in the revision history and restore it).
 */
export function applySuggestion(questions: PaperQuestion[], s: Suggestion, newKey: () => string): ApplyResult {
  if (s.action === "marks") {
    const idx = questions.findIndex((q) => q.key === s.target_key);
    if (idx < 0) return { ok: false, error: "That question is no longer in the paper (it was changed or removed), so this suggestion can't be applied." };
    const m = Number(s.proposed.marks);
    if (!(m > 0) || m > MAX_MARKS || Math.round(m * 2) !== m * 2) return { ok: false, error: "This suggestion has invalid marks" };
    const prev = questions[idx];
    const next = { ...prev, marks: m, difficulty: isDifficulty(s.proposed.difficulty) ? s.proposed.difficulty : prev.difficulty };
    const out = [...questions]; out[idx] = next;
    return { ok: true, questions: out, previous: prev, added: next };
  }
  const v = validateQuestionDraft(s.proposed, {});
  if (!v.ok) return { ok: false, error: `This suggestion is no longer valid: ${v.errors[0]}` };
  if (questions.length >= MAX_PAPER_QUESTIONS && s.action === "add") return { ok: false, error: `A paper can have at most ${MAX_PAPER_QUESTIONS} questions` };

  if (s.action === "add") {
    const q = draftToQuestion(v.value, newKey());
    return { ok: true, questions: [...questions, q], previous: null, added: q };
  }
  const idx = questions.findIndex((q) => q.key === s.target_key);
  if (idx < 0) return { ok: false, error: "That question is no longer in the paper (it was changed or removed), so this suggestion can't be applied." };
  const prev = questions[idx];
  const next = draftToQuestion(v.value, newKey(), prev.topic ?? null);
  const out = [...questions]; out[idx] = next;
  return { ok: true, questions: out, previous: prev, added: next };
}
