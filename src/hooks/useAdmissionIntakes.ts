import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AdmissionIntake } from "@/types/admission";

export interface IntakeFormInput {
  academic_year: string;
  grade: string;
  total_seats: number;
  min_percentage_required?: number | null;
  criteria_notes?: string | null;
  is_open?: boolean;
  opens_on?: string | null;
  closes_on?: string | null;
}

export function useAdmissionIntakes() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;

  const [intakes, setIntakes] = useState<AdmissionIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIntakes = useCallback(async () => {
    if (!schoolId) {
      setIntakes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [{ data: intakeRows, error: intakeErr }, { data: seatRows, error: seatErr }] = await Promise.all([
      supabase
        .from("admission_intakes")
        .select("*")
        .eq("school_id", schoolId)
        .order("academic_year", { ascending: false })
        .order("grade", { ascending: true }),
      supabase
        .from("admission_intake_seat_summary")
        .select("*")
        .eq("school_id", schoolId),
    ]);

    if (intakeErr) {
      setError(intakeErr.message);
      setIntakes([]);
      setLoading(false);
      return;
    }
    if (seatErr) {
      // Seat summary is a nice-to-have; don't block the page on it.
      console.error("Failed to load seat summary:", seatErr);
    }

    const seatMap = new Map((seatRows ?? []).map((r: any) => [r.intake_id, r]));
    const merged: AdmissionIntake[] = (intakeRows ?? []).map((row: any) => {
      const seats = seatMap.get(row.id);
      return {
        ...row,
        seats_filled: seats?.seats_filled ?? 0,
        seats_remaining: seats?.seats_remaining ?? row.total_seats,
        applicants_pending_review: seats?.applicants_pending_review ?? 0,
      };
    });

    setIntakes(merged);
    setLoading(false);
  }, [schoolId]);

  useEffect(() => {
    fetchIntakes();
  }, [fetchIntakes]);

  const createIntake = useCallback(
    async (input: IntakeFormInput) => {
      if (!schoolId) return { error: "No school on your profile." };
      const { error } = await supabase.from("admission_intakes").insert({
        school_id: schoolId,
        created_by: profile?.id ?? null,
        ...input,
      });
      if (!error) await fetchIntakes();
      return { error: error?.message ?? null };
    },
    [schoolId, profile?.id, fetchIntakes]
  );

  const updateIntake = useCallback(
    async (id: string, patch: Partial<IntakeFormInput>) => {
      const { error } = await supabase.from("admission_intakes").update(patch).eq("id", id);
      if (!error) await fetchIntakes();
      return { error: error?.message ?? null };
    },
    [fetchIntakes]
  );

  const toggleIntakeOpen = useCallback(
    async (id: string, isOpen: boolean) => {
      return updateIntake(id, { is_open: isOpen });
    },
    [updateIntake]
  );

  return { intakes, loading, error, refetch: fetchIntakes, createIntake, updateIntake, toggleIntakeOpen };
}
