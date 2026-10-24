// src/lib/conceptVisual.ts
//
// Browser side of "AI concept visualization" (feature 37). Calls cat-session, action "concept_visual"
// (server: supabase/functions/_shared/handlers/conceptVisual.ts). Keep the limits and the response shape
// in sync with supabase/functions/_shared/conceptVisualModel.ts.

import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export const MIN_CONCEPT_LENGTH = 2;
export const MAX_CONCEPT_LENGTH = 80;

export interface VisualStep { label: string; detail: string }
export interface VisualPart { name: string; role: string }
export interface ConceptVisual {
  title: string;
  summary: string;
  steps: VisualStep[];
  parts: VisualPart[];
  analogy: string;
  check_question: string;
}

/** What the user typed, trimmed and tidied; null when it is too short or too long to send. */
export function cleanConceptInput(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < MIN_CONCEPT_LENGTH || text.length > MAX_CONCEPT_LENGTH) return null;
  return text;
}

export async function requestConceptVisual(args: {
  concept: string;
  grade?: string;
  language?: string;
}): Promise<ConceptVisual> {
  const { data, error } = await supabase.functions.invoke("cat-session", {
    body: {
      action: "concept_visual",
      concept: args.concept,
      grade: args.grade || undefined,
      language: args.language,
    },
  });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Couldn't build the visual. Please try again.");
    throw new Error(message);
  }
  const visual = (data as { visual?: ConceptVisual } | null)?.visual;
  if (!visual) throw new Error("Couldn't build the visual. Please try again.");
  return visual;
}
