// src/components/teacher/AIClassBriefingCard.tsx
// AI class briefing (sheet row 41): today's classes, outstanding work and learning issues in one card.
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, BookOpen, ClipboardCheck, ListChecks, RefreshCw, Sparkles, UserCheck, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClassBriefing } from "@/hooks/useClassBriefing";
import { toast } from "sonner";

export function AIClassBriefingCard() {
  const { data, isLoading, error, refresh, refreshing } = useClassBriefing();

  const onRefresh = async () => {
    try { await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not refresh the briefing"); }
  };

  return (
    <Card className="border border-indigo-200/70 bg-gradient-to-br from-indigo-50/70 via-background to-background">
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center"><Sparkles className="h-4 w-4" /></div>
            <div>
              <h2 className="font-semibold leading-tight">AI Class Briefing</h2>
              <p className="text-xs text-muted-foreground">
                {data ? `${data.source === "ai" ? "AI summary" : "Quick summary"} · updated ${new Date(data.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Your day at a glance"}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={refreshing || isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">Couldn't load the briefing: {error instanceof Error ? error.message : "unknown error"}</p>
        ) : data ? (
          <>
            <p className="text-base md:text-lg font-medium text-foreground">{data.headline}</p>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Stat icon={UserCheck} label="Attendance to mark" value={data.outstanding.attendance_unmarked} to="/attendance" />
              <Stat icon={ClipboardCheck} label="Homework to grade" value={data.outstanding.submissions_to_grade} to="/analytics" />
              <Stat icon={BookOpen} label="Exam answers to review" value={data.outstanding.exam_attempts_to_review} to="/exam-reviews" />
              <Stat icon={ListChecks} label="Homework due soon" value={data.outstanding.homework_due_soon} to="/classroom" />
              <Stat icon={AlertTriangle} label="Students at risk" value={data.outstanding.at_risk} to="/teacher-at-risk" />
            </div>

            {data.priorities.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Do first</p>
                <ol className="space-y-1 text-sm list-decimal pl-5">
                  {data.priorities.map((p, i) => <li key={i}>{p}</li>)}
                </ol>
              </div>
            )}

            {data.classes.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Your classes</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {data.classes.map((c) => (
                    <Link key={c.class_id} to={`/classroom?class=${c.class_id}`} className="rounded-lg border bg-background p-3 hover:border-indigo-300 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-indigo-600" />{c.label}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{c.summary}</p>
                      {c.focus && <p className="text-xs mt-1.5 text-indigo-700">💡 {c.focus}</p>}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {data.learning_issues.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Learning issues</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.learning_issues.map((t, i) => <Badge key={i} variant="secondary" className="font-normal text-left whitespace-normal">{t}</Badge>)}
                </div>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, to }: { icon: typeof Users; label: string; value: number; to: string }) {
  return (
    <Link to={to} className="rounded-lg border bg-background px-3 py-2 hover:border-indigo-300 transition-colors">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className={`text-xl font-semibold ${value ? "text-foreground" : "text-muted-foreground"}`}>{value}</div>
    </Link>
  );
}
