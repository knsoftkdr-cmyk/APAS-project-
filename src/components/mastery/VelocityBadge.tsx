import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import type { VelocityLabel, VelocityTrend } from "@/hooks/useLearningVelocity";

const LABEL_STYLES: Record<VelocityLabel, string> = {
  fast: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400",
  average: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400",
  slow: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400",
  insufficient_data: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400",
};

const LABEL_TEXT: Record<VelocityLabel, string> = {
  fast: "Fast pace",
  average: "Average pace",
  slow: "Slower pace",
  insufficient_data: "Not enough data",
};

/** Badge for a concept/topic/subject's learning-pace label (module 12). */
export function VelocityBadge({ label, className }: { label: VelocityLabel; className?: string }) {
  const key = LABEL_TEXT[label] ? label : "insufficient_data";
  return (
    <Badge variant="outline" className={cn("font-medium", LABEL_STYLES[key], className)}>
      {LABEL_TEXT[key]}
    </Badge>
  );
}

const TREND_ICON: Record<VelocityTrend, typeof TrendingUp> = {
  accelerating: TrendingUp,
  steady: Minus,
  slowing: TrendingDown,
  insufficient_data: HelpCircle,
};

const TREND_TEXT: Record<VelocityTrend, string> = {
  accelerating: "Speeding up",
  steady: "Steady pace",
  slowing: "Slowing down",
  insufficient_data: "Trend unclear yet",
};

const TREND_COLOR: Record<VelocityTrend, string> = {
  accelerating: "text-emerald-600 dark:text-emerald-400",
  steady: "text-blue-600 dark:text-blue-400",
  slowing: "text-amber-600 dark:text-amber-400",
  insufficient_data: "text-muted-foreground",
};

/** Small inline trend indicator (icon + label) for a concept's pace trend. */
export function VelocityTrendIndicator({ trend, className }: { trend: VelocityTrend; className?: string }) {
  const key = TREND_ICON[trend] ? trend : "insufficient_data";
  const Icon = TREND_ICON[key];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", TREND_COLOR[key], className)}>
      <Icon className="h-3 w-3" /> {TREND_TEXT[key]}
    </span>
  );
}
