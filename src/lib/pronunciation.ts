// Client for Pronunciation Assessment.
// Served by the existing `get-mastery-history` edge function (no new function) via the `pronunciation_*` actions.
// The browser records and transcribes (Web Speech API); the server scores - see
// supabase/functions/_shared/pronunciationModel.ts.
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export type WordStatus = "correct" | "close" | "mispronounced" | "missed";
export type ScoreBand = "excellent" | "good" | "developing" | "needs_practice";
export type Level = "beginner" | "intermediate" | "advanced";

export interface WordResult { ref: string; heard: string | null; status: WordStatus; similarity: number; score: number }
export interface PronunciationResult {
  model_version: string;
  overall: number;
  band: ScoreBand;
  accuracy: number;
  completeness: number;
  fluency: number | null;
  clarity: number | null;
  words_per_minute: number | null;
  words: WordResult[];
  extra_words: string[];
  counts: { total: number; correct: number; close: number; mispronounced: number; missed: number };
  notes: string[];
}
export interface Coaching { summary: string; tips: { word: string; tip: string }[] }
export interface AssessResponse {
  result: PronunciationResult;
  coaching: Coaching | null;
  saved: boolean;
  persistence: "available" | "unavailable" | "error";
  disclaimer: string;
}
export interface AttemptRow {
  id: string; language: string; reference_text: string; overall: number; accuracy: number; completeness: number;
  fluency: number | null; clarity: number | null; words_per_minute: number | null; created_at: string;
}
export interface HistorySummary {
  attempts: number; average: number | null; best: number | null; recent_average: number | null; earlier_average: number | null;
  direction: "improving" | "declining" | "steady" | null;
  tricky_words: { word: string; times_missed: number; attempts_seen: number }[];
}
export interface HistoryResponse { summary: HistorySummary; attempts: AttemptRow[]; persistence: "available" | "unavailable" }

/** Recognition / voice locale for each teaching language (the browser needs a full BCP-47 tag). */
export const SPEECH_LOCALES: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", te: "te-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", bn: "bn-IN",
};
export const ENGLISH_ACCENTS = [
  { value: "en-IN", label: "Indian English" },
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
];

export const BAND_LABEL: Record<ScoreBand, string> = {
  excellent: "Excellent", good: "Good", developing: "Getting there", needs_practice: "Keep practising",
};

async function call<T>(action: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("get-mastery-history", { body: { action, ...body } });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, fallback);
    throw Object.assign(new Error(message), { code });
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const assessPronunciation = (p: {
  language: string; reference_text: string; transcript: string; duration_seconds?: number | null; confidence?: number | null;
}) => call<AssessResponse>("pronunciation_assess", p, "Couldn't score your reading right now.");

export const fetchPronunciationHistory = (language?: string) =>
  call<HistoryResponse>("pronunciation_history", language ? { language } : {}, "Couldn't load your progress.");

export const generatePassage = (language: string, level: Level, topic?: string) =>
  call<{ text: string; language: string; level: Level }>("pronunciation_passage", { language, level, ...(topic ? { topic } : {}) }, "Couldn't create a passage right now.");
