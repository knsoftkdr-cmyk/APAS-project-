import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OverallRiskLevel, RiskCauseType } from "@/hooks/useStudentRisk";

const LEVEL_STYLES: Record<OverallRiskLevel, string> = {
  high: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400",
  insufficient_data: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400",
};

const LEVEL_TEXT: Record<OverallRiskLevel, string> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
  insufficient_data: "Not enough data",
};

/** Badge for a student's overall composite early-warning risk level (module 13). */
export function RiskBadge({ level, className }: { level: OverallRiskLevel; className?: string }) {
  const key = LEVEL_TEXT[level] ? level : "insufficient_data";
  return (
    <Badge variant="outline" className={cn("font-medium", LEVEL_STYLES[key], className)}>
      {LEVEL_TEXT[key]}
    </Badge>
  );
}

export const CAUSE_LABELS: Record<RiskCauseType, string> = {
  academic_decline: "Academic decline",
  disengagement: "Disengagement",
  stalled_progress: "Stalled progress",
  chronic_absenteeism: "Chronic absenteeism",
};
