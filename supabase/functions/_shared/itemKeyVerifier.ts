// supabase/functions/_shared/itemKeyVerifier.ts
//
// Independent answer-key check for AI-written MCQs. The writer model sometimes stores a wrong key
// (e.g. "314,205 + 423,172" keyed as 737,477). A second call that SOLVES each question without ever
// seeing the stored key catches that: if its answer differs, the item is not trusted.
import { callAi, type AiConfig } from "./aiClient.ts";

export interface SolveInput { stem: string; options: Record<string, string> }
export type SolveResult = "A" | "B" | "C" | "D" | "NONE" | "MULTIPLE" | null; // null = solver gave no usable answer

const LETTERS = ["A", "B", "C", "D"];
const BATCH = 8;

function buildPrompt(items: SolveInput[]): string {
  const blocks = items.map((it, i) =>
    `Q${i + 1}. ${it.stem}\n` + LETTERS.map((L) => `  ${L}. ${it.options[L]}`).join("\n")).join("\n\n");
  return `You are a careful examiner. Solve each multiple-choice question yourself, from scratch.
Work out the answer independently - do all arithmetic digit by digit and double-check it - THEN pick the option that matches your result.
If no option is correct answer "NONE". If more than one option is correct answer "MULTIPLE".

${blocks}

Return ONLY a JSON array with one entry per question, in order:
[{"q":1,"answer":"A|B|C|D|NONE|MULTIPLE"}]`;
}

/** Solves the items (in batches) and returns one result per input, same order. Never throws for a bad batch -> null. */
export async function solveItems(ai: AiConfig, items: SolveInput[]): Promise<SolveResult[]> {
  const out: SolveResult[] = new Array(items.length).fill(null);
  for (let start = 0; start < items.length; start += BATCH) {
    const slice = items.slice(start, start + BATCH);
    try {
      const { text } = await callAi(ai, buildPrompt(slice), {
        temperature: 0, reasoning: true, maxOutputTokens: 16384,
        system: "You output strict JSON only. No markdown, no commentary.",
      });
      const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
      const arr = JSON.parse(cleaned);
      if (!Array.isArray(arr)) continue;
      for (const row of arr) {
        const idx = Number(row?.q) - 1;
        const ans = String(row?.answer ?? "").trim().toUpperCase();
        if (Number.isInteger(idx) && idx >= 0 && idx < slice.length && ["A", "B", "C", "D", "NONE", "MULTIPLE"].includes(ans)) {
          out[start + idx] = ans as SolveResult;
        }
      }
    } catch (e) {
      console.warn("solveItems batch failed", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/** True only when the solver independently reached the stored key. */
export const keyConfirmed = (solved: SolveResult, key: string) => solved === key;

export function mismatchNote(solved: SolveResult, key: string): string {
  if (solved === null) return "Answer key could not be verified automatically - please check it.";
  if (solved === "NONE") return `Independent check found no correct option (key says ${key}).`;
  if (solved === "MULTIPLE") return `Independent check found more than one correct option (key says ${key}).`;
  return `Independent check chose ${solved} but the key says ${key}.`;
}
