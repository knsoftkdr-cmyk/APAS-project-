import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { Outcome, ScoringRules, SessionScore } from "../../supabase/functions/_shared/dailyReviewScoring";

export type { Outcome, ScoringRules, SessionScore };

// ── Types matching supabase/functions/spaced-repetition/index.ts's response shapes ─

export interface ReviewForecast {
  student_id: string;
  due_now: number;
  due_today: number;
  due_next_7_days: number;
  total_scheduled: number;
  long_retention_count: number;
  recent_lapses: number;
  last_reviewed_at: string | null;
  /** due, but no practice question exists for the objective yet (so it can't be served) */
  due_without_questions?: number;
  /** the next time something becomes reviewable (null when nothing is scheduled ahead) */
  next_due_at?: string | null;
}

export interface ReviewItem {
  item_id: string;
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  bloom_level: string | null;
}

export interface DueReview {
  schedule_id: string;
  learning_objective_id: number;
  objective_text: string;
  difficulty: "easy" | "medium" | "hard";
  subtopic_id: number;
  subtopic_name: string;
  topic_id: number;
  topic_name: string;
  chapter_name: string;
  subject: string;
  class_name: string | null;
  p_mastery: number;
  due_at: string;
  days_overdue: number;
  repetitions: number;
  lapses: number;
  ease_factor: number;
  item: ReviewItem;
}

/** Daily Review negative marking, as scored by the server for one answer. `enabled: false` = marking is off for this school. */
export interface AnswerScoring {
  enabled: boolean;
  /** false when this scheduled review had already been scored (a repeat submit) or couldn't be scored */
  counted: boolean;
  duplicate?: boolean;
  outcome?: Outcome;
  marks?: number;
  rules?: ScoringRules;
  /** running totals for the session so far, from the server's ledger */
  session?: SessionScore | null;
}

export interface ReviewAnswerFeedback {
  is_correct: boolean;
  correct_option: "A" | "B" | "C" | "D";
  explanation: string | null;
  p_mastery_before: number | null;
  p_mastery_after: number | null;
  scoring?: AnswerScoring;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  // Served by cat-session (Edge Function limit): "due" -> "sr_due", "session-answer" -> "sr_session_answer", ...
  const { data, error } = await supabase.functions.invoke("cat-session", {
    body: { ...body, action: `sr_${String(body.action).replace(/-/g, "_")}` },
  });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Spaced repetition request failed.");
    throw new Error(message);
  }
  return data as T;
}

// ── Dashboard widget: due-now/today/7-day counts ─────────────────────────────
export function useReviewForecast(studentId?: string) {
  return useQuery<ReviewForecast>({
    queryKey: ["review-forecast", studentId ?? "self"],
    queryFn: () => invoke<ReviewForecast>({ action: "forecast", student_id: studentId }),
    staleTime: 60 * 1000,
  });
}

// ── The actual review queue for a "Daily Review" session ────────────────────
export function useDueReviews(args: { studentId?: string; limit?: number; bookId?: number } = {}) {
  return useQuery<{ count: number; reviews: DueReview[]; scoring?: ScoringRules }>({
    queryKey: ["due-reviews", args.studentId ?? "self", args.limit ?? 20, args.bookId ?? "all"],
    queryFn: () =>
      invoke<{ count: number; reviews: DueReview[]; scoring?: ScoringRules }>({
        action: "due",
        student_id: args.studentId,
        limit: args.limit,
        book_id: args.bookId,
      }),
    staleTime: 30 * 1000,
  });
}

// ── Grade one review; the DB trigger reschedules it automatically ───────────
export function useAnswerReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      scheduleId: string;
      learningObjectiveId: number;
      itemId: string;
      selectedOption: "A" | "B" | "C" | "D";
      /** ties the answers of one sitting together so the server can total the session's marks */
      sessionId?: string;
      sessionTotal?: number;
    }) =>
      invoke<ReviewAnswerFeedback>({
        action: "session-answer",
        schedule_id: args.scheduleId,
        learning_objective_id: args.learningObjectiveId,
        item_id: args.itemId,
        selected_option: args.selectedOption,
        session_id: args.sessionId,
        session_total: args.sessionTotal,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["due-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["review-forecast"] });
      queryClient.invalidateQueries({ queryKey: ["mastery-tree"] });
    },
  });
}

// ── "Remind me later" ────────────────────────────────────────────────────────
export function useSnoozeReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { learningObjectiveId: number; days?: number; studentId?: string; scheduleId?: string; sessionId?: string }) =>
      invoke<{ learning_objective_id: number; due_at: string }>({
        action: "snooze",
        learning_objective_id: args.learningObjectiveId,
        days: args.days ?? 1,
        student_id: args.studentId,
        schedule_id: args.scheduleId,
        session_id: args.sessionId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["due-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["review-forecast"] });
    },
  });
}

// ── Daily Review scoring rules (negative marking) ───────────────────────────
export interface ScoringConfig { rules: ScoringRules; can_edit: boolean; school_id: string | null }

export function useDailyReviewScoring(enabled = true) {
  return useQuery<ScoringConfig>({
    queryKey: ["daily-review-scoring"],
    queryFn: () => invoke<ScoringConfig>({ action: "scoring-get" }),
    staleTime: 60 * 1000,
    enabled,
  });
}

/** Principal only (enforced by the server). The rules apply to the whole school. */
export function useSaveDailyReviewScoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: ScoringRules) =>
      invoke<ScoringConfig>({
        action: "scoring-set",
        enabled: rules.enabled,
        marks_per_correct: rules.marks_per_correct,
        negative_marks_per_wrong: rules.negative_marks_per_wrong,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-review-scoring"] });
      queryClient.invalidateQueries({ queryKey: ["due-reviews"] });
    },
  });
}
