import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Hourglass, AlertTriangle, TrendingDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, isPast } from "date-fns";
import { useForgettingForecast, useRetentionCurve } from "@/hooks/useForgettingCurve";
import { ForgettingCurveChart } from "@/components/mastery/ForgettingCurveChart";

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-800 border-emerald-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  hard: "bg-red-100 text-red-800 border-red-300",
};

export default function ForgettingForecast() {
  const { data: forecast, isLoading } = useForgettingForecast({ horizonDays: 14 });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const items = forecast ?? [];
  const atRisk = items.filter((i) => i.is_at_risk);
  const later = items.filter((i) => !i.is_at_risk);
  const selected = items.find((i) => i.learning_objective_id === selectedId) ?? items[0] ?? null;

  const { data: curve, isLoading: curveLoading } = useRetentionCurve(selected?.learning_objective_id);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Forgetting Forecast</h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Predicted from your review history — concepts here are on track to slip below 50% recall soon, even before their next scheduled review.
        </p>

        {isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </CardContent></Card>
        )}

        {!isLoading && items.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <TrendingDown className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
              <p className="font-medium">No prediction data yet</p>
              <p className="text-sm text-muted-foreground">
                This fills in once you've reviewed a few concepts through Daily Review or an adaptive test.
              </p>
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
              <ForecastRow key={item.learning_objective_id} item={item} selected={item.learning_objective_id === selected?.learning_objective_id} onClick={() => setSelectedId(item.learning_objective_id)} />
            ))}
          </div>
        )}

        {later.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Further out</h2>
            {later.map((item) => (
              <ForecastRow key={item.learning_objective_id} item={item} selected={item.learning_objective_id === selected?.learning_objective_id} onClick={() => setSelectedId(item.learning_objective_id)} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ForecastRow({ item, selected, onClick }: { item: { learning_objective_id: number; objective_text: string; topic_name: string; subject: string; retention_now: number; forgetting_date: string; is_at_risk: boolean }; selected: boolean; onClick: () => void }) {
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
