// src/hooks/useDigitalClassroom.ts
// Digital classroom workspace (sheet row 43). Data: ai-teacher-assistant { action: "classroom", op } - see
// supabase/functions/_shared/handlers/digitalClassroom.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/hooks/useExamIntelligence";

export interface Person { id: string; name: string; role: string }
export interface ClassroomPost {
  id: string; kind: "announcement" | "discussion" | "question"; body: string; pinned: boolean; created_at: string;
  author: Person; can_delete: boolean; comments: Array<{ id: string; body: string; created_at: string; author: Person }>;
}
export interface ClassroomMaterial {
  id: string; title: string; description: string | null; topic: string | null; kind: "file" | "link" | "text"; url: string | null; body?: string | null;
  file_name: string | null; mime_type: string | null; size_bytes: number | null; created_at: string; uploaded_by: string;
}
export interface ClassroomAssignment {
  id: string; type: "homework" | "test" | "mock_exam"; title: string; subject: string | null; due: string | null;
  created_at: string | null; status: string | null; time_limit_minutes?: number | null;
}
export interface ClassroomSession { id: string; title: string | null; subject: string | null; meet_link: string | null; scheduled_start: string; scheduled_end: string; status: string | null }
export type AttendanceStatus = "present" | "absent" | "late" | "half_day" | "excused";
export interface ClassroomOverview {
  classes: Array<{ id: string; label: string }>;
  class: { id: string; label: string; roster_size: number } | null;
  role?: "teacher" | "staff" | "student";
  me?: string;
  posts?: ClassroomPost[];
  materials?: ClassroomMaterial[];
  assignments?: ClassroomAssignment[];
  sessions?: ClassroomSession[];
  attendance?: {
    date?: string;
    roster?: Array<{ student_id: string; name: string; status: AttendanceStatus | null }>;
    recent?: Array<{ date: string; status: string }>;
    present_pct?: number | null;
  };
}

const call = <T,>(op: string, body: Record<string, unknown> = {}) => invokeFn<T>("ai-teacher-assistant", { action: "classroom", op, ...body });

export function useClassroomOverview(classId: string | null) {
  return useQuery({
    queryKey: ["classroom", classId ?? "default"],
    queryFn: () => call<ClassroomOverview>("overview", classId ? { class_id: classId } : {}),
    staleTime: 20 * 1000,
  });
}

/** One mutation for every classroom write; refreshes the overview afterwards. */
export function useClassroomAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ op, ...body }: { op: string } & Record<string, unknown>) => call<Record<string, unknown>>(op, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["classroom"] }),
  });
}

/** Uploads a file straight to storage through a signed URL issued by the server, then records it. */
export async function uploadClassroomFile(classId: string, file: File, meta: { title: string; description?: string; topic?: string }) {
  const { path, token } = await call<{ path: string; token: string }>("material_upload_url", { class_id: classId, file_name: file.name });
  const { error } = await supabase.storage.from("classroom-materials").uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return call("material_add", {
    class_id: classId, kind: "file", storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, ...meta,
  });
}
