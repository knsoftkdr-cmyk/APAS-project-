import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types matching get-intervention-effectiveness-summary's response (module 15) ──

export type EffectivenessVerdict = "improved" | "no_change" | "worsened" | "insufficient_data";

export interface EffectivenessBreakdownRow {
  measured: number;
  improved: number;
  improved_pct: number | null;
}

export interface ActionEffectivenessRow extends EffectivenessBreakdownRow {
  action: string;
  no_change: number;
  worsened: number;
}

export interface TierEffectivenessRow extends EffectivenessBreakdownRow {
  tier: 2 | 3;
}

export interface PriorityEffectivenessRow extends EffectivenessBreakdownRow {
  priority: "low" | "medium" | "high";
}

export interface InterventionEffectivenessSummary {
  scope: "teacher" | "school";
  class_id: string | null;
  total_completed: number;
  improved: number;
  no_change: number;
  worsened: number;
  unmeasured: number;
  improved_pct: number | null;
  by_action: ActionEffectivenessRow[];
  by_tier: TierEffectivenessRow[];
  by_priority: PriorityEffectivenessRow[];
  generated_at: string;
}

// A teacher gets their own interventions; hod/principal/school_admin/admin
// get a school-wide view. Either can narrow to a single class.
export function useInterventionEffectivenessSummary(classId?: string) {
  return useQuery<InterventionEffectivenessSummary>({
    queryKey: ["intervention-effectiveness-summary", classId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-intervention-effectiveness-summary", {
        body: { class_id: classId },
      });
      if (error) throw error;
      return data as InterventionEffectivenessSummary;
    },
    staleTime: 60 * 1000,
  });
}

// ── Per-metric labels/deltas the effectiveness_detail jsonb column carries ──

export interface EffectivenessDeltas {
  avg_mastery_delta?: number;
  correctness_rate_14d_delta?: number;
  risk_signal_count_delta?: number;
  attempts_14d_delta?: number;
}

export interface EffectivenessDetail {
  verdict: EffectivenessVerdict;
  signals_compared: number;
  votes: number;
  deltas: EffectivenessDeltas;
}
