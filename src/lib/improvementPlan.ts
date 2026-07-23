import { supabase } from "@/integrations/supabase/client";

export interface PlanContent {
  summary: string;
  strengths: string[];
  focus_areas: string[];
  goals: { title: string; description: string; timeframe: string }[];
  action_items: { item: string; category: "academic" | "attendance" | "behavioural" }[];
}

export interface ImprovementPlan {
  id: string;
  student_id: string;
  school_id: string;
  content: PlanContent;
  teacher_notes: string | null;
  is_visible_to_student: boolean;
  generated_at: string;
  updated_at: string;
}

export async function getImprovementPlan(studentId: string): Promise<ImprovementPlan | null> {
  const { data, error } = await supabase
    .from("student_improvement_plans")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  return data as ImprovementPlan | null;
}

export async function generateImprovementPlan(studentId: string): Promise<{ student_id: string; content: PlanContent }> {
  const { data, error } = await supabase.functions.invoke("generate-improvement-plan", {
    body: { student_id: studentId },
  });
  if (error) throw error;
  return data;
}

export async function updateImprovementPlan(
  planId: string,
  payload: Partial<Pick<ImprovementPlan, "content" | "teacher_notes" | "is_visible_to_student">>
): Promise<void> {
  const { error } = await supabase
    .from("student_improvement_plans")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) throw error;
}
