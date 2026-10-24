import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileSearch, Loader2, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/i18n/LanguageContext";
import { normaliseTutorLanguage } from "@/lib/tutorLanguages";
import { getMyChildren, type ChildOption } from "@/lib/appointments";
import {
  DAY_OPTIONS,
  requestEvidenceReport,
  type EvidenceObjective,
  type EvidenceReport,
} from "@/lib/masteryEvidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CHANGE_STYLE: Record<EvidenceObjective["direction"], string> = {
  up: "bg-emerald-50 text-emerald-700 border-emerald-200",
  down: "bg-red-50 text-red-700 border-red-200",
  flat: "bg-slate-50 text-slate-700 border-slate-200",
};

const changeText = (o: EvidenceObjective) => {
  if (o.direction === "up") return `Up ${o.change_pts} points`;
  if (o.direction === "down") return `Down ${Math.abs(o.change_pts)} points`;
  return "About the same";
};

const DirectionIcon = ({ direction }: { direction: EvidenceObjective["direction"] }) => {
  if (direction === "up") return <ArrowUpRight className="h-4 w-4" aria-hidden="true" />;
  if (direction === "down") return <ArrowDownRight className="h-4 w-4" aria-hidden="true" />;
  return <ArrowRight className="h-4 w-4" aria-hidden="true" />;
};

export default function LearningEvidenceReport() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const isParent = profile?.role === "parent";

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [childrenLoaded, setChildrenLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<EvidenceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Parents: load their children first.
  useEffect(() => {
    if (!isParent || !profile?.id) return;
    let cancelled = false;
    getMyChildren(profile.id)
      .then((kids) => {
        if (cancelled) return;
        setChildren(kids);
        setSelectedId((current) => (kids.some((k) => k.studentId === current) ? current : kids[0]?.studentId ?? ""));
      })
      .catch((e) => {
        console.error("Failed to load children for learning evidence:", e);
        if (!cancelled) setError("Couldn't load your children's details. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setChildrenLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isParent, profile?.id]);

  // Load the facts (no AI) whenever the child or the number of days changes.
  useEffect(() => {
    if (!profile?.id) return;
    if (isParent && !selectedId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    requestEvidenceReport({ studentProfileId: isParent ? selectedId : undefined, days })
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((e) => {
        if (cancelled) return;
        setReport(null);
        setError(e instanceof Error ? e.message : "Couldn't load the learning evidence. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, isParent, selectedId, days, attempt]);

  const explainWithAi = async () => {
    setExplaining(true);
    try {
      const result = await requestEvidenceReport({
        studentProfileId: isParent ? selectedId : undefined,
        days,
        explain: true,
        language: normaliseTutorLanguage(language),
      });
      setReport(result);
      if (result.ai.status !== "ok") toast.error("The AI explanation isn't available right now. The facts below are still correct.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't get the AI explanation. Please try again.");
    } finally {
      setExplaining(false);
    }
  };

  const selectedChild = children.find((c) => c.studentId === selectedId);
  const waitingForChildren = isParent && !childrenLoaded;
  const noChildren = isParent && childrenLoaded && children.length === 0;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <FileSearch className="h-6 w-6 text-primary" aria-hidden="true" /> Learning evidence
          </h1>
          <p className="mt-1 text-muted-foreground">
            See why the mastery estimate for each topic went up or down, based on the answers behind it.
          </p>
        </div>

        {isParent && children.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a child">
            {children.map((child) => (
              <Button
                key={child.studentId}
                size="sm"
                variant={child.studentId === selectedId ? "default" : "outline"}
                aria-pressed={child.studentId === selectedId}
                onClick={() => setSelectedId(child.studentId)}
              >
                {child.fullName}
              </Button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time period">
          <span className="text-sm text-muted-foreground">Show the last</span>
          {DAY_OPTIONS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === days ? "default" : "outline"}
              aria-pressed={option === days}
              onClick={() => setDays(option)}
            >
              {option} days
            </Button>
          ))}
        </div>

        {(waitingForChildren || loading) && (
          <div className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the learning evidence
          </div>
        )}

        {noChildren && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No children are linked to your account yet. Ask the school office to link your child, then come back here.
            </CardContent>
          </Card>
        )}

        {error && !loading && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {report && !loading && !error && (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {isParent && selectedChild ? `${selectedChild.fullName}: ` : ""}
              {report.overall.attempts === 0
                ? `No answers were recorded in the last ${report.window_days} days.`
                : `${report.overall.attempts} answers in the last ${report.window_days} days, ${report.overall.accuracy_pct}% correct, across ${report.overall.objectives} topic${report.overall.objectives === 1 ? "" : "s"}.`}
            </p>

            {report.objectives.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={explainWithAi} disabled={explaining} variant="outline">
                  {explaining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Explain in simple words (AI)
                </Button>
                <span className="text-xs text-muted-foreground">The facts below are always from the answers. The AI only rewords them.</span>
              </div>
            )}

            {report.truncated && (
              <p className="text-xs text-muted-foreground">
                There are a lot of answers in this period, so only the most recent ones are used.
              </p>
            )}

            <div className="space-y-4">
              {report.objectives.map((o) => (
                <Card key={o.objective_id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{o.objective_text}</CardTitle>
                      <Badge variant="outline" className={`flex shrink-0 items-center gap-1 ${CHANGE_STYLE[o.direction]}`}>
                        <DirectionIcon direction={o.direction} />
                        {changeText(o)}
                      </Badge>
                    </div>
                    <CardDescription>
                      From {o.start_pct}% to {o.end_pct}% after {o.attempts} answer{o.attempts === 1 ? "" : "s"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="relative h-2 w-full rounded-full bg-muted" role="img" aria-label={`Mastery ${o.end_pct}%, it was ${o.start_pct}%`}>
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${o.end_pct}%` }} />
                      <div className="absolute top-[-3px] h-3.5 w-0.5 bg-foreground/60" style={{ left: `${o.start_pct}%` }} aria-hidden="true" />
                    </div>

                    <div className="flex flex-wrap items-center gap-1" aria-label="Latest answers, oldest first">
                      <span className="mr-1 text-xs text-muted-foreground">Latest answers:</span>
                      {o.recent.map((isCorrect, index) => (
                        <span
                          key={index}
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                            isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          }`}
                          title={isCorrect ? "Correct" : "Wrong"}
                        >
                          {isCorrect ? "✓" : "✗"}
                        </span>
                      ))}
                    </div>

                    <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                      {o.reasons.map((reason, index) => (
                        <li key={index}>{reason}</li>
                      ))}
                    </ul>

                    {o.ai_summary && (
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                        <p className="font-medium text-foreground">In simple words</p>
                        <p className="text-muted-foreground">{o.ai_summary}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {report.ai.status === "ok" && (
              <p className="text-xs text-muted-foreground">
                The "In simple words" text is made by AI from the facts above. It can make mistakes, so check with your teacher if something looks wrong.
              </p>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
