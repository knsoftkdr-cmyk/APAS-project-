import { supabase } from "@/integrations/supabase/client";

export interface SchoolClassRow { id: string; name: string; section: string | null }

/**
 * The classes a principal / admin / HOD / school-admin may see: ONLY their own school's.
 * Backed by the my_school_classes() database function (migration 20261010000000), which
 * works out the school from the signed-in user, so it can't be asked for another school.
 *
 * Fails closed: if nothing can be loaded this returns [] instead of every school's classes.
 */
export async function fetchSchoolClasses(schoolId?: string | null): Promise<SchoolClassRow[]> {
  // deno-lint-ignore no-explicit-any
  const { data, error } = await (supabase as any).rpc("my_school_classes");
  if (!error) return (data ?? []) as SchoolClassRow[];

  console.error("my_school_classes failed — has migration 20261010000000 been applied?", error.message);
  if (!schoolId) return [];
  // Until the migration is applied: classes explicitly stamped with this school.
  // deno-lint-ignore no-explicit-any
  const { data: fallback, error: fbError } = await (supabase as any)
    .from("classes").select("id, name, section").eq("school_id", schoolId).order("name");
  return fbError ? [] : ((fallback ?? []) as SchoolClassRow[]);
}
