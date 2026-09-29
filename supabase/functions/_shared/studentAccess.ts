// supabase/functions/_shared/studentAccess.ts
//
// Who may see whose data, for the readiness / cohort views.
//
//   student            only themself
//   teacher            only students on a class roster they teach
//                      (class_teachers -> class_students)
//   admin / principal / hod / school_admin
//                      any student in THEIR OWN school. A staff account with no
//                      school on its profile (a platform-level admin) is not
//                      school-restricted.
//
// The school check exists because `classes` and the mastery tables carry no
// school_id of their own: without it, a principal could request another
// school's student id and read it straight through the service-role client.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

export const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];

export interface Caller {
  userId: string;
  role: string;
  schoolId: string | null;
  isStaff: boolean;
}

export async function resolveCaller(admin: any, userId: string): Promise<Caller | null> {
  const { data: profile } = await admin.from("profiles").select("role, school_id").eq("id", userId).maybeSingle();
  if (!profile) return null;
  return {
    userId,
    role: profile.role,
    schoolId: profile.school_id ?? null,
    isStaff: STAFF_ROLES.includes(profile.role),
  };
}

/** The students.id for a student caller, or null. */
export async function studentIdForProfile(admin: any, profileId: string): Promise<string | null> {
  const { data } = await admin.from("students").select("id").eq("profile_id", profileId).maybeSingle();
  return data?.id ?? null;
}

async function schoolsOfStudents(admin: any, studentIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!studentIds.length) return out;
  const { data: students } = await admin.from("students").select("profile_id").in("id", studentIds);
  const profileIds = (students ?? []).map((s: Row) => s.profile_id).filter(Boolean);
  if (!profileIds.length) return out;
  const { data: profiles } = await admin.from("profiles").select("school_id").in("id", profileIds);
  for (const p of profiles ?? []) if (p.school_id) out.add(p.school_id);
  return out;
}

export interface AccessResult { ok: boolean; status?: number; error?: string }
const DENY = (error: string, status = 403): AccessResult => ({ ok: false, status, error });

/** May this staff caller read this one student? */
export async function canStaffAccessStudent(admin: any, caller: Caller, studentId: string): Promise<AccessResult> {
  if (!caller.isStaff) return DENY("Not permitted");

  const { data: student } = await admin.from("students").select("id").eq("id", studentId).maybeSingle();
  if (!student) return DENY("Student not found", 404);

  if (caller.schoolId) {
    const schools = await schoolsOfStudents(admin, [studentId]);
    if (schools.size > 0 && !schools.has(caller.schoolId)) return DENY("This student belongs to a different school");
  }

  if (caller.role === "teacher") {
    const { data: memberships } = await admin.from("class_students").select("class_id").eq("student_id", studentId);
    const classIds = (memberships ?? []).map((m: Row) => m.class_id);
    if (!classIds.length) return DENY("You do not teach this student");
    const { data: taught } = await admin.from("class_teachers").select("id")
      .eq("teacher_id", caller.userId).in("class_id", classIds).limit(1);
    if (!taught?.length) return DENY("You do not teach this student");
  }
  return { ok: true };
}

/** May this staff caller read this class roster? Returns the roster's student ids on success. */
export async function canStaffAccessClass(
  admin: any, caller: Caller, classId: string,
): Promise<AccessResult & { studentIds?: string[] }> {
  if (!caller.isStaff) return DENY("Not permitted");

  const { data: cls } = await admin.from("classes").select("id").eq("id", classId).maybeSingle();
  if (!cls) return DENY("Class not found", 404);

  if (caller.role === "teacher") {
    const { data: assignment } = await admin.from("class_teachers").select("id")
      .eq("class_id", classId).eq("teacher_id", caller.userId).maybeSingle();
    if (!assignment) return DENY("You are not assigned to this class");
  }

  const { data: roster, error } = await admin.from("class_students").select("student_id").eq("class_id", classId);
  if (error) throw error;
  const studentIds = (roster ?? []).map((r: Row) => r.student_id);

  if (caller.schoolId && studentIds.length) {
    const schools = await schoolsOfStudents(admin, studentIds);
    if (schools.size > 0 && !schools.has(caller.schoolId)) return DENY("This class belongs to a different school");
  }
  return { ok: true, studentIds };
}
