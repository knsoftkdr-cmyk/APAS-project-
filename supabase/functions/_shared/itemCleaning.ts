// supabase/functions/_shared/itemCleaning.ts
//
// Validating and re-dealing AI-written MCQs before they reach question_bank. Pure functions (no Deno, no database),
// shared by generate-item-bank and the document question generator.

export const LETTERS = ["A", "B", "C", "D"] as const;

export interface RawItem {
  stem?: unknown;
  options?: unknown;
  correct?: unknown;
  explanation?: unknown;
  difficulty_target?: unknown;
  distractor_misconceptions?: unknown;
}

export interface CleanItem {
  stem: string;
  options: Record<string, string>;
  correct: string;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  distractorMisconceptions: Record<string, number>;
}

const BANNED_OPTION = /\b(all|none)\s+of\s+the\s+above\b|\bboth\s+[a-d]\s+and\s+[a-d]\b/i;

export function cleanItem(r: RawItem, validMcIds: Set<number>): CleanItem | null {
  const stem = typeof r.stem === "string" ? r.stem.trim() : "";
  if (stem.length < 8 || stem.length > 800) return null;

  const opts = r.options as Record<string, unknown> | undefined;
  if (!opts || typeof opts !== "object") return null;
  const options: Record<string, string> = {};
  for (const L of LETTERS) {
    const v = opts[L];
    if (typeof v !== "string" || !v.trim() || v.length > 400) return null;
    if (BANNED_OPTION.test(v)) return null;
    options[L] = v.trim();
  }
  if (Object.keys(opts).length !== 4) return null;
  if (new Set(Object.values(options).map((v) => v.toLowerCase())).size !== 4) return null;

  const correct = typeof r.correct === "string" ? r.correct.trim().toUpperCase() : "";
  if (!LETTERS.includes(correct as typeof LETTERS[number])) return null;

  const dt = String(r.difficulty_target ?? "medium").toLowerCase();
  const difficulty = (["easy", "medium", "hard"].includes(dt) ? dt : "medium") as CleanItem["difficulty"];

  const dm: Record<string, number> = {};
  if (r.distractor_misconceptions && typeof r.distractor_misconceptions === "object") {
    for (const [k, v] of Object.entries(r.distractor_misconceptions as Record<string, unknown>)) {
      const letter = k.toUpperCase();
      const id = Number(v);
      if (LETTERS.includes(letter as typeof LETTERS[number]) && letter !== correct && Number.isFinite(id) && validMcIds.has(id)) dm[letter] = id;
    }
  }

  const explanation = typeof r.explanation === "string" && r.explanation.trim() ? r.explanation.trim() : null;
  return { stem, options, correct, explanation, difficulty, distractorMisconceptions: dm };
}

// Models over-produce "B" and "C" as the key. Re-deal the options with a
// cryptographic shuffle and remap the key + misconception tags to match.
export function shuffleOptions(c: CleanItem) {
  const order = [...LETTERS];
  const rnd = new Uint32Array(order.length);
  crypto.getRandomValues(rnd);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const options: Record<string, string> = {};
  const distractorMisconceptions: Record<string, number> = {};
  let correct = "A";
  order.forEach((oldLetter, idx) => {
    const newLetter = LETTERS[idx];
    options[newLetter] = c.options[oldLetter];
    if (oldLetter === c.correct) correct = newLetter;
    if (c.distractorMisconceptions[oldLetter] != null) distractorMisconceptions[newLetter] = c.distractorMisconceptions[oldLetter];
  });
  return { options, correct, distractorMisconceptions };
}
