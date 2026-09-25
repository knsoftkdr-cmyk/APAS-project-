import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RiskCause, OverallRiskLevel } from "@/hooks/useStudentRisk";

// ── Types matching get-intervention-recommendations' response (module 14) ──

export type InterventionType = "remedial_lesson" | "extra_practice" | "teacher_intervention" | "parent_communication" | "counselling";
export type InterventionPriority = "low" | "medium" | "high";

export interface InterventionRecommendation {
  type: InterventionType;
  priority: InterventionPriority;
  reason: string;
  suggested_actions: string[];
}

export interface StudentInterventionPlan {
  student_id: string;
  overall_risk_level: OverallRiskLevel;
  causes: RiskCause[];
  recommended_interventions: InterventionRecommendation[];
  suggested_tier: 2 | 3;
  suggested_priority: InterventionPriority;
  suggested_action_plan: string[];
  generated_at: string;
}

export interface ClassInterventionRow {
  student_id: string;
  full_name: string;
  overall_risk_level: OverallRiskLevel;
  recommended_interventions: InterventionRecommendation[];
  suggested_tier: 2 | 3;
  suggested_priority: InterventionPriority;
  suggested_action_plan: string[];
}

// ── Student's own (or, for staff, any student's) recommended interventions ─
export function useInterventionRecommendations(studentId?: string) {
  return useQuery<StudentInterventionPlan>({
    queryKey: ["intervention-recommendations", studentId ?? "self"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-intervention-recommendations", {
        body: { student_id: studentId },
      });
      if (error) throw error;
      return data as StudentInterventionPlan;
    },
    staleTime: 60 * 1000,
  });
}

// ── Teacher/admin-facing: whole-class recommended interventions ────────────
export function useClassInterventionRecommendations(classId?: string) {
  return useQuery<ClassInterventionRow[]>({
    queryKey: ["class-intervention-recommendations", classId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-intervention-recommendations", {
        body: { class_id: classId },
      });
      if (error) throw error;
      return (data?.students ?? []) as ClassInterventionRow[];
    },
    enabled: !!classId,
    staleTime: 60 * 1000,
  });
}
