// src/lib/liveAttendance.ts
//
// Automatic attendance for Live Classes (virtual classroom). Everything here sits on the EXISTING
// virtual_classroom_sessions / virtual_classroom_attendance tables (see
// supabase/migrations/20261112000000_live_class_auto_attendance.sql). The pure helpers have no dependencies so they
// are unit-tested directly (src/test/liveAttendance.test.ts); the RPC wrappers at the bottom are thin.
//
// Compatibility: if the migration has not been applied yet, every wrapper falls back to the exact table calls the
// app made before (manual marking and the old "joined" upsert), so nothing breaks while the database catches up.

import { supabase } from "@/integrations/supabase/client";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export type AttendanceResult = "present" | "partial" | "absent" | "excused";

export interface LiveAttendanceRules {
  school_id: string;
  auto_enabled: boolean;
  present_min_percent: number;
  partial_min_percent: number;
  late_grace_minutes: number;
  heartbeat_timeout_seconds: number;
  background_grace_minutes: number;
  can_edit: boolean;
}

export interface AttendanceInterval {
  joined_at: string;
  left_at: string | null;
  open: boolean;
  reason: string | null;
}

export interface DayRegisterRow {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  result: AttendanceResult;
  attendance_status: string | null;
  total_seconds: number;
  attended_percent: number | null;
  first_joined_at: string | null;
  last_left_at: string | null;
  join_count: number;
  is_late: boolean;
  is_final: boolean;
  in_class: boolean;
  result_source: "auto" | "teacher" | null;
  auto_result: AttendanceResult | null;
  corrected_at: string | null;
  correction_reason: string | null;
  intervals: AttendanceInterval[];
  /** Last time APAS heard from the student's open stay (null when there is no open stay). */
  last_seen_at: string | null;
  /** True when that was within the last couple of minutes. */
  seen_recently: boolean;
}

export interface ClassReportRow {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  sessions_held: number;
  present: number;
  partial: number;
  absent: number;
  excused: number;
  late: number;
  total_seconds: number;
  attended_percent: number | null;
}

export interface SessionReportRow {
  session_id: string;
  session_date: string;
  subject: string;
  title: string | null;
  window_start: string;
  window_end: string;
  roster_size: number;
  present: number;
  partial: number;
  absent: number;
  excused: number;
  late: number;
}

export const DEFAULT_RULES = {
  present_min_percent: 75,
  partial_min_percent: 40,
  late_grace_minutes: 10,
  heartbeat_timeout_seconds: 180,
  background_grace_minutes: 15,
} as const;

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────────────

export const RESULT_META: Record<AttendanceResult, { label: string; badge: string }> = {
  present: { label: "Present", badge: "bg-green-100 text-green-800" },
  partial: { label: "Partial", badge: "bg-amber-100 text-amber-800" },
  absent: { label: "Absent", badge: "bg-red-100 text-red-800" },
  excused: { label: "Excused", badge: "bg-sky-100 text-sky-800" },
};

/** attendance_result when set, otherwise derived from the legacy attendance_status (joined/absent/excused). */
export function normalizeResult(result: string | null | undefined, legacyStatus: string | null | undefined): AttendanceResult {
  if (result === "present" || result === "partial" || result === "absent" || result === "excused") return result;
  if (legacyStatus === "joined") return "present";
  if (legacyStatus === "excused") return "excused";
  return "absent";
}

/** The old attendance_status value that goes with a result (present AND partial both stay 'joined'). */
export function legacyStatusFor(result: AttendanceResult): "joined" | "absent" | "excused" {
  return result === "present" || result === "partial" ? "joined" : result;
}

/**
 * What the register can honestly say about a student right now.
 *  in_class  open stay and APAS heard from the student in the last ~2.5 min
 *  away      open stay but APAS has gone quiet (page backgrounded, phone suspended, or the student left without
 *            tapping Leave): the stay is still open, so we do NOT claim they are in class
 *  left      stays exist and none is open
 *  none      nothing tracked
 */
export function presenceState(r: Pick<DayRegisterRow, "in_class" | "seen_recently" | "join_count">): "in_class" | "away" | "left" | "none" {
  if (r.in_class) return r.seen_recently ? "in_class" : "away";
  return r.join_count > 0 ? "left" : "none";
}

/** Seconds attended as a percentage of the scheduled window, 0 to 100, one decimal. */
export function attendedPercent(attendedSeconds: number, windowSeconds: number): number {
  if (!(windowSeconds > 0) || !(attendedSeconds > 0)) return 0;
  return Math.round(Math.min(100, (attendedSeconds / windowSeconds) * 100) * 10) / 10;
}

/** Same rule the database applies: >= present threshold is Present, >= partial threshold is Partial, else Absent. */
export function classifyAttendance(
  percent: number,
  rules: Pick<LiveAttendanceRules, "present_min_percent" | "partial_min_percent">,
): "present" | "partial" | "absent" {
  if (percent >= rules.present_min_percent) return "present";
  if (percent >= rules.partial_min_percent) return "partial";
  return "absent";
}

/** "0 min", "<1 min", "39 min", "1 h 05 min". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSeconds ?? 0));
  if (s === 0) return "0 min";
  if (s < 60) return "<1 min";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "10:02" in the viewer's locale; "—" when empty. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Validation that mirrors the database CHECKs, so the form can explain a problem before the server rejects it. */
export function validateRules(r: {
  present_min_percent: number; partial_min_percent: number; late_grace_minutes: number;
  heartbeat_timeout_seconds: number; background_grace_minutes: number;
}): string | null {
  const inRange = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!inRange(r.present_min_percent, 1, 100)) return "Present threshold must be a whole number from 1 to 100.";
  if (!inRange(r.partial_min_percent, 1, 100)) return "Partial threshold must be a whole number from 1 to 100.";
  if (r.partial_min_percent > r.present_min_percent) return "The Partial threshold cannot be higher than the Present threshold.";
  if (!inRange(r.late_grace_minutes, 0, 120)) return "Late grace must be 0 to 120 minutes.";
  if (!inRange(r.heartbeat_timeout_seconds, 60, 900)) return "Connection timeout must be 60 to 900 seconds.";
  if (!inRange(r.background_grace_minutes, 0, 240)) return "Background grace must be 0 to 240 minutes.";
  return null;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function classReportCsv(rows: ClassReportRow[]): string {
  const head = ["Roll", "Student", "Sessions held", "Present", "Partial", "Absent", "Excused", "Late", "Time in class (min)", "Attended %"];
  const body = rows.map((r) => [
    r.roll_number ?? "", r.full_name, r.sessions_held, r.present, r.partial, r.absent, r.excused, r.late,
    Math.round(r.total_seconds / 60), r.attended_percent ?? "",
  ]);
  return [head, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

export function sessionReportCsv(rows: SessionReportRow[]): string {
  const head = ["Date", "Subject", "Title", "Start", "End", "Roster", "Present", "Partial", "Absent", "Excused", "Late"];
  const body = rows.map((r) => [
    r.session_date, r.subject, r.title ?? "", formatClock(r.window_start), formatClock(r.window_end),
    r.roster_size, r.present, r.partial, r.absent, r.excused, r.late,
  ]);
  return [head, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
}

/** PostgREST says PGRST202 / "Could not find the function" when the migration has not been applied. */
export function isMissingRpc(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? "");
}

/** The UTC calendar day: the convention every live-class screen already uses for session_date. */
export const utcToday = () => new Date().toISOString().slice(0, 10);

// ── RPC wrappers (migration applied) with legacy fallbacks (migration not yet applied) ───────────────

// The generated Database types predate the live-class tables, so the client is used untyped here, as the existing
// live-class pages already do for these tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function toRow(r: any): DayRegisterRow {
  return {
    student_id: r.student_id,
    full_name: r.full_name ?? "Unknown",
    roll_number: r.roll_number ?? null,
    result: normalizeResult(r.result, r.attendance_status),
    attendance_status: r.attendance_status ?? null,
    total_seconds: Number(r.total_seconds ?? 0),
    attended_percent: r.attended_percent == null ? null : Number(r.attended_percent),
    first_joined_at: r.first_joined_at ?? null,
    last_left_at: r.last_left_at ?? null,
    join_count: Number(r.join_count ?? 0),
    is_late: !!r.is_late,
    is_final: !!r.is_final,
    in_class: !!r.in_class,
    result_source: r.result_source ?? null,
    auto_result: r.auto_result ?? null,
    corrected_at: r.corrected_at ?? null,
    correction_reason: r.correction_reason ?? null,
    intervals: Array.isArray(r.intervals) ? r.intervals : [],
    last_seen_at: r.last_seen_at ?? null,
    seen_recently: !!r.seen_recently,
  };
}

function sortByRoll(rows: DayRegisterRow[]): DayRegisterRow[] {
  return [...rows].sort((a, b) => (a.roll_number || "").localeCompare(b.roll_number || "", undefined, { numeric: true }));
}

/** The whole roster for one occurrence. `legacy` is true when the migration is not applied yet. */
export async function fetchDayRegister(
  session: { id: string; class_id: string },
  date: string,
): Promise<{ rows: DayRegisterRow[]; legacy: boolean }> {
  const { data, error } = await db.rpc("get_live_attendance_day", { p_session: session.id, p_date: date });
  if (!error) return { rows: sortByRoll((data ?? []).map(toRow)), legacy: false };
  if (!isMissingRpc(error)) throw new Error(error.message);

  // ── legacy path: exactly what TeacherVirtualClassroom did before ──
  const { data: classStudents, error: csError } = await db
    .from("class_students")
    .select("student_id, students:student_id ( full_name, roll_number )")
    .eq("class_id", session.class_id);
  if (csError) throw new Error(csError.message);
  const { data: attendance, error: attError } = await db
    .from("virtual_classroom_attendance")
    .select("student_id, attendance_status, joined_at")
    .eq("session_id", session.id)
    .eq("session_date", date);
  if (attError) throw new Error(attError.message);
  const byStudent = new Map<string, any>((attendance || []).map((a: any) => [a.student_id, a]));
  const rows = (classStudents || []).map((row: any) => {
    const att = byStudent.get(row.student_id);
    return toRow({
      student_id: row.student_id,
      full_name: row.students?.full_name,
      roll_number: row.students?.roll_number,
      attendance_status: att?.attendance_status ?? "absent",
      first_joined_at: att?.joined_at ?? null,
    });
  });
  return { rows: sortByRoll(rows), legacy: true };
}

/** Teacher correction (Present / Partial / Absent / Excused). */
export async function overrideAttendance(args: {
  sessionId: string; studentId: string; date: string; result: AttendanceResult; reason?: string; legacy?: boolean;
}): Promise<void> {
  if (!args.legacy) {
    const { error } = await db.rpc("live_attendance_override", {
      p_session: args.sessionId, p_student: args.studentId, p_date: args.date,
      p_result: args.result, p_reason: args.reason?.trim() || null,
    });
    if (!error) return;
    if (!isMissingRpc(error)) throw new Error(error.message);
  }
  // legacy: the original manual upsert (partial has no legacy value, so it is stored as 'joined')
  const { error } = await db.from("virtual_classroom_attendance").upsert(
    {
      session_id: args.sessionId, student_id: args.studentId, session_date: args.date,
      attendance_status: legacyStatusFor(args.result), marked_by_teacher: true,
    },
    { onConflict: "session_id,student_id,session_date" },
  );
  if (error) throw new Error(error.message);
}

/** Teacher: end a stay that is still open because the student left without telling APAS. */
export async function endStay(sessionId: string, studentId: string, date: string): Promise<void> {
  const { error } = await db.rpc("live_attendance_end_stay", { p_session: sessionId, p_student: studentId, p_date: date });
  if (error) throw new Error(error.message);
}

export async function revertAttendanceOverride(sessionId: string, studentId: string, date: string): Promise<void> {
  const { error } = await db.rpc("live_attendance_revert_override", { p_session: sessionId, p_student: studentId, p_date: date });
  if (error) throw new Error(error.message);
}

export async function fetchRules(): Promise<LiveAttendanceRules | null> {
  const { data, error } = await db.rpc("get_live_attendance_rules");
  if (error) {
    if (isMissingRpc(error)) return null;
    throw new Error(error.message);
  }
  return (data as LiveAttendanceRules | null) ?? null;
}

export async function saveRules(r: Omit<LiveAttendanceRules, "school_id" | "can_edit">): Promise<LiveAttendanceRules | null> {
  const { data, error } = await db.rpc("save_live_attendance_rules", {
    p_auto_enabled: r.auto_enabled,
    p_present_min_percent: r.present_min_percent,
    p_partial_min_percent: r.partial_min_percent,
    p_late_grace_minutes: r.late_grace_minutes,
    p_heartbeat_timeout_seconds: r.heartbeat_timeout_seconds,
    p_background_grace_minutes: r.background_grace_minutes,
  });
  if (error) throw new Error(error.message);
  return (data as LiveAttendanceRules | null) ?? null;
}

export async function fetchClassReport(classId: string, from: string, to: string, subject: string | null): Promise<ClassReportRow[]> {
  const { data, error } = await db.rpc("get_live_attendance_class_report", {
    p_class: classId, p_from: from, p_to: to, p_subject: subject,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...r,
    sessions_held: Number(r.sessions_held), present: Number(r.present), partial: Number(r.partial),
    absent: Number(r.absent), excused: Number(r.excused), late: Number(r.late),
    total_seconds: Number(r.total_seconds ?? 0),
    attended_percent: r.attended_percent == null ? null : Number(r.attended_percent),
  }));
}

export async function fetchSessionReport(classId: string, from: string, to: string, subject: string | null): Promise<SessionReportRow[]> {
  const { data, error } = await db.rpc("get_live_attendance_session_report", {
    p_class: classId, p_from: from, p_to: to, p_subject: subject,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    ...r,
    roster_size: Number(r.roster_size), present: Number(r.present), partial: Number(r.partial),
    absent: Number(r.absent), excused: Number(r.excused), late: Number(r.late),
  }));
}

/** The pre-migration "student joined" write, kept so joining still records something if the RPCs are not deployed. */
export async function legacyRecordJoin(sessionId: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return;
  const { data: studentRow } = await db.from("students").select("id").eq("profile_id", userData.user.id).single();
  if (!studentRow) return;
  const { error } = await db.from("virtual_classroom_attendance").upsert(
    { session_id: sessionId, student_id: studentRow.id, session_date: utcToday(), attendance_status: "joined", joined_at: new Date().toISOString() },
    { onConflict: "session_id,student_id,session_date" },
  );
  if (error) throw new Error(error.message);
}
