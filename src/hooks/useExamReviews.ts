// src/hooks/useExamReviews.ts
//
// Teacher side of "your teacher will confirm": lists exam attempts that have written (open-ended)
// answers, loads one attempt with every answer + the AI's first-pass grade, and saves the teacher's
// final mark.
//
// Reads go straight to the tables (staff RLS allows it, and we scope to the teacher's classes / the
// school here). The write goes through the existing `evaluate-assessment` action
// "review_open_response", which stamps graded_by/graded_at and sets status = "teacher_reviewed".
// A database trigger (sync_assessment_attempt_grade) then totals the attempt and flips it to "graded"
// once every written answer on it has been reviewed - nothing to compute client-side.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchClassOptions } from "@/lib/Classsubjects";
import { invokeFn } from "@/hooks/useExamIntelligence";

// deno-lint-ignore no-explicit-any
const db = supabase as any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const STAFF_ADMIN_ROLES = ["admin", "principal", "school_admin", "hod"];
const CHUNK = 80;

export type ReviewFilter = "pending" | "reviewed";

export interface ReviewAttempt {
  id: string;
  status: "submitted" | "graded";
  studentName: string;
  studentClass: string;
  rollNumber: string | null;
  examTitle: string;
  assignmentId: string;
  isMock: boolean;
  submittedAt: string | null;
  totalScore: number | null;
  totalMax: number;
  writtenTotal: number;
  writtenPending: number;
  autoSubmitted: boolean;
  late: boolean;
}

export interface RubricRow { criterion: string; max_marks: number; awarded?: number; met?: boolean; reasoning?: string }
export interface SubQuestion { id?: string; label?: string; question?: string; text?: string; marks?: number }

export interface ReviewItem {
  number: number;           // position on the paper - same numbering the student sees
  itemId: string;
  slotMarks: number;        // marks this question is worth on THIS paper
  itemMax: number;          // the question's own max (teacher_score is on this scale)
  sectionLabel: string | null;
  questionType: string;
  stem: string;
  context: string | null;
  subQuestions: SubQuestion[];
  rubric: Row[];
  modelAnswer: string | null;
  submission: null | {
    id: string;
    answerText: string;
    aiScore: number | null;
    aiRubric: RubricRow[];
    aiFeedback: string | null;
    teacherScore: number | null;
    teacherFeedback: string | null;
    status: string;
  };
}

export interface ReviewDetail {
  attemptId: string;
  status: string;
  studentName: string;
  studentClass: string;
  examTitle: string;
  totalScore: number | null;
  totalMax: number;
  items: ReviewItem[];    // written questions only (MCQs need no review)
}

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const studentClassLabel = (s: Row | null | undefined) =>
  s ? [s.class, s.section].filter(Boolean).join(" - ") : "";

const ATTEMPT_COLS =
  "id, status, assignment_id, total_score, total_max_marks, submitted_at, auto_submitted, late_submission, " +
  "students!inner(full_name, class, section, roll_number, school_id), " +
  "generated_assessment_paper_assignments(title, is_mock)";

async function loadAttempts(
  profile: { id: string; role: string; school_id: string | null },
  filter: ReviewFilter,
): Promise<ReviewAttempt[]> {
  const wantStatus = filter === "pending" ? "submitted" : "graded";

  const query = (assignmentIds?: string[]) => {
    let q = db.from("generated_assessment_paper_attempts").select(ATTEMPT_COLS).eq("status", wantStatus);
    if (filter === "reviewed") q = q.gt("open_ended_max_marks", 0); // MCQ-only papers have nothing to review
    if (profile.school_id) q = q.eq("students.school_id", profile.school_id);
    if (assignmentIds) q = q.in("assignment_id", assignmentIds);
    return q.order("submitted_at", { ascending: false }).limit(300);
  };

  let rows: Row[] = [];
  if (STAFF_ADMIN_ROLES.includes(profile.role)) {
    const { data, error } = await query();
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } else {
    // A teacher sees the exams given to their classes, plus any they assigned themselves.
    const classes = await fetchClassOptions(profile);
    const classIds = classes.map((c) => c.id);
    const scope = classIds.length
      ? `class_id.in.(${classIds.join(",")}),assigned_by.eq.${profile.id}`
      : `assigned_by.eq.${profile.id}`;
    const { data: asg, error: asgErr } = await db.from("generated_assessment_paper_assignments").select("id").or(scope);
    if (asgErr) throw new Error(asgErr.message);
    const ids: string[] = (asg ?? []).map((a: Row) => a.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await query(ids.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    rows.sort((a, b) => String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? "")));
  }
  if (!rows.length) return [];

  // How many written answers each attempt has, and how many still wait for the teacher.
  const attemptIds = rows.map((r) => r.id as string);
  const counts = new Map<string, { total: number; pending: number }>();
  for (let i = 0; i < attemptIds.length; i += CHUNK) {
    const { data, error } = await db.from("open_response_submissions")
      .select("source_id, status").eq("source", "test").in("source_id", attemptIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const s of data ?? []) {
      const c = counts.get(s.source_id) ?? { total: 0, pending: 0 };
      c.total++;
      if (s.status !== "teacher_reviewed") c.pending++;
      counts.set(s.source_id, c);
    }
  }

  return rows
    .map((r): ReviewAttempt => {
      const c = counts.get(r.id) ?? { total: 0, pending: 0 };
      const asg = r.generated_assessment_paper_assignments as Row | null;
      return {
        id: r.id, status: r.status, assignmentId: r.assignment_id,
        studentName: r.students?.full_name ?? "Student", studentClass: studentClassLabel(r.students),
        rollNumber: r.students?.roll_number ?? null,
        examTitle: asg?.title ?? "Exam", isMock: !!asg?.is_mock,
        submittedAt: r.submitted_at, totalScore: num(r.total_score), totalMax: Number(r.total_max_marks) || 0,
        writtenTotal: c.total, writtenPending: c.pending,
        autoSubmitted: !!r.auto_submitted, late: !!r.late_submission,
      };
    })
    .filter((a) => a.writtenTotal > 0);
}

export function useExamReviewAttempts(filter: ReviewFilter, enabled = true) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["exam-reviews", "list", filter, profile?.id],
    enabled: enabled && !!profile?.id,
    staleTime: 30_000,
    queryFn: () => loadAttempts({ id: profile!.id, role: profile!.role, school_id: profile!.school_id }, filter),
  });
}

export function useExamReviewDetail(attemptId: string | null) {
  return useQuery({
    queryKey: ["exam-reviews", "detail", attemptId],
    enabled: !!attemptId,
    staleTime: 0,
    queryFn: async (): Promise<ReviewDetail> => {
      const { data: attempt, error } = await db.from("generated_assessment_paper_attempts")
        .select("id, status, total_score, total_max_marks, students(full_name, class, section), generated_assessment_paper_assignments(title, paper_id)")
        .eq("id", attemptId).single();
      if (error || !attempt) throw new Error(error?.message ?? "Attempt not found");
      const paperId = attempt.generated_assessment_paper_assignments?.paper_id;

      const { data: paperItems, error: piErr } = await db.from("generated_assessment_paper_items")
        .select("mcq_item_id, extended_item_id, marks, order_index, section_label").eq("paper_id", paperId).order("order_index");
      if (piErr) throw new Error(piErr.message);

      const extIds: string[] = (paperItems ?? []).map((p: Row) => p.extended_item_id).filter(Boolean);
      const [{ data: bank, error: bankErr }, { data: subs, error: subErr }] = await Promise.all([
        extIds.length
          ? db.from("question_bank_extended").select("id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks").in("id", extIds)
          : Promise.resolve({ data: [], error: null }),
        db.from("open_response_submissions")
          .select("id, item_id, answer_text, ai_suggested_score, ai_rubric_scores, ai_feedback, teacher_score, teacher_feedback, status")
          .eq("source", "test").eq("source_id", attemptId),
      ]);
      if (bankErr) throw new Error(bankErr.message);
      if (subErr) throw new Error(subErr.message);

      const bankById = new Map<string, Row>((bank ?? []).map((b: Row) => [b.id, b]));
      const subByItem = new Map<string, Row>((subs ?? []).map((s: Row) => [s.item_id, s]));

      const items: ReviewItem[] = [];
      (paperItems ?? []).forEach((p: Row, idx: number) => {
        if (!p.extended_item_id) return;
        const q = bankById.get(p.extended_item_id);
        if (!q) return;
        const s = subByItem.get(p.extended_item_id);
        items.push({
          number: idx + 1, itemId: q.id, slotMarks: Number(p.marks), itemMax: Number(q.max_marks) || Number(p.marks),
          sectionLabel: p.section_label ?? null, questionType: q.question_type,
          stem: q.stem, context: q.context_passage ?? null,
          subQuestions: Array.isArray(q.sub_questions) ? q.sub_questions : [],
          rubric: Array.isArray(q.rubric) ? q.rubric : [],
          modelAnswer: q.model_answer ?? null,
          submission: s ? {
            id: s.id, answerText: s.answer_text, aiScore: num(s.ai_suggested_score),
            aiRubric: Array.isArray(s.ai_rubric_scores) ? s.ai_rubric_scores : [], aiFeedback: s.ai_feedback ?? null,
            teacherScore: num(s.teacher_score), teacherFeedback: s.teacher_feedback ?? null, status: s.status,
          } : null,
        });
      });

      return {
        attemptId: attempt.id, status: attempt.status,
        studentName: attempt.students?.full_name ?? "Student", studentClass: studentClassLabel(attempt.students),
        examTitle: attempt.generated_assessment_paper_assignments?.title ?? "Exam",
        totalScore: num(attempt.total_score), totalMax: Number(attempt.total_max_marks) || 0, items,
      };
    },
  });
}

export function useSaveReview(attemptId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { submissionId: string; score: number; feedback: string }) =>
      invokeFn<{ submission: Row }>("evaluate-assessment", {
        action: "review_open_response",
        submission_id: args.submissionId,
        teacher_score: args.score,
        teacher_feedback: args.feedback.trim() || null,
      }),
    // Returning the promise makes mutateAsync wait until the lists/detail have refetched, so the caller
    // can read the fresh attempt status (the DB trigger may have just finalised it).
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["exam-reviews"] }),
        qc.invalidateQueries({ queryKey: ["my-exams"] }),
        ...(attemptId ? [qc.invalidateQueries({ queryKey: ["exam-reviews", "detail", attemptId] })] : []),
      ]);
    },
  });
}
