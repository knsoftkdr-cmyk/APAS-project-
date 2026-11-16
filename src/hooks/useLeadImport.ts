// Data access for CRM lead import/export. Leads are admission_applicants rows, read and written through the same table
// (and therefore the same RLS) as the Admissions screen. Only the import log is new.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sb } from "@/hooks/useCourseStructure";
import { useAuth } from "@/contexts/AuthContext";
import { safeUpdatePatch, type ExistingLead, type LeadPayload } from "@/lib/leadImport";

export interface ExistingLeadFull extends ExistingLead {
  parent_name: string | null; parent_email: string | null; gender: string | null; previous_school_name: string | null;
  previous_grade: string | null; address: string | null; meeting_notes: string | null;
}

/** All leads of the user's school (paged past the 1000-row API limit) for duplicate checks. */
export async function fetchExistingLeads(schoolId: string): Promise<ExistingLeadFull[]> {
  const out: ExistingLeadFull[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("admission_applicants")
      .select("id, intake_id, full_name, parent_phone, date_of_birth, parent_name, parent_email, gender, previous_school_name, previous_grade, address, meeting_notes")
      .eq("school_id", schoolId)
      .order("id")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as ExistingLeadFull[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export interface ImportOutcome {
  imported: number; updated: number;
  failed: { rowNum: number; message: string }[];
}

const friendlyDbError = (m: string) =>
  /row-level security|permission denied/i.test(m) ? "Not allowed to add leads for this school" :
  /duplicate key|unique/i.test(m) ? "Already exists" :
  /violates check|invalid input/i.test(m) ? "A value was rejected by the database" : m.slice(0, 160);

/** Inserts in batches of 100. A batch is all-or-nothing; if one fails it is retried row by row so a single bad row
 *  can't block the rest, and every failure is reported with its row number. Updates are per-row, fill-empty-only. */
export async function executeLeadImport(args: {
  userId: string; schoolId: string;
  inserts: { rowNum: number; payload: LeadPayload }[];
  updates: { rowNum: number; existing: ExistingLeadFull; payload: LeadPayload }[];
  onProgress: (done: number, total: number) => void;
}): Promise<ImportOutcome> {
  const { userId, schoolId, inserts, updates, onProgress } = args;
  const total = inserts.length + updates.length;
  let done = 0;
  const out: ImportOutcome = { imported: 0, updated: 0, failed: [] };
  const tick = (n: number) => { done += n; onProgress(done, total); };

  const BATCH = 100;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const chunk = inserts.slice(i, i + BATCH);
    const { error } = await supabase.from("admission_applicants").insert(chunk.map((c) => ({ ...c.payload, recorded_by: userId })));
    if (!error) { out.imported += chunk.length; tick(chunk.length); continue; }
    for (const c of chunk) {
      const { error: e1 } = await supabase.from("admission_applicants").insert({ ...c.payload, recorded_by: userId });
      if (e1) out.failed.push({ rowNum: c.rowNum, message: friendlyDbError(e1.message) }); else out.imported += 1;
      tick(1);
    }
  }
  for (const u of updates) {
    const patch = safeUpdatePatch(u.existing as unknown as Record<string, unknown>, u.payload);
    if (Object.keys(patch).length === 0) { tick(1); continue; }
    const { error } = await supabase.from("admission_applicants").update(patch as never).eq("id", u.existing.id).eq("school_id", schoolId);
    if (error) out.failed.push({ rowNum: u.rowNum, message: friendlyDbError(error.message) }); else out.updated += 1;
    tick(1);
  }
  return out;
}

export interface ImportJobRow {
  id: string; file_name: string; duplicate_mode: string; total_rows: number; imported_count: number; updated_count: number;
  skipped_duplicates: number; invalid_count: number; failed_count: number; status: string; error_report: { row: number; message: string }[];
  created_at: string; importer?: { full_name: string | null } | null;
}

export async function recordImportJob(job: Omit<ImportJobRow, "id" | "created_at" | "importer"> & { school_id: string; imported_by: string }) {
  const { error } = await sb.from("admission_import_jobs").insert({ ...job, error_report: job.error_report.slice(0, 500) });
  return error?.message ?? null;
}

export function useImportHistory(enabled: boolean) {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["lead-import-history", profile?.school_id], enabled: enabled && !!profile?.school_id,
    queryFn: async () => {
      const { data, error } = await sb.from("admission_import_jobs")
        .select("id, file_name, duplicate_mode, total_rows, imported_count, updated_count, skipped_duplicates, invalid_count, failed_count, status, error_report, created_at, importer:imported_by(full_name)")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as (Omit<ImportJobRow, "importer"> & { importer?: { full_name: string | null } | { full_name: string | null }[] | null })[]).map((j) => ({
        ...j, importer: Array.isArray(j.importer) ? (j.importer[0] ?? null) : (j.importer ?? null),
      })) as ImportJobRow[];
    },
  });
}
