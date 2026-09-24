import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// ── Types matching the get-student-misconceptions / get-class-misconception-
//    hotspots edge functions' response shapes ──────────────────────────────

export interface StudentMisconception {
  misconception_id: number;
  misconception_text: string;
  why_it_happens: string | null;
  correction_hint: string | null;
  severity: "low" | "medium" | "high";
  occurrence_count: number;
  distinct_items: number;
  first_seen_at: string;
  last_seen_at: string;
  subtopic_id: number;
  subtopic_name: string;
  topic_id: number;
  topic_name: string;
  chapter_name: string;
  subject: string;
  class_name: string | null;
}

export interface ClassMisconceptionHotspot {
  misconception_id: number;
  misconception_text: string;
  correction_hint: string | null;
  severity: "low" | "medium" | "high";
  topic_name: string;
  chapter_name: string;
  students_affected: number;
  total_occurrences: number;
}

// ── Student (or, for staff, a chosen student's) repeated misconceptions ────
export function useStudentMisconceptions(args: { studentId?: string; minOccurrences?: number; bookId?: number } = {}) {
  return useQuery<StudentMisconception[]>({
    queryKey: ["student-misconceptions", args.studentId ?? "self", args.minOccurrences ?? 2, args.bookId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-student-misconceptions", {
        body: { student_id: args.studentId, min_occurrences: args.minOccurrences, book_id: args.bookId },
      });
      if (error) {
        const { message } = await unwrapFunctionError(error, "Couldn't load misconception patterns.");
        throw new Error(message);
      }
      return (data?.misconceptions ?? []) as StudentMisconception[];
    },
    staleTime: 60 * 1000,
  });
}

// ── Teacher-facing: misconceptions shared across the most students ─────────
export function useClassMisconceptionHotspots(classId?: string, bookId?: number, minOccurrences?: number) {
  return useQuery<ClassMisconceptionHotspot[]>({
    queryKey: ["class-misconception-hotspots", classId, bookId, minOccurrences ?? 2],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-class-misconception-hotspots", {
        body: { class_id: classId, book_id: bookId, min_occurrences: minOccurrences },
      });
      if (error) {
        const { message } = await unwrapFunctionError(error, "Couldn't load class misconception hotspots.");
        throw new Error(message);
      }
      return (data?.hotspots ?? []) as ClassMisconceptionHotspot[];
    },
    enabled: !!classId && !!bookId,
    staleTime: 60 * 1000,
  });
}
