// The student's own Engagement Score (student dashboard).
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMyEngagement } from "@/lib/engagement";
import { ActivityBars, CategoryBadge, CategoryLegend, DeltaBadge, ScoreRing, TrendChart, periodText } from "./EngagementParts";

export default function StudentEngagementCard() {
  const q = useQuery({ queryKey: ["engagement", "me"], queryFn: () => fetchMyEngagement(), staleTime: 60_000 });

  return (
    <Card className="relative overflow-hidden border-blue-100 shadow-sm" data-testid="engagement-card">
      <div className="h-1 bg-gradient-to-r from-blue-950 via-blue-800 to-amber-400" />
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base md:text-lg font-semibold text-blue-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-900 to-blue-700 shadow-sm"><Sparkles className="h-4 w-4 text-amber-300" /></span>
            My Engagement Score
          </h2>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-slate-500" onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Refresh engagement score">
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {q.isLoading ? (
          <div className="mt-4 flex gap-6"><Skeleton className="h-32 w-32 rounded-full" /><div className="flex-1 space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div></div>
        ) : q.isError ? (
          <p className="mt-4 text-sm text-red-600">{(q.error as Error).message}</p>
        ) : !q.data?.score ? (
          <p className="mt-4 text-sm text-slate-500">Your score will appear here once you have some learning activity.</p>
        ) : (
          <div className="mt-4 grid gap-6 md:grid-cols-[auto,1fr]">
            <div className="flex flex-col items-center gap-2 md:items-start">
              <ScoreRing score={q.data.score.score} category={q.data.score.category} />
              <CategoryBadge category={q.data.score.category} />
              {q.data.score.status === "ok" && <DeltaBadge delta={q.data.score.delta} trend={q.data.score.trend} declining={q.data.score.declining} />}
              <p className="text-[11px] text-slate-400">Based on your {periodText(q.data.score)}</p>
            </div>

            <div className="min-w-0 space-y-4">
              {q.data.score.status === "insufficient" || !q.data.score.activities ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <b>Not enough data yet.</b> There have not been enough videos, quizzes, assignments or live classes for your class
                  in the last {q.data.score.window_days} days to give a fair score. It will appear automatically as activities are assigned.
                </div>
              ) : (
                <>
                  <ActivityBars activities={q.data.score.activities} />
                  {q.data.score.tips.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800"><Lightbulb className="h-3.5 w-3.5" /> How to improve</p>
                      <ul className="space-y-1 text-xs text-amber-900">{q.data.score.tips.map((t) => <li key={t.key}>• {t.text}</li>)}</ul>
                    </div>
                  )}
                </>
              )}
              {q.data.history.length > 1 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">My trend</p>
                  <TrendChart data={q.data.history.map((h) => ({ date: h.date, value: h.score }))} height={120} ariaLabel="My engagement trend" />
                </div>
              )}
              <CategoryLegend />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
