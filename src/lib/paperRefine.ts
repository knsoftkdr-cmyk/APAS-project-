// src/lib/paperRefine.ts
//
// Chat to Refine Questions - browser helpers. The rules themselves (what a valid question is, how a suggestion is applied)
// live in supabase/functions/_shared/paperRefineModel.ts so the server and the browser can't disagree.
//   * revision history: snapshots of the paper before every approved change, restorable
//   * draft persistence: the paper being built survives a refresh (per teacher, per browser)
//   * the quick prompts shown in the chat panel

import {
  applySuggestion, sumMarks, validateQuestionDraft,
  type PaperQuestion, type QuestionDraft, type Suggestion,
} from "../../supabase/functions/_shared/paperRefineModel";

export {
  applySuggestion, draftToQuestion, findDuplicateCandidates, sumMarks, validateQuestionDraft,
  QUESTION_TYPES, DIFFICULTIES, MAX_PAPER_QUESTIONS,
  type Finding, type PaperContext, type PaperObjective, type PaperQuestion, type QuestionDraft, type QuestionType, type Suggestion, type TotalCheck,
} from "../../supabase/functions/_shared/paperRefineModel";

export const TYPE_LABEL: Record<string, string> = {
  mcq: "MCQ", descriptive: "Short/long answer", case_based: "Case-based", hots: "HOTS", competency: "Competency", scenario: "Scenario",
};

export const QUICK_PROMPTS: Array<{ label: string; text: string; needsQuestion?: boolean }> = [
  { label: "Make this question harder", text: "Make question {n} harder while keeping the same learning objective.", needsQuestion: true },
  { label: "Generate 5 more questions", text: "Generate 5 additional questions for this paper. Keep the total marks as they are." },
  { label: "Improve question wording", text: "Improve the wording of question {n}: fix grammar, remove ambiguity and keep the meaning.", needsQuestion: true },
  { label: "Convert to MCQ", text: "Convert question {n} into a multiple-choice question and keep the correct answer.", needsQuestion: true },
  { label: "Find duplicate questions", text: "Find duplicate or very similar questions in this paper and suggest different replacements. Do not remove anything." },
  { label: "Balance marks distribution", text: "Review the marks distribution against difficulty and suggest changes. The total marks must stay the same." },
  { label: "Review the entire paper", text: "Review the entire paper: coverage of the chapter and learning objectives, difficulty balance, marks, duplicates and wording." },
];

export const newKey = () => `draft:${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)}`;

// ── revision history ──────────────────────────────────────────────────────────────────────────────────────
export interface Revision {
  id: string; at: string; label: string;
  /** The whole paper as it was BEFORE the change, so restoring is exact. */
  before: PaperQuestion[];
}
const MAX_REVISIONS = 40;

export function pushRevision(history: Revision[], label: string, before: PaperQuestion[], now = new Date()): Revision[] {
  const entry: Revision = { id: newKey(), at: now.toISOString(), label, before: before.map((q) => ({ ...q })) };
  return [entry, ...history].slice(0, MAX_REVISIONS);
}

/** Restores the paper to a revision. The state being replaced is itself recorded, so a restore can be undone too. */
export function restoreRevision(history: Revision[], id: string, current: PaperQuestion[], now = new Date()): { questions: PaperQuestion[]; history: Revision[] } | null {
  const r = history.find((h) => h.id === id);
  if (!r) return null;
  return { questions: r.before.map((q) => ({ ...q })), history: pushRevision(history, `Before restoring "${r.label}"`, current, now) };
}

// ── applying + marks safety ───────────────────────────────────────────────────────────────────────────────
/** What accepting a set of suggestions would do to the total, so the UI can warn before the teacher confirms. */
export function totalAfter(questions: PaperQuestion[], suggestions: Suggestion[], target: number | null) {
  const current = sumMarks(questions);
  const projected = Math.round((current + suggestions.reduce((s, x) => s + x.marks_delta, 0)) * 10) / 10;
  return { current, projected, target, changes: projected !== current, breaksTarget: target !== null && projected !== target };
}

export interface BatchApplied {
  questions: PaperQuestion[];
  applied: Array<{ suggestion: Suggestion; previous: PaperQuestion | null }>;
  skipped: Array<{ suggestion: Suggestion; error: string }>;
}

/** Accept all: applies each suggestion in turn; a stale or invalid one is skipped (and reported) instead of aborting the rest. */
export function applyMany(questions: PaperQuestion[], suggestions: Suggestion[], keyFn: () => string = newKey): BatchApplied {
  let cur = questions;
  const applied: BatchApplied["applied"] = [];
  const skipped: BatchApplied["skipped"] = [];
  for (const s of suggestions) {
    const r = applySuggestion(cur, s, keyFn);
    if (r.ok) { cur = r.questions; applied.push({ suggestion: s, previous: r.previous }); } else skipped.push({ suggestion: s, error: r.error });
  }
  return { questions: cur, applied, skipped };
}

/** The teacher's manual edit of a suggestion: re-validated with the same rules before it can be accepted. */
export function editSuggestion(s: Suggestion, draft: unknown): { ok: true; suggestion: Suggestion } | { ok: false; errors: string[] } {
  const v = validateQuestionDraft(draft, { fallbackObjectiveId: s.proposed.learning_objective_id });
  if (!v.ok) return v;
  return { ok: true, suggestion: { ...s, proposed: v.value, marks_delta: Math.round((v.value.marks - (s.original_marks ?? 0)) * 10) / 10 } };
}

/** Stored paper question -> the draft shape the server accepts for a "custom" item. */
export function toCustomDraft(q: PaperQuestion): QuestionDraft {
  return {
    type: q.type, stem: q.stem, options: q.options, correct_option: q.correct_option, explanation: q.explanation ?? null,
    context_passage: q.context_passage ?? null, sub_questions: q.sub_questions, model_answer: q.model_answer ?? null,
    difficulty: q.difficulty ?? "medium", bloom_level: q.bloom_level, marks: q.marks, learning_objective_id: q.learning_objective_id ?? null,
  };
}

// ── draft persistence (so a refresh doesn't lose the paper) ───────────────────────────────────────────────
export interface PaperDraft {
  v: 1; savedAt: string; title: string; instructions: string; targetTotal: string; picked: unknown[]; history: Revision[];
}
const draftKey = (userId: string) => `apas.paperDraft.${userId}`;

export function saveDraft(userId: string | undefined, d: Omit<PaperDraft, "v" | "savedAt">, storage: Pick<Storage, "setItem"> | null = safeStorage()) {
  if (!userId || !storage) return;
  try { storage.setItem(draftKey(userId), JSON.stringify({ v: 1, savedAt: new Date().toISOString(), ...d })); } catch { /* quota / private mode: drafts are a convenience */ }
}
export function loadDraft(userId: string | undefined, storage: Pick<Storage, "getItem"> | null = safeStorage()): PaperDraft | null {
  if (!userId || !storage) return null;
  try {
    const raw = storage.getItem(draftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as PaperDraft;
    return d && d.v === 1 && Array.isArray(d.picked) ? d : null;
  } catch { return null; }
}
export function clearDraft(userId: string | undefined, storage: Pick<Storage, "removeItem"> | null = safeStorage()) {
  if (!userId || !storage) return;
  try { storage.removeItem(draftKey(userId)); } catch { /* ignore */ }
}
function safeStorage(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }

/** Replaces {n} in a quick prompt with the selected question's number. */
export function fillPrompt(text: string, selected: number | null): string {
  return text.replace(/\{n\}/g, selected ? String(selected) : "the selected");
}
