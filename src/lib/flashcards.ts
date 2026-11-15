import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { CardType, Rating, CardState, DeckStats } from "../../supabase/functions/_shared/flashcardModel";

export { CARD_TYPES, CARD_TYPE_LABELS, RATINGS, requeueAfterRating } from "../../supabase/functions/_shared/flashcardModel";
export type { CardType, Rating, CardState, DeckStats };

// AI Auto Flashcards client. Goes through the already-deployed `cat-session` edge function (actions fc_*) - no new edge
// function. See supabase/functions/CONSOLIDATION.md. Keep the shapes in sync with supabase/functions/_shared/handlers/flashcards.ts.

export class FlashcardError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cat-session", { body: { ...body, action: `fc_${action}` } });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Flashcards request failed.");
    throw new FlashcardError(message, code);
  }
  return data as T;
}

export interface FlashcardSubject { key: string; label: string }
export interface CatalogTopic { id: number; name: string; available: number; in_deck: number }
export interface CatalogChapter { id: number; name: string; unit: string | null; topics: CatalogTopic[] }
export interface FlashcardCatalog {
  class: { key: string; label: string };
  subjects: FlashcardSubject[];
  message: string | null;
  subject?: FlashcardSubject;
  chapters?: CatalogChapter[];
}

export interface TopicGenerationResult {
  topic_id: number; topic_name: string; added: number; reused: number; generated: number;
  rejected: Record<string, number>; status: "ok" | "no_material" | "ai_failed" | "nothing_new"; message?: string;
}
export interface GenerateResult {
  subject: string; chapter: { id: number; name: string };
  added: number; reused: number; generated: number; topics: TopicGenerationResult[]; scope: "topic" | "chapter"; message: string | null;
}

export interface StudyCard {
  id: string;
  card_type: CardType;
  question: string;
  answer: string;
  hint: string | null;
  difficulty: "easy" | "medium" | "hard";
  topic_id: number;
  topic_name: string | null;
  chapter_name: string | null;
  source_pages: number[];
  grounding: "textbook" | "syllabus";
  state: CardState;
  times_seen: number;
  times_correct: number;
  last_rating: Rating | null;
  /** what each rating would do, e.g. { easy: "in 3 days", medium: "tomorrow", difficult: "in 10 min" } */
  preview: Record<Rating, string>;
}
export interface StudyQueue {
  mode: "due" | "practice"; count: number; due_total: number; new_total: number; deck_total: number; cards: StudyCard[];
}

export interface RateResult {
  duplicate: boolean; rating: Rating; correct: boolean; due_at: string; interval_days: number;
  next_label?: string; times_seen?: number; times_correct?: number; daily_review_pulled: boolean;
}

export interface DeckSummary {
  topic_id: number; topic_name: string; chapter_id: number | null; chapter_name: string | null;
  total: number; due: number; new: number; mastered: number; accuracy: number | null;
}
export interface FlashcardOverview {
  stats: DeckStats;
  recent_days: { date: string; reviews: number; correct: number }[];
  streak: number;
  decks: DeckSummary[];
  weak_topics: DeckSummary[];
  new_per_session: number;
}

export const getCatalog = (subject?: string) => call<FlashcardCatalog>("catalog", { subject });
export const generateFlashcards = (args: { topicId?: number; chapterId?: number; types: CardType[]; count: number }) =>
  call<GenerateResult>("generate", { topic_id: args.topicId, chapter_id: args.chapterId, types: args.types, count: args.count });
export const getStudyQueue = (args: { topicId?: number; chapterId?: number; subject?: string; mode?: "due" | "practice"; limit?: number; newLimit?: number } = {}) =>
  call<StudyQueue>("study", { topic_id: args.topicId, chapter_id: args.chapterId, subject: args.subject, mode: args.mode, limit: args.limit, new_limit: args.newLimit });
export const rateFlashcard = (args: { flashcardId: string; rating: Rating; sessionId?: string }) =>
  call<RateResult>("rate", { flashcard_id: args.flashcardId, rating: args.rating, session_id: args.sessionId });
export const getOverview = () => call<FlashcardOverview>("overview", { tz_offset_minutes: new Date().getTimezoneOffset() });
export const reportFlashcard = (flashcardId: string) => call<{ reported: boolean; retired: boolean }>("report", { flashcard_id: flashcardId });
