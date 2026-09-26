import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import type { LearningPathStep } from "@/hooks/useLearningPath";

// ── Types matching adaptive_homework_assignments / adaptive_homework_items ─

export type MasteryBand = "beginning" | "developing" | "proficient" | "mastered";

export interface AdaptiveHomeworkAssignment {
  id: string;
  class_id: string;
  book_id: number;
  chapter_id: number | null;
  title: string;
  items_per_student: number;
  due_at: string | null;
  assigned_by: string;
  student_count: number;
  band_counts: Partial<Record<MasteryBand, number>>;
  created_at: string;
}

export interface AdaptiveHomeworkAnswer {
  item_id: string;
  learning_objective_id: number;
  selected_option: "A" | "B" | "C" | "D";
  is_correct: boolean;
}

export interface AdaptiveHomeworkItemRow {
  id: string;
  assignment_id: string;
  student_id: string;
  mastery_band: MasteryBand;
  avg_mastery: number | null;
  items: LearningPathStep[];
  answers: AdaptiveHomeworkAnswer[];
  status: "assigned" | "in_progress" | "submitted";
  score: number | null;
  submitted_at: string | null;
  created_at: string;
  adaptive_homework_assignments?: AdaptiveHomeworkAssignment;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("adaptive-homework", { body });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Adaptive homework request failed.");
    throw new Error(message);
  }
  return data as T;
}

// ── Student: my own generated sets ──────────────────────────────────────────
export function useMyAdaptiveHomework() {
  return useQuery<AdaptiveHomeworkItemRow[]>({
    queryKey: ["adaptive-homework", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("adaptive_homework_items")
        .select("*, adaptive_homework_assignments(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdaptiveHomeworkItemRow[];
    },
    staleTime: 60 * 1000,
  });
}

// ── Student: grade one item in one of my sets ───────────────────────────────
export function useSubmitAdaptiveHomeworkAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      itemRowId: string;
      itemId: string;
      learningObjectiveId: number;
      selectedOption: "A" | "B" | "C" | "D";
    }) =>
      invoke<{ is_correct: boolean; correct_option: string; explanation: string | null; p_mastery_before: number; p_mastery_after: number }>({
        action: "submit_answer",
        item_row_id: args.itemRowId,
        item_id: args.itemId,
        learning_objective_id: args.learningObjectiveId,
        selected_option: args.selectedOption,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adaptive-homework"] });
      queryClient.invalidateQueries({ queryKey: ["mastery-tree"] });
    },
  });
}

// ── Teacher/staff: generate one differentiated set per student in a class ──
export function useGenerateAdaptiveHomework() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      classId: string;
      bookId: number;
      chapterId?: number;
      title?: string;
      itemsPerStudent?: number;
      dueAt?: string;
    }) =>
      invoke<{
        assignment_id: string;
        title: string;
        student_count: number;
        band_counts: Partial<Record<MasteryBand, number>>;
        students: Array<{ student_id: string; mastery_band?: MasteryBand; item_count?: number; error?: string }>;
      }>({
        action: "generate",
        class_id: args.classId,
        book_id: args.bookId,
        chapter_id: args.chapterId,
        title: args.title,
        items_per_student: args.itemsPerStudent,
        due_at: args.dueAt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adaptive-homework-assignments"] });
    },
  });
}

// ── Teacher/staff: past batches generated for a class ───────────────────────
export function useAdaptiveHomeworkAssignments(classId?: string) {
  return useQuery<AdaptiveHomeworkAssignment[]>({
    queryKey: ["adaptive-homework-assignments", classId ?? "all"],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("adaptive_homework_assignments")
        .select("*")
        .eq("class_id", classId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AdaptiveHomeworkAssignment[];
    },
  });
}
