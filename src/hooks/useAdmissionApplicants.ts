import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AdmissionApplicant, ApplicantStatus } from "@/types/admission";

export interface ApplicantFormInput {
  intake_id: string;
  full_name: string;
  date_of_birth?: string | null;
  gender?: string | null;
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
  address?: string | null;
  previous_school_name?: string | null;
  previous_grade?: string | null;
  previous_percentage?: number | null;
  sibling_studying_here?: boolean;
  distance_from_school_km?: number | null;
  category?: string | null;
  source?: string;
  meeting_date?: string;
  meeting_notes?: string | null;
}

export interface ApplicantFilters {
  intakeId?: string | "all";
  status?: ApplicantStatus | "all";
  search?: string;
  minPercentage?: number | null;
  sortBy?: "previous_percentage" | "priority_score" | "meeting_date" | "created_at";
  sortDirection?: "asc" | "desc";
}

export function useAdmissionApplicants(filters: ApplicantFilters) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;

  const [applicants, setApplicants] = useState<AdmissionApplicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApplicants = useCallback(async () => {
    if (!schoolId) {
      setApplicants([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    let query = supabase
      .from("admission_applicants")
      .select("*, intake:admission_intakes(id, grade, academic_year, total_seats), documents:admission_documents(count)")
      .eq("school_id", schoolId);

    if (filters.intakeId && filters.intakeId !== "all") {
      query = query.eq("intake_id", filters.intakeId);
    }
    if (filters.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }
    if (filters.minPercentage != null) {
      query = query.gte("previous_percentage", filters.minPercentage);
    }
    if (filters.search) {
      const term = filters.search.trim();
      if (term) {
        query = query.or(`full_name.ilike.%${term}%,parent_name.ilike.%${term}%,parent_phone.ilike.%${term}%`);
      }
    }

    const sortBy = filters.sortBy ?? "created_at";
    const sortDirection = filters.sortDirection ?? "desc";
    query = query.order(sortBy, { ascending: sortDirection === "asc", nullsFirst: false });

    const { data, error: fetchErr } = await query;

    if (fetchErr) {
      setError(fetchErr.message);
      setApplicants([]);
    } else {
      setApplicants((data ?? []) as unknown as AdmissionApplicant[]);
    }
    setLoading(false);
  }, [schoolId, filters.intakeId, filters.status, filters.minPercentage, filters.search, filters.sortBy, filters.sortDirection]);

  useEffect(() => {
    fetchApplicants();
  }, [fetchApplicants]);

  const addApplicant = useCallback(
    async (input: ApplicantFormInput) => {
      if (!schoolId || !profile?.id) return { error: "No school on your profile.", id: null };
      const { data, error } = await supabase
        .from("admission_applicants")
        .insert({
          ...input,
          recorded_by: profile.id,
        })
        .select("id")
        .single();
      if (!error) await fetchApplicants();
      return { error: error?.message ?? null, id: data?.id ?? null };
    },
    [schoolId, profile?.id, fetchApplicants]
  );

  const updateApplicant = useCallback(
    async (id: string, patch: Partial<ApplicantFormInput>) => {
      const { error } = await supabase.from("admission_applicants").update(patch).eq("id", id);
      if (!error) await fetchApplicants();
      return { error: error?.message ?? null };
    },
    [fetchApplicants]
  );

  const decideApplicant = useCallback(
    async (id: string, status: ApplicantStatus, decisionNotes?: string) => {
      if (!profile?.id) return { error: "Not signed in." };
      const { error } = await supabase
        .from("admission_applicants")
        .update({
          status,
          decision_notes: decisionNotes ?? null,
          decided_by: profile.id,
          decided_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (!error) await fetchApplicants();
      return { error: error?.message ?? null };
    },
    [profile?.id, fetchApplicants]
  );

  return { applicants, loading, error, refetch: fetchApplicants, addApplicant, updateApplicant, decideApplicant };
}
