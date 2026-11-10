// Client for the Student Engagement Score. Served by the existing `get-mastery-history` edge function via the
// `eng_*` actions; server side: supabase/functions/_shared/handlers/engagementScore.ts (rules in engagementModel.ts).
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export type ActivityKey = "video" | "quiz" | "assignment" | "live_class" | "interaction";
export type EngagementCategory = "highly_engaged" | "moderately_engaged" | "low" | "very_low";

export const ACTIVITY_META: Record<ActivityKey, { label: string; short: string }> = {
  video: { label: "Video watching", short: "Videos" },
  quiz: { label: "Quiz participation", short: "Quizzes" },
  assignment: { label: "Assignment submission", short: "Assignments" },
  live_class: { label: "Live class attendance", short: "Live classes" },
  interaction: { label: "Doubts & interactions", short: "Doubts" },
};
export const ACTIVITY_ORDER: ActivityKey[] = ["video", "quiz", "assignment", "live_class", "interaction"];

export const CATEGORY_META: Record<EngagementCategory, { label: string; range: string; text: string; bg: string; ring: string }> = {
  highly_engaged: { label: "Highly Engaged", range: "80-100", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", ring: "#059669" },
  moderately_engaged: { label: "Moderately Engaged", range: "60-79", text: "text-blue-700", bg: "bg-blue-50 border-blue-200", ring: "#2563eb" },
  low: { label: "Low Engagement", range: "40-59", text: "text-amber-700", bg: "bg-amber-50 border-amber-200", ring: "#d97706" },
  very_low: { label: "Very Low Engagement", range: "0-39", text: "text-red-700", bg: "bg-red-50 border-red-200", ring: "#dc2626" },
};

export interface ActivityResult {
  key: ActivityKey; available: boolean; score: number | null; opportunities: number; credit: number;
  weight: number; effective_weight: number; points: number;
}
export interface EngagementScore {
  student_id: string;
  status: "ok" | "insufficient";
  score: number | null;
  category: EngagementCategory | null;
  category_label: string | null;
  opportunities: number;
  activities: Record<ActivityKey, ActivityResult> | null;
  previous_score: number | null;
  delta: number | null;
  trend: "up" | "down" | "flat" | "unknown";
  declining: boolean;
  period_start: string | null; period_end: string | null; window_days: number; computed_at: string | null;
  tips: { key: ActivityKey; text: string }[];
  not_participating: ActivityKey[];
  name?: string;
}
export interface HistoryPoint { date: string; score: number | null; status: string; category: string | null }
export interface TrendPoint { date: string; average: number; students: number }
export interface Summary {
  students: number; scored: number; insufficient: number; average: number | null; category: EngagementCategory | null;
  category_counts: Record<EngagementCategory, number>; declining: number;
  activity_averages: Record<ActivityKey, number | null>; activity_gaps: Record<ActivityKey, number>;
  roster?: number; not_calculated?: number;
}
export interface SlimStudent { student_id: string; name: string; score: number; category: EngagementCategory | null; category_label: string | null; delta: number | null; trend: string }
export interface ClassSummary extends Summary { class_id: string; name: string; section: string; roster: number }
export interface EngagementConfig { weights: Record<ActivityKey, number>; window_days: number; [k: string]: unknown }

export interface MeResponse { config: { window_days: number; weights: Record<ActivityKey, number> }; score: EngagementScore | null; history: HistoryPoint[]; sources_unavailable: string[] }
export interface StudentResponse extends MeResponse { student: { id: string; name: string } }
export interface ClassResponse { config: MeResponse["config"]; summary: Summary; students: EngagementScore[]; pending_refresh: number; trend: TrendPoint[]; sources_unavailable: string[] }
export interface OverviewResponse {
  scope: "teacher" | "school"; config: MeResponse["config"]; summary: Summary & { roster: number; not_calculated: number };
  classes: ClassSummary[]; most_engaged: SlimStudent[]; least_engaged: SlimStudent[]; declining: SlimStudent[];
  trend: TrendPoint[]; pending_refresh: number; sources_unavailable: string[];
}
export interface SettingsResponse { config: EngagementConfig; defaults: EngagementConfig; can_edit: boolean }

async function call<T>(body: Record<string, unknown>, retried = false): Promise<T> {
  const { data, error } = await supabase.functions.invoke("get-mastery-history", { body });
  if (error) {
    const status = (error as { context?: Response } | null)?.context?.status;
    if (status === 401 && !retried) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) return call<T>(body, true);
    }
    const { message } = await unwrapFunctionError(error, "Couldn't load engagement scores.");
    throw new Error(status === 401 ? "Your sign-in has expired. Please sign out and sign in again." : message);
  }
  return data as T;
}

export const fetchMyEngagement = (force = false) => call<MeResponse>({ action: "eng_me", ...(force ? { force: true } : {}) });
export const fetchStudentEngagement = (studentId: string, force = false) => call<StudentResponse>({ action: "eng_student", student_id: studentId, ...(force ? { force: true } : {}) });
export const fetchClassEngagement = (classId: string, force = false) => call<ClassResponse>({ action: "eng_class", class_id: classId, ...(force ? { force: true } : {}) });
export const fetchEngagementOverview = (force = false) => call<OverviewResponse>({ action: "eng_overview", ...(force ? { force: true } : {}) });
export const fetchEngagementSettings = () => call<SettingsResponse>({ action: "eng_settings_get" });
export const saveEngagementSettings = (config: Partial<EngagementConfig>) => call<{ config: EngagementConfig }>({ action: "eng_settings_save", config });
