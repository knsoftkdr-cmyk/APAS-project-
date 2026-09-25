import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types matching get-student-risk-profile / get-class-risk-roster
//    response shapes (module 13) ────────────────────────────────────────────

export type RiskStrength = "strong" | "moderate" | "none" | "insufficient_data" | "unavailable";
export type OverallRiskLevel = "high" | "medium" | "low" | "insufficient_data";

export type RiskCauseType = "academic_decline" | "disengagement" | "stalled_progress" | "chronic_absenteeism";

export interface RiskCause {
  cause_type: RiskCauseType;
  evidence_strength: RiskStrength;
  explanation: string;
  evidence?: Record<string, unknown>;
}

export interface StudentRiskProfile {
  student_id: string;
  overall_risk_level: OverallRiskLevel;
  primary_cause: RiskCause | null;
  causes: RiskCause[];
  generated_at: string;
}

export interface ClassRiskStudentRow {
  student_id: string;
  full_name: string;
  overall_risk_level: OverallRiskLevel;
  primary_cause: RiskCause | null;
  causes: RiskCause[];
}

// ── Student's own (or, for staff, any student's) risk profile ──────────────
export function useStudentRisk(studentId?: string) {
  return useQuery<StudentRiskProfile>({
    queryKey: ["student-risk-profile", studentId ?? "self"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-student-risk-profile", {
        body: { student_id: studentId },
      });
      if (error) throw error;
      return data as StudentRiskProfile;
    },
    staleTime: 60 * 1000,
  });
}

// ── Teacher/admin-facing: whole-class early-warning roster ──────────────────
export function useClassRisk(classId?: string) {
  return useQuery<ClassRiskStudentRow[]>({
    queryKey: ["class-risk-roster", classId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-risk-roster", {
        body: { class_id: classId },
      });
      if (error) throw error;
      return (data?.students ?? []) as ClassRiskStudentRow[];
    },
    enabled: !!classId,
    staleTime: 60 * 1000,
  });
}
