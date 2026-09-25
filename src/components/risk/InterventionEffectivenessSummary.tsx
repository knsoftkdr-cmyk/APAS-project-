import { TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useInterventionEffectivenessSummary } from "@/hooks/useInterventionEffectiveness";

const TIER_LABEL: Record<number, string> = { 2: "Tier 2", 3: "Tier 3" };
const PRIORITY_LABEL: Record<string, string> = { low: "Low priority", medium: "Medium priority", high: "High priority" };

function pctColor(pct: number | null) {
  if (pct === null) return "text-slate-500";
  if (pct >= 60) return "text-emerald-600";
  if (pct >= 35) return "text-amber-600";
  return "text-red-600";
}

function barColor(pct: number | null) {
  if (pct === null) return "bg-slate-300";
  if (pct >= 60) return "bg-emerald-500";
  if (pct >= 35) return "bg-amber-500";
  return "bg-red-500";
}

/**
 * Module 15 (Intervention Effectiveness Tracking) - dashboard widget.
 * Shows, for the interventions this viewer can see (a teacher's own, or a
 * whole school for hod/principal/school_admin/admin), what fraction of
 * COMPLETED and MEASURED interventions actually improved the student's
 * outcome, plus a breakdown by action/tier/priority so it's clear which
 * kinds of interventions are working best.
 */
export function InterventionEffectivenessSummary({ classId, className }: { classId?: string; className?: string }) {
  const { data, isLoading } = useInterventionEffectivenessSummary(classId);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.total_completed === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Intervention Effectiveness</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          No completed interventions yet - once one is marked completed, its impact shows up here automatically.
        </CardContent>
      </Card>
    );
  }

  const measured = data.total_completed - data.unmeasured;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Intervention Effectiveness</span>
          {data.improved_pct !== null && (
            <span className={cn("text-base font-bold", pctColor(data.improved_pct))}>{data.improved_pct}% improved</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> {data.improved} improved</span>
          <span className="flex items-center gap-1"><Minus className="h-3.5 w-3.5 text-slate-400" /> {data.no_change} no change</span>
          <span className="flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-red-500" /> {data.worsened} worsened</span>
          {data.unmeasured > 0 && (
            <span className="flex items-center gap-1"><HelpCircle className="h-3.5 w-3.5" /> {data.unmeasured} unmeasured</span>
          )}
        </div>

        {measured === 0 ? (
          <p className="text-xs text-muted-foreground">
            {data.total_completed} completed intervention{data.total_completed > 1 ? "s" : ""}, but none had enough before/after data to judge impact yet.
          </p>
        ) : (
          <>
            {data.by_action.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">By action</p>
                {data.by_action.map((row) => (
                  <div key={row.action} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate">{row.action}</span>
                      <span className={cn("font-medium shrink-0 ml-2", pctColor(row.improved_pct))}>
                        {row.improved_pct}% ({row.improved}/{row.measured})
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className={cn("h-full rounded-full", barColor(row.improved_pct))} style={{ width: `${row.improved_pct ?? 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {data.by_tier.map((row) => (
                <Badge key={row.tier} variant="outline" className="text-[10px]">
                  {TIER_LABEL[row.tier]}: <span className={cn("ml-1 font-semibold", pctColor(row.improved_pct))}>{row.improved_pct}%</span>
                </Badge>
              ))}
              {data.by_priority.map((row) => (
                <Badge key={row.priority} variant="outline" className="text-[10px]">
                  {PRIORITY_LABEL[row.priority]}: <span className={cn("ml-1 font-semibold", pctColor(row.improved_pct))}>{row.improved_pct}%</span>
                </Badge>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
