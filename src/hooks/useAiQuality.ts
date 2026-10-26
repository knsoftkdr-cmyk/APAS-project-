// src/hooks/useAiQuality.ts
// AI quality and safety control (sheet row 40). Data: ai-hooks { action: "quality_evaluate" | "quality_list" | "quality_review" }
// - see supabase/functions/_shared/handlers/aiQualityControl.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFn } from "@/hooks/useExamIntelligence";

export const QUALITY_DIMENSIONS = [
  { key: "hallucination", label: "Accuracy (no hallucination)" },
  { key: "bias", label: "Bias-free" },
  { key: "alignment", label: "Content alignment" },
  { key: "privacy", label: "Privacy" },
  { key: "age_suitability", label: "Age suitability" },
] as const;
export type QualityDimension = typeof QUALITY_DIMENSIONS[number]["key"];
export type Verdict = "pass" | "warn" | "block";

export interface QualityIssue { dimension: QualityDimension; severity: "low" | "medium" | "high"; detail: string }
export interface QualityEvaluation {
  id: string; source: string; content_excerpt: string; grade_band: string | null; subject: string | null;
  score_hallucination: number | null; score_bias: number | null; score_alignment: number | null; score_privacy: number | null; score_age_suitability: number | null;
  overall_score: number | null; verdict: Verdict; issues: QualityIssue[]; evaluator_model: string | null;
  reviewed_at: string | null; review_note: string | null; created_at: string;
}
export interface QualityList {
  rows: QualityEvaluation[];
  summary: { total: number; by_verdict: Record<Verdict, number>; averages: Record<QualityDimension, number | null>; sources: string[]; days: number };
}
export interface EvaluateResult { id: string | null; verdict: Verdict; overall: number | null; scores: Record<QualityDimension, number> | null; issues: QualityIssue[]; model: string | null }

export function useQualityList(filters: { verdict?: string; source?: string; days: number }) {
  return useQuery({
    queryKey: ["ai-quality", filters],
    queryFn: () => invokeFn<QualityList>("ai-hooks", {
      action: "quality_list", days: filters.days,
      verdict: filters.verdict && filters.verdict !== "all" ? filters.verdict : undefined,
      source: filters.source && filters.source !== "all" ? filters.source : undefined,
    }),
    staleTime: 30 * 1000,
  });
}

export function useEvaluateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { content: string; question?: string; reference?: string; grade_band?: string; subject?: string }) =>
      invokeFn<EvaluateResult>("ai-hooks", { action: "quality_evaluate", ...args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-quality"] }),
  });
}

export function useReviewEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; note?: string }) => invokeFn<{ ok: true }>("ai-hooks", { action: "quality_review", ...args }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-quality"] }),
  });
}
