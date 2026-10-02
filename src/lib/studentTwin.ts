// Client for the Student Digital Learning Twin.
// Served by the existing `get-mastery-history` edge function (no new function) via `action: "student_twin"`.
import { supabase } from "@/integrations/supabase/client";
import type { Direction } from "@/lib/academicForecast";

export interface TwinSubject {
  subject: string;
  ability: number | null;
  tests: number;
  adaptive_items: number;
  sources: ("tests" | "adaptive")[];
  projected_next: number | null;
  projected_low: number | null;
  projected_high: number | null;
  trend: Direction | null;
  slope_per_test: number | null;
}
export interface TwinNextStep { action: string; reason: string; subject?: string }
export interface StudentTwin {
  model_version: string;
  generated_at: string;
  sufficient_data: boolean;
  overall_ability: number | null;
  subjects: TwinSubject[];
  preferences: {
    strengths: { subject: string; margin: number }[];
    challenges: { subject: string; margin: number }[];
    recorded_learning_style: string | null;
    note: string;
  };
  progression: {
    direction: Direction | null;
    slope_per_month: number | null;
    basis: "monthly_tests" | "recent_tests" | "none";
    history: { date: string; overall: number | null }[];
  };
  retention: { tracked: number; mastered: number; mastered_pct: number | null; stale_pct: number | null };
  engagement: { tests_last_30_days: number; attendance_pct: number | null };
  risk: { level: "low" | "medium" | "high" | "unknown"; reasons: string[] };
  next_steps: TwinNextStep[];
  assumptions: Record<string, number | string>;
}
export interface StudentTwinResponse { student: { id: string; name: string }; twin: StudentTwin }

/** `studentId` is students.id; a student viewing themself may omit it. */
export async function fetchStudentTwin(studentId?: string): Promise<StudentTwinResponse> {
  const { data, error } = await supabase.functions.invoke("get-mastery-history", {
    body: { action: "student_twin", ...(studentId ? { student_id: studentId } : {}) },
  });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) message = j.error;
      }
    } catch { /* keep generic message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as StudentTwinResponse;
}
