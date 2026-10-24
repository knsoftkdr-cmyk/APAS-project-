// src/lib/masteryEvidence.ts
//
// Browser side of "AI learning evidence report" (feature 38). Calls cat-session, action "mastery_evidence"
// (server: supabase/functions/_shared/handlers/masteryEvidenceReport.ts). Keep the response shape in sync
// with supabase/functions/_shared/masteryEvidenceModel.ts.

import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export type EvidenceDirection = "up" | "down" | "flat";

export interface EvidenceObjective {
  objective_id: number;
  objective_text: string;
  start_pct: number;
  end_pct: number;
  change_pts: number;
  direction: EvidenceDirection;
  attempts: number;
  correct: number;
  wrong: number;
  best_run: number;
  trailing_wrong: number;
  recent: boolean[];
  last_at: string;
  reasons: string[];
  ai_summary: string | null;
}

export interface EvidenceReport {
  window_days: number;
  overall: { attempts: number; correct: number; accuracy_pct: number; objectives: number };
  objectives: EvidenceObjective[];
  truncated: boolean;
  ai: { status: "not_requested" | "ok" | "unavailable"; model?: string };
}

export const DAY_OPTIONS = [7, 30, 90] as const;

export async function requestEvidenceReport(args: {
  studentProfileId?: string;
  days: number;
  explain?: boolean;
  language?: string;
}): Promise<EvidenceReport> {
  const { data, error } = await supabase.functions.invoke("cat-session", {
    body: {
      action: "mastery_evidence",
      student_profile_id: args.studentProfileId,
      days: args.days,
      explain: args.explain === true,
      language: args.language,
    },
  });
  if (error) {
    const { message } = await unwrapFunctionError(error, "Couldn't load the learning evidence. Please try again.");
    throw new Error(message);
  }
  const report = data as EvidenceReport | null;
  if (!report || !Array.isArray(report.objectives)) throw new Error("Couldn't load the learning evidence. Please try again.");
  return report;
}
