import { supabase } from "@/integrations/supabase/client";
import type { SheetChild, SheetConsent, SheetLink, SheetParent } from "@/lib/consentSheetModel";

// Read-only. Starts from the school's own students, then finds their parents and saved consents.
// The consent tables are not in the generated Supabase types, so the client is cast (same as consentCenter.ts).
const db = supabase as any;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ConsentSheetData {
  children: SheetChild[];
  links: SheetLink[];
  parents: SheetParent[];
  consents: SheetConsent[];
}

export async function loadConsentSheet(schoolId: string): Promise<ConsentSheetData> {
  // 1. Children of this school. students.profile_id is the child's profiles.id (same id parent_students uses).
  const { data: studentRows, error: studentError } = await db
    .from("students")
    .select("profile_id, full_name, class, section")
    .eq("school_id", schoolId);
  if (studentError) throw studentError;

  const children: SheetChild[] = ((studentRows ?? []) as any[])
    .filter((s) => s.profile_id)
    .map((s) => ({
      studentId: s.profile_id,
      fullName: s.full_name ?? "Unknown child",
      className: s.class ?? "",
      section: s.section ?? "",
    }));
  const childIds = children.map((c) => c.studentId);
  if (childIds.length === 0) return { children, links: [], parents: [], consents: [] };

  // 2. Parent-child links and saved consents, only for those children.
  const links: SheetLink[] = [];
  const consents: SheetConsent[] = [];
  for (const ids of chunk(childIds, 100)) {
    const { data: linkRows, error: linkError } = await db
      .from("parent_students")
      .select("parent_id, student_id")
      .in("student_id", ids);
    if (linkError) throw linkError;
    for (const l of (linkRows ?? []) as any[]) links.push({ parentId: l.parent_id, studentId: l.student_id });

    const { data: consentRows, error: consentError } = await db
      .from("parent_consents")
      .select("parent_id, student_id, category, status")
      .in("student_id", ids);
    if (consentError) throw consentError;
    for (const c of (consentRows ?? []) as any[]) consents.push(c as SheetConsent);
  }

  // 3. Parent names.
  const parentIds = Array.from(new Set(links.map((l) => l.parentId)));
  const parents: SheetParent[] = [];
  for (const ids of chunk(parentIds, 100)) {
    const { data: parentRows, error: parentError } = await db.from("profiles").select("id, full_name").in("id", ids);
    if (parentError) throw parentError;
    for (const p of (parentRows ?? []) as any[]) parents.push({ id: p.id, fullName: p.full_name ?? "" });
  }

  return { children, links, parents, consents };
}