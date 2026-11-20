// Data hooks for Daily Practice Problems. Every call goes through a SECURITY DEFINER function, so grading,
// the answer key and school/ownership checks stay on the server.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sb } from "@/hooks/useCourseStructure";
import { useAuth } from "@/contexts/AuthContext";
import { friendlyDppError } from "@/lib/dpp";
import type {
  DppAdminOverview, DppHistoryRow, DppParentOverview, DppRecommendation, DppResult, DppRun, DppSetDetail, DppSummary,
  DppTeacherOverview, DppToday,
} from "@/lib/dpp";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(friendlyDppError(error));
  return data as T;
}

const KEY = "dpp";

export function useDppToday() {
  const { user } = useAuth();
  return useQuery({ queryKey: [KEY, "today", user?.id], enabled: !!user, queryFn: () => rpc<DppToday>("dpp_student_today"), staleTime: 30_000 });
}
export function useDppStats() {
  const { user } = useAuth();
  return useQuery({ queryKey: [KEY, "stats", user?.id], enabled: !!user, queryFn: () => rpc<DppSummary>("dpp_student_stats") });
}
export function useDppHistory() {
  const { user } = useAuth();
  return useQuery({ queryKey: [KEY, "history", user?.id], enabled: !!user, queryFn: () => rpc<DppHistoryRow[]>("dpp_history", { p_limit: 50 }) });
}
export function useDppRecommendations() {
  const { user } = useAuth();
  return useQuery({ queryKey: [KEY, "recs", user?.id], enabled: !!user, queryFn: () => rpc<DppRecommendation[]>("dpp_recommendations") });
}
export function useDppResult(attemptId: string | null) {
  return useQuery({ queryKey: [KEY, "result", attemptId], enabled: !!attemptId, queryFn: () => rpc<DppResult>("dpp_get_result", { p_attempt: attemptId }) });
}

export function useStartDpp() {
  return useMutation({ mutationFn: (assignmentId: string) => rpc<DppRun>("dpp_start_attempt", { p_assignment: assignmentId }) });
}
export async function saveDppAnswer(attemptId: string, itemId: string, answer: string): Promise<"saved" | "time_up"> {
  return rpc<"saved" | "time_up">("dpp_save_answer", { p_attempt: attemptId, p_item: itemId, p_answer: answer });
}
export function useSubmitDpp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) => rpc<DppResult>("dpp_submit_attempt", { p_attempt: attemptId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}

// --- staff -----------------------------------------------------------------
export function useDppOverview(days = 30) {
  const { user } = useAuth();
  return useQuery({ queryKey: [KEY, "teacher", user?.id, days], enabled: !!user, queryFn: () => rpc<DppTeacherOverview>("dpp_teacher_overview", { p_days: days }) });
}
export function useDppSetDetail(setId: string | null) {
  return useQuery({ queryKey: [KEY, "set", setId], enabled: !!setId, queryFn: () => rpc<DppSetDetail>("dpp_set_detail", { p_set: setId }) });
}
export function useDppStaffOptions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [KEY, "options", user?.id], enabled: !!user, staleTime: 5 * 60_000,
    queryFn: () => rpc<{ classes: { class_level: string; section: string; students: number }[]; subjects: string[]; timezone: string }>("dpp_staff_options"),
  });
}
export function useDppPendingManual() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [KEY, "pending", user?.id], enabled: !!user,
    queryFn: () => rpc<{ answer_id: string; attempt_id: string; student: string; set_title: string; stem: string; answer: string; marks: number; explanation: string | null; submitted_at: string }[]>("dpp_pending_manual"),
  });
}
export function useDppAdminOverview(days: number, enabled: boolean) {
  return useQuery({ queryKey: [KEY, "admin", days], enabled, queryFn: () => rpc<DppAdminOverview>("dpp_admin_overview", { p_days: days }) });
}
export function useDppSettings(enabled = true) {
  return useQuery({ queryKey: [KEY, "settings"], enabled, queryFn: () => rpc<{ timezone: string; auto_assign: boolean; daily_question_count: number }>("dpp_get_settings") });
}
export function useDppParentOverview(childId: string | null) {
  return useQuery({ queryKey: [KEY, "parent", childId], enabled: !!childId, queryFn: () => rpc<DppParentOverview>("dpp_parent_overview", { p_child: childId }) });
}

export function useDppStaffMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [KEY] });
  return {
    saveSet: useMutation({
      mutationFn: (v: { setId: string | null; set: Record<string, unknown>; items: Record<string, unknown>[] | null }) =>
        rpc<string>("dpp_save_set", { p_set_id: v.setId, p_set: v.set, p_items: v.items }),
      onSuccess: refresh,
    }),
    assign: useMutation({
      mutationFn: (v: { setId: string; classLevel?: string | null; section?: string | null; studentIds?: string[] | null; date?: string | null }) =>
        rpc<{ assigned: number; already_assigned: number; assigned_for: string }>("dpp_assign_set", {
          p_set: v.setId, p_class_level: v.classLevel ?? null, p_section: v.section ?? null, p_student_ids: v.studentIds ?? null, p_assigned_for: v.date ?? null,
        }),
      onSuccess: refresh,
    }),
    archive: useMutation({ mutationFn: (setId: string) => rpc<void>("dpp_archive_set", { p_set: setId }), onSuccess: refresh }),
    grade: useMutation({
      mutationFn: (v: { answerId: string; marks: number; feedback?: string }) => rpc<void>("dpp_grade_answer", { p_answer: v.answerId, p_marks: v.marks, p_feedback: v.feedback ?? null }),
      onSuccess: refresh,
    }),
    saveSettings: useMutation({
      mutationFn: (v: { timezone: string; autoAssign: boolean; count: number }) => rpc<void>("dpp_save_settings", { p_timezone: v.timezone, p_auto_assign: v.autoAssign, p_count: v.count }),
      onSuccess: refresh,
    }),
  };
}
export async function pickBankItems(subject: string, classLevel: string, chapter: string) {
  return rpc<{ bank_item_id: string; stem: string; options: Record<string, string>; correct_answer: string; explanation: string | null;
               learning_objective_id: number; subtopic_id: number; chapter: string; subject: string; difficulty: "easy" | "medium" | "hard" }[]>(
    "dpp_pick_bank_items", { p_subject: subject, p_class_level: classLevel, p_chapter: chapter || null, p_limit: 30 });
}
