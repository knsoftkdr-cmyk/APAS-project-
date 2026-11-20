// Data layer for the publish workflow. Reads go through RLS / read-only RPCs; every state change goes through a
// SECURITY DEFINER database function that re-validates role, ownership, stage and status (see
// supabase/migrations/20261102000000_publish_workflow_approvals.sql). Nothing here can set a status directly.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { sb, STAFF_ROLES, useStaffSubjects } from "@/hooks/useCourseStructure";
import { friendlyCourseError } from "@/lib/courseStructure";
import type { ContentKind, WorkflowItem } from "@/lib/approvalWorkflow";
import type { ContentStatus } from "@/types/courseManagement";

export class WorkflowError extends Error {}
function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new WorkflowError(friendlyCourseError(res.error.message));
  return res.data;
}

export interface WorkflowSettings {
  enabled: boolean; allow_self_approval: boolean; admin_can_skip_stages: boolean; publish_mode: "manual" | "auto";
  stages: { name: string; reviewer_role: string }[];
}

export interface QueueRow {
  id: string; content_kind: ContentKind; content_id: string; course_id: string; title: string; version: number; status: string;
  current_stage: number; total_stages: number; submitted_by: string; submitted_by_name: string | null; submitted_at: string;
  assigned_reviewer: string | null; assigned_reviewer_name: string | null; priority: "normal" | "high";
  path: { subject?: string; academic_year?: string | null; semester?: string | null; module?: string | null; chapter?: string | null; topic?: string | null } | null;
  decided_at: string | null; can_review: boolean;
}

export interface HistoryEntry {
  id: string; action: string; from_status: string | null; to_status: string | null; stage: number | null; version: number | null;
  comment: string | null; reason: string | null; actor_name: string | null; actor_role: string | null; created_at: string;
}

export interface SubmissionDetail {
  submission: Omit<QueueRow, "path" | "can_review" | "submitted_by_name" | "assigned_reviewer_name"> & { note: string | null };
  snapshot: { item: Record<string, unknown>; children: { kind: string; id: string; title: string; status: string; type?: string }[]; path: QueueRow["path"] };
  submitted_by_name: string | null; assigned_reviewer_name: string | null;
  stages: { order: number; name: string; role: string }[];
  history: HistoryEntry[];
  versions: { id: string; version: number; status: string; submitted_at: string; decided_at: string | null; published_at: string | null }[];
  can_review: boolean; can_assign: boolean; can_publish: boolean; can_withdraw: boolean; is_own: boolean; allow_self_approval: boolean;
}

const WF_KEYS = ["wf-settings", "wf-my-content", "wf-queue", "wf-stats", "wf-detail", "cs-subject", "cs-topic-extras", "cs-subjects"];

function useRefreshAll() {
  const qc = useQueryClient();
  return () => WF_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function useIsStaff() {
  const { profile } = useAuth();
  return !!profile?.role && STAFF_ROLES.includes(profile.role);
}
export function useCanSeeQueue() {
  const { profile } = useAuth();
  // HOD / admin-level always; other roles appear only when a stage names them, which the RPC re-checks.
  return !!profile?.role && ["admin", "principal", "school_admin", "hod"].includes(profile.role);
}
export function useIsAdminLevel() {
  const { profile } = useAuth();
  return !!profile?.role && ["admin", "principal", "school_admin"].includes(profile.role);
}

export function useWorkflowSettings() {
  const { profile } = useAuth();
  const staff = useIsStaff();
  return useQuery({
    queryKey: ["wf-settings", profile?.school_id],
    enabled: staff && !!profile?.school_id,
    staleTime: 60_000,
    queryFn: async () => unwrap(await sb.rpc("wf_settings")) as WorkflowSettings,
  });
}

export function useSaveWorkflowSettings() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (s: WorkflowSettings) => unwrap(await sb.rpc("wf_save_settings", {
      p_enabled: s.enabled, p_allow_self: s.allow_self_approval, p_publish_mode: s.publish_mode,
      p_admin_skip: s.admin_can_skip_stages, p_stages: s.stages,
    })),
    onSuccess: refresh,
  });
}

/** Every module / chapter / topic / material of the subjects the signed-in staff member manages (RLS-filtered). */
export function useMyContent() {
  const { profile } = useAuth();
  const subjects = useStaffSubjects();
  // Same rule as the course manager: admin-level/HOD see the whole school, teachers only subjects they created or mentor.
  const courses = subjects.data?.courses.filter((c) =>
    profile?.role !== "teacher" || c.created_by === profile.id || c.mentor_id === profile.id);
  return useQuery({
    queryKey: ["wf-my-content", profile?.id, courses?.map((c) => c.id).join(",")],
    enabled: !!courses,
    queryFn: async (): Promise<WorkflowItem[]> => {
      const byId = new Map(courses!.map((c) => [c.id, c.title]));
      const mods = unwrap(await sb.from("course_modules").select("id, course_id, title, status, updated_at:created_at").in("course_id", [...byId.keys()])) as
        { id: string; course_id: string; title: string; status: ContentStatus; updated_at: string }[];
      // RLS returns only rows of subjects the user may manage; "mine" = everything they can open.
      if (!mods.length) return [];
      const modIds = mods.map((m) => m.id);
      const [chs, tps] = await Promise.all([
        sb.from("course_chapters").select("id, module_id, title, status, updated_at").in("module_id", modIds),
        sb.from("course_topics").select("id, module_id, chapter_id, title, status, updated_at").in("module_id", modIds),
      ]);
      const chapters = unwrap(chs) as { id: string; module_id: string; title: string; status: ContentStatus; updated_at: string }[];
      const topics = unwrap(tps) as { id: string; module_id: string; chapter_id: string | null; title: string; status: ContentStatus; updated_at: string }[];
      const mats = topics.length
        ? unwrap(await sb.from("topic_materials").select("id, topic_id, title, material_type, status, updated_at").in("topic_id", topics.map((t) => t.id))) as
          { id: string; topic_id: string; title: string; material_type: string; status: ContentStatus; updated_at: string }[]
        : [];
      const mod = new Map(mods.map((m) => [m.id, m]));
      const chap = new Map(chapters.map((c) => [c.id, c]));
      const top = new Map(topics.map((t) => [t.id, t]));
      const subs = unwrap(await sb.from("approval_submissions").select("id, content_kind, content_id, version, status")
        .in("course_id", [...byId.keys()]).order("version", { ascending: false })) as { id: string; content_kind: string; content_id: string; version: number; status: string }[];
      const latest = new Map<string, { id: string; status: string }>();
      for (const x of subs) if (!latest.has(`${x.content_kind}:${x.content_id}`)) latest.set(`${x.content_kind}:${x.content_id}`, { id: x.id, status: x.status });
      const items: WorkflowItem[] = [];
      for (const m of mods) items.push({ kind: "module", id: m.id, title: m.title, status: m.status, courseId: m.course_id, subject: byId.get(m.course_id) ?? "", module: m.title, chapter: null, topic: null, updatedAt: m.updated_at });
      for (const c of chapters) { const m = mod.get(c.module_id)!; items.push({ kind: "chapter", id: c.id, title: c.title, status: c.status, courseId: m.course_id, subject: byId.get(m.course_id) ?? "", module: m.title, chapter: c.title, topic: null, updatedAt: c.updated_at }); }
      for (const t of topics) { const m = mod.get(t.module_id)!; items.push({ kind: "topic", id: t.id, title: t.title, status: t.status, courseId: m.course_id, subject: byId.get(m.course_id) ?? "", module: m.title, chapter: t.chapter_id ? chap.get(t.chapter_id)?.title ?? null : null, topic: t.title, updatedAt: t.updated_at }); }
      for (const x of mats) { const t = top.get(x.topic_id)!; const m = mod.get(t.module_id)!; items.push({ kind: "material", id: x.id, title: x.title, status: x.status, courseId: m.course_id, subject: byId.get(m.course_id) ?? "", module: m.title, chapter: t.chapter_id ? chap.get(t.chapter_id)?.title ?? null : null, topic: t.title, materialType: x.material_type, updatedAt: x.updated_at }); }
      for (const i of items) { const l = latest.get(`${i.kind}:${i.id}`); if (l) { i.submissionId = l.id; i.submissionStatus = l.status; } }
      return items;
    },
  });
}

/** Owner-side actions (teachers and admins on their own content). */
export function useOwnerActions() {
  const refresh = useRefreshAll();
  const opts = { onSuccess: refresh };
  return {
    submit: useMutation({ mutationFn: async (v: { kind: ContentKind; id: string; note?: string; priority?: "normal" | "high" }) =>
      unwrap(await sb.rpc("wf_submit", { p_kind: v.kind, p_id: v.id, p_note: v.note ?? null, p_priority: v.priority ?? "normal" })), ...opts }),
    withdraw: useMutation({ mutationFn: async (submissionId: string) => unwrap(await sb.rpc("wf_withdraw", { p_submission: submissionId })), ...opts }),
    reopen: useMutation({ mutationFn: async (v: { kind: ContentKind; id: string; reason: string }) =>
      unwrap(await sb.rpc("wf_reopen", { p_kind: v.kind, p_id: v.id, p_reason: v.reason })), ...opts }),
    archive: useMutation({ mutationFn: async (v: { kind: ContentKind; id: string; reason?: string }) =>
      unwrap(await sb.rpc("wf_archive", { p_kind: v.kind, p_id: v.id, p_reason: v.reason ?? null })), ...opts }),
  };
}

export function useItemHistory(kind: ContentKind | null, id: string | null) {
  return useQuery({
    queryKey: ["wf-detail", "history", kind, id],
    enabled: !!kind && !!id,
    queryFn: async () => unwrap(await sb.rpc("wf_history", { p_kind: kind, p_id: id })) as HistoryEntry[],
  });
}

// ----------------------------------------------------------------------------- reviewer side
export interface QueueParams { status: string; search: string; kind: string; course: string; sort: string; page: number; pageSize: number }

export function useApprovalQueue(p: QueueParams, enabled: boolean) {
  return useQuery({
    queryKey: ["wf-queue", p],
    enabled,
    placeholderData: (prev) => prev,
    queryFn: async () => unwrap(await sb.rpc("wf_queue", {
      p_status: p.status === "all" ? null : p.status, p_search: p.search || null, p_kind: p.kind === "all" ? null : p.kind,
      p_course: p.course === "all" ? null : p.course, p_sort: p.sort, p_limit: p.pageSize, p_offset: p.page * p.pageSize,
    })) as { total: number; rows: QueueRow[] },
  });
}

export function useApprovalStats(enabled: boolean) {
  return useQuery({
    queryKey: ["wf-stats"],
    enabled,
    queryFn: async () => unwrap(await sb.rpc("wf_stats")) as {
      pending: number; approved: number; published: number; rejected: number; changes_requested: number;
      avg_review_hours: number | null; reviewed_count: number },
  });
}

export function useSubmissionDetail(id: string | null) {
  return useQuery({
    queryKey: ["wf-detail", id],
    enabled: !!id,
    queryFn: async () => unwrap(await sb.rpc("wf_submission_detail", { p_id: id })) as SubmissionDetail,
  });
}

export function useReviewerCandidates(enabled: boolean) {
  return useQuery({
    queryKey: ["wf-detail", "candidates"],
    enabled,
    queryFn: async () => unwrap(await sb.rpc("wf_reviewer_candidates")) as { id: string; name: string | null; role: string }[],
  });
}

export function useReviewActions() {
  const refresh = useRefreshAll();
  const opts = { onSuccess: refresh };
  return {
    review: useMutation({ mutationFn: async (v: { id: string; decision: "approve" | "reject" | "request_changes"; comment?: string }) =>
      unwrap(await sb.rpc("wf_review", { p_submission: v.id, p_decision: v.decision, p_comment: v.comment ?? null })) as string, ...opts }),
    publish: useMutation({ mutationFn: async (id: string) => unwrap(await sb.rpc("wf_publish", { p_submission: id })), ...opts }),
    assign: useMutation({ mutationFn: async (v: { id: string; reviewer: string }) =>
      unwrap(await sb.rpc("wf_assign", { p_submission: v.id, p_reviewer: v.reviewer })), ...opts }),
    directPublish: useMutation({ mutationFn: async (v: { kind: ContentKind; id: string; reason: string }) =>
      unwrap(await sb.rpc("wf_direct_publish", { p_kind: v.kind, p_id: v.id, p_reason: v.reason })), ...opts }),
    reminders: useMutation({ mutationFn: async () => unwrap(await sb.rpc("wf_send_reminders", { p_older_than_hours: 48 })) as number, ...opts }),
  };
}
