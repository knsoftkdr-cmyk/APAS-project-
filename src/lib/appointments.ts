import { supabase } from "@/integrations/supabase/client";

// ============================================================
// TYPES
// ============================================================

export type MeetingMode = "in_person" | "virtual";
export type ReasonCategory =
  | "academic_concern"
  | "behaviour_discussion"
  | "general_checkin"
  | "other";
export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed"
  | "no_show";
export type RequestedBy = "parent" | "teacher";

export interface ChildOption {
  studentId: string;
  fullName: string;
  className: string;
  section: string;
  schoolId: string;
}

export interface TeacherOption {
  teacherId: string;
  fullName: string;
  designation: string | null;
  subject: string | null;
  teacherRole: string | null;
}

export interface ParentOption {
  parentId: string;
  parentName: string;
}

export interface AvailableSlot {
  date: string;
  startTime: string;
  endTime: string;
}

export interface Appointment {
  id: string;
  schoolId: string;
  parentId: string;
  studentId: string;
  teacherId: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  reasonCategory: ReasonCategory;
  reasonNote: string | null;
  meetingMode: MeetingMode;
  locationRoom: string | null;
  meetingLink: string | null;
  createdAt: string;
  rejectionReason: string | null;
  requestedBy: RequestedBy;
  teacherName?: string;
  studentName?: string;
  parentName?: string;
}

// ============================================================
// 1. GET PARENT'S CHILDREN
// ============================================================

export async function getMyChildren(parentId: string): Promise<ChildOption[]> {
  const { data: links, error: linksError } = await supabase
    .from("parent_students")
    .select("student_id")
    .eq("parent_id", parentId);

  if (linksError) throw linksError;
  if (!links || links.length === 0) return [];

  const studentIds = links.map((l) => l.student_id);

  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, class_grade, section, school_id")
    .in("id", studentIds);

  if (profilesError) throw profilesError;

  return (profilesData ?? []).map((p: any) => ({
    studentId: p.id,
    fullName: p.full_name,
    className: p.class_grade,
    section: p.section ?? "",
    schoolId: p.school_id,
  }));
}

// ============================================================
// 2. GET TEACHERS FOR A CHILD'S CLASS
// ============================================================

export async function getTeachersForChild(
  className: string,
  section: string,
  schoolId: string
): Promise<TeacherOption[]> {
  let dbClassName = className;
  if (className && !isNaN(Number(className))) {
    dbClassName = `Class ${className}`;
  } else if (className) {
    dbClassName = className.charAt(0).toUpperCase() + className.slice(1);
  }

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id")
    .eq("name", dbClassName)
    .eq("section", section)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (classError) throw classError;
  if (!classRow) return [];

  const { data: assignments, error } = await supabase
    .from("class_teachers")
    .select("teacher_id, teacher_role, subject")
    .eq("class_id", classRow.id);

  if (error) throw error;
  if (!assignments || assignments.length === 0) return [];

  const teacherIds = assignments.map((a) => a.teacher_id);

  const { data: teacherProfiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, designation")
    .in("id", teacherIds);

  if (profilesError) throw profilesError;

  return assignments.map((a) => {
    const p = (teacherProfiles ?? []).find((tp) => tp.id === a.teacher_id);
    return {
      teacherId: a.teacher_id,
      fullName: p?.full_name ?? "Unknown",
      designation: p?.designation ?? null,
      subject: a.subject,
      teacherRole: a.teacher_role,
    };
  });
}

// ============================================================
// 2b. GET PARENTS LINKED TO A TEACHER'S STUDENTS (for teacher-initiated booking)
// ============================================================

export async function getTeacherParents(teacherId: string): Promise<ParentOption[]> {
  const { data: assignedClasses } = await supabase
    .from("class_teachers")
    .select("class_id")
    .eq("teacher_id", teacherId);
  const classIds = [...new Set((assignedClasses ?? []).map((c: any) => c.class_id))];
  if (classIds.length === 0) return [];

  const { data: classStudentLinks } = await supabase
    .from("class_students")
    .select("student_id")
    .in("class_id", classIds);
  const studentIds = [...new Set((classStudentLinks ?? []).map((c: any) => c.student_id))];
  if (studentIds.length === 0) return [];

  const { data: students } = await supabase
    .from("students")
    .select("profile_id")
    .in("id", studentIds);
  const profileIds = (students ?? []).map((s: any) => s.profile_id).filter(Boolean);
  if (profileIds.length === 0) return [];

  const { data: parentLinks } = await supabase
    .from("parent_students")
    .select("parent_id")
    .in("student_id", profileIds);
  const parentIds = [...new Set((parentLinks ?? []).map((p: any) => p.parent_id))];
  if (parentIds.length === 0) return [];

  const { data: parentProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", parentIds);

  return (parentProfiles ?? []).map((p: any) => ({
    parentId: p.id,
    parentName: p.full_name ?? "Unnamed Parent",
  }));
}

// ============================================================
// 2c. GET A SPECIFIC PARENT'S CHILDREN, SCOPED TO THIS TEACHER'S CLASSES
// ============================================================

export async function getChildrenForParentByTeacher(
  teacherId: string,
  parentId: string
): Promise<ChildOption[]> {
  const { data: assignedClasses } = await supabase
    .from("class_teachers")
    .select("class_id")
    .eq("teacher_id", teacherId);
  const classIds = [...new Set((assignedClasses ?? []).map((c: any) => c.class_id))];
  if (classIds.length === 0) return [];

  const { data: classRows } = await supabase
    .from("classes")
    .select("id, name, section, school_id")
    .in("id", classIds);
  const classMap = new Map((classRows ?? []).map((c: any) => [c.id, c]));

  const { data: classStudentLinks } = await supabase
    .from("class_students")
    .select("class_id, student_id")
    .in("class_id", classIds);
  const studentIds = [...new Set((classStudentLinks ?? []).map((c: any) => c.student_id))];
  if (studentIds.length === 0) return [];

  const { data: students } = await supabase
    .from("students")
    .select("id, full_name, profile_id")
    .in("id", studentIds);

  const { data: parentLinks } = await supabase
    .from("parent_students")
    .select("student_id")
    .eq("parent_id", parentId);
  const linkedProfileIds = new Set((parentLinks ?? []).map((p: any) => p.student_id));

  const studentToClass = new Map(
    (classStudentLinks ?? []).map((cs: any) => [cs.student_id, cs.class_id])
  );

  return (students ?? [])
    .filter((s: any) => s.profile_id && linkedProfileIds.has(s.profile_id))
    .map((s: any) => {
      const cId = studentToClass.get(s.id);
      const cls = classMap.get(cId);
      return {
        studentId: s.profile_id,
        fullName: s.full_name,
        className: cls?.name ?? "",
        section: cls?.section ?? "",
        schoolId: cls?.school_id ?? "",
      };
    });
}

// ============================================================
// 3. GET AVAILABLE SLOTS FOR A TEACHER
// ============================================================

export async function getTeacherAvailableSlots(
  teacherId: string,
  fromDate: Date,
  daysAhead: number = 14
): Promise<AvailableSlot[]> {
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + daysAhead);

  const fromStr = fromDate.toISOString().split("T")[0];
  const toStr = toDate.toISOString().split("T")[0];

  const { data: recurring, error: recurringError } = await supabase
    .from("teacher_availability")
    .select("day_of_week, start_time, end_time, slot_duration_minutes")
    .eq("teacher_id", teacherId)
    .eq("is_active", true);

  if (recurringError) throw recurringError;

  const { data: exceptions, error: exceptionError } = await supabase
    .from("availability_exceptions")
    .select("exception_date, start_time, end_time, exception_type, slot_duration_minutes")
    .eq("teacher_id", teacherId)
    .gte("exception_date", fromStr)
    .lte("exception_date", toStr);

  if (exceptionError) throw exceptionError;

  const { data: booked, error: bookedError } = await supabase
    .from("appointments")
    .select("appointment_date, start_time")
    .eq("teacher_id", teacherId)
    .in("status", ["pending", "confirmed"])
    .gte("appointment_date", fromStr)
    .lte("appointment_date", toStr);

  if (bookedError) throw bookedError;

  const bookedSet = new Set((booked ?? []).map((b) => `${b.appointment_date}_${b.start_time}`));
  const blackoutDates = new Set(
    (exceptions ?? [])
      .filter((e) => e.exception_type === "blackout" && !e.start_time)
      .map((e) => e.exception_date)
  );

  const slots: AvailableSlot[] = [];

  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    if (blackoutDates.has(dateStr)) continue;

    const dayOfWeek = d.getDay();
    const rulesForDay = (recurring ?? []).filter((r) => r.day_of_week === dayOfWeek);

    for (const rule of rulesForDay) {
      generateSlotsInRange(dateStr, rule.start_time, rule.end_time, rule.slot_duration_minutes, bookedSet, slots);
    }
  }

  for (const ex of exceptions ?? []) {
    if (ex.exception_type === "extra_slot" && ex.start_time && ex.end_time) {
      generateSlotsInRange(ex.exception_date, ex.start_time, ex.end_time, ex.slot_duration_minutes ?? 15, bookedSet, slots);
    }
  }

  return slots.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
}

function generateSlotsInRange(
  date: string,
  startTime: string,
  endTime: string,
  durationMinutes: number,
  bookedSet: Set<string>,
  outSlots: AvailableSlot[]
) {
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  let cursor = startH * 60 + startM;
  const end = endH * 60 + endM;

  while (cursor + durationMinutes <= end) {
    const slotStart = minutesToTimeStr(cursor);
    const slotEnd = minutesToTimeStr(cursor + durationMinutes);

    if (!bookedSet.has(`${date}_${slotStart}:00`)) {
      outSlots.push({ date, startTime: slotStart, endTime: slotEnd });
    }
    cursor += durationMinutes;
  }
}

function minutesToTimeStr(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ============================================================
// 4. CREATE APPOINTMENT
// ============================================================

export interface CreateAppointmentPayload {
  schoolId: string;
  parentId: string;
  studentId: string;
  teacherId: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  reasonCategory: ReasonCategory;
  reasonNote?: string;
  meetingMode: MeetingMode;
  locationRoom?: string;
  meetingLink?: string;
  requestedBy?: RequestedBy; // defaults to "parent" — pass "teacher" for teacher-initiated bookings
}

export async function createAppointment(payload: CreateAppointmentPayload): Promise<Appointment> {
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      school_id: payload.schoolId,
      parent_id: payload.parentId,
      student_id: payload.studentId,
      teacher_id: payload.teacherId,
      appointment_date: payload.appointmentDate,
      start_time: payload.startTime,
      end_time: payload.endTime,
      reason_category: payload.reasonCategory,
      reason_note: payload.reasonNote ?? null,
      meeting_mode: payload.meetingMode,
      location_room: payload.locationRoom ?? null,
      meeting_link: payload.meetingLink ?? null,
      status: "pending",
      requested_by: payload.requestedBy ?? "parent",
    })
    .select()
    .single();

  if (error) throw error;
  return mapAppointmentRow(data);
}

// ============================================================
// 5. GET MY APPOINTMENTS (Parent overview)
// ============================================================

export async function getMyAppointments(parentId: string): Promise<{
  upcoming: Appointment[];
  history: Appointment[];
}> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("parent_id", parentId)
    .order("appointment_date", { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const teacherIds = [...new Set(rows.map((r) => r.teacher_id))];
  const studentIds = [...new Set(rows.map((r) => r.student_id))];

  const { data: teacherProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", teacherIds.length ? teacherIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data: studentProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds.length ? studentIds : ["00000000-0000-0000-0000-000000000000"]);

  const all = rows.map((row: any) => ({
    ...mapAppointmentRow(row),
    teacherName: teacherProfiles?.find((t) => t.id === row.teacher_id)?.full_name,
    studentName: studentProfiles?.find((s) => s.id === row.student_id)?.full_name,
  }));

  const upcoming = all.filter((a) => ["pending", "confirmed"].includes(a.status));
  const history = all.filter((a) => ["rejected", "cancelled", "completed", "no_show"].includes(a.status));

  return { upcoming, history };
}

// ============================================================
// 6. CANCEL APPOINTMENT
// ============================================================

export async function cancelAppointment(
  appointmentId: string,
  cancelledBy: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_by: cancelledBy,
      cancellation_reason: reason ?? null,
    })
    .eq("id", appointmentId);

  if (error) throw error;
}

// ============================================================
// 7. GET TEACHER'S APPOINTMENTS (Teacher view)
// ============================================================

export async function getTeacherAppointments(teacherId: string): Promise<{
  upcoming: Appointment[];
  history: Appointment[];
}> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("appointment_date", { ascending: true });

  if (error) throw error;

  const rows = data ?? [];
  const parentIds = [...new Set(rows.map((r) => r.parent_id))];
  const studentIds = [...new Set(rows.map((r) => r.student_id))];

  const { data: parentProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]);

  const { data: studentProfiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds.length ? studentIds : ["00000000-0000-0000-0000-000000000000"]);

  const all = rows.map((row: any) => ({
    ...mapAppointmentRow(row),
    // NOTE: fixed from a previous bug where the parent's name was stored under `teacherName`.
    parentName: parentProfiles?.find((p) => p.id === row.parent_id)?.full_name,
    studentName: studentProfiles?.find((s) => s.id === row.student_id)?.full_name,
  }));

  const upcoming = all.filter((a) => ["pending", "confirmed"].includes(a.status));
  const history = all.filter((a) => ["rejected", "cancelled", "completed", "no_show"].includes(a.status));

  return { upcoming, history };
}

// ============================================================
// 8. UPDATE APPOINTMENT STATUS (Teacher OR parent actions, depending on who needs to respond)
// ============================================================

export async function updateAppointmentStatus(
  appointmentId: string,
  newStatus: AppointmentStatus,
  rejectionReason?: string
): Promise<void> {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: newStatus,
      rejection_reason: newStatus === "rejected" ? (rejectionReason ?? null) : null,
    })
    .eq("id", appointmentId);

  if (error) throw error;
}

// ============================================================
// HELPERS
// ============================================================

function mapAppointmentRow(row: any): Appointment {
  return {
    id: row.id,
    schoolId: row.school_id,
    parentId: row.parent_id,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    appointmentDate: row.appointment_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    reasonCategory: row.reason_category,
    reasonNote: row.reason_note,
    meetingMode: row.meeting_mode,
    locationRoom: row.location_room,
    meetingLink: row.meeting_link,
    createdAt: row.created_at,
    rejectionReason: row.rejection_reason ?? null,
    requestedBy: row.requested_by ?? "parent",
  };
}