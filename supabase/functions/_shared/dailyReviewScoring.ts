// supabase/functions/_shared/dailyReviewScoring.ts
//
// Pure rules for Daily Review negative marking (no I/O, no Deno / browser APIs): shared by the
// spaced-repetition edge handler, the React app and the unit tests.
//
//   correct            -> + marks_per_correct
//   incorrect          - - negative_marks_per_wrong
//   skipped / unanswered -> 0
//
// This is a scoring OVERLAY for Daily Review only. It never feeds BKT / SM-2: the correct / incorrect
// verdict that drives mastery and scheduling is untouched.
//
// All arithmetic is done in whole hundredths ("cents") so 0.1 + 0.2 style float drift can never show up
// in a student's score.

export type Outcome = "correct" | "wrong" | "skipped";

export interface ScoringRules {
  enabled: boolean;
  marks_per_correct: number;
  negative_marks_per_wrong: number;
}

/** Off by default: until a school's admin turns it on, Daily Review looks and behaves exactly as before. */
export const DEFAULT_RULES: ScoringRules = { enabled: false, marks_per_correct: 1, negative_marks_per_wrong: 0.25 };

export const MAX_MARKS_PER_QUESTION = 10;

export const toCents = (n: number): number => Math.round(n * 100);
export const fromCents = (c: number): number => c / 100;

const hasAtMostTwoDecimals = (n: number) => Math.abs(toCents(n) - n * 100) < 1e-7;

export type RulesCheck = { ok: true; rules: ScoringRules } | { ok: false; error: string };

/** Validates admin input. Every number must be finite, with at most 2 decimals. */
export function validateRules(raw: unknown): RulesCheck {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Rules are required." };
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return { ok: false, error: "Choose whether negative marking is on or off." };

  const correct = Number(r.marks_per_correct);
  const penalty = Number(r.negative_marks_per_wrong);
  if (!Number.isFinite(correct) || r.marks_per_correct === "" || r.marks_per_correct === null) return { ok: false, error: "Marks for a correct answer must be a number." };
  if (!Number.isFinite(penalty) || r.negative_marks_per_wrong === "" || r.negative_marks_per_wrong === null) return { ok: false, error: "Marks deducted for a wrong answer must be a number." };
  if (!hasAtMostTwoDecimals(correct) || !hasAtMostTwoDecimals(penalty)) return { ok: false, error: "Use at most 2 decimal places." };
  if (correct <= 0 || correct > MAX_MARKS_PER_QUESTION) return { ok: false, error: `Marks for a correct answer must be above 0 and at most ${MAX_MARKS_PER_QUESTION}.` };
  if (penalty < 0) return { ok: false, error: "Marks deducted can't be negative. Enter the amount to deduct, e.g. 0.25." };
  if (penalty > correct) return { ok: false, error: "Marks deducted can't be more than the marks for a correct answer." };

  return { ok: true, rules: { enabled: r.enabled, marks_per_correct: fromCents(toCents(correct)), negative_marks_per_wrong: fromCents(toCents(penalty)) } };
}

/** Reads a stored settings row; anything missing or invalid falls back to the (disabled) defaults. */
export function rulesFromRow(row: unknown): ScoringRules {
  if (!row || typeof row !== "object") return { ...DEFAULT_RULES };
  const r = row as Record<string, unknown>;
  const check = validateRules({
    enabled: r.negative_marking_enabled === true,
    marks_per_correct: r.marks_per_correct,
    negative_marks_per_wrong: r.negative_marks_per_wrong,
  });
  return check.ok ? check.rules : { ...DEFAULT_RULES };
}

/** Marks for one question. With negative marking off nothing is scored (0), so the legacy screen is unchanged. */
export function marksFor(outcome: Outcome, rules: ScoringRules): number {
  if (!rules.enabled) return 0;
  if (outcome === "correct") return fromCents(toCents(rules.marks_per_correct));
  if (outcome === "wrong") return -fromCents(toCents(rules.negative_marks_per_wrong));
  return 0;
}

export interface ScoredRow { outcome: Outcome; marks: number; marks_for_correct?: number }

export interface SessionScore {
  total_questions: number;
  correct: number;
  wrong: number;
  skipped: number;          // snoozed with "Remind me later"
  unanswered: number;       // skipped + never reached; both are worth 0
  marks_gained: number;     // sum of the + marks
  marks_deducted: number;   // sum of the penalties, as a positive number
  net: number;              // marks_gained - marks_deducted: the final score (can be below 0)
  max_possible: number;
}

/**
 * Final score of one Daily Review session.
 * `totalQuestions` is the size of the session; anything not answered counts 0 and is "unanswered".
 */
export function summarizeSession(rows: ScoredRow[], totalQuestions: number, rules: ScoringRules): SessionScore {
  let gained = 0, deducted = 0, correct = 0, wrong = 0, skipped = 0;
  for (const r of rows) {
    const c = toCents(r.marks);
    if (r.outcome === "correct") { correct += 1; gained += Math.max(0, c); }
    else if (r.outcome === "wrong") { wrong += 1; deducted += Math.max(0, -c); }
    else skipped += 1;
  }
  const total = Math.max(totalQuestions, correct + wrong + skipped);
  return {
    total_questions: total,
    correct, wrong, skipped,
    unanswered: total - correct - wrong,
    marks_gained: fromCents(gained),
    marks_deducted: fromCents(deducted),
    net: fromCents(gained - deducted),
    max_possible: fromCents(total * toCents(rules.marks_per_correct)),
  };
}

/** "+1", "−0.25", "0" - a real minus sign so it never reads as a hyphen. */
export function formatMarks(n: number, opts: { sign?: boolean } = {}): string {
  const c = toCents(n);
  const abs = Math.abs(c) / 100;
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace(/0+$/, "");
  if (c < 0) return `−${text}`;
  if (c > 0 && opts.sign) return `+${text}`;
  return text;
}

/** Worked example shown to admins while they edit the rules. */
export function exampleScore(rules: ScoringRules, correct = 7, wrong = 2, skipped = 1): { net: number; text: string } {
  const net = fromCents(correct * toCents(rules.marks_per_correct) - wrong * toCents(rules.negative_marks_per_wrong));
  return {
    net,
    text: `${correct + wrong + skipped} questions: ${correct} correct, ${wrong} wrong, ${skipped} skipped = ${formatMarks(net)} / ${formatMarks(fromCents((correct + wrong + skipped) * toCents(rules.marks_per_correct)))}`,
  };
}
