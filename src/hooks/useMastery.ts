import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types matching the get_student_mastery_tree() JSON shape ────────────────
export interface MasteryObjective {
  id: number;
  text: string;
  bloom_level: string | null;
  difficulty: string;
  p_mastery: number;
  status: "not_assessed" | "beginning" | "developing" | "proficient" | "mastered";
  opportunities: number;
}

export interface MasteryConcept {
  id: number;
  name: string;
  p_mastery: number;
  objective_count: number;
  attempted_count: number;
  objectives: MasteryObjective[];
}

export interface MasteryTopic {
  id: number;
  name: string;
  p_mastery: number;
  objective_count: number;
  attempted_count: number;
  concepts: MasteryConcept[];
}

export interface MasteryChapter {
  id: number;
  name: string;
  p_mastery: number;
  objective_count: number;
  attempted_count: number;
  topics: MasteryTopic[];
}

export interface MasterySubject {
  book_id: number;
  subject: string;
  class_name: string | null;
  curriculum: string | null;
  p_mastery: number;
  objective_count: number;
  attempted_count: number;
  last_evidence_at: string | null;
  chapters: MasteryChapter[];
}

export interface ClassMasteryTopicRow {
  chapter_id: string;
  chapter_name: string;
  topic_id: string;
  topic_name: string;
  class_avg_mastery: number;
  students_attempted: number;
  students_total: number;
  is_weak_spot: boolean;
}

// ── Student's own (or, for staff, any student's) mastery tree ───────────────
export function useMasteryTree(studentId?: string, bookId?: number) {
  return useQuery<MasterySubject[]>({
    queryKey: ["mastery-tree", studentId ?? "self", bookId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-mastery-tree", {
        body: { student_id: studentId, book_id: bookId },
      });
      if (error) throw error;
      return (data?.subjects ?? []) as MasterySubject[];
    },
    staleTime: 60 * 1000,
  });
}

// ── Teacher-facing: weak-concept rollup for a whole class + subject ─────────
export function useClassMastery(classId?: string, bookId?: number) {
  return useQuery<ClassMasteryTopicRow[]>({
    queryKey: ["class-mastery", classId, bookId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-mastery", {
        body: { class_id: classId, book_id: bookId },
      });
      if (error) throw error;
      return (data?.topics ?? []) as ClassMasteryTopicRow[];
    },
    enabled: !!classId && !!bookId,
    staleTime: 60 * 1000,
  });
}

// ── Admin/teacher: AI-generate learning objectives for a concept or topic ───
export function useGenerateLearningObjectives() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { subtopicId?: number; topicId?: number; overwrite?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("generate-learning-objectives", {
        body: { subtopic_id: args.subtopicId, topic_id: args.topicId, overwrite: args.overwrite ?? false },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mastery-tree"] });
      queryClient.invalidateQueries({ queryKey: ["class-mastery"] });
    },
  });
}

// ── Record one or more graded answers against learning objectives ───────────
export interface EvidenceItem {
  learning_objective_id: number;
  is_correct: boolean;
  source: "mcq" | "homework" | "worksheet" | "ai_tutor" | "diagnostic" | "manual";
  source_id?: string;
  student_id?: string; // staff only; students always write their own record
}

export function useRecordMasteryEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: EvidenceItem | EvidenceItem[]) => {
      const body = Array.isArray(items) ? { items } : items;
      const { data, error } = await supabase.functions.invoke("update-mastery", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mastery-tree"] });
      queryClient.invalidateQueries({ queryKey: ["class-mastery"] });
    },
  });
}
