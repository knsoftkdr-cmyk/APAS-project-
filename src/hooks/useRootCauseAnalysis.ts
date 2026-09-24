import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// ── Types matching the root-cause-analysis edge function's response shape ──

export type CauseType = "practice_deficiency" | "prerequisite_gap" | "difficulty_mismatch" | "misconception" | "attendance";
export type EvidenceStrength = "strong" | "moderate" | "none" | "unavailable";

export interface RootCause {
  cause_type: CauseType;
  evidence_strength: EvidenceStrength;
  explanation: string;
  // deno-lint-ignore no-explicit-any
  evidence?: any;
}

export interface RootCauseAnalysis {
  student_id: string;
  learning_objective_id: number;
  objective_text: string;
  subtopic_name: string;
  topic_name: string;
  chapter_name: string;
  subject: string;
  primary_cause: RootCause | null;
  causes: RootCause[];
  generated_at: string;
}

// ── Why is this student struggling with this objective? ─────────────────────
export function useRootCauseAnalysis(learningObjectiveId?: number, studentId?: string) {
  return useQuery<RootCauseAnalysis>({
    queryKey: ["root-cause-analysis", studentId ?? "self", learningObjectiveId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("root-cause-analysis", {
        body: { learning_objective_id: learningObjectiveId, student_id: studentId },
      });
      if (error) {
        const { message } = await unwrapFunctionError(error, "Couldn't run root-cause analysis.");
        throw new Error(message);
      }
      return data as RootCauseAnalysis;
    },
    enabled: !!learningObjectiveId,
    staleTime: 5 * 60 * 1000,
  });
}
