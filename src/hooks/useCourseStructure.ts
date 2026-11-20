// Data hooks for the multi-level course structure (manager side + student side).
// The generated Database types predate these tables, so we use an untyped handle for them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { friendlyCourseError } from "@/lib/courseStructure";
import type {
  Course, CourseChapter, ContentStatus, CourseCompletionStats, CourseModule, CourseStructure, CourseTopic, StudentTopicView,
  TopicAssessmentLink, TopicMaterial, TopicPrerequisite,
} from "@/types/courseManagement";
import type { SemesterRef, SessionRef } from "@/lib/courseStructure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sb = supabase as unknown as SupabaseClient<any, "public", any>;

export class CourseStructureError extends Error {}
function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new CourseStructureError(friendlyCourseError(res.error.message));
  return res.data;
}

export const STAFF_ROLES = ["admin", "principal", "school_admin", "hod", "teacher"];
export const ADMIN_ROLES = ["admin", "principal", "school_admin", "hod"];

// ---------------------------------------------------------------- manager side
export function useStaffSubjects() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["cs-subjects", profile?.school_id, profile?.id],
    enabled: !!profile?.school_id,
    queryFn: async () => {
      const [courses, sessions, semesters] = await Promise.all([
        sb.from("courses").select("*").eq("school_id", profile!.school_id).order("title"),
        sb.from("academic_years").select("id, name, is_active").eq("school_id", profile!.school_id).order("created_at", { ascending: false }),
        sb.from("academic_semesters").select("id, academic_year_id, name").eq("school_id", profile!.school_id).order("created_at"),
      ]);
      return {
        courses: unwrap(courses) as Course[],
        sessions: unwrap(sessions) as SessionRef[],
        semesters: unwrap(semesters) as SemesterRef[],
      };
    },
  });
}

export interface SubjectData {
  modules: CourseModule[];
  chapters: CourseChapter[];
  topics: CourseTopic[];
  prerequisites: TopicPrerequisite[];
}

export function useSubjectData(courseId: string | null) {
  return useQuery({
    queryKey: ["cs-subject", courseId],
    enabled: !!courseId,
    queryFn: async (): Promise<SubjectData> => {
      const modules = unwrap(await sb.from("course_modules").select("*").eq("course_id", courseId!).order("order_index")) as CourseModule[];
      const ids = modules.map((m) => m.id);
      if (ids.length === 0) return { modules, chapters: [], topics: [], prerequisites: [] };
      const [chapters, topics] = await Promise.all([
        sb.from("course_chapters").select("*").in("module_id", ids).order("order_index"),
        sb.from("course_topics").select("*").in("module_id", ids).order("order_index"),
      ]);
      const topicRows = unwrap(topics) as CourseTopic[];
      const prereq = topicRows.length
        ? unwrap(await sb.from("topic_prerequisites").select("*").in("topic_id", topicRows.map((t) => t.id))) as TopicPrerequisite[]
        : [];
      return { modules, chapters: unwrap(chapters) as CourseChapter[], topics: topicRows, prerequisites: prereq };
    },
  });
}

export type NodeKind = "module" | "chapter" | "topic" | "material";
const TABLE: Record<NodeKind, string> = {
  module: "course_modules", chapter: "course_chapters", topic: "course_topics", material: "topic_materials",
};

/** One mutation hook for all structure writes; refreshes the subject tree afterwards. */
export function useStructureMutations(courseId: string | null) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cs-subject", courseId] });
    qc.invalidateQueries({ queryKey: ["cs-topic-extras"] });
    qc.invalidateQueries({ queryKey: ["cs-subjects"] });
  };
  const wrap = <V, R>(fn: (v: V) => Promise<R>) =>
    useMutation({ mutationFn: fn, onSuccess: refresh }); // eslint-disable-line react-hooks/rules-of-hooks

  return {
    create: wrap(async (v: { kind: NodeKind; values: Record<string, unknown> }) =>
      unwrap(await sb.from(TABLE[v.kind]).insert({ ...(v.kind !== "module" ? { created_by: profile?.id } : {}), ...v.values }).select().single())),
    update: wrap(async (v: { kind: NodeKind; id: string; values: Record<string, unknown> }) =>
      unwrap(await sb.from(TABLE[v.kind]).update(v.values).eq("id", v.id).select().single())),
    remove: wrap(async (v: { kind: NodeKind; ids: string[] }) =>
      unwrap(await sb.from(TABLE[v.kind]).delete().in("id", v.ids))),
    bulkStatus: wrap(async (v: { kind: NodeKind; ids: string[]; status: ContentStatus }) =>
      unwrap(await sb.from(TABLE[v.kind]).update({ status: v.status }).in("id", v.ids))),
    reorder: wrap(async (v: { kind: NodeKind; ids: string[] }) =>
      unwrap(await sb.rpc("mlcs_reorder", { p_kind: v.kind, p_ids: v.ids }))),
    addPrerequisite: wrap(async (v: { topicId: string; prerequisiteId: string }) =>
      unwrap(await sb.from("topic_prerequisites").insert({ topic_id: v.topicId, prerequisite_topic_id: v.prerequisiteId, created_by: profile?.id }))),
    removePrerequisite: wrap(async (id: string) => unwrap(await sb.from("topic_prerequisites").delete().eq("id", id))),
    updateSubject: wrap(async (v: { id: string; values: Record<string, unknown> }) =>
      unwrap(await sb.from("courses").update({ ...v.values, updated_at: new Date().toISOString() }).eq("id", v.id).select().single())),
  };
}

export function useSubjectMutations() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const refresh = () => qc.invalidateQueries({ queryKey: ["cs-subjects"] });
  return {
    create: useMutation({
      mutationFn: async (values: Record<string, unknown>) =>
        unwrap(await sb.from("courses").insert({ school_id: profile!.school_id, created_by: profile!.id, status: "draft", ...values }).select().single()) as Course,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await sb.from("courses").delete().eq("id", id)),
      onSuccess: refresh,
    }),
    createSession: useMutation({
      mutationFn: async (v: { name: string; start_date: string; end_date: string }) =>
        unwrap(await sb.from("academic_years").insert({ school_id: profile!.school_id, structure: "semester", ...v }).select().single()),
      onSuccess: refresh,
    }),
    createSemester: useMutation({
      mutationFn: async (v: { academic_year_id: string; name: string; start_date?: string | null; end_date?: string | null }) =>
        unwrap(await sb.from("academic_semesters").insert({ school_id: profile!.school_id, ...v }).select().single()),
      onSuccess: refresh,
    }),
  };
}

export function useTopicExtras(topicId: string | null) {
  return useQuery({
    queryKey: ["cs-topic-extras", topicId],
    enabled: !!topicId,
    queryFn: async () => {
      const [materials, links] = await Promise.all([
        sb.from("topic_materials").select("*").eq("topic_id", topicId!).order("order_index"),
        sb.from("topic_assessment_links").select("*").eq("topic_id", topicId!).order("created_at"),
      ]);
      return { materials: unwrap(materials) as TopicMaterial[], links: unwrap(links) as TopicAssessmentLink[] };
    },
  });
}

export function useCompletionStats(courseId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["cs-stats", courseId],
    enabled: !!courseId && enabled,
    queryFn: async () => unwrap(await sb.rpc("get_course_completion_stats", { p_course: courseId })) as CourseCompletionStats,
  });
}

/** Existing homework / worksheets / assessment papers the teacher may attach to a topic. */
export function useAttachableWork(enabled: boolean) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["cs-attachable", profile?.id],
    enabled: enabled && !!profile?.id,
    queryFn: async () => {
      const [hw, ws, ap] = await Promise.all([
        sb.from("homework_assignments").select("id, topic, period_title, subject, class_level, section, due_date").eq("teacher_id", profile!.id).order("created_at", { ascending: false }).limit(50),
        sb.from("worksheet_assignments").select("id, class_level, section, due_date, worksheets(title)").eq("teacher_id", profile!.id).order("created_at", { ascending: false }).limit(50),
        sb.from("assessment_papers").select("id, title, subject, class_level, section").eq("teacher_id", profile!.id).order("created_at", { ascending: false }).limit(50),
      ]);
      type Opt = { link_type: "homework" | "worksheet" | "assessment"; ref_id: string; title: string; due_date: string | null };
      type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const opts: Opt[] = [];
      for (const r of (hw.data ?? []) as Row[]) opts.push({ link_type: "homework", ref_id: r.id, title: `${r.period_title || r.topic || "Homework"} · ${r.subject ?? ""} ${r.class_level ?? ""}${r.section ? "-" + r.section : ""}`.trim(), due_date: r.due_date ?? null });
      for (const r of (ws.data ?? []) as Row[]) opts.push({ link_type: "worksheet", ref_id: r.id, title: `${r.worksheets?.title ?? "Worksheet"} · ${r.class_level ?? ""}${r.section ? "-" + r.section : ""}`.trim(), due_date: r.due_date ?? null });
      for (const r of (ap.data ?? []) as Row[]) opts.push({ link_type: "assessment", ref_id: r.id, title: `${r.title ?? "Assessment paper"} · ${r.subject ?? ""} ${r.class_level ?? ""}`.trim(), due_date: null });
      return opts;
    },
  });
}

export function useLinkMutations(topicId: string | null) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const refresh = () => qc.invalidateQueries({ queryKey: ["cs-topic-extras", topicId] });
  return {
    add: useMutation({
      mutationFn: async (v: { link_type: string; ref_id: string; title: string; due_date: string | null }) =>
        unwrap(await sb.from("topic_assessment_links").insert({ topic_id: topicId, created_by: profile?.id, ...v })),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => unwrap(await sb.from("topic_assessment_links").delete().eq("id", id)),
      onSuccess: refresh,
    }),
  };
}

/** Uploads to the private bucket and returns the storage path. */
export async function uploadMaterialFile(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from("course-materials").upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new CourseStructureError(error.message);
}
export async function removeMaterialFile(path: string): Promise<void> {
  await supabase.storage.from("course-materials").remove([path]);
}
export async function signedMaterialUrl(path: string, seconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from("course-materials").createSignedUrl(path, seconds);
  if (error || !data) throw new CourseStructureError(error?.message ?? "Could not open this file.");
  return data.signedUrl;
}

// ---------------------------------------------------------------- student side
export function useStudentCourseStructure(courseId: string | undefined) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["student-course-structure", courseId, profile?.id],
    enabled: !!courseId && !!profile?.id,
    queryFn: async () => unwrap(await sb.rpc("get_student_course_structure", { p_course: courseId })) as CourseStructure,
  });
}

export function useStudentTopic(topicId: string | undefined) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["student-topic", topicId, profile?.id],
    enabled: !!topicId && !!profile?.id,
    queryFn: async () => unwrap(await sb.rpc("get_student_topic", { p_topic: topicId })) as StudentTopicView,
  });
}

export function useStudentProgressActions(courseId: string | undefined, topicId: string | undefined) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["student-course-structure", courseId] });
    qc.invalidateQueries({ queryKey: ["student-topic", topicId] });
    qc.invalidateQueries({ queryKey: ["course-catalog"] });
    qc.invalidateQueries({ queryKey: ["course-detail", courseId, profile?.id] });
  };
  return {
    complete: useMutation({
      mutationFn: async (completed: boolean) =>
        unwrap(await sb.rpc("complete_topic", { p_topic: topicId, p_completed: completed })) as { course_percent: number; next_topic_id: string | null },
      onSuccess: refresh,
    }),
    /** Fire-and-forget activity ping (time spent + material progress). Errors are non-fatal. */
    track: async (seconds: number, material?: { id: string; percent?: number; completed?: boolean }) => {
      if (!topicId) return;
      await sb.rpc("record_topic_activity", {
        p_topic: topicId, p_seconds: Math.round(seconds),
        p_material: material?.id ?? null, p_material_percent: material?.percent ?? null, p_material_completed: material?.completed ?? null,
      });
    },
  };
}
