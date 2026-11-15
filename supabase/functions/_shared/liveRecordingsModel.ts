// supabase/functions/_shared/liveRecordingsModel.ts
//
// Pure logic for automatic live-class recordings (no Deno, no network, no database) so it can be unit-tested
// (src/test/liveRecordingsModel.test.ts). The handler (handlers/liveRecordings.ts) and the Google client
// (googleMeet.ts) are thin shells around these functions.
//
// HOW RECORDING WORKS (read this first)
//   Live classes run on Google Meet links the teacher pastes into APAS. Recording is done by GOOGLE, on Google's
//   servers: APAS switches on "auto recording" for the teacher's meeting space through the Meet REST API, so Meet
//   starts recording as soon as someone with recording privilege (the teacher/host) joins. Nothing depends on the
//   teacher's browser staying open. When the meeting ends Google writes an MP4 to the organiser's Drive; APAS polls
//   the Meet API, finds the file, and (storage_mode = supabase_copy) copies it into a private Supabase Storage bucket
//   in resumable chunks, or (drive_link) just keeps the Drive link.
//   Requires: a paid Google Workspace edition that allows recording, and a Workspace admin authorising APAS's
//   service account (domain-wide delegation). Without both, recordings can still be attached by hand (upload / link).

export type RecStatus = "recording" | "processing" | "copying" | "ready" | "failed" | "deleted";
export type StorageKind = "none" | "supabase" | "drive" | "link";
export type StorageMode = "supabase_copy" | "drive_link";
export type Source = "auto" | "upload" | "link";

export interface RecSettings {
  enabled: boolean;
  auto_record: boolean;
  storage_mode: StorageMode;
  teachers_can_toggle: boolean;
  teachers_can_manage: boolean;
  teachers_can_delete: boolean;
  teachers_can_upload: boolean;
  student_access: boolean;
  student_download: boolean;
  retention_days: number;     // 0 = keep until someone deletes it
  storage_quota_gb: number;
  max_upload_mb: number;
}

export const DEFAULT_SETTINGS: RecSettings = {
  enabled: false,
  auto_record: true,
  storage_mode: "supabase_copy",
  teachers_can_toggle: true,
  teachers_can_manage: true,
  teachers_can_delete: false,
  teachers_can_upload: true,
  student_access: true,
  student_download: false,
  retention_days: 180,
  storage_quota_gb: 50,
  max_upload_mb: 1024,
};

const DAY_MS = 86_400_000;

// ── Meet link / session helpers ─────────────────────────────────────────────────────────────────────

/** "abc-mnop-xyz" from a Meet URL, or null (Classroom "lookup" links and other providers are not supported). */
export function parseMeetingCode(link: string | null | undefined): string | null {
  const m = /^https?:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/i.exec((link ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

/** Recording is on when the school allows it AND (the session says so, else the school default says so). */
export function effectiveRecordEnabled(
  sessionFlag: boolean | null | undefined,
  s: Pick<RecSettings, "enabled" | "auto_record">,
): boolean {
  if (!s.enabled) return false;
  return sessionFlag ?? s.auto_record;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Same rule as the attendance feature: the occurrence on `date` has the stored session's UTC time of day and length. */
export function occurrenceWindow(startIso: string, endIso: string, date: string): { start: number; end: number } {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const timeOfDay = s - Date.parse(`${utcDay(s)}T00:00:00.000Z`);
  const start = Date.parse(`${date}T00:00:00.000Z`) + timeOfDay;
  return { start, end: start + Math.max(e - s, 60_000) };
}

/** Which session_date a timestamp belongs to: the in-range date whose window is nearest to it. */
export function resolveOccurrenceDate(
  session: { start: string; end: string; recurrenceEnd: string | null },
  tsMs: number,
): string {
  const first = utcDay(new Date(session.start).getTime());
  const last = session.recurrenceEnd && session.recurrenceEnd > first ? session.recurrenceEnd : first;
  const today = Date.parse(`${utcDay(tsMs)}T00:00:00.000Z`);
  let best = "";
  let bestGap = Infinity;
  for (const d of [today - DAY_MS, today, today + DAY_MS]) {
    const date = utcDay(d);
    if (date < first || date > last) continue;
    const w = occurrenceWindow(session.start, session.end, date);
    const gap = tsMs < w.start ? w.start - tsMs : tsMs > w.end ? tsMs - w.end : 0;
    if (gap < bestGap) { best = date; bestGap = gap; }
  }
  if (best) return best;
  return utcDay(today) < first ? first : last;   // clamp into the schedule
}

/** Occurrences (UTC dates) of a session that ended between `fromMs` and `toMs`: what the sync step looks at. */
export function endedOccurrences(
  session: { start: string; end: string; recurrenceEnd: string | null },
  fromMs: number,
  toMs: number,
): string[] {
  const first = utcDay(new Date(session.start).getTime());
  const last = session.recurrenceEnd && session.recurrenceEnd > first ? session.recurrenceEnd : first;
  const out: string[] = [];
  for (let d = Date.parse(`${first}T00:00:00.000Z`); utcDay(d) <= last && d <= toMs; d += DAY_MS) {
    const w = occurrenceWindow(session.start, session.end, utcDay(d));
    if (w.end >= fromMs && w.end <= toMs) out.push(utcDay(d));
  }
  return out;
}

// ── Retention, quota, retries, chunking ─────────────────────────────────────────────────────────────

/** When a recording stops being kept. 0 days (or no date) means never. */
export function retentionExpiry(endedAtIso: string | null | undefined, days: number): string | null {
  if (!days || days <= 0) return null;
  const base = endedAtIso ? new Date(endedAtIso).getTime() : NaN;
  return new Date((Number.isNaN(base) ? Date.now() : base) + days * DAY_MS).toISOString();
}

/** Would storing `addBytes` more keep the school within its quota? */
export function quotaAllows(usedBytes: number, addBytes: number, quotaGb: number): boolean {
  return usedBytes + Math.max(0, addBytes) <= quotaGb * 1024 ** 3;
}

/** 1, 2, 5, 15, 30 minutes, then hourly. */
export function backoffMs(attempts: number): number {
  const steps = [1, 2, 5, 15, 30, 60];
  return steps[Math.min(Math.max(attempts, 0), steps.length - 1)] * 60_000;
}

export const MAX_COPY_ATTEMPTS = 8;
/** Supabase resumable uploads need 6 MiB chunks (the last one may be smaller). */
export const TUS_CHUNK = 6 * 1024 * 1024;

export function chunkPlan(offset: number, total: number, chunk: number, maxChunks: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (let start = Math.max(0, offset); start < total && out.length < maxChunks; start += chunk) {
    out.push({ start, end: Math.min(start + chunk, total) - 1 });   // inclusive end, as HTTP Range wants
  }
  return out;
}

// ── Provider state, naming, links ───────────────────────────────────────────────────────────────────

export function mapProviderState(state: string, mode: StorageMode): { status: RecStatus; kind: StorageKind } {
  if (state === "STARTED") return { status: "recording", kind: "none" };
  if (state === "FILE_GENERATED") return mode === "supabase_copy" ? { status: "copying", kind: "none" } : { status: "ready", kind: "drive" };
  return { status: "processing", kind: "none" };   // ENDED (file not generated yet) or anything unknown
}

export function safeFileName(name: string): string {
  const base = (name || "recording").split(/[\\/]/).pop()!.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 120);
  return base || "recording";
}

export function extensionFor(mime: string | null | undefined, fileName?: string): string {
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  const m = /\.([a-z0-9]{2,4})$/i.exec(fileName ?? "");
  return m && ["mp4", "webm", "mov"].includes(m[1].toLowerCase()) ? m[1].toLowerCase() : "mp4";
}

/** school / class / recording id: one object per recording id, so retries can never create a second copy. */
export function buildStoragePath(schoolId: string, classId: string, recId: string, ext: string): string {
  return `${schoolId}/${classId}/${recId}.${ext}`;
}

export const ALLOWED_VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"];

export function validateLinkUrl(raw: unknown): { ok: true; url: string; kind: "drive" | "other" } | { ok: false; error: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 1000) return { ok: false, error: "Paste a link to the recording" };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: "That is not a valid link" }; }
  if (u.protocol !== "https:") return { ok: false, error: "Only https links are allowed" };
  return { ok: true, url: u.toString(), kind: /(^|\.)drive\.google\.com$/.test(u.hostname) ? "drive" : "other" };
}

// ── Who may see / manage / delete a recording ───────────────────────────────────────────────────────

export type Member = "teacher" | "staff" | "student" | null;

export interface AccessRow {
  status: RecStatus;
  visibility: "class" | "teachers";
  deleted_at: string | null;
  retention_expires_at: string | null;
}

export function recordingAccess(
  member: Member,
  row: AccessRow,
  s: Pick<RecSettings, "student_access" | "teachers_can_manage" | "teachers_can_delete">,
  nowMs = Date.now(),
): { view: boolean; manage: boolean; remove: boolean } {
  const none = { view: false, manage: false, remove: false };
  if (!member || row.deleted_at || row.status === "deleted") return none;
  if (member === "staff") return { view: true, manage: true, remove: true };
  if (member === "teacher") return { view: true, manage: s.teachers_can_manage, remove: s.teachers_can_delete };
  // student: only finished, class-visible, unexpired recordings, and only if the school allows student access
  const expired = row.retention_expires_at ? new Date(row.retention_expires_at).getTime() <= nowMs : false;
  const view = s.student_access && row.status === "ready" && row.visibility === "class" && !expired;
  return { view, manage: false, remove: false };
}

// ── Google API shapes ───────────────────────────────────────────────────────────────────────────────

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.settings",   // switch auto-recording on for the teacher's space
  "https://www.googleapis.com/auth/meetings.space.readonly",   // list conferences / recordings
  "https://www.googleapis.com/auth/drive.meet.readonly",       // download the MP4 Meet saved (restricted scope)
];

export interface ProviderRecording {
  name: string;               // conferenceRecords/{c}/recordings/{r}: the dedupe key
  state: string;
  startTime: string | null;
  endTime: string | null;
  fileId: string | null;
  exportUri: string | null;
}

// deno-lint-ignore no-explicit-any
export function parseConferenceRecords(json: any): Array<{ name: string; startTime: string | null; endTime: string | null }> {
  const list = Array.isArray(json?.conferenceRecords) ? json.conferenceRecords : [];
  // deno-lint-ignore no-explicit-any
  return list.filter((c: any) => typeof c?.name === "string").map((c: any) => ({
    name: c.name, startTime: c.startTime ?? null, endTime: c.endTime ?? null,
  }));
}

// deno-lint-ignore no-explicit-any
export function parseRecordings(json: any): ProviderRecording[] {
  const list = Array.isArray(json?.recordings) ? json.recordings : [];
  // deno-lint-ignore no-explicit-any
  return list.filter((r: any) => typeof r?.name === "string").map((r: any) => ({
    name: r.name,
    state: String(r.state ?? "STATE_UNSPECIFIED"),
    startTime: r.startTime ?? null,
    endTime: r.endTime ?? null,
    fileId: r.driveDestination?.file ?? null,
    exportUri: r.driveDestination?.exportUri ?? null,
  }));
}

export function meetConferenceFilter(meetingCode: string, sinceIso: string): string {
  return `space.meeting_code = "${meetingCode}" AND start_time>="${sinceIso}"`;
}

export function formatBytes(n: number): string {
  if (!(n > 0)) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** Validates admin input; returns the cleaned settings or an error message. */
export function cleanSettings(input: Record<string, unknown>, current: RecSettings): { ok: true; value: RecSettings } | { ok: false; error: string } {
  const b = (k: keyof RecSettings) => (typeof input[k] === "boolean" ? (input[k] as boolean) : (current[k] as boolean));
  const n = (k: keyof RecSettings) => (input[k] === undefined ? (current[k] as number) : Number(input[k]));
  const mode = input.storage_mode === undefined ? current.storage_mode : input.storage_mode;
  if (mode !== "supabase_copy" && mode !== "drive_link") return { ok: false, error: "Unknown storage mode" };
  const v: RecSettings = {
    enabled: b("enabled"), auto_record: b("auto_record"), storage_mode: mode,
    teachers_can_toggle: b("teachers_can_toggle"), teachers_can_manage: b("teachers_can_manage"),
    teachers_can_delete: b("teachers_can_delete"), teachers_can_upload: b("teachers_can_upload"),
    student_access: b("student_access"), student_download: b("student_download"),
    retention_days: n("retention_days"), storage_quota_gb: n("storage_quota_gb"), max_upload_mb: n("max_upload_mb"),
  };
  if (!Number.isInteger(v.retention_days) || v.retention_days < 0 || v.retention_days > 3650) return { ok: false, error: "Retention must be 0 to 3650 days (0 keeps recordings until deleted)" };
  if (!Number.isInteger(v.storage_quota_gb) || v.storage_quota_gb < 1 || v.storage_quota_gb > 100000) return { ok: false, error: "Storage quota must be 1 to 100000 GB" };
  if (!Number.isInteger(v.max_upload_mb) || v.max_upload_mb < 10 || v.max_upload_mb > 5120) return { ok: false, error: "Maximum upload must be 10 to 5120 MB" };
  return { ok: true, value: v };
}
