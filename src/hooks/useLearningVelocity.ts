import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types matching the get_student_velocity_tree() / get_class_velocity()
//    JSON shapes (module 12) ──────────────────────────────────────────────

export type VelocityLabel = "insufficient_data" | "slow" | "average" | "fast";
export type VelocityTrend = "insufficient_data" | "accelerating" | "steady" | "slowing";

export interface VelocityConcept {
  id: number;
  name: string;
  attempts_count: number;
  mastery_gain_per_attempt: number | null;
  mastery_gain_per_day: number | null;
  velocity_label: VelocityLabel;
  trend: VelocityTrend;
  projected_days_to_mastery: number | null;
  projected_attempts_to_mastery: number | null;
  current_mastery: number | null;
}

export interface VelocityTopic {
  id: number;
  name: string;
  avg_gain_per_attempt: number | null;
  fast_count: number;
  average_count: number;
  slow_count: number;
  insufficient_count: number;
  concepts: VelocityConcept[];
}

export interface VelocityChapter {
  id: number;
  name: string;
  avg_gain_per_attempt: number | null;
  fast_count: number;
  average_count: number;
  slow_count: number;
  insufficient_count: number;
  topics: VelocityTopic[];
}

export interface VelocitySubject {
  book_id: number;
  subject: string;
  class_name: string | null;
  curriculum: string | null;
  avg_gain_per_attempt: number | null;
  pace_label: VelocityLabel;
  fast_count: number;
  average_count: number;
  slow_count: number;
  insufficient_count: number;
  last_evidence_at: string | null;
  chapters: VelocityChapter[];
}

export interface ClassVelocityTopicRow {
  chapter_id: string;
  chapter_name: string;
  topic_id: string;
  topic_name: string;
  class_avg_gain_per_attempt: number | null;
  students_with_data: number;
  students_total: number;
  students_slow_pace: number;
  students_fast_pace: number;
  is_pace_concern: boolean;
}

export interface ClassVelocityStudentRow {
  student_id: string;
  overall_avg_gain_per_attempt: number | null;
  pace_label: VelocityLabel;
}

// ── Student's own (or, for staff, any student's) velocity tree ──────────────
export function useVelocityTree(studentId?: string, bookId?: number) {
  return useQuery<VelocitySubject[]>({
    queryKey: ["learning-velocity", studentId ?? "self", bookId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-learning-velocity", {
        body: { student_id: studentId, book_id: bookId },
      });
      if (error) throw error;
      return (data?.subjects ?? []) as VelocitySubject[];
    },
    staleTime: 60 * 1000,
  });
}

// ── Teacher-facing: pace rollup for a whole class + subject ─────────────────
export function useClassVelocity(classId?: string, bookId?: number) {
  return useQuery<{ topics: ClassVelocityTopicRow[]; students: ClassVelocityStudentRow[] }>({
    queryKey: ["class-velocity", classId, bookId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-velocity", {
        body: { class_id: classId, book_id: bookId },
      });
      if (error) throw error;
      return {
        topics: (data?.topics ?? []) as ClassVelocityTopicRow[],
        students: (data?.students ?? []) as ClassVelocityStudentRow[],
      };
    },
    enabled: !!classId && !!bookId,
    staleTime: 60 * 1000,
  });
}
