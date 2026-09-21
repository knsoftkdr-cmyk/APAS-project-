import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  mastered: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400",
  proficient: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400",
  developing: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400",
  beginning: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400",
  not_assessed: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400",
};

const STATUS_LABELS: Record<string, string> = {
  mastered: "Mastered",
  proficient: "Proficient",
  developing: "Developing",
  beginning: "Needs work",
  not_assessed: "Not assessed",
};

/** Maps a raw P(mastery) probability to the same status buckets the DB uses. */
export function masteryStatusFromScore(pMastery: number, attempted = true): keyof typeof STATUS_LABELS {
  if (!attempted) return "not_assessed";
  if (pMastery >= 0.85) return "mastered";
  if (pMastery >= 0.6) return "proficient";
  if (pMastery >= 0.35) return "developing";
  return "beginning";
}

export function MasteryBadge({ status, className }: { status: string; className?: string }) {
  const key = STATUS_LABELS[status] ? status : "not_assessed";
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_STYLES[key], className)}>
      {STATUS_LABELS[key]}
    </Badge>
  );
}
