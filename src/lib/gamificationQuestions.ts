import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { AgeGroupId } from "@/components/gamification/engine/ageGroups";
import type {
  MatchPair, QuizQuestion, SortCategory, SpeedTapRule, VisualMemorySet, WordEntry,
} from "@/components/gamification/engine/contentPools";

// Gamification question client. Goes through the already-deployed `update-mastery` edge function
// (actions gq_context / gq_serve) - no new edge function. See supabase/functions/CONSOLIDATION.md.
// The class, school and subjects are decided by the server from the signed-in student's record; nothing here can choose them.
// Keep the response shapes in sync with supabase/functions/_shared/handlers/gamificationQuestions.ts.

export type GameType = "quick-quiz" | "word-scramble" | "match-pairs" | "category-sort" | "speed-tap" | "visual-memory";

export interface GameItemMap {
  "quick-quiz": QuizQuestion;
  "word-scramble": WordEntry;
  "match-pairs": MatchPair;
  "category-sort": SortCategory;
  "speed-tap": SpeedTapRule;
  "visual-memory": VisualMemorySet;
}

export interface GameContext {
  persistence: "available";
  class: { key: string; label: string };
  band: AgeGroupId;
  subjects: { key: string; label: string }[];
  message: string | null;
}

export interface ServedContent<T> {
  items: T[];
  subject: string;
  class: { key: string; label: string };
  difficulty: "easy" | "medium" | "hard";
  meta: {
    served: number; requested: number; short: boolean; exhausted: boolean;
    generation: "not_needed" | "ok" | "partial" | "failed";
    sources: Record<string, number>;
  };
  /** Set when nothing could be served (e.g. every eligible question has been played): show it to the student. */
  message: string | null;
}

export class GqError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function call<T>(action: "gq_context" | "gq_serve", body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("update-mastery", { body: { action, ...body } });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Couldn't load your game questions.");
    throw new GqError(message, code);
  }
  if (data?.error) throw new GqError(data.error, data.code);
  return data as T;
}

/** The signed-in student's class (from the database) and the subjects taught to it. */
export const getGameContext = () => call<GameContext>("gq_context");

/**
 * Fresh items for one game. Everything returned is recorded server-side as served, so it will not come back in this
 * or any later session. `subject` omitted / mode "generic" lets the server pick the subject the student has played least.
 */
export const serveGameContent = <G extends GameType>(
  gameType: G,
  opts: { subject?: string | null; mode?: "subject" | "generic"; sessionId?: string },
) =>
  call<ServedContent<GameItemMap[G]>>("gq_serve", {
    game_type: gameType,
    subject: opts.mode === "generic" ? undefined : opts.subject ?? undefined,
    mode: opts.mode ?? "subject",
    session_id: opts.sessionId,
  });
