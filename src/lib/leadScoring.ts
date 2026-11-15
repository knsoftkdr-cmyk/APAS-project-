// Client-side helpers for lead scores. The score itself is calculated in Postgres
// (supabase/migrations/20261114000000_admission_lead_scoring.sql); nothing here computes one.

export type LeadCategory = "hot" | "warm" | "cold";
export type FactorKey = "interest" | "engagement" | "readiness" | "budget";

export interface ScoreSignal { key: string; label: string; score: number; weight: number; detail: string }
export interface ScoreFactor {
  label: string;
  weight: number;                // configured weight (default 30/25/25/20)
  available: boolean;            // false = no evidence yet -> excluded from the total, never counted as zero
  score: number | null;          // 0-100 for this factor
  contribution?: number | null;  // points this factor adds to the final score (they sum to the total)
  signals: ScoreSignal[];
}
export interface LeadScore {
  applicant_id: string;
  computed_score: number;
  override_score: number | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
  score: number;
  category: LeadCategory;
  coverage: number;              // % of the weight backed by real data
  factors: Record<FactorKey, ScoreFactor>;
  calculated_at: string;
  score_changed_at: string;
}
export interface ScoreHistoryRow {
  id: string;
  change_type: "auto" | "manual_override" | "manual_clear";
  trigger_source: string | null;
  old_score: number | null;
  new_score: number;
  old_category: LeadCategory | null;
  new_category: LeadCategory;
  computed_score: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}
export interface LeadQualification {
  interest_level: "high" | "medium" | "low" | null;
  interested_course: string | null;
  annual_budget: number | null;
  fee_affordability: "comfortable" | "manageable" | "stretch" | "unaffordable" | null;
  admission_timeline: "immediate" | "this_term" | "next_term" | "next_year" | "exploring" | null;
}

export const FACTOR_ORDER: FactorKey[] = ["interest", "engagement", "readiness", "budget"];
export const DEFAULT_THRESHOLDS = { hot: 70, warm: 40 };

/** Same rule as the database (adm_score_category); used only to preview an adjustment before it is saved. */
export function scoreCategory(score: number, t: { hot: number; warm: number } = DEFAULT_THRESHOLDS): LeadCategory {
  return score >= t.hot ? "hot" : score >= t.warm ? "warm" : "cold";
}

export const CATEGORY_LABELS: Record<LeadCategory, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const CATEGORY_RANGES: Record<LeadCategory, string> = { hot: "70–100", warm: "40–69", cold: "0–39" };
// Colour is never the only cue: every chip also carries an icon and the word.
export const CATEGORY_TONES: Record<LeadCategory, { chip: string; bar: string; ring: string }> = {
  hot: { chip: "bg-red-50 text-red-700 border-red-200", bar: "bg-red-500", ring: "text-red-600" },
  warm: { chip: "bg-amber-50 text-amber-700 border-amber-200", bar: "bg-amber-500", ring: "text-amber-600" },
  cold: { chip: "bg-sky-50 text-sky-700 border-sky-200", bar: "bg-sky-500", ring: "text-sky-600" },
};

export const INTERACTION_TYPES = [
  { value: "call_answered", label: "Call answered" },
  { value: "call_not_answered", label: "Call not answered" },
  { value: "message_sent", label: "Message / email sent" },
  { value: "message_replied", label: "Parent replied" },
  { value: "visit_scheduled", label: "Campus visit scheduled" },
  { value: "visit_completed", label: "Campus visit completed" },
  { value: "visit_missed", label: "Campus visit missed" },
  { value: "follow_up_note", label: "Follow-up note" },
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number]["value"];

export const INTEREST_LEVELS = [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }];
export const AFFORDABILITY = [
  { value: "comfortable", label: "Comfortable" }, { value: "manageable", label: "Manageable" },
  { value: "stretch", label: "A stretch" }, { value: "unaffordable", label: "Unaffordable" },
];
export const TIMELINES = [
  { value: "immediate", label: "Immediately" }, { value: "this_term", label: "This term" }, { value: "next_term", label: "Next term" },
  { value: "next_year", label: "Next academic year" }, { value: "exploring", label: "Just exploring" },
];

export const TRIGGER_LABELS: Record<string, string> = {
  applicant_created: "Lead created", applicant_updated: "Lead details changed", documents_changed: "Documents changed",
  interaction_logged: "Interaction logged", enquiry_updated: "Repeat enquiry", qualification_updated: "Budget / timeline updated",
  intake_fee_changed: "Intake fee changed", scheduled_refresh: "Daily refresh", config_changed: "Scoring settings changed",
  backfill: "Initial calculation", before_manual_change: "Recalculated",
};
