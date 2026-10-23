import { supabase } from "@/integrations/supabase/client";
import {
  isConsentCategory,
  type ConsentCategory,
  type ConsentHistoryEntry,
  type ConsentRecord,
  type ConsentStatus,
} from "@/lib/consentModel";

// The consent tables come from supabase/migrations/20261025000000_parent_consent_center.sql and are not in the
// generated Supabase types yet, so the client is cast here (same approach as other newer features).
const db = supabase as any;

/** Saved decisions for the signed-in parent. Row-level security limits this to the parent's own rows. */
export async function loadConsents(studentIds: string[]): Promise<ConsentRecord[]> {
  if (studentIds.length === 0) return [];
  const { data, error } = await db
    .from("parent_consents")
    .select("student_id, category, status, updated_at")
    .in("student_id", studentIds);
  if (error) throw error;
  return ((data ?? []) as ConsentRecord[]).filter((r) => isConsentCategory(r.category));
}

/** Change history (written by a database trigger, read-only for the parent). */
export async function loadConsentHistory(studentIds: string[]): Promise<ConsentHistoryEntry[]> {
  if (studentIds.length === 0) return [];
  const { data, error } = await db
    .from("parent_consent_history")
    .select("id, student_id, category, old_status, new_status, changed_at")
    .in("student_id", studentIds)
    .order("changed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as ConsentHistoryEntry[]).filter((e) => isConsentCategory(e.category));
}

/** Save one decision. A second save for the same child + category updates the existing row. */
export async function saveConsent(
  parentId: string,
  studentId: string,
  category: ConsentCategory,
  status: Exclude<ConsentStatus, "pending">,
): Promise<void> {
  const { error } = await db
    .from("parent_consents")
    .upsert(
      { parent_id: parentId, student_id: studentId, category, status, updated_at: new Date().toISOString() },
      { onConflict: "parent_id,student_id,category" },
    );
  if (error) throw error;
}
