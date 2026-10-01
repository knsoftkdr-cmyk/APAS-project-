import { supabase } from "@/integrations/supabase/client";

export interface ClassOption { id: string; label: string; name: string }
export interface BookOption { id: number; subject: string | null; class_name: string | null }
export interface SubjectOption { bookId: number; subject: string }

const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12",
};

/** "Class 4", "class 4", "Grade 4", "4", "4th", "IV" -> "4", so classes.name and books.class_name compare reliably. */
export function classKey(raw?: string | null): string {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/\b(class|grade|std|standard)\b\.?/g, "")
    .replace(/\s+/g, "")
    .replace(/^(\d+)(st|nd|rd|th)$/, "$1");
  return ROMAN[s] ?? s;
}

const subjectKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Classes the user can work with: every class for staff/admins, assigned classes for teachers. */
export async function fetchClassOptions(profile?: { id?: string; role?: string } | null): Promise<ClassOption[]> {
  const isStaffAdmin = ["admin", "principal", "school_admin", "hod"].includes(profile?.role ?? "");
  if (isStaffAdmin) {
    const { data } = await supabase.from("classes").select("id, name, section");
    // deno-lint-ignore no-explicit-any
    return ((data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, label: `${c.name}${c.section ? " - " + c.section : ""}` }));
  }
  const { data } = await supabase.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", profile?.id ?? "");
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[])
    .filter((c) => c.classes)
    .map((c) => ({ id: c.classes.id, name: c.classes.name, label: `${c.classes.name}${c.classes.section ? " - " + c.classes.section : ""}` }));
}

/** Loads every active book for the school, paging past the 1000-row API limit. */
export async function fetchSchoolBooks(schoolId?: string | null): Promise<BookOption[]> {
  const out: BookOption[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("id").range(from, from + page - 1);
    if (schoolId) q = q.eq("school_id", schoolId);
    const { data, error } = await q;
    if (error || !data) break;
    out.push(...(data as BookOption[]));
    if (data.length < page) break;
  }
  return out;
}

/** How much curriculum a book has (topics weigh most), used to pick between duplicate books of one subject. */
async function curriculumScore(bookId: number): Promise<number> {
  const { data: units } = await supabase.from("units").select("id").eq("book_id", bookId);
  const unitIds = (units ?? []).map((u) => u.id as number);
  const chapterIds: number[] = [];
  for (const ids of chunk(unitIds, 30)) {
    const { data } = await supabase.from("curriculum_chapters").select("id").in("unit_id", ids);
    chapterIds.push(...(data ?? []).map((c) => c.id as number));
  }
  let topics = 0;
  for (const ids of chunk(chapterIds, 30)) {
    const { count } = await supabase.from("topics").select("id", { count: "exact", head: true }).in("chapter_id", ids);
    topics += count ?? 0;
  }
  return topics * 1000 + chapterIds.length;
}

/** One subject entry per subject taught in the class; duplicates resolve to the book with the most curriculum. */
export async function resolveSubjectsForClass(books: BookOption[], selectedClassKey: string): Promise<SubjectOption[]> {
  const groups = new Map<string, { subject: string; ids: number[] }>();
  for (const b of books) {
    if (!b.subject || classKey(b.class_name) !== selectedClassKey) continue;
    const k = subjectKey(b.subject);
    const g = groups.get(k) ?? { subject: b.subject.trim(), ids: [] };
    g.ids.push(b.id);
    groups.set(k, g);
  }
  const picked: SubjectOption[] = [];
  for (const g of groups.values()) {
    let bookId = Math.min(...g.ids);
    if (g.ids.length > 1) {
      let best = -1;
      for (const id of g.ids) {
        let score = 0;
        try { score = await curriculumScore(id); } catch { /* unreadable book scores 0 */ }
        if (score > best) { best = score; bookId = id; }
      }
    }
    picked.push({ bookId, subject: g.subject });
  }
  return picked.sort((a, b) => a.subject.localeCompare(b.subject));
}