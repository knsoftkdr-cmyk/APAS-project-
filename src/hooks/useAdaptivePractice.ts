import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export type PracticeScopeType = "concept" | "topic" | "chapter" | "subject";
export type DifficultyLabel = "foundational" | "moderate" | "challenging";

export interface PracticeItem {
  item_id: string;
  seq: number;
  stem: string;
  options: Record<string, string>;
  bloom_level: string;
  difficulty_label: DifficultyLabel;
}

export interface PracticeSession {
  id: string;
  scope_label: string;
  status: string;
  mode: "practice";
  items_administered: number;
  min_items: number;
  max_items: number;
}

export interface PracticeFeedback {
  is_correct: boolean;
  correct_option: string;
  explanation: string | null;
  mastery_before: number | null;
  mastery_after: number | null;
}

export interface PracticeResult {
  accuracy: number;
  by_objective: Array<{ learning_objective_id: number; text: string; answered: number; correct: number; p_mastery: number | null }>;
  misconceptions: Array<{ id: number; text: string; correction_hint: string | null; times_selected: number }>;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cat-session", { body });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Adaptive practice request failed.");
    throw new Error(message);
  }
  return data as T;
}

/**
 * Drives a short, fixed-length practice round whose question difficulty
 * adapts after every single answer (same CAT engine module 4 uses for
 * formal tests, run in "practice" mode: fixed length, no precision target).
 * Embeddable anywhere a (scopeType, scopeId) pair is known - a concept
 * (subtopic), topic, chapter or whole subject.
 */
export function useAdaptivePractice() {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [item, setItem] = useState<PracticeItem | null>(null);
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server already serves the next item alongside grading feedback for the
  // current one; hold it here so the feedback screen keeps showing the
  // question that was just answered, and only swap in the next question
  // once the student dismisses the feedback.
  const [pendingNext, setPendingNext] = useState<{ session: PracticeSession; item: PracticeItem } | null>(null);

  const reset = useCallback(() => {
    setSession(null); setItem(null); setFeedback(null); setResult(null); setError(null); setPendingNext(null);
  }, []);

  const start = useCallback(async (args: {
    scopeType: PracticeScopeType; scopeId: number; length?: number; source?: string;
  }) => {
    setLoading(true); setError(null); setResult(null); setFeedback(null); setPendingNext(null);
    try {
      const data = await invoke<{ session: PracticeSession; item: PracticeItem }>({
        action: "start", scope_type: args.scopeType, scope_id: args.scopeId,
        mode: "practice", length: args.length ?? 5, source: args.source,
      });
      setSession(data.session);
      setItem(data.item);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start practice");
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = useCallback(async (selectedOption: string) => {
    if (!session || !item) return;
    setLoading(true); setError(null);
    try {
      const data = await invoke<{
        feedback: PracticeFeedback; complete: boolean; session?: PracticeSession; item?: PracticeItem;
        result?: PracticeResult;
      }>({ action: "answer", session_id: session.id, item_id: item.item_id, selected_option: selectedOption });
      setFeedback(data.feedback);
      if (data.complete) {
        setResult(data.result ?? null);
      } else if (data.session && data.item) {
        setPendingNext({ session: data.session, item: data.item });
      }
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't grade that answer");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [session, item]);

  // Dismiss feedback and reveal the next (already difficulty-adjusted) item.
  const acknowledgeFeedback = useCallback(() => {
    setFeedback(null);
    if (pendingNext) {
      setSession(pendingNext.session);
      setItem(pendingNext.item);
      setPendingNext(null);
    }
  }, [pendingNext]);

  return { session, item, feedback, result, loading, error, start, submit, acknowledgeFeedback, reset };
}
