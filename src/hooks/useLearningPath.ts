import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// ── Types matching supabase/functions/learning-path/index.ts's response shapes ─

export type PathStepType = "review" | "remediate" | "learn" | "practice";

export interface PathStepItem {
  item_id: string;
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  bloom_level: string | null;
}

export interface LearningPathStep {
  step_type: PathStepType;
  learning_objective_id: number;
  objective_text: string;
  subtopic_id: number;
  subtopic_name: string;
  topic_id: number;
  topic_name: string;
  chapter_name: string;
  subject: string;
  class_name: string | null;
  reason: string;
  schedule_id?: string; // present on "review" steps
  p_mastery?: number;
  item: PathStepItem | null;
}

export interface PathAnswerFeedback {
  is_correct: boolean;
  correct_option: "A" | "B" | "C" | "D";
  explanation: string | null;
  p_mastery_before: number;
  p_mastery_after: number;
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Learning path request failed.");
    throw new Error(message);
  }
  return data as T;
}

// ── The ranked next-steps queue for a subject ───────────────────────────────
export function useLearningPath(bookId?: number, args: { studentId?: string; length?: number } = {}) {
  return useQuery<{ student_id: string; book_id: number; path: LearningPathStep[] }>({
    queryKey: ["learning-path", args.studentId ?? "self", bookId, args.length ?? 10],
    queryFn: () =>
      invoke("learning-path", { action: "generate", student_id: args.studentId, book_id: bookId, length: args.length }),
    enabled: !!bookId,
    staleTime: 5 * 60 * 1000, // the path is a recommendation snapshot, not a live feed
  });
}

// ── Grade one step, whichever type it is ────────────────────────────────────
export function useAnswerPathStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (step: {
      stepType: PathStepType;
      learningObjectiveId: number;
      itemId: string;
      selectedOption: "A" | "B" | "C" | "D";
      scheduleId?: string;
    }) =>
      invoke<PathAnswerFeedback>("learning-path", {
        action: "answer",
        step_type: step.stepType,
        learning_objective_id: step.learningObjectiveId,
        item_id: step.itemId,
        selected_option: step.selectedOption,
        schedule_id: step.scheduleId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-path"] });
      queryClient.invalidateQueries({ queryKey: ["due-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["review-forecast"] });
      queryClient.invalidateQueries({ queryKey: ["forgetting-forecast"] });
      queryClient.invalidateQueries({ queryKey: ["mastery-tree"] });
    },
  });
}
