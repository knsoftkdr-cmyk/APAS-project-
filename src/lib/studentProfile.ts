// src/lib/studentProfile.ts
//
// Query layer for the Student 360° Profile.
// All reads/writes for the new SIS modules go through these functions.
// RLS on each table handles security — these are plain client calls.

import { supabase } from "@/integrations/supabase/client";

// ============================================================
// Configuration
// Tune these as your grading policy, attendance targets, or
// behaviour scoring rules change — without touching the
// functions below. Move to a DB table later if schools need
// different settings (e.g. per-school grading scale).
// ============================================================

export const APP_CONFIG = {
  gpa: {
    scale: 4.0, // change to 10.0 for a 10-point scale, etc.
    // percentage breakpoints -> grade points, edit freely
    bands: [
      { minPercent: 90, points: 4.0 },
      { minPercent: 80, points: 3.7 },
      { minPercent: 70, points: 3.3 },
      { minPercent: 60, points: 3.0 },
      { minPercent: 50, points: 2.5 },
      { minPercent: 40, points: 2.0 },
      { minPercent: 0, points: 0.0 },
    ],
  },
  attendance: {
    targetPercent: 90, // used by AI insight rule + UI "Good/Needs Improvement" labels
    countLateAsPresent: true,
  },
  behaviour: {
    baselineScore: 0, // starting score before points are applied
    minScore: 0,
    maxScore: 100,
  },
  insights: {
    maxActiveInsights: 5,
  },
} as const;

// ============================================================
// Types
// ============================================================

export interface ParentProfile {
  id: string;
  school_id: string;
  student_id: string;
  parent_id: string | null;
  full_name: string;
  relation: "father" | "mother" | "guardian" | "other";
  is_primary_contact: boolean;
  occupation: string | null;
  phone: string | null;
  alternate_phone: string | null;
  email: string | null;
  whatsapp_number: string | null;
  address: string | null;
  pickup_authorized: boolean;
  photo_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicalRecord {
  id: string;
  student_id: string;
  blood_group: string | null;
  allergies: string[] | null;
  chronic_conditions: string[] | null;
  current_medications: string[] | null;
  disabilities: string | null;
  vaccination_status: Record<string, unknown>;
  emergency_medical_notes: string | null;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  family_doctor_name: string | null;
  family_doctor_phone: string | null;
  last_checkup_date: string | null;
}

export interface TransportAssignment {
  id: string;
  student_id: string;
  bus_number: string | null;
  route_name: string | null;
  pickup_point: string | null;
  pickup_time: string | null;
  drop_point: string | null;
  drop_time: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_registration_number: string | null;
  transport_fee: number | null;
  fee_status: "pending" | "paid" | "overdue" | "waived";
  status: "active" | "inactive";
}

export interface StudentDocument {
  id: string;
  student_id: string;
  document_type: string;
  document_name: string;
  file_url: string; // NOTE: now stores the storage PATH, not a public URL
  verified: boolean;
  expiry_date: string | null;
  created_at: string;
}

export interface BehaviourRecord {
  id: string;
  student_id: string;
  category: "positive" | "negative" | "neutral";
  title: string;
  description: string | null;
  points: number;
  recorded_date: string;
  action_taken: string | null;
}

export interface LearningSupportRecord {
  id: string;
  student_id: string;
  support_type: string;
  diagnosis: string | null;
  goals: string | null;
  accommodations: string | null;
  start_date: string | null;
  review_date: string | null;
  status: "active" | "completed" | "discontinued";
}

export interface EmergencyContact {
  id: string;
  student_id: string;
  full_name: string;
  relation: string;
  phone: string;
  alternate_phone: string | null;
  address: string | null;
  priority_order: number;
  pickup_authorized: boolean;
}

export interface StudentMark {
  id: string;
  student_id: string;
  academic_year: string;
  term: string;
  subject: string;
  marks_obtained: number;
  max_marks: number;
  exam_date: string | null;
}

export interface AttendanceRecord {
  id: string;
  student_id: string;
  date: string;
  status: "present" | "absent" | "late" | "excused";
}

export interface AIInsight {
  id: string;
  student_id: string;
  insight_type: "positive" | "warning" | "info";
  title: string;
  description: string;
  generated_at: string;
}

export interface StudentCore {
  id: string;
  full_name: string | null;
  roll_number: string | null;
  grade: string | null;
  class: string | null;
  section: string | null;
  curriculum: string | null;
  date_of_birth: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  house_id: string | null;
  school_id: string | null;
  profile_id: string;
}

// ============================================================
// Shared helpers
// ============================================================

/**
 * Wraps a Supabase call, throwing a consistent, readable error.
 * Use this for any new query function you add later so error
 * handling stays uniform across the whole file.
 */
async function unwrap<T>(
  promise: Promise<{ data: T | null; error: { message: string } | null }>,
  context: string
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(`[studentProfile] ${context}: ${error.message}`);
  return data as T;
}

// ============================================================
// Core student info (Personal + Academic Information cards)
// ============================================================

export async function getStudentCore(studentId: string) {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .eq("id", studentId)
    .single();

  if (error) throw error;
  return data as StudentCore;
}

export async function updateStudentCore(
  studentId: string,
  payload: Partial<StudentCore>
) {
  const { data, error } = await supabase
    .from("students")
    .update(payload)
    .eq("id", studentId)
    .select()
    .single();

  if (error) throw error;
  return data as StudentCore;
}

// ============================================================
// Parent Profiles tab
// ============================================================

export async function getParentProfiles(studentId: string) {
  const { data, error } = await supabase
    .from("parent_profiles")
    .select("*")
    .eq("student_id", studentId)
    .order("is_primary_contact", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ParentProfile[];
}

export async function upsertParentProfile(
  payload: Partial<ParentProfile> & { school_id: string; student_id: string }
) {
  const { data, error } = await supabase
    .from("parent_profiles")
    .upsert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as ParentProfile;
}
export async function deleteParentProfile(id: string) {
  const { error } = await supabase
    .from("parent_profiles")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

// ============================================================
// Medical tab
// ============================================================

export async function getMedicalRecord(studentId: string) {
  const { data, error } = await supabase
    .from("student_medical_records")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw error;
  return data as MedicalRecord | null;
}

export async function upsertMedicalRecord(
  payload: Partial<MedicalRecord> & { school_id: string; student_id: string }
) {
  const { data, error } = await supabase
    .from("student_medical_records")
    .upsert(payload, { onConflict: "student_id" })
    .select()
    .single();

  if (error) throw error;
  return data as MedicalRecord;
}
export async function deleteMedicalRecord(studentId: string) {
  const { error } = await supabase
    .from("student_medical_records")
    .delete()
    .eq("student_id", studentId);

  if (error) throw error;
}


// ============================================================
// Transport tab
// ============================================================

export async function getTransportAssignment(studentId: string) {
  const { data, error } = await supabase
    .from("transport_assignments")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw error;
  return data as TransportAssignment | null;
}
export async function upsertTransportAssignment(
  payload: Partial<TransportAssignment> & { school_id: string; student_id: string }
) {
  const { data, error } = await supabase
    .from("transport_assignments")
    .upsert(payload, { onConflict: "student_id" })
    .select()
    .single();

  if (error) throw error;
  return data as TransportAssignment;
}
export async function deleteTransportAssignment(studentId: string) {
  const { error } = await supabase
    .from("transport_assignments")
    .delete()
    .eq("student_id", studentId);

  if (error) throw error;
}

// ============================================================
// Documents tab
// ============================================================

export async function getStudentDocuments(
  studentId: string,
  opts?: { page?: number; pageSize?: number }
) {
  const page = opts?.page ?? 0;
  const pageSize = opts?.pageSize ?? 20;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("student_documents")
    .select("*", { count: "exact" })
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { records: (data ?? []) as StudentDocument[], total: count ?? 0 };
}

const DOCUMENTS_BUCKET = "student-documents";

export async function uploadStudentDocument(
  file: File,
  studentId: string,
  schoolId: string,
  documentType: string
) {
  const filePath = `${studentId}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  // NOTE: student-documents is a PRIVATE bucket, so we don't use
  // getPublicUrl() here (it produces a URL that always 404s / errors
  // "Bucket not found" for private buckets). Instead we store the
  // storage PATH and generate a short-lived signed URL on demand
  // whenever the document needs to be previewed/downloaded — see
  // getStudentDocumentSignedUrl() below.
  const { data, error } = await supabase
    .from("student_documents")
    .insert({
      school_id: schoolId,
      student_id: studentId,
      document_type: documentType,
      document_name: file.name,
      file_url: filePath,
      verified: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data as StudentDocument;
}

/**
 * Generates a temporary signed URL for previewing/downloading a
 * private document. Call this right before opening the preview —
 * signed URLs expire, so don't store the result.
 */
export async function getStudentDocumentSignedUrl(
  filePath: string,
  expiresInSeconds = 60
) {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error) throw error;
  return data.signedUrl;
}

export async function deleteStudentDocument(id: string, filePath: string) {
  // filePath is now the raw storage path (e.g. "studentId/167890-file.jpg"),
  // stored directly in file_url — no need to parse a public URL anymore.
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  const { error } = await supabase
    .from("student_documents")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
// ============================================================
// Behaviour tab (+ Overview "Recent Behaviour Records" card)
// ============================================================

export async function getBehaviourRecords(
  studentId: string,
  opts?: { limit?: number; page?: number; pageSize?: number }
) {
  // Simple mode: just a limit (used by Overview "recent" card)
  if (opts?.limit !== undefined && opts.page === undefined) {
    const { data, error } = await supabase
      .from("behaviour_records")
      .select("*")
      .eq("student_id", studentId)
      .order("recorded_date", { ascending: false })
      .limit(opts.limit);

    if (error) throw error;
    return (data ?? []) as BehaviourRecord[];
  }

  // Paginated mode: used by the full Behaviour tab as records grow
  const page = opts?.page ?? 0;
  const pageSize = opts?.pageSize ?? 20;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from("behaviour_records")
    .select("*")
    .eq("student_id", studentId)
    .order("recorded_date", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return (data ?? []) as BehaviourRecord[];
}

export async function getBehaviourScore(studentId: string) {
  // Sum of points applied to a configurable baseline, clamped to min/max.
  const { data, error } = await supabase
    .from("behaviour_records")
    .select("points")
    .eq("student_id", studentId);

  if (error) throw error;
  const total = (data ?? []).reduce((sum, r) => sum + (r.points ?? 0), 0);
  const { baselineScore, minScore, maxScore } = APP_CONFIG.behaviour;
  return Math.max(minScore, Math.min(maxScore, baselineScore + total));
}

export async function createBehaviourRecord(
  payload: Omit<BehaviourRecord, "id"> & { school_id: string }
) {
  const { data, error } = await supabase
    .from("behaviour_records")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as BehaviourRecord;
}

export async function updateBehaviourRecord(id: string, payload: Partial<BehaviourRecord>) {
  const { data, error } = await supabase
    .from("behaviour_records")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as BehaviourRecord;
}

export async function deleteBehaviourRecord(id: string) {
  const { error } = await supabase
    .from("behaviour_records")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
// ============================================================
// Learning Support tab
// ============================================================

export async function getLearningSupportRecords(studentId: string) {
  const { data, error } = await supabase
    .from("learning_support")
    .select("*")
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });

  if (error) throw error;
  return (data ?? []) as LearningSupportRecord[];
}

export async function createLearningSupportRecord(
  payload: Omit<LearningSupportRecord, "id"> & { school_id: string }
) {
  const { data, error } = await supabase
    .from("learning_support")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as LearningSupportRecord;
}

export async function updateLearningSupportRecord(id: string, payload: Partial<LearningSupportRecord>) {
  const { data, error } = await supabase
    .from("learning_support")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as LearningSupportRecord;
}

export async function deleteLearningSupportRecord(id: string) {
  const { error } = await supabase
    .from("learning_support")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
// ============================================================
// Emergency Contacts tab
// ============================================================

export async function getEmergencyContacts(studentId: string) {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("*")
    .eq("student_id", studentId)
    .order("priority_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as EmergencyContact[];
}
export async function createEmergencyContact(
  payload: { school_id: string; student_id: string; full_name: string; relation: string; phone: string; priority_order: number }
) {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data as EmergencyContact;
}

export async function updateEmergencyContact(id: string, payload: Partial<EmergencyContact>) {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as EmergencyContact;
}

export async function deleteEmergencyContact(id: string) {
  const { error } = await supabase
    .from("emergency_contacts")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function getSiblingStudentIds(parentUserId: string, excludeStudentId: string) {
  const { data: links, error } = await supabase
    .from("parent_students")
    .select("student_id")
    .eq("parent_id", parentUserId);
  if (error) throw error;

  const profileIds = (links ?? []).map((l) => l.student_id);
  if (profileIds.length === 0) return [];

  const { data: students, error: err2 } = await supabase
    .from("students")
    .select("id, profile_id")
    .in("profile_id", profileIds);
  if (err2) throw err2;

  return (students ?? []).map((s) => s.id).filter((id) => id !== excludeStudentId);
}

export async function syncParentProfileAcrossSiblings(
  schoolId: string,
  parentUserId: string,
  sourceStudentId: string,
  parentData: { relation: string; full_name: string; occupation: string | null; phone: string | null; alternate_phone: string | null; email: string | null; whatsapp_number: string | null; address: string | null; is_primary_contact: boolean; pickup_authorized: boolean }
) {
  const siblingIds = await getSiblingStudentIds(parentUserId, sourceStudentId);

  for (const siblingId of siblingIds) {
    const { data: existing } = await supabase
      .from("parent_profiles")
      .select("id")
      .eq("student_id", siblingId)
      .eq("relation", parentData.relation)
      .maybeSingle();

    await supabase
      .from("parent_profiles")
      .upsert({
        ...(existing?.id ? { id: existing.id } : {}),
        school_id: schoolId,
        student_id: siblingId,
        ...parentData,
      });
  }
}

export async function syncEmergencyContactAcrossSiblings(
  schoolId: string,
  parentUserId: string,
  sourceStudentId: string,
  contactData: { relation: string; full_name: string; phone: string }
) {
  const siblingIds = await getSiblingStudentIds(parentUserId, sourceStudentId);

  for (const siblingId of siblingIds) {
    const { data: existing } = await supabase
      .from("emergency_contacts")
      .select("id")
      .eq("student_id", siblingId)
      .eq("relation", contactData.relation)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("emergency_contacts")
        .update({ full_name: contactData.full_name, phone: contactData.phone })
        .eq("id", existing.id);
    } else {
      const { count } = await supabase
        .from("emergency_contacts")
        .select("id", { count: "exact", head: true })
        .eq("student_id", siblingId);

      await supabase.from("emergency_contacts").insert({
        school_id: schoolId,
        student_id: siblingId,
        relation: contactData.relation,
        full_name: contactData.full_name,
        phone: contactData.phone,
        priority_order: (count ?? 0) + 1,
      });
    }
  }
}
// ============================================================
// Marks / GPA (Step 3 will add calculateGPA on top of this)
// ============================================================

export async function getStudentMarks(studentId: string, academicYear?: string) {
  let query = supabase
    .from("student_marks")
    .select("*")
    .eq("student_id", studentId);

  if (academicYear) {
    query = query.eq("academic_year", academicYear);
  }

  const { data, error } = await query.order("exam_date", { ascending: false });

  if (error) throw error;
  return (data ?? []) as StudentMark[];
}

/**
 * Converts a single percentage into grade points using
 * APP_CONFIG.gpa.bands. Edit the bands in APP_CONFIG to change
 * grading policy — no need to touch this function.
 */
function percentageToGradePoints(percent: number): number {
  const band = APP_CONFIG.gpa.bands.find((b) => percent >= b.minPercent);
  return band ? band.points : 0;
}

/**
 * Calculates GPA from all marks for a student (optionally scoped
 * to one academic year/term). Returns null if no marks exist yet,
 * so the UI can show "No data" instead of a misleading 0.00.
 */
export async function calculateGPA(
  studentId: string,
  opts?: { academicYear?: string; term?: string }
) {
  let query = supabase
    .from("student_marks")
    .select("marks_obtained, max_marks, subject")
    .eq("student_id", studentId);

  if (opts?.academicYear) query = query.eq("academic_year", opts.academicYear);
  if (opts?.term) query = query.eq("term", opts.term);

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const perSubject: Record<string, { obtained: number; max: number }> = {};
  for (const row of data) {
    const key = row.subject;
    if (!perSubject[key]) perSubject[key] = { obtained: 0, max: 0 };
    perSubject[key].obtained += Number(row.marks_obtained);
    perSubject[key].max += Number(row.max_marks);
  }

  const gradePoints = Object.values(perSubject).map(({ obtained, max }) =>
    percentageToGradePoints(max > 0 ? (obtained / max) * 100 : 0)
  );

  const gpa = gradePoints.reduce((sum, p) => sum + p, 0) / gradePoints.length;
  return Math.round(gpa * 100) / 100; // e.g. 3.85
}

/**
 * Per-subject breakdown — useful for the "strong in Science"
 * style AI insight and for a future subject-wise report view.
 */
export async function getSubjectPerformance(studentId: string, academicYear?: string) {
  let query = supabase
    .from("student_marks")
    .select("subject, marks_obtained, max_marks")
    .eq("student_id", studentId);

  if (academicYear) query = query.eq("academic_year", academicYear);

  const { data, error } = await query;
  if (error) throw error;

  const perSubject: Record<string, { obtained: number; max: number }> = {};
  for (const row of data ?? []) {
    const key = row.subject;
    if (!perSubject[key]) perSubject[key] = { obtained: 0, max: 0 };
    perSubject[key].obtained += Number(row.marks_obtained);
    perSubject[key].max += Number(row.max_marks);
  }

  return Object.entries(perSubject).map(([subject, { obtained, max }]) => ({
    subject,
    percentage: max > 0 ? Math.round((obtained / max) * 1000) / 10 : 0,
  }));
}

// ============================================================
// Attendance (stub — table is empty until attendance module is built)
// ============================================================

export async function getAttendanceRecords(studentId: string, months = 6) {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const { data, error } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("student_id", studentId)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as AttendanceRecord[];
}

export async function getAttendancePercentage(studentId: string) {
  const records = await getAttendanceRecords(studentId, 12);
  if (records.length === 0) return null; // no data yet — UI should show "No data"

  const countableStatuses = APP_CONFIG.attendance.countLateAsPresent
    ? ["present", "late"]
    : ["present"];

  const present = records.filter((r) => countableStatuses.includes(r.status)).length;
  return Math.round((present / records.length) * 1000) / 10;
}

// ============================================================
// AI Insights (Step 4 will add generateInsights on top of this)
// ============================================================

export async function getAIInsights(studentId: string) {
  const { data, error } = await supabase
    .from("ai_insights")
    .select("*")
    .eq("student_id", studentId)
    .eq("is_active", true)
    .order("generated_at", { ascending: false })
    .limit(APP_CONFIG.insights.maxActiveInsights);

  if (error) throw error;
  return (data ?? []) as AIInsight[];
}

// ============================================================
// Recent Assessments (Overview card) — reuses existing tables
// ============================================================

export async function getRecentAssessments(studentId: string, limit = 10) {
  const { data, error } = await supabase
    .from("student_assessments")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ============================================================
// One-shot loader for the whole Overview tab
// ============================================================

export async function getStudentOverview(studentId: string) {
  const [
    core,
    parentProfiles,
    behaviourRecords,
    behaviourScore,
    recentAssessments,
    attendancePercentage,
    attendanceRecords,
    aiInsights,
    gpa,
    subjectPerformance,
  ] = await Promise.all([
    getStudentCore(studentId),
    getParentProfiles(studentId),
    getBehaviourRecords(studentId, { limit: 5 }),
    getBehaviourScore(studentId),
    getRecentAssessments(studentId, 5),
    getAttendancePercentage(studentId),
    getAttendanceRecords(studentId, 6),
    getAIInsights(studentId),
    calculateGPA(studentId),
    getSubjectPerformance(studentId),
  ]);

  return {
    core,
    parentProfiles,
    behaviourRecords,
    behaviourScore,
    recentAssessments,
    attendancePercentage,
    attendanceRecords,
    aiInsights,
    gpa,
    subjectPerformance,
  };
}