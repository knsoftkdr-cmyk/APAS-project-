import { supabase } from "@/integrations/supabase/client";

/**
 * Loads what every ERP page needs about the signed-in user: erp_access, school_id and the school name.
 *
 * Two plain queries instead of `profiles.select("..., schools(name)")`: an embedded select depends on the API
 * finding exactly ONE relationship between profiles and schools, and fails (and used to bounce the user to
 * /dashboard) as soon as any other table creates a second path between them.
 * The real error is logged so a failure is visible in the browser console instead of a silent redirect.
 */
export async function fetchErpProfile(userId: string) {
  const db = supabase as any;
  const { data, error } = await db
    .from("profiles")
    .select("erp_access, school_id")
    .eq("id", userId)
    .single();

  if (error || !data) {
    console.error("[ERP] could not load profile:", error);
    return { data: null, error: error ?? new Error("Profile not found") };
  }

  let schoolName: string | null = null;
  if (data.school_id) {
    const { data: school, error: schoolError } = await db
      .from("schools")
      .select("name")
      .eq("id", data.school_id)
      .maybeSingle();
    if (schoolError) console.warn("[ERP] could not load school name:", schoolError);
    schoolName = school?.name ?? null;
  }

  return {
    data: {
      erp_access: data.erp_access as boolean | null,
      school_id: data.school_id as string | null,
      schools: schoolName ? { name: schoolName } : null,
    },
    error: null,
  };
}
