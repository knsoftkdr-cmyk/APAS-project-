import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

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

export interface ReviewAnswerFeedback {
  is_correct: boolean;
  correct_option: "A" | "B" | "C" | "D";
  explanation: string | null;
  p_mastery_before: number;
  p_mastery_after: number;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("spaced-repetition", { body });
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
  return useQuery<{ count: number; reviews: DueReview[] }>({
    queryKey: ["due-reviews", args.studentId ?? "self", args.limit ?? 20, args.bookId ?? "all"],
    queryFn: () =>
      invoke<{ count: number; reviews: DueReview[] }>({
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
    }) =>
      invoke<ReviewAnswerFeedback>({
        action: "session-answer",
        schedule_id: args.scheduleId,
        learning_objective_id: args.learningObjectiveId,
        item_id: args.itemId,
        selected_option: args.selectedOption,
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
    mutationFn: (args: { learningObjectiveId: number; days?: number; studentId?: string }) =>
      invoke<{ learning_objective_id: number; due_at: string }>({
        action: "snooze",
        learning_objective_id: args.learningObjectiveId,
        days: args.days ?? 1,
        student_id: args.studentId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["due-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["review-forecast"] });
    },
  });
}
