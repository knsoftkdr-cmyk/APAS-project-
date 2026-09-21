import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TrendPoint } from "@/components/mastery/MasteryTrendChart";

export interface ObjectiveHistoryEvent {
  responded_at: string;
  is_correct: boolean;
  source: string;
  p_mastery_before: number;
  p_mastery_after: number;
}

export interface ConceptTrendEvent {
  responded_at: string;
  learning_objective_id: number;
  event_p_mastery: number;
  is_correct: boolean;
  concept_p_mastery: number;
}

// ── Raw history for one learning objective ───────────────────────────────
export function useMasteryHistory(learningObjectiveId?: number, studentId?: string) {
  return useQuery<TrendPoint[]>({
    queryKey: ["mastery-history", "objective", learningObjectiveId, studentId ?? "self"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-mastery-history", {
        body: { learning_objective_id: learningObjectiveId, student_id: studentId },
      });
      if (error) throw error;
      const history: ObjectiveHistoryEvent[] = data?.history ?? [];
      return history.map((h) => ({
        responded_at: h.responded_at, p_mastery: h.p_mastery_after, is_correct: h.is_correct,
      }));
    },
    enabled: !!learningObjectiveId,
    staleTime: 30 * 1000,
  });
}

// ── Concept-level running-average trend across all its objectives ────────
export function useConceptMasteryTrend(subtopicId?: number, studentId?: string) {
  return useQuery<TrendPoint[]>({
    queryKey: ["mastery-history", "concept", subtopicId, studentId ?? "self"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-mastery-history", {
        body: { subtopic_id: subtopicId, student_id: studentId },
      });
      if (error) throw error;
      const trend: ConceptTrendEvent[] = data?.trend ?? [];
      return trend.map((t) => ({
        responded_at: t.responded_at, p_mastery: t.concept_p_mastery, is_correct: t.is_correct,
      }));
    },
    enabled: !!subtopicId,
    staleTime: 30 * 1000,
  });
}

// ── Admin/teacher: fit BKT params from real evidence ──────────────────────
export interface CalibrationResult {
  calibrated: boolean;
  reason?: string;
  learning_objective_id?: number;
  p_init?: number; p_transit?: number; p_slip?: number; p_guess?: number;
  log_likelihood?: number;
  student_count: number;
  event_count: number;
}

export function useCalibrateBktParams() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { learningObjectiveId?: number; subtopicId?: number; topicId?: number }) => {
      const { data, error } = await supabase.functions.invoke("calibrate-bkt-params", {
        body: {
          learning_objective_id: args.learningObjectiveId,
          subtopic_id: args.subtopicId,
          topic_id: args.topicId,
        },
      });
      if (error) throw error;
      return (data?.results ?? []) as CalibrationResult[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mastery-tree"] });
    },
  });
}
