// src/hooks/useExamIntelligence.ts
//
// Client hooks for:
//   - Exam Readiness Score      (get-prerequisite-readiness view "exam", get-class-mastery mode "readiness")
//   - Cohort Intelligence       (get-class-mastery mode "cohort")
//   - Exam Simulation Mode      (generate-assessment-paper / assign-assessment-paper /
//                                get-assessment-paper-attempt / submit-assessment-paper-attempt)
// No new edge functions: each call goes to an existing one.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const { message } = await unwrapFunctionError(error, "That request failed.");
    throw new Error(message);
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

// ═══════════════════════════════════════════════════════════════════════════
// Exam readiness
// ═══════════════════════════════════════════════════════════════════════════
export type ReadinessBand = "exam_ready" | "nearly_ready" | "needs_work" | "at_risk";

export const BAND_LABEL: Record<ReadinessBand, string> = {
  exam_ready: "Exam ready", nearly_ready: "Nearly ready", needs_work: "Needs work", at_risk: "At risk",
};
export const BAND_CLASS: Record<ReadinessBand, string> = {
  exam_ready: "bg-emerald-100 text-emerald-800 border-emerald-200",
  nearly_ready: "bg-sky-100 text-sky-800 border-sky-200",
  needs_work: "bg-amber-100 text-amber-800 border-amber-200",
  at_risk: "bg-rose-100 text-rose-800 border-rose-200",
};
export const bandForScore = (score: number | null | undefined): ReadinessBand | null =>
  score == null ? null : score >= 80 ? "exam_ready" : score >= 65 ? "nearly_ready" : score >= 45 ? "needs_work" : "at_risk";

export interface TopicReadiness { topic_id: number; name: string; readiness: number; current_mastery: number; band: ReadinessBand; objective_count: number; assessed_count: number; coverage_pct: number }
export interface ChapterReadiness { chapter_id: number; name: string; readiness: number; current_mastery: number; band: ReadinessBand; objective_count: number; assessed_count: number; coverage_pct: number; topics: TopicReadiness[] }
export interface SubjectReadiness { book_id: number; subject: string; class_name: string | null; readiness: number; current_mastery: number; band: ReadinessBand; objective_count: number; assessed_count: number; coverage_pct: number; chapters: ChapterReadiness[] }

export interface ExamReadiness {
  student_id: string;
  has_data: boolean;
  message?: string;
  exam_date?: string | null;
  days_to_exam?: number | null;
  overall: null | {
    readiness: number; current_mastery: number; forgetting_loss: number; predicted_score_pct: number; band: ReadinessBand;
    objective_count: number; assessed_count: number; weak_objective_count: number; coverage_pct: number; confidence: "high" | "medium" | "low";
  };
  subjects: SubjectReadiness[];
  blueprint?: null | {
    blueprint_id: string; title: string; readiness: number | null; predicted_score_pct: number | null; band: ReadinessBand | null; unmapped_weight_pct: number;
    scopes: { scope_type: string; scope_id: number; label: string; weight_pct: number; readiness: number | null; coverage_pct: number | null }[];
  };
  focus_areas?: { topic_id: number; topic_name: string; chapter_name: string; subject: string; readiness: number; coverage_pct: number; priority: number }[];
  weakest_concepts?: { subtopic_id: number; name: string; topic_name: string; chapter_name: string; subject: string; readiness: number; assessed: boolean }[];
  bloom?: { bloom_level: string; readiness: number; objective_count: number; assessed_count: number }[];
  mock_exams?: { attempt_id: string; title: string; score: number; max_marks: number; pct: number; status: string; submitted_at: string }[];
}

export interface ReadinessParams { studentId?: string; bookId?: number | null; blueprintId?: string | null; examDate?: string | null }

export function useExamReadiness(params: ReadinessParams, enabled = true) {
  return useQuery<ExamReadiness>({
    queryKey: ["exam-readiness", params.studentId ?? "self", params.bookId ?? "all", params.blueprintId ?? "none", params.examDate ?? "today"],
    queryFn: () => invokeFn<ExamReadiness>("get-prerequisite-readiness", {
      view: "exam", student_id: params.studentId, book_id: params.bookId ?? undefined,
      blueprint_id: params.blueprintId ?? undefined, exam_date: params.examDate || undefined,
    }),
    enabled,
    staleTime: 60 * 1000,
  });
}

export interface ClassExamReadiness {
  class_id: string;
  roster_size: number;
  students_with_data: number;
  class_avg_readiness: number | null;
  class_avg_blueprint_readiness: number | null;
  bands: Partial<Record<ReadinessBand, number>>;
  students: { student_id: string; name: string; readiness: number | null; band: ReadinessBand | null; blueprint_readiness: number | null; coverage_pct: number | null; confidence: string | null; weakest_topic: string | null }[];
  topics: { topic_id: number; topic_name: string; chapter_name: string; class_readiness: number; students_at_risk: number; students: number }[];
}

export function useClassExamReadiness(classId?: string, params: { bookId?: number | null; blueprintId?: string | null; examDate?: string | null } = {}) {
  return useQuery<ClassExamReadiness>({
    queryKey: ["class-exam-readiness", classId, params.bookId ?? "all", params.blueprintId ?? "none", params.examDate ?? "today"],
    queryFn: () => invokeFn<ClassExamReadiness>("get-class-mastery", {
      mode: "readiness", class_id: classId, book_id: params.bookId ?? undefined,
      blueprint_id: params.blueprintId ?? undefined, exam_date: params.examDate || undefined,
    }),
    enabled: !!classId,
    staleTime: 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Cohort intelligence
// ═══════════════════════════════════════════════════════════════════════════
export type CohortLevelKey = "section" | "class" | "grade" | "school";

export interface CohortLevel {
  label: string;
  suppressed?: boolean;
  reason?: string;
  roster_size?: number;
  compared_with?: number;
  avg_pct?: number | null;
  median_pct?: number | null;
  p25_pct?: number | null;
  p75_pct?: number | null;
  top_pct?: number | null;
  gap_vs_avg_pts?: number | null;
  percentile?: number | null;
  rank?: number | null;
  z_score?: number | null;
}

export interface CohortTopicRow {
  topic_id: number; topic_name: string; chapter_name: string; student_pct?: number;
  section_avg_pct: number | null; class_avg_pct: number | null; grade_avg_pct: number | null; school_avg_pct: number | null;
  gap_pts: number | null; standing: "above" | "on_par" | "below" | "no_reference"; section_students?: number;
}

export interface StudentCohortComparison {
  student_id: string;
  insufficient_data: boolean;
  student_score_pct: number | null;
  min_objectives: number;
  levels: Partial<Record<CohortLevelKey, CohortLevel>>;
  topics: CohortTopicRow[];
}

export type CohortPattern =
  | "below_all_levels" | "above_all_levels" | "strong_in_section_weak_in_grade" | "weak_in_section_strong_in_grade" | "mixed" | "insufficient_data";

export interface ClassCohortIntelligence {
  class_id: string;
  class_label: string;
  grade: string | null;
  levels: Partial<Record<CohortLevelKey, { roster_size: number; compared_with: number; avg_pct: number | null; median_pct: number | null }>>;
  section_gap_vs_grade_pts: number | null;
  section_gap_vs_school_pts: number | null;
  sections_in_class: { class_id: string; label: string; roster_size: number; compared_with: number; avg_pct: number | null; is_this_section: boolean }[];
  distribution: { band: string; students: number }[];
  pattern_counts: Partial<Record<CohortPattern, number>>;
  students: {
    student_id: string; name: string; score_pct: number | null; assessed_objectives: number | null;
    section_percentile: number | null; grade_percentile: number | null; school_percentile: number | null;
    gap_vs_section_pts: number | null; gap_vs_grade_pts: number | null; gap_vs_school_pts: number | null; pattern: CohortPattern;
  }[];
  topics: CohortTopicRow[];
}

export function useClassCohort(classId?: string, bookId?: number | null) {
  return useQuery<ClassCohortIntelligence>({
    queryKey: ["class-cohort", classId, bookId ?? "all"],
    queryFn: () => invokeFn<ClassCohortIntelligence>("get-class-mastery", { mode: "cohort", class_id: classId, book_id: bookId ?? undefined }),
    enabled: !!classId,
    staleTime: 60 * 1000,
  });
}

/** The signed-in student's own standing (studentId omitted), or a specific student for staff. */
export function useStudentCohort(bookId?: number | null, studentId?: string, enabled = true) {
  return useQuery<StudentCohortComparison>({
    queryKey: ["student-cohort", studentId ?? "self", bookId ?? "all"],
    queryFn: () => invokeFn<StudentCohortComparison>("get-class-mastery", { mode: "cohort", student_id: studentId, book_id: bookId ?? undefined }),
    enabled,
    staleTime: 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Exam simulation
// ═══════════════════════════════════════════════════════════════════════════
export interface ExamPatternSection { question_type: string; marks_per_item: number; total_marks: number; section_label?: string }
export interface ExamPattern {
  code: string; name: string; board: string | null; grade: string | null; subject: string | null; description: string | null;
  total_marks: number; duration_minutes: number; question_type_mix: ExamPatternSection[];
  bloom_distribution: Record<string, number>; difficulty_distribution: Record<string, number>; instructions: string[]; is_system: boolean;
}

export function useExamPatterns() {
  return useQuery<ExamPattern[]>({
    queryKey: ["exam-patterns"],
    queryFn: async () => (await invokeFn<{ patterns: ExamPattern[] }>("generate-assessment-paper", { list_exam_patterns: true })).patterns,
    staleTime: 5 * 60 * 1000,
  });
}

export interface GeneratedMock {
  paper_id: string; blueprint_id: string | null; exam_pattern_code: string | null; duration_minutes: number | null;
  assembled_total_marks: number; item_count: number;
  coverage_report: { match_score: number; shortfalls: { question_type: string; difficulty: string; chapter: string; needed: number; found: number; reason: string }[] };
}

export function useGenerateMockExam() {
  return useMutation({
    mutationFn: (args: { examPatternCode: string; syllabusWeightage: { scope_type: "chapter" | "topic"; scope_id: number; label?: string; weight_pct: number }[]; title?: string; subject?: string }) =>
      invokeFn<GeneratedMock>("generate-assessment-paper", {
        exam_pattern_code: args.examPatternCode, syllabus_weightage: args.syllabusWeightage, title: args.title, subject: args.subject, save_as_blueprint: true,
      }),
  });
}

export function useAssignMockExam() {
  return useMutation({
    mutationFn: (args: { paperId: string; classId: string; title?: string; opensAt?: string | null; dueAt?: string | null; timeLimitMinutes?: number | null; strictTimer: boolean; graceSeconds?: number }) =>
      invokeFn<{ assignment_id: string; student_count: number; time_limit_minutes: number | null; strict_timer: boolean }>("assign-assessment-paper", {
        paper_id: args.paperId, class_id: args.classId, is_mock: true, strict_timer: args.strictTimer, title: args.title,
        opens_at: args.opensAt || undefined, due_at: args.dueAt || undefined,
        time_limit_minutes: args.timeLimitMinutes ?? undefined, grace_seconds: args.graceSeconds,
      }),
  });
}

export interface ExamItem {
  item_id: string; question_type: string; order_index: number; section_label: string; marks: number;
  stem: string; options?: Record<string, string>; context_passage?: string | null;
  sub_questions?: { id: string; text: string; max_marks: number }[]; bloom_level?: string | null; difficulty?: string | null;
}
export interface AttemptResultItem {
  item_id: string; question_type: "mcq" | "open_ended"; order_index: number; section_label: string; marks: number; awarded: number;
  answered: boolean; is_correct?: boolean; selected_option?: string | null; correct_option?: string; explanation?: string | null;
  provisional?: boolean; teacher_reviewed?: boolean; feedback?: string | null; bloom_level: string | null; difficulty: string | null; topic_name: string | null;
}
export interface AnalysisRow { marks: number; max_marks: number; pct: number | null; questions: number; label?: string; bloom_level?: string; difficulty?: string; topic_name?: string }
export interface AttemptPayload {
  attempt: { id: string; status: "assigned" | "in_progress" | "submitted" | "graded"; started_at: string | null; total_max_marks: number; total_score?: number; submitted_at?: string; auto_submitted?: boolean; late_submission?: boolean; time_taken_seconds?: number };
  assignment: { id: string; title: string; due_at: string | null; time_limit_minutes: number | null; is_mock: boolean; strict_timer: boolean; grace_seconds: number; opens_at: string | null };
  exam: { title: string; instructions: string[]; exam_pattern_code: string | null };
  timing: { server_now: string; deadline_at: string | null; seconds_remaining: number | null; expired: boolean };
  draft?: { mcq?: Record<string, string>; open?: Record<string, string> };
  items: ExamItem[];
  result?: {
    score: number; max_marks: number; pct: number | null; provisional: boolean; unanswered: number; items: AttemptResultItem[];
    analysis: { sections: AnalysisRow[]; bloom: AnalysisRow[]; difficulty: AnalysisRow[]; topics: AnalysisRow[]; weak_topics: AnalysisRow[] };
  };
}

export function useExamAttempt(assignmentId?: string) {
  return useQuery<AttemptPayload>({
    queryKey: ["exam-attempt", assignmentId],
    queryFn: () => invokeFn<AttemptPayload>("get-assessment-paper-attempt", { assignment_id: assignmentId }),
    enabled: !!assignmentId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useSubmitExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { attemptId: string; mcq: Record<string, string>; open: Record<string, string> }) =>
      invokeFn<{ status: string; total_score: number; total_max_marks: number; auto_submitted: boolean; note?: string }>("submit-assessment-paper-attempt", {
        attempt_id: args.attemptId,
        mcq_answers: Object.entries(args.mcq).map(([item_id, selected_option]) => ({ item_id, selected_option })),
        open_responses: Object.entries(args.open).map(([item_id, answer_text]) => ({ item_id, answer_text })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-attempt"] });
      qc.invalidateQueries({ queryKey: ["my-exams"] });
      qc.invalidateQueries({ queryKey: ["mastery-tree"] });
      qc.invalidateQueries({ queryKey: ["exam-readiness"] });
    },
  });
}

export interface MyExamRow {
  attempt_id: string; assignment_id: string; status: "assigned" | "in_progress" | "submitted" | "graded";
  total_score: number | null; total_max_marks: number; title: string; due_at: string | null; opens_at: string | null;
  time_limit_minutes: number | null; is_mock: boolean; strict_timer: boolean; assignment_status: string;
}

/** The student's own assigned exams. Attempts + assignments are readable by the student through RLS. */
export function useMyExams(studentId?: string) {
  return useQuery<MyExamRow[]>({
    queryKey: ["my-exams", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      // deno-lint-ignore no-explicit-any
      const db = supabase as any;
      const { data: attempts, error } = await db.from("generated_assessment_paper_attempts")
        .select("id, assignment_id, status, total_score, total_max_marks").eq("student_id", studentId).order("created_at", { ascending: false });
      if (error) throw error;
      const ids = [...new Set((attempts ?? []).map((a: { assignment_id: string }) => a.assignment_id))];
      if (!ids.length) return [];
      const { data: asg, error: aErr } = await db.from("generated_assessment_paper_assignments")
        .select("id, title, due_at, opens_at, time_limit_minutes, is_mock, strict_timer, status").in("id", ids);
      if (aErr) throw aErr;
      const byId = new Map((asg ?? []).map((a: { id: string }) => [a.id, a]));
      return (attempts ?? []).flatMap((a: Record<string, unknown>) => {
        const g = byId.get(a.assignment_id as string) as Record<string, unknown> | undefined;
        if (!g) return [];
        return [{
          attempt_id: a.id, assignment_id: a.assignment_id, status: a.status, total_score: a.total_score, total_max_marks: a.total_max_marks,
          title: g.title, due_at: g.due_at, opens_at: g.opens_at, time_limit_minutes: g.time_limit_minutes, is_mock: g.is_mock,
          strict_timer: g.strict_timer, assignment_status: g.status,
        } as MyExamRow];
      });
    },
  });
}
