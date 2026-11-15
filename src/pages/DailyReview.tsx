import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RotateCw, CheckCircle2, XCircle, ChevronRight, Trophy, Loader2,
  Flame, CalendarClock, Clock3, AlarmClock, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useDueReviews, useAnswerReview, useSnoozeReview, useReviewForecast,
  type AnswerScoring, type DueReview, type ReviewForecast, type ScoringRules, type SessionScore,
} from "@/hooks/useSpacedRepetition";
import { useAuth } from "@/contexts/AuthContext";
import { ScoringRulesTabs } from "@/components/dailyreview/ScoringRulesTabs";
import { AnswerMarks, RulesBanner, SessionResults, type ResultItem } from "@/components/dailyreview/MarksDisplay";
import { DEFAULT_RULES, summarizeSession, formatMarks } from "../../supabase/functions/_shared/dailyReviewScoring";

type Phase = "loading" | "error" | "empty" | "review" | "feedback" | "done";

const DIFFICULTY_STYLES: Record<DueReview["difficulty"], string> = {
  easy: "bg-emerald-100 text-emerald-800 border-emerald-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  hard: "bg-red-100 text-red-800 border-red-300",
};

/** "in 35 min" / "in 5 hours" / "in 3 days (Fri, 17 Oct)" */
function formatWhen(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  const date = new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `in ${days} day${days === 1 ? "" : "s"} (${date})`;
}

const SCORING_ADMIN_ROLES = ["principal"];
const newSessionId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `dr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/**
 * Students get their review queue. The principal opens the same Daily Review screen to set its marking rules
 * (negative marking) - they have no queue of their own, so the student queries are never fired for them.
 */
export default function DailyReview({ embedded = false }: { embedded?: boolean } = {}) {
  const { profile } = useAuth();
  if (profile?.role && SCORING_ADMIN_ROLES.includes(profile.role)) {
    return (
      <PageShell embedded={embedded}>
        <div className="max-w-2xl mx-auto p-4">
          <ScoringRulesTabs active="daily" />
        </div>
      </PageShell>
    );
  }
  return <StudentDailyReview embedded={embedded} />;
}

function StudentDailyReview({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: queueData, isLoading, isError, error, isFetching, refetch } = useDueReviews({ limit: 20 });
  const { data: forecast } = useReviewForecast();
  const answerReview = useAnswerReview();
  const snoozeReview = useSnoozeReview();

  // The queue for THIS session is frozen when it first loads. Answering a review reschedules it, so the
  // live query drops that item as soon as it refetches - if the screen followed the live list, the
  // question under the student would be swapped for the next one while its feedback was still showing,
  // and every "Next" would then skip an item. Waiting for !isFetching means a stale cached list from an
  // earlier visit is never used.
  const [session, setSession] = useState<DueReview[] | null>(null);
  useEffect(() => {
    if (session === null && queueData && !isFetching) {
      setSession(queueData.reviews ?? []);
      setSessionRules(queueData.scoring ?? DEFAULT_RULES);   // frozen with the queue: the rules can't change under a student mid-session
    }
  }, [queueData, isFetching, session]);

  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [feedback, setFeedback] = useState<Awaited<ReturnType<typeof answerReview.mutateAsync>> | null>(null);
  const [sessionStats, setSessionStats] = useState({ answered: 0, correct: 0 });
  const [checking, setChecking] = useState(false);

  // Negative marking (Daily Review only). Marks come from the server per answer; this just keeps them for the summary.
  const sessionId = useRef(newSessionId());
  const [sessionRules, setSessionRules] = useState<ScoringRules>(DEFAULT_RULES);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [lastSession, setLastSession] = useState<SessionScore | null>(null);

  const reviews = session ?? [];
  const current = reviews[index];

  const phase: Phase = isError && session === null
    ? "error"
    : isLoading || session === null
    ? "loading"
    : reviews.length === 0
    ? "empty"
    : index >= reviews.length
    ? "done"
    : feedback
    ? "feedback"
    : "review";

  const submitting = answerReview.isPending;

  const handleSubmit = async () => {
    if (!current || !selectedOption) return;
    try {
      const result = await answerReview.mutateAsync({
        scheduleId: current.schedule_id,
        learningObjectiveId: current.learning_objective_id,
        itemId: current.item.item_id,
        selectedOption,
        sessionId: sessionId.current,
        sessionTotal: reviews.length,
      });
      setFeedback(result);
      const sc = result.scoring;
      setResults((r) => [...r, {
        key: current.schedule_id, stem: current.item.stem, outcome: result.is_correct ? "correct" : "wrong",
        selected: selectedOption, correctOption: result.correct_option, topic: current.topic_name,
        marks: sc?.enabled && sc.counted ? sc.marks ?? 0 : null,
      }]);
      if (sc?.session) setLastSession(sc.session);
      setSessionStats((s) => ({ answered: s.answered + 1, correct: s.correct + (result.is_correct ? 1 : 0) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't grade that answer.");
    }
  };

  const handleContinue = () => {
    setFeedback(null);
    setSelectedOption(null);
    setIndex((i) => i + 1);
  };

  const handleSnooze = async () => {
    if (!current) return;
    try {
      await snoozeReview.mutateAsync({
        learningObjectiveId: current.learning_objective_id, days: 1, scheduleId: current.schedule_id, sessionId: sessionId.current,
      });
      setResults((r) => [...r, { key: current.schedule_id, stem: current.item.stem, outcome: "skipped", marks: sessionRules.enabled ? 0 : null, topic: current.topic_name }]);
      toast.success("Pushed to tomorrow.");
      setSelectedOption(null); // don't carry a half-made choice over to the next question
      setIndex((i) => i + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't snooze that review.");
    }
  };

  const handleCheckForMore = async () => {
    setChecking(true);
    try {
      const r = await refetch();
      if (r.isError || !r.data) throw r.error ?? new Error("Couldn't check for more reviews.");
      setSession(r.data.reviews ?? []);
      setSessionRules(r.data.scoring ?? DEFAULT_RULES);
      sessionId.current = newSessionId();                      // a new sitting is scored on its own
      setResults([]);
      setLastSession(null);
      setIndex(0);
      setFeedback(null);
      setSelectedOption(null);
      setSessionStats({ answered: 0, correct: 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check for more reviews.");
    } finally {
      setChecking(false);
    }
  };

  const progressPct = reviews.length > 0 ? Math.round((Math.min(index, reviews.length) / reviews.length) * 100) : 0;

  return (
    <PageShell embedded={embedded}>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <RotateCw className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Daily Review</h1>
        </div>

        {forecast && phase !== "review" && phase !== "feedback" && (
          <ForecastStrip forecast={forecast} />
        )}

        {phase === "loading" && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </CardContent></Card>
        )}

        {phase === "error" && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="font-medium">Couldn't load your reviews</p>
              <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Something went wrong."}</p>
              <Button variant="outline" onClick={() => refetch()}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {phase === "empty" && <EmptyState forecast={forecast} />}

        {(phase === "review" || phase === "feedback") && current && (
          <>
            <RulesBanner rules={sessionRules} />
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Review {Math.min(index + 1, reviews.length)} of {reviews.length}</span>
                  <span>
                    {sessionStats.correct}/{sessionStats.answered} correct so far
                    {sessionRules.enabled && lastSession ? ` · score ${formatMarks(lastSession.net)}` : ""}
                  </span>
                </div>
                <Progress value={progressPct} className="h-1.5" />
              </CardContent>
            </Card>

            <ReviewCard
              review={current}
              selectedOption={selectedOption}
              onSelect={setSelectedOption}
              feedback={feedback}
              submitting={submitting}
              onSubmit={handleSubmit}
              onContinue={handleContinue}
              onSnooze={handleSnooze}
              isLast={index === reviews.length - 1}
            />
          </>
        )}

        {phase === "done" && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Trophy className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="font-medium text-lg">Review complete!</p>
              {sessionRules.enabled ? (
                <SessionResults
                  rules={sessionRules}
                  items={results}
                  score={lastSession ?? summarizeSession(results.map((r) => ({ outcome: r.outcome, marks: r.marks ?? 0 })), reviews.length, sessionRules)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {sessionStats.correct} of {sessionStats.answered} correct this session.
                </p>
              )}
              <Button onClick={handleCheckForMore} disabled={checking}>
                {checking && <Loader2 className="h-4 w-4 animate-spin me-1" />}
                Check for more
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Says WHY nothing is queued, so an empty screen never contradicts the numbers above it. */
function EmptyState({ forecast }: { forecast?: ReviewForecast }) {
  const waiting = forecast?.due_without_questions ?? 0;
  let title = "You're all caught up";
  let body: string;
  if (waiting > 0) {
    title = "Nothing to practise yet";
    body = `${waiting} concept${waiting === 1 ? " is" : "s are"} due for review but ${waiting === 1 ? "has" : "have"} no practice questions yet. ${
      waiting === 1 ? "It" : "They"
    } will show up here as soon as questions are added.`;
    if (forecast?.next_due_at) body += ` Your next other review is due ${formatWhen(forecast.next_due_at)}.`;
  } else if (forecast?.next_due_at) {
    body = `Your next review is due ${formatWhen(forecast.next_due_at)}. Come back then.`;
  } else if (forecast && forecast.total_scheduled > 0) {
    body = "Everything you've learned is scheduled for later review. Come back when it's due.";
  } else {
    body = "Reviews appear here after you answer questions in tests, homework or the adaptive test.";
  }
  return (
    <Card>
      <CardContent className="p-8 text-center space-y-2">
        <Trophy className="h-10 w-10 text-emerald-500 mx-auto" />
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function ForecastStrip({ forecast }: { forecast: ReviewForecast }) {
  const stats = useMemo(
    () => [
      { icon: AlarmClock, label: "Due now", value: forecast.due_now },
      { icon: Clock3, label: "Later today", value: forecast.due_today },
      { icon: CalendarClock, label: "Next 7 days", value: forecast.due_next_7_days },
      { icon: Flame, label: "Locked in (21d+)", value: forecast.long_retention_count },
    ],
    [forecast],
  );
  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="p-3 text-center space-y-1">
            <s.icon className="h-4 w-4 mx-auto text-muted-foreground" />
            <p className="text-lg font-bold leading-none">{s.value}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{s.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
interface ReviewCardProps {
  review: DueReview;
  selectedOption: "A" | "B" | "C" | "D" | null;
  onSelect: (opt: "A" | "B" | "C" | "D") => void;
  feedback: { is_correct: boolean; correct_option: string; explanation: string | null; scoring?: AnswerScoring } | null;
  submitting: boolean;
  onSubmit: () => void;
  onContinue: () => void;
  onSnooze: () => void;
  isLast: boolean;
}

function ReviewCard({ review, selectedOption, onSelect, feedback, submitting, onSubmit, onContinue, onSnooze, isLast }: ReviewCardProps) {
  const showAnswer = !!feedback;

  const optionStyle = (key: string) => {
    if (showAnswer && key === feedback!.correct_option) return "border-emerald-500 bg-emerald-50";
    if (showAnswer && key === selectedOption && key !== feedback!.correct_option) return "border-red-500 bg-red-50";
    if (!showAnswer && selectedOption === key) return "border-primary bg-primary/5";
    return "border-border";
  };
  const optionBadgeStyle = (key: string) => {
    if (showAnswer && key === feedback!.correct_option) return "bg-emerald-500 text-white";
    if (showAnswer && key === selectedOption && key !== feedback!.correct_option) return "bg-red-500 text-white";
    if (!showAnswer && selectedOption === key) return "bg-primary text-primary-foreground";
    return "bg-muted text-muted-foreground";
  };

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
          <Badge variant="outline" className={cn("text-[11px]", DIFFICULTY_STYLES[review.difficulty])}>
            {review.difficulty}
          </Badge>
          <span>{review.subject} · {review.chapter_name} · {review.topic_name}</span>
          {review.days_overdue > 0.5 && (
            <span className="text-amber-600">· {Math.round(review.days_overdue)}d overdue</span>
          )}
        </div>
        <CardTitle className="text-base leading-relaxed">{review.item.stem}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(Object.entries(review.item.options) as [string, string][]).map(([key, value]) => (
          <button
            key={key}
            onClick={() => !showAnswer && onSelect(key as "A" | "B" | "C" | "D")}
            disabled={showAnswer}
            className={cn("w-full flex items-center gap-3 rounded-xl border-2 p-4 text-start transition-all duration-200", optionStyle(key))}
          >
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors", optionBadgeStyle(key))}>
              {showAnswer && key === feedback!.correct_option ? <CheckCircle2 className="h-5 w-5" />
                : showAnswer && key === selectedOption ? <XCircle className="h-5 w-5" /> : key}
            </span>
            <span className="text-sm">{value}</span>
          </button>
        ))}

        {showAnswer && (
          <div className={cn(
            "mt-2 rounded-lg p-3 text-sm",
            feedback!.is_correct ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-amber-50 border border-amber-200 text-amber-800",
          )}>
            <p className="font-medium mb-1">{feedback!.is_correct ? "Remembered it!" : "That one slipped — it'll come back sooner now"}</p>
            {feedback!.explanation && <p>{feedback!.explanation}</p>}
            <AnswerMarks scoring={feedback!.scoring} />
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          {!showAnswer ? (
            <>
              <Button variant="ghost" size="sm" onClick={onSnooze} className="text-muted-foreground">
                Remind me tomorrow
              </Button>
              <Button onClick={onSubmit} disabled={!selectedOption || submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : null}
                Submit
              </Button>
            </>
          ) : (
            <Button onClick={onContinue} className="ms-auto">
              {isLast ? <>Finish <Trophy className="h-4 w-4 ms-1" /></> : <>Next <ChevronRight className="h-4 w-4 ms-1" /></>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
