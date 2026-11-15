import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { ScoringRules } from "../../supabase/functions/_shared/dailyReviewScoring";
import type { ScoringConfig } from "@/hooks/useSpacedRepetition";

// Adaptive Test marking rules (negative marking). Served by cat-session ("cat_scoring_get" / "cat_scoring_set").
// Separate from Daily Review's rules: a school can mark the two differently.

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cat-session", { body });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Adaptive Test scoring request failed.");
    throw Object.assign(new Error(message), { code });
  }
  return data as T;
}

export function useAdaptiveTestScoring(enabled = true) {
  return useQuery<ScoringConfig>({
    queryKey: ["adaptive-test-scoring"],
    queryFn: () => invoke<ScoringConfig>({ action: "cat_scoring_get" }),
    staleTime: 60 * 1000,
    enabled,
  });
}

/** Principal only (enforced by the server). The rules apply to the whole school. */
export function useSaveAdaptiveTestScoring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: ScoringRules) =>
      invoke<ScoringConfig>({
        action: "cat_scoring_set",
        enabled: rules.enabled,
        marks_per_correct: rules.marks_per_correct,
        negative_marks_per_wrong: rules.negative_marks_per_wrong,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["adaptive-test-scoring"] }),
  });
}
