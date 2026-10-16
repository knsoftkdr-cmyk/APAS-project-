import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types matching the get-forgetting-forecast / get-retention-curve /
//    get-class-forgetting-risk edge functions' response shapes ─────────────

export interface ForgettingForecastItem {
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
  /** predicted recall now = mastery x memory decay (0-1) */
  retention_now: number;
  /** current mastery estimate (0-1); the curve starts here, not at 100% */
  p_mastery?: number;
  due_at: string;
  forgetting_date: string;
  days_until_forgotten: number;
  is_at_risk: boolean;
  repetitions: number;
  ease_factor: number;
}

export interface RetentionCurvePoint {
  day: number;
  date: string;
  retention: number;
}

export interface RetentionCurve {
  learning_objective_id: number;
  last_reviewed_at: string;
  due_at: string;
  half_life_days: number;
  /** mastery the curve starts from (0-1) */
  p_mastery?: number;
  points: RetentionCurvePoint[];
}

/** A concept that was answered but isn't learned yet - there is nothing to forget, so it gets no forecast. */
export interface StillLearningItem {
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
  last_reviewed_at: string;
  reason: "answered_incorrectly" | "low_mastery";
}

export interface ClassForgettingRiskTopic {
  topic_id: number;
  topic_name: string;
  chapter_name: string;
  students_at_risk: number;
  students_total: number;
  risk_ratio: number;
}

// ── Student (or, for staff, a chosen student's) forgetting forecast ────────
export function useForgettingForecast(args: { studentId?: string; threshold?: number; horizonDays?: number; bookId?: number } = {}) {
  return useQuery<ForgettingForecastItem[]>({
    queryKey: ["forgetting-forecast", args.studentId ?? "self", args.threshold ?? 0.5, args.horizonDays ?? 14, args.bookId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-forgetting-risk", {
        body: {
          action: "student_forecast",
          student_id: args.studentId,
          threshold: args.threshold,
          horizon_days: args.horizonDays,
          book_id: args.bookId,
        },
      });
      if (error) throw error;
      return (data?.forecast ?? []) as ForgettingForecastItem[];
    },
    staleTime: 60 * 1000,
  });
}

// ── The Forgetting Forecast page: concepts you know (with forecasts) + concepts still to learn ─────────
export function useForgettingOverview(args: { studentId?: string; threshold?: number; horizonDays?: number; bookId?: number } = {}) {
  return useQuery<{ forecast: ForgettingForecastItem[]; stillLearning: StillLearningItem[] }>({
    queryKey: ["forgetting-overview", args.studentId ?? "self", args.threshold ?? 0.5, args.horizonDays ?? 14, args.bookId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-forgetting-risk", {
        body: {
          action: "student_forecast",
          include_unlearned: true,
          student_id: args.studentId,
          threshold: args.threshold,
          horizon_days: args.horizonDays,
          book_id: args.bookId,
        },
      });
      if (error) throw error;
      return {
        forecast: (data?.forecast ?? []) as ForgettingForecastItem[],
        stillLearning: (data?.still_learning ?? []) as StillLearningItem[],
      };
    },
    staleTime: 60 * 1000,
  });
}

// ── One concept's day-by-day decay curve, for charting ──────────────────────
export function useRetentionCurve(learningObjectiveId?: number, args: { studentId?: string; daysAhead?: number } = {}) {
  return useQuery<RetentionCurve | null>({
    queryKey: ["retention-curve", learningObjectiveId, args.studentId ?? "self", args.daysAhead ?? 30],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-forgetting-risk", {
        body: {
          action: "retention_curve",
          learning_objective_id: learningObjectiveId,
          student_id: args.studentId,
          days_ahead: args.daysAhead,
        },
      });
      if (error) throw error;
      return (data?.curve ?? null) as RetentionCurve | null;
    },
    enabled: !!learningObjectiveId,
    staleTime: 60 * 1000,
  });
}

// ── Teacher-facing: which topics are decaying fastest across a class ───────
export function useClassForgettingRisk(classId?: string, bookId?: number, args: { threshold?: number; horizonDays?: number } = {}) {
  return useQuery<ClassForgettingRiskTopic[]>({
    queryKey: ["class-forgetting-risk", classId, bookId, args.threshold ?? 0.5, args.horizonDays ?? 14],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-forgetting-risk", {
        body: { class_id: classId, book_id: bookId, threshold: args.threshold, horizon_days: args.horizonDays },
      });
      if (error) throw error;
      return (data?.topics ?? []) as ClassForgettingRiskTopic[];
    },
    enabled: !!classId && !!bookId,
    staleTime: 60 * 1000,
  });
}
