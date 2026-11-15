// src/lib/liveRecordings.ts
//
// Client for live-class recordings. Every call goes through the already-deployed `ai-teacher-assistant` function
// (action "live_recordings"); the recordings tables and the storage bucket are not reachable from the browser at all,
// so who may see or change what is decided on the server (supabase/functions/_shared/handlers/liveRecordings.ts).
//
// The pure helpers (labels, formatting, validation) are unit-tested in src/test/liveRecordings.test.ts.

import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/hooks/useExamIntelligence";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export type RecStatus = "recording" | "processing" | "copying" | "ready" | "failed" | "deleted";

export interface RecordingSettings {
  enabled: boolean;
  auto_record: boolean;
  storage_mode: "supabase_copy" | "drive_link";
  teachers_can_toggle: boolean;
  teachers_can_manage: boolean;
  teachers_can_delete: boolean;
  teachers_can_upload: boolean;
  student_access: boolean;
  student_download: boolean;
  retention_days: number;
  storage_quota_gb: number;
  max_upload_mb: number;
}

export interface GoogleConnection {
  configured: boolean;
  client_email: string | null;
  client_id: string | null;
  scopes: string[];
}

export interface Recording {
  id: string;
  session_id: string | null;
  session_date: string | null;
  class_id: string;
  class_label: string;
  subject: string | null;
  title: string;
  notes: string | null;
  source: "auto" | "upload" | "link";
  status: RecStatus;
  storage_kind: "none" | "supabase" | "drive" | "link";
  size_bytes: number;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  visibility: "class" | "teachers";
  pinned: boolean;
  course_id: string | null;
  course_title: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  retention_expires_at: string | null;
  created_at: string;
  last_error: string | null;
  can_manage: boolean;
  can_delete: boolean;
  playable: boolean;
}

export interface SessionRecordingState {
  school_enabled: boolean;
  /** false until the server has the Google key: Meet is then never told to record, so nothing records by itself. */
  google_configured?: boolean;
  record_enabled: boolean | null;
  effective: boolean;
  armed_at: string | null;
  arm_error: string | null;
  meet_supported: boolean;
  can_toggle: boolean;
  can_upload: boolean;
  recordings: number;
}

export interface PlayInfo {
  kind: "file" | "external";
  url: string;
  title: string;
  mime_type?: string;
  expires_in?: number;
  download?: boolean;
}

export interface UsageReport {
  used_bytes: number;
  quota_bytes: number;
  total_recordings: number;
  by_status: Record<string, number>;
  kept_as_drive_link: number;
  expiring_30_days: number;
  failed: number;
  by_class: Array<{ name: string; bytes: number; count: number }>;
  by_subject: Array<{ name: string; bytes: number; count: number }>;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────────────

export const STATUS_META: Record<RecStatus, { label: string; badge: string }> = {
  recording: { label: "Recording", badge: "bg-red-100 text-red-800" },
  processing: { label: "Processing", badge: "bg-amber-100 text-amber-800" },
  copying: { label: "Saving", badge: "bg-amber-100 text-amber-800" },
  ready: { label: "Ready", badge: "bg-green-100 text-green-800" },
  failed: { label: "Failed", badge: "bg-red-100 text-red-800" },
  deleted: { label: "Deleted", badge: "bg-slate-100 text-slate-600" },
};

export function formatBytes(n: number): string {
  if (!(n > 0)) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** "42 min", "1 h 05 min", or "" when unknown. */
export function formatRecordingDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Whole days until the recording is removed by retention; null when it is kept (pinned / no limit). */
export function daysUntilExpiry(r: Pick<Recording, "retention_expires_at" | "pinned">, now = Date.now()): number | null {
  if (r.pinned || !r.retention_expires_at) return null;
  return Math.max(0, Math.ceil((new Date(r.retention_expires_at).getTime() - now) / 86_400_000));
}

export function usagePercent(used: number, quota: number): number {
  return quota > 0 ? Math.min(100, Math.round((used / quota) * 1000) / 10) : 0;
}

/** Group by subject (alphabetical, "Other" last), newest class first inside each. */
export function groupBySubject(list: Recording[]): Array<{ subject: string; items: Recording[] }> {
  const m = new Map<string, Recording[]>();
  for (const r of list) {
    const k = r.subject?.trim() || "Other";
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  const date = (r: Recording) => r.session_date ?? r.created_at.slice(0, 10);
  return [...m.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
    .map(([subject, items]) => ({ subject, items: [...items].sort((x, y) => date(y).localeCompare(date(x))) }));
}

export function matchesSearch(r: Recording, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.title, r.subject, r.class_label, r.course_title, r.lesson_title, r.notes].some((v) => (v ?? "").toLowerCase().includes(needle));
}

export const ACCEPTED_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];

export function validateUploadFile(file: { type: string; size: number }, maxMb: number): string | null {
  if (!ACCEPTED_VIDEO.includes(file.type)) return "Choose an MP4, WebM or MOV video.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > maxMb * 1024 * 1024) return `That file is larger than your school's ${maxMb} MB limit.`;
  return null;
}

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────

const call = <T,>(op: string, body: Record<string, unknown> = {}) =>
  invokeFn<T>("ai-teacher-assistant", { action: "live_recordings", op, ...body });

export const getRecordingSettings = () => call<{ settings: RecordingSettings; can_edit: boolean; google: GoogleConnection | null }>("settings_get");
export const saveRecordingSettings = (settings: Partial<RecordingSettings>) =>
  call<{ settings: RecordingSettings; retention_reapplied: number }>("settings_save", { settings });
export const retentionPreview = (days: number) => call<{ would_expire: number }>("retention_preview", { days });
export const getRecordingUsage = () => call<UsageReport>("usage");
export const purgeRecordingsNow = () => call<{ expired: number; purged: number; stale_uploads_removed: number }>("purge_now");

export const getSessionRecordingState = (sessionId: string) => call<SessionRecordingState>("session_state", { session_id: sessionId });
/** enabled: true / false for this session, null to follow the school default. */
export const setSessionRecording = (sessionId: string, enabled: boolean | null) => call<SessionRecordingState>("session_toggle", { session_id: sessionId, enabled });
export const rearmSession = (sessionId: string) => call<SessionRecordingState>("arm", { session_id: sessionId });

export const listRecordings = (filter: { session_id?: string; class_id?: string; subject?: string } = {}) =>
  call<{ recordings: Recording[] }>("list", filter).then((r) => r.recordings);
export const getPlayInfo = (id: string) => call<PlayInfo>("play", { id });
export const updateRecording = (id: string, patch: Partial<Pick<Recording, "title" | "notes" | "visibility" | "pinned" | "course_id" | "lesson_id">>) =>
  call<{ ok: true }>("update", { id, ...patch });
export const deleteRecording = (id: string) => call<{ ok: true }>("delete", { id });
export const getLinkOptions = (id: string) =>
  call<{ courses: Array<{ id: string; title: string }>; lessons: Array<{ id: string; title: string }> }>("link_options", { id });
export const addRecordingLink = (sessionId: string, sessionDate: string, url: string, title?: string) =>
  call<{ id: string }>("add_link", { session_id: sessionId, session_date: sessionDate, url, title });

/** Upload a recording file the teacher already has (MP4/WebM/MOV). Two steps so nothing is registered until the bytes are in. */
export async function uploadRecordingFile(
  sessionId: string, sessionDate: string, file: File, title?: string,
): Promise<string> {
  const slot = await call<{ id: string; path: string; token: string }>("upload_url", {
    session_id: sessionId, session_date: sessionDate, file_name: file.name, size_bytes: file.size, mime_type: file.type, title,
  });
  const { error } = await supabase.storage.from("live-class-recordings").uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  await call("upload_complete", { id: slot.id });
  return slot.id;
}
