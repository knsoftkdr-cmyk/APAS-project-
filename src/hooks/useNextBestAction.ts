import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { LearningPathStep } from "@/hooks/useLearningPath";

// ── Types matching the next-best-action edge function's response shape ─────

export interface SubjectScore {
  book_id: number;
  subject: string;
  class_name: string | null;
  urgency_score: number;
  overdue_count: number;
  at_risk_count: number;
  blocked_count: number;
  soonest_forget_days: number | null;
}

export interface NextBestAction {
  student_id: string;
  has_recommendation: boolean;
  message?: string;
  primary_subject?: SubjectScore;
  next_action?: LearningPathStep;
  why_this_subject?: string;
  session_plan?: LearningPathStep[];
  estimated_minutes?: number;
  minutes_available?: number;
  alternates?: SubjectScore[];
  generated_at?: string;
}

// ── The single "what should I do right now" recommendation ────────────────
export function useNextBestAction(args: { studentId?: string; minutesAvailable?: number; maxSteps?: number } = {}) {
  return useQuery<NextBestAction>({
    queryKey: ["next-best-action", args.studentId ?? "self", args.minutesAvailable ?? 15, args.maxSteps ?? 5],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("next-best-action", {
        body: {
          student_id: args.studentId,
          minutes_available: args.minutesAvailable,
          max_steps: args.maxSteps,
        },
      });
      if (error) {
        const { message } = await unwrapFunctionError(error, "Couldn't get a recommendation right now.");
        throw new Error(message);
      }
      return data as NextBestAction;
    },
    staleTime: 2 * 60 * 1000,
  });
}
