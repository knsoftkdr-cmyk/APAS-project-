// Supabase calls for Automatic Fee Plan Assignment. Reads of structures go through RLS; every write to assignments / history is a
// SECURITY DEFINER database function that re-checks the caller, so nothing here can bypass school isolation or permissions.
// (The generated Supabase types do not cover the new tables yet, hence the single `db` cast - same as instalmentApi.ts.)
import { supabase } from "@/integrations/supabase/client";
import type { FeeAssignmentView, FeeHistoryEntry, FeeLines, FeeStructure, InstalmentTemplateRow } from "@/lib/feePlan";
import { friendlyFeeError } from "@/lib/feePlan";

const db = supabase as any;

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyFeeError(error.message));
  return data as T;
}

const num = (v: unknown) => Number(v) || 0;
const normStructure = (r: any): FeeStructure => ({
  ...r,
  admission_fee: num(r.admission_fee), tuition_fee: num(r.tuition_fee), transport_fee: num(r.transport_fee), uniform_fee: num(r.uniform_fee),
  material_fee: num(r.material_fee), exam_fee: num(r.exam_fee), other_fee: num(r.other_fee), total_fee: num(r.total_fee),
});

// ───────────── fee structures ─────────────
export const listFeeStructures = async (schoolId: string) =>
  (await unwrap<any[]>(db.from("fee_structures").select("*").eq("school_id", schoolId).order("academic_year", { ascending: false }).order("class_grade"))).map(normStructure);

export interface FeeStructureInput extends FeeLines {
  id?: string;
  school_id: string;
  name: string;
  academic_year: string;
  class_grade: string;
  category: string | null;
  due_date: string | null;
  instalment_schedule: InstalmentTemplateRow[] | null;
  notes: string | null;
  is_active: boolean;
}

export async function saveFeeStructure(input: FeeStructureInput): Promise<void> {
  const { id, ...row } = input;
  if (id) await unwrap(db.from("fee_structures").update(row).eq("id", id));
  else await unwrap(db.from("fee_structures").insert(row));
}
export const setFeeStructureActive = (id: string, isActive: boolean) => unwrap(db.from("fee_structures").update({ is_active: isActive }).eq("id", id));
export const deleteFeeStructure = (id: string) => unwrap(db.from("fee_structures").delete().eq("id", id));

// ───────────── assignments ─────────────
const normAssignment = (r: any): FeeAssignmentView => ({
  ...r,
  admission_fee: num(r.admission_fee), tuition_fee: num(r.tuition_fee), transport_fee: num(r.transport_fee), uniform_fee: num(r.uniform_fee),
  material_fee: num(r.material_fee), exam_fee: num(r.exam_fee), other_fee: num(r.other_fee), gross_total: num(r.gross_total),
  concession_amount: num(r.concession_amount), net_total: num(r.net_total), paid: num(r.paid), outstanding: num(r.outstanding),
});

export const listFeeAssignments = async (schoolId: string) =>
  (await unwrap<any[]>(db.rpc("list_fee_assignments", { p_school: schoolId }))).map(normAssignment);

export interface UnassignedApplicant { applicant_id: string; full_name: string; grade: string; academic_year: string; category: string | null }
export const listUnassignedAdmitted = (schoolId: string) => unwrap<UnassignedApplicant[]>(db.rpc("fee_unassigned_admitted", { p_school: schoolId }));

export interface ApplicantFeePlan {
  applicant_status: string; class_grade: string; academic_year: string; category: string | null;
  assignment: FeeAssignmentView | null; history: FeeHistoryEntry[];
}
export async function getApplicantFeePlan(applicantId: string): Promise<ApplicantFeePlan> {
  const r = await unwrap<any>(db.rpc("get_applicant_fee_plan", { p_applicant: applicantId }));
  return { ...r, assignment: r.assignment ? normAssignment(r.assignment) : null, history: r.history ?? [] };
}

export async function getStudentFeePlan(studentId: string): Promise<{ plans: FeeAssignmentView[]; history: FeeHistoryEntry[] }> {
  const r = await unwrap<any>(db.rpc("get_student_fee_plan", { p_student: studentId }));
  return { plans: (r.plans ?? []).map(normAssignment), history: r.history ?? [] };
}

export interface AssignPlanArgs {
  applicantId: string;
  structureId: string | null;
  /** null = use the structure's amounts as they are; an object = custom amounts */
  lines: FeeLines | null;
  concession: number;
  concessionReason: string;
  reason: string;
  dueDate: string | null;
}
export const assignFeePlan = (a: AssignPlanArgs) =>
  unwrap<string>(db.rpc("fee_assign_manual", {
    p_applicant: a.applicantId, p_structure: a.structureId, p_lines: a.lines, p_concession: a.concession,
    p_concession_reason: a.concessionReason.trim() || null, p_reason: a.reason.trim() || null, p_due_date: a.dueDate || null,
  }));

export const cancelFeePlan = (assignmentId: string, reason: string) => unwrap<null>(db.rpc("fee_assignment_cancel", { p_assignment: assignmentId, p_reason: reason }));
export const linkFeePlanStudent = (assignmentId: string, studentId: string) => unwrap<null>(db.rpc("fee_assignment_link_student", { p_assignment: assignmentId, p_student: studentId }));
export const resolveUnmatchedPlans = (schoolId: string, includeUnassigned: boolean) =>
  unwrap<{ assigned: number; still_unmatched: number; failed: number }>(db.rpc("fee_resolve_unmatched", { p_school: schoolId, p_include_unassigned: includeUnassigned }));
export const createInstalmentsFromPlan = (assignmentId: string) => unwrap<string>(db.rpc("fee_assignment_create_instalments", { p_assignment: assignmentId }));

export interface LinkableStudent { id: string; full_name: string; class: string | null; section: string | null }
export const listStudentsForLinking = async (schoolId: string) =>
  unwrap<LinkableStudent[]>(db.from("students").select("id, full_name, class, section").eq("school_id", schoolId).order("full_name"));
