import { Flame, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AccuracyBars, WeekTrendChart } from "@/components/dpp/DppCharts";
import { friendlyDppError, percentTone, TONE_CLASS } from "@/lib/dpp";
import { useDppParentOverview } from "@/hooks/useDpp";

/** Daily Practice progress for one linked child. The database refuses any child not linked to the signed-in parent. */
export function ParentDppCard({ childId }: { childId: string | null }) {
  const q = useDppParentOverview(childId);
  if (!childId) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" />Daily Practice</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading && <Skeleton className="h-40 w-full" />}
        {q.error && <p className="text-sm text-red-600">{friendlyDppError(q.error)}</p>}
        {q.data && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="gap-1"><Flame className="h-3 w-3 text-orange-500" />{q.data.streak.current}-day streak</Badge>
              <Badge variant="outline">{q.data.totals.attempts} sets completed</Badge>
              <Badge variant="outline" className={TONE_CLASS[percentTone(q.data.totals.attempts ? q.data.totals.avg_percent : null)]}>avg {Math.round(q.data.totals.avg_percent)}%</Badge>
              <Badge variant="outline" className={q.data.pending_count ? "border-amber-400 text-amber-700" : ""}>{q.data.pending_count} pending</Badge>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div><p className="mb-1 text-sm font-medium">This week</p><WeekTrendChart data={q.data.week} /></div>
              <div><p className="mb-1 text-sm font-medium">Accuracy by subject</p><AccuracyBars data={q.data.by_subject} nameKey="subject" /></div>
            </div>
            {q.data.improve.length > 0 && (
              <div><p className="mb-1 text-sm font-medium">Areas to improve</p>
                {q.data.improve.map((i) => <p key={i.subject + i.chapter} className="text-sm text-muted-foreground">{i.subject} · {i.chapter} - {i.accuracy}% correct</p>)}</div>
            )}
            <div>
              <p className="mb-1 text-sm font-medium">Assigned in the last 2 weeks</p>
              {q.data.assigned.length === 0 && <p className="text-sm text-muted-foreground">Nothing assigned yet.</p>}
              <div className="space-y-1">
                {q.data.assigned.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span>{a.title} <span className="text-muted-foreground">· {a.subject} · {a.questions} questions · {a.assigned_for}</span></span>
                    {a.status === "submitted" && a.percent != null
                      ? <Badge variant="outline" className={TONE_CLASS[percentTone(a.percent)]}>{Math.round(a.percent)}%</Badge>
                      : <Badge variant="outline">{a.status === "in_progress" ? "in progress" : "pending"}</Badge>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
