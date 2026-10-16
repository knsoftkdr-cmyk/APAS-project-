import { useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Hourglass, AlertTriangle, TrendingDown, ChevronRight, Sprout } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, isPast } from "date-fns";
import {
  useForgettingOverview, useRetentionCurve,
  type ForgettingForecastItem, type StillLearningItem,
} from "@/hooks/useForgettingCurve";
import { ForgettingCurveChart } from "@/components/mastery/ForgettingCurveChart";

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-800 border-emerald-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  hard: "bg-red-100 text-red-800 border-red-300",
};

export default function ForgettingForecast() {
  const { data, isLoading, isError, error, refetch } = useForgettingOverview({ horizonDays: 14 });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Only concepts the student has actually learned are forecast; the rest are listed separately below.
  const items = data?.forecast ?? [];
  const stillLearning = data?.stillLearning ?? [];
  const atRisk = items.filter((i) => i.is_at_risk);
  const later = items.filter((i) => !i.is_at_risk);
  const selected = items.find((i) => i.learning_objective_id === selectedId) ?? atRisk[0] ?? items[0] ?? null;

  const { data: curve, isLoading: curveLoading } = useRetentionCurve(selected?.learning_objective_id);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Forgetting Forecast</h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          For the concepts you've shown you know: how likely you are to still recall them, based on how well you know each one and
          how long it's been since you last practised. Concepts here are on track to slip below 50% recall soon — even before
          their next scheduled review.
        </p>

        {isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </CardContent></Card>
        )}

        {isError && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="font-medium">Couldn't load your forecast</p>
              <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Something went wrong."}</p>
              <Button variant="outline" onClick={() => refetch()}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <TrendingDown className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
              {stillLearning.length > 0 ? (
                <>
                  <p className="font-medium">Nothing to forecast yet</p>
                  <p className="text-sm text-muted-foreground">
                    A forecast starts once you've answered a concept correctly and shown you know it. Practise the
                    {" "}{stillLearning.length} concept{stillLearning.length === 1 ? "" : "s"} below and they'll appear here.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">No prediction data yet</p>
                  <p className="text-sm text-muted-foreground">
                    This fills in once you've answered questions on a few concepts in Daily Review, an adaptive test or an exam.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {selected && (
          <Card className="border-2">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
                <Badge variant="outline" className={cn("text-[11px]", DIFFICULTY_STYLES[selected.difficulty])}>
                  {selected.difficulty}
                </Badge>
                <span>{selected.subject} · {selected.chapter_name} · {selected.topic_name}</span>
              </div>
              <CardTitle className="text-base leading-relaxed">{selected.objective_text}</CardTitle>
            </CardHeader>
            <CardContent>
              {curveLoading ? <Skeleton className="h-[220px] w-full" /> : <ForgettingCurveChart curve={curve ?? null} />}
            </CardContent>
          </Card>
        )}

        {atRisk.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> At risk within 2 weeks
            </h2>
            {atRisk.map((item) => (
              <ForecastRow
                key={item.learning_objective_id}
                item={item}
                selected={item.learning_objective_id === selected?.learning_objective_id}
                onClick={() => setSelectedId(item.learning_objective_id)}
              />
            ))}
          </div>
        )}

        {later.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Further out</h2>
            {later.map((item) => (
              <ForecastRow
                key={item.learning_objective_id}
                item={item}
                selected={item.learning_objective_id === selected?.learning_objective_id}
                onClick={() => setSelectedId(item.learning_objective_id)}
              />
            ))}
          </div>
        )}

        {stillLearning.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <Sprout className="h-4 w-4 text-emerald-600" /> Still to learn
            </h2>
            <p className="text-xs text-muted-foreground">
              You haven't shown you know these yet, so there's nothing to forget — practise them to start a forecast.{" "}
              <Link to="/learning-path" className="text-primary underline underline-offset-2">Open your Learning Path</Link>
            </p>
            {stillLearning.map((item) => <StillLearningRow key={item.learning_objective_id} item={item} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ForecastRow({ item, selected, onClick }: { item: ForgettingForecastItem; selected: boolean; onClick: () => void }) {
  const alreadyPast = isPast(new Date(item.forgetting_date));
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{item.objective_text}</p>
        <p className="text-xs text-muted-foreground truncate">{item.subject} · {item.topic_name}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <p className={cn("text-sm font-semibold", item.is_at_risk ? "text-amber-600" : "text-muted-foreground")}>
            {Math.round(item.retention_now * 100)}%
          </p>
          <p className="text-[11px] text-muted-foreground">
            {alreadyPast ? "likely forgotten" : `~${formatDistanceToNow(new Date(item.forgetting_date))} left`}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  );
}

function StillLearningRow({ item }: { item: StillLearningItem }) {
  const missed = item.reason === "answered_incorrectly";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{item.objective_text}</p>
        <p className="text-xs text-muted-foreground truncate">{item.subject} · {item.topic_name}</p>
      </div>
      <div className="text-right shrink-0 space-y-1">
        <Badge
          variant="outline"
          className={cn("text-[11px]", missed ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200")}
        >
          {missed ? "Missed last time" : "Not mastered yet"}
        </Badge>
        <p className="text-[11px] text-muted-foreground">mastery {Math.round(item.p_mastery * 100)}%</p>
      </div>
    </div>
  );
}
