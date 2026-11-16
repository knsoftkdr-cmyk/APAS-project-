import { describe, expect, it } from "vitest";
import {
  applySuggestion, extractJson, findDuplicateCandidates, sanitizePaperContext, validateQuestionDraft, validateRefineResponse,
  type PaperContext, type PaperQuestion,
} from "../../supabase/functions/_shared/paperRefineModel";
import { applyMany, clearDraft, editSuggestion, fillPrompt, loadDraft, pushRevision, restoreRevision, saveDraft, totalAfter } from "@/lib/paperRefine";

const mcq = (n: number, over: Partial<PaperQuestion> = {}): PaperQuestion => ({
  key: `mcq:00000000-0000-4000-8000-00000000000${n}`, type: "mcq", stem: `Question number ${n} about fractions and decimals`,
  options: { A: "1/2", B: "1/3", C: "1/4", D: "1/5" }, correct_option: "A", explanation: "Because.", difficulty: "easy", bloom_level: "understand",
  marks: 2, topic: "Fractions", learning_objective_id: 11, ...over,
});
const written = (n: number): PaperQuestion => ({
  key: `extended:00000000-0000-4000-8000-0000000001${n}`, type: "descriptive", stem: `Explain concept ${n} of algebra in detail`, model_answer: "Reference answer",
  difficulty: "medium", bloom_level: "apply", marks: 5, topic: "Algebra", learning_objective_id: 12,
});
const paperOf = (qs: PaperQuestion[], over: Partial<PaperContext> = {}): PaperContext => ({
  title: "Unit test", class_name: "Class 8", subject: "Mathematics", chapter: "Fractions", total_marks: qs.reduce((s, q) => s + q.marks, 0),
  target_total_marks: null, duration_minutes: 60, instructions: [], objectives: [{ id: 11, text: "Add fractions" }, { id: 12, text: "Solve equations" }], questions: qs, ...over,
});
const goodMcq = { type: "mcq", stem: "Which fraction is the largest?", options: { A: "1/2", B: "1/3", C: "1/4", D: "1/5" }, correct_option: "A", explanation: "Smaller denominator, larger fraction.", difficulty: "medium", bloom_level: "apply", marks: 2, learning_objective_id: 11 };
let idn = 0; const nid = () => `s${++idn}`;

describe("validateQuestionDraft", () => {
  it("accepts a well-formed MCQ", () => { expect(validateQuestionDraft(goodMcq).ok).toBe(true); });
  it("rejects duplicate options", () => {
    const r = validateQuestionDraft({ ...goodMcq, options: { A: "1/2", B: "1/2", C: "1/4", D: "1/5" } });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors.join()).toMatch(/same text/);
  });
  it("requires exactly one valid correct option", () => {
    expect(validateQuestionDraft({ ...goodMcq, correct_option: "E" }).ok).toBe(false);
    expect(validateQuestionDraft({ ...goodMcq, correct_option: undefined }).ok).toBe(false);
  });
  it("rejects unknown type, bad difficulty and bad marks", () => {
    expect(validateQuestionDraft({ ...goodMcq, type: "essay" }).ok).toBe(false);
    expect(validateQuestionDraft({ ...goodMcq, difficulty: "impossible" }).ok).toBe(false);
    expect(validateQuestionDraft({ ...goodMcq, marks: 0 }).ok).toBe(false);
    expect(validateQuestionDraft({ ...goodMcq, marks: 2.3 }).ok).toBe(false);
    expect(validateQuestionDraft({ ...goodMcq, marks: 500 }).ok).toBe(false);
  });
  it("allows a 2-option true/false MCQ", () => {
    expect(validateQuestionDraft({ ...goodMcq, stem: "Is 1/2 > 1/3?", options: { A: "True", B: "False" }, correct_option: "A" }).ok).toBe(true);
  });
  it("requires a model answer for written questions and checks sub-question marks", () => {
    const base = { type: "descriptive", stem: "Explain.", difficulty: "hard", marks: 4 };
    expect(validateQuestionDraft(base).ok).toBe(false);
    expect(validateQuestionDraft({ ...base, model_answer: "x" }).ok).toBe(true);
    expect(validateQuestionDraft({ ...base, model_answer: "x", sub_questions: [{ id: "a", text: "p", max_marks: 1 }, { id: "b", text: "q", max_marks: 1 }] }).ok).toBe(false);
    expect(validateQuestionDraft({ ...base, model_answer: "x", sub_questions: [{ id: "a", text: "p", max_marks: 2 }, { id: "b", text: "q", max_marks: 2 }] }).ok).toBe(true);
  });
});

describe("extractJson", () => {
  it("handles fences, prose and braces inside strings", () => {
    expect(extractJson('Here you go:\n```json\n{"a": "x}y"}\n```\nthanks')).toEqual({ a: "x}y" });
    expect(extractJson('{"a":1} trailing words')).toEqual({ a: 1 });
  });
  it("returns null for garbage / truncated JSON", () => {
    expect(extractJson("I cannot do that")).toBeNull();
    expect(extractJson('{"a": [1,2')).toBeNull();
  });
});

describe("sanitizePaperContext (untrusted input)", () => {
  it("rejects malformed papers", () => {
    expect(sanitizePaperContext(null).ok).toBe(false);
    expect(sanitizePaperContext({ questions: "x" }).ok).toBe(false);
    expect(sanitizePaperContext({ questions: [{ key: "a", type: "mcq", stem: "s", marks: -1 }] }).ok).toBe(false);
    expect(sanitizePaperContext({ questions: Array.from({ length: 101 }, (_, i) => ({ key: `k${i}`, type: "mcq", stem: "s", marks: 1 })) }).ok).toBe(false);
  });
  it("computes the total itself instead of trusting the client", () => {
    const r = sanitizePaperContext({ total_marks: 999, questions: [mcq(1), mcq(2)] });
    expect(r.ok && r.paper.total_marks).toBe(4);
  });
});

describe("duplicate detection", () => {
  it("flags identical and near-identical stems, not unrelated ones", () => {
    const d = findDuplicateCandidates([
      { stem: "What is the sum of 1/2 and 1/3?" }, { stem: "What is the sum of 1/2 and 1/3?" },
      { stem: "Find the sum of 1/2 and 1/3" }, { stem: "Name the capital city of France" },
    ]);
    expect(d.some((x) => x.a === 1 && x.b === 2 && x.identical)).toBe(true);
    expect(d.some((x) => x.a === 1 && x.b === 3)).toBe(true);
    expect(d.some((x) => x.b === 4 || x.a === 4)).toBe(false);
  });
});

describe("validateRefineResponse", () => {
  const paper = paperOf([mcq(1), mcq(2), written(3)]);
  it("scopes suggestions to the active paper", () => {
    const r = validateRefineResponse({ reply: "ok", suggestions: [
      { action: "revise", question_number: 9, reason: "x", question: goodMcq },
      { action: "revise", question_number: 1, reason: "harder", question: { ...goodMcq, difficulty: "hard" } },
    ] }, paper, nid)!;
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].target_key).toBe(paper.questions[0].key);
    expect(r.rejected.join()).toMatch(/not in this paper/);
  });
  it("drops invalid items but keeps valid ones; returns null for unusable output", () => {
    const r = validateRefineResponse({ reply: "ok", suggestions: [{ action: "add", reason: "r", question: { ...goodMcq, correct_option: "Z" } }, { action: "add", reason: "r", question: goodMcq }] }, paper, nid)!;
    expect(r.suggestions).toHaveLength(1); expect(r.rejected).toHaveLength(1);
    expect(validateRefineResponse("nope", paper, nid)).toBeNull();
    expect(validateRefineResponse({ suggestions: "x" }, paper, nid)).toBeNull();
    expect(validateRefineResponse({}, paper, nid)).toBeNull();
  });
  it("uses only objectives that belong to the paper", () => {
    const r = validateRefineResponse({ reply: "ok", suggestions: [{ action: "add", reason: "r", question: { ...goodMcq, learning_objective_id: 99999 } }] }, paper, nid)!;
    expect(r.suggestions[0].proposed.learning_objective_id).toBe(11); // fell back to the paper's own objective
  });
  it("only one suggestion per question per reply; no-op revisions are discarded", () => {
    const r = validateRefineResponse({ reply: "ok", suggestions: [
      { action: "revise", question_number: 1, reason: "a", question: { ...goodMcq, difficulty: "hard" } },
      { action: "marks", question_number: 1, marks: 3, reason: "b" },
      { action: "revise", question_number: 2, reason: "same", question: { ...paper.questions[1] } },
    ] }, paper, nid)!;
    expect(r.suggestions).toHaveLength(1); expect(r.rejected).toHaveLength(2);
  });
  it("reports the effect on total marks and warns when a required total would break", () => {
    const locked = paperOf([mcq(1), mcq(2), written(3)], { target_total_marks: 9 });
    const r = validateRefineResponse({ reply: "ok", suggestions: [{ action: "add", reason: "r", question: goodMcq }] }, locked, nid)!;
    expect(r.total_check).toMatchObject({ current: 9, projected: 11, target: 9, ok: false });
    expect(r.warnings.join()).toMatch(/total/);
    const balanced = validateRefineResponse({ reply: "ok", suggestions: [
      { action: "add", reason: "r", question: goodMcq }, { action: "marks", question_number: 3, marks: 3, reason: "make room" },
    ] }, locked, nid)!;
    expect(balanced.total_check.ok).toBe(true);
  });
  it("keeps clarification-only replies (conflicting instructions) with no suggestions", () => {
    const r = validateRefineResponse({ reply: "", clarification: "50 marks cannot fit 5 more questions. Which should shrink?", suggestions: [] }, paper, nid)!;
    expect(r.clarification).toMatch(/50 marks/); expect(r.suggestions).toHaveLength(0);
  });
  it("marks-only suggestions don't require a complete MCQ", () => {
    const legacy = paperOf([mcq(1, { explanation: null }), mcq(2)]);
    const r = validateRefineResponse({ reply: "ok", suggestions: [{ action: "marks", question_number: 1, marks: 4, reason: "r" }] }, legacy, nid)!;
    expect(r.suggestions).toHaveLength(1);
    const a = applySuggestion(legacy.questions, r.suggestions[0], () => "draft:x");
    expect(a.ok && a.questions[0].marks).toBe(4);
  });
  it("findings only reference real question numbers", () => {
    const r = validateRefineResponse({ reply: "ok", findings: [{ type: "duplicate", text: "Q1 and Q2 match", question_numbers: [1, 2, 40] }] }, paper, nid)!;
    expect(r.findings[0].question_numbers).toEqual([1, 2]);
  });
});

describe("apply / reject / revision history", () => {
  const qs = [mcq(1), mcq(2), written(3)];
  const paper = paperOf(qs);
  const sug = () => validateRefineResponse({ reply: "ok", suggestions: [{ action: "revise", question_number: 1, reason: "harder", question: { ...goodMcq, difficulty: "hard", marks: 3 } }] }, paper, nid)!.suggestions[0];

  it("accept replaces the question in place and returns the original", () => {
    const s = sug();
    const r = applySuggestion(qs, s, () => "draft:new");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.questions[0].key).toBe("draft:new"); expect(r.questions[0].difficulty).toBe("hard"); expect(r.previous?.key).toBe(qs[0].key); expect(r.questions).toHaveLength(3); }
    expect(qs[0].difficulty).toBe("easy"); // input untouched
  });
  it("reject = not applying: the paper is unchanged", () => { expect(qs[0].stem).toMatch(/Question number 1/); expect(paper.questions).toHaveLength(3); });
  it("refuses a suggestion whose question is gone", () => {
    const s = sug();
    const r = applySuggestion(qs.slice(1), s, () => "draft:n");
    expect(r.ok).toBe(false);
  });
  it("add appends; type conversion keeps the paper length", () => {
    const add = validateRefineResponse({ reply: "ok", suggestions: [{ action: "add", reason: "r", question: goodMcq }] }, paper, nid)!.suggestions[0];
    const r = applySuggestion(qs, add, () => "draft:a"); expect(r.ok && r.questions).toHaveLength(4);
    const conv = validateRefineResponse({ reply: "ok", suggestions: [{ action: "revise", question_number: 3, reason: "to MCQ", question: { ...goodMcq, marks: 5 } }] }, paper, nid)!.suggestions[0];
    const c = applySuggestion(qs, conv, () => "draft:c"); expect(c.ok && c.questions[2].type).toBe("mcq");
  });
  it("accept-all skips stale suggestions without aborting the rest", () => {
    const a = sug();
    const b = validateRefineResponse({ reply: "ok", suggestions: [{ action: "revise", question_number: 2, reason: "r", question: { ...goodMcq, stem: "A different question altogether?" } }] }, paper, nid)!.suggestions[0];
    const out = applyMany(qs.filter((q) => q.key !== qs[0].key), [a, b], () => `draft:${Math.random()}`);
    expect(out.applied).toHaveLength(1); expect(out.skipped).toHaveLength(1);
  });
  it("revision history restores the exact earlier paper, and the restore is undoable", () => {
    const s = sug();
    const r = applySuggestion(qs, s, () => "draft:new"); if (!r.ok) throw new Error();
    let h = pushRevision([], "Revised Q1", qs);
    const restored = restoreRevision(h, h[0].id, r.questions)!;
    expect(restored.questions.map((q) => q.key)).toEqual(qs.map((q) => q.key));
    expect(restored.history).toHaveLength(2);
    expect(restoreRevision(restored.history, "nope", qs)).toBeNull();
    h = restored.history;
    expect(restoreRevision(h, h[0].id, restored.questions)!.questions[0].key).toBe("draft:new");
  });
  it("totalAfter flags a change to the required total", () => {
    const s = sug();
    expect(totalAfter(qs, [s], 9)).toMatchObject({ current: 9, projected: 10, changes: true, breaksTarget: true });
    expect(totalAfter(qs, [s], null).breaksTarget).toBe(false);
  });
  it("manual edit of a suggestion is re-validated", () => {
    const s = sug();
    expect(editSuggestion(s, { ...s.proposed, options: { A: "x", B: "x", C: "y", D: "z" } }).ok).toBe(false);
    const ok = editSuggestion(s, { ...s.proposed, stem: "Reworded by the teacher?", marks: 4 });
    expect(ok.ok && ok.suggestion.marks_delta).toBe(2);
  });
});

describe("draft persistence + helpers", () => {
  it("round-trips, survives corrupt storage, and never throws", () => {
    const store: Record<string, string> = {};
    const st = { setItem: (k: string, v: string) => { store[k] = v; }, getItem: (k: string) => store[k] ?? null, removeItem: (k: string) => { delete store[k]; } };
    saveDraft("u1", { title: "T", instructions: "i", targetTotal: "50", picked: [{ a: 1 }], history: [] }, st);
    expect(loadDraft("u1", st)?.title).toBe("T");
    expect(loadDraft("u2", st)).toBeNull();
    store["apas.paperDraft.u1"] = "{not json"; expect(loadDraft("u1", st)).toBeNull();
    clearDraft("u1", st); expect(store["apas.paperDraft.u1"]).toBeUndefined();
    expect(() => saveDraft("u1", { title: "", instructions: "", targetTotal: "", picked: [], history: [] }, { setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });
  it("fills quick prompts with the selected question", () => { expect(fillPrompt("Make question {n} harder", 3)).toBe("Make question 3 harder"); });
});
