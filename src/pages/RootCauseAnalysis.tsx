import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Stethoscope, BookX, GraduationCap, Gauge, Lightbulb, CalendarX,
  CheckCircle2, HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRootCauseAnalysis, type CauseType, type EvidenceStrength } from "@/hooks/useRootCauseAnalysis";

const CAUSE_META: Record<CauseType, { label: string; icon: typeof BookX }> = {
  practice_deficiency: { label: "Not Enough Practice", icon: Gauge },
  prerequisite_gap: { label: "Prerequisite Gap", icon: BookX },
  difficulty_mismatch: { label: "Difficulty Mismatch", icon: GraduationCap },
  misconception: { label: "Misconception", icon: Lightbulb },
  attendance: { label: "Attendance", icon: CalendarX },
};

const STRENGTH_STYLES: Record<EvidenceStrength, string> = {
  strong: "bg-red-100 text-red-800 border-red-300",
  moderate: "bg-amber-100 text-amber-800 border-amber-300",
  none: "bg-emerald-100 text-emerald-800 border-emerald-300",
  unavailable: "bg-muted text-muted-foreground border-border",
};

const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  strong: "Likely factor",
  moderate: "Possible factor",
  none: "Ruled out",
  unavailable: "Unavailable",
};

export default function RootCauseAnalysis() {
  const [searchParams] = useSearchParams();
  const loParam = searchParams.get("lo");
  const learningObjectiveId = loParam ? Number(loParam) : undefined;

  const { data, isLoading, error } = useRootCauseAnalysis(learningObjectiveId);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Why is this hard?</h1>
        </div>

        {!learningObjectiveId && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <HelpCircle className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
              <p className="font-medium">No concept selected</p>
              <p className="text-sm text-muted-foreground">
                Open this from a weak spot in your mastery view or forgetting forecast to see a breakdown.
              </p>
            </CardContent>
          </Card>
        )}

        {learningObjectiveId && isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </CardContent></Card>
        )}

        {learningObjectiveId && error && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">{error.message}</CardContent></Card>
        )}

        {data && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <div className="text-xs text-muted-foreground mb-1">{data.subject} · {data.chapter_name} · {data.topic_name}</div>
                <CardTitle className="text-base leading-relaxed">{data.objective_text}</CardTitle>
              </CardHeader>
              {data.primary_cause ? (
                <CardContent>
                  <div className="flex items-start gap-3 bg-muted/50 rounded-lg p-3">
                    {(() => {
                      const meta = CAUSE_META[data.primary_cause.cause_type];
                      return <meta.icon className="h-5 w-5 text-primary shrink-0 mt-0.5" />;
                    })()}
                    <div>
                      <p className="text-sm font-semibold">
                        Most likely: {CAUSE_META[data.primary_cause.cause_type].label}
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">{data.primary_cause.explanation}</p>
                    </div>
                  </div>
                </CardContent>
              ) : (
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    No single factor stands out — likely just needs more practice reps.
                  </div>
                </CardContent>
              )}
            </Card>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Full breakdown</h2>
              {data.causes.map((c) => {
                const meta = CAUSE_META[c.cause_type];
                return (
                  <Card key={c.cause_type}>
                    <CardContent className="p-4 flex items-start gap-3">
                      <meta.icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-medium">{meta.label}</span>
                          <Badge variant="outline" className={cn("text-[11px]", STRENGTH_STYLES[c.evidence_strength])}>
                            {STRENGTH_LABEL[c.evidence_strength]}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{c.explanation}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
