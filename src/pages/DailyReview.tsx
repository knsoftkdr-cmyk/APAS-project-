import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RotateCw, CheckCircle2, XCircle, ChevronRight, Trophy, Loader2,
  Flame, CalendarClock, Clock3, AlarmClockOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useDueReviews, useAnswerReview, useSnoozeReview, useReviewForecast,
  type DueReview,
} from "@/hooks/useSpacedRepetition";

type Phase = "loading" | "empty" | "review" | "feedback" | "done";

const DIFFICULTY_STYLES: Record<DueReview["difficulty"], string> = {
  easy: "bg-emerald-100 text-emerald-800 border-emerald-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  hard: "bg-red-100 text-red-800 border-red-300",
};

export default function DailyReview() {
  const { data: queueData, isLoading, refetch } = useDueReviews({ limit: 20 });
  const { data: forecast } = useReviewForecast();
  const answerReview = useAnswerReview();
  const snoozeReview = useSnoozeReview();

  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [feedback, setFeedback] = useState<Awaited<ReturnType<typeof answerReview.mutateAsync>> | null>(null);
  const [sessionStats, setSessionStats] = useState({ answered: 0, correct: 0 });

  const reviews = queueData?.reviews ?? [];
  const current = reviews[index];

  const phase: Phase = isLoading
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
      });
      setFeedback(result);
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
      await snoozeReview.mutateAsync({ learningObjectiveId: current.learning_objective_id, days: 1 });
      toast.success("Pushed to tomorrow.");
      setIndex((i) => i + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't snooze that review.");
    }
  };

  const progressPct = reviews.length > 0 ? Math.round((Math.min(index, reviews.length) / reviews.length) * 100) : 0;

  return (
    <AppLayout>
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

        {phase === "empty" && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <Trophy className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-medium">Nothing due right now</p>
              <p className="text-sm text-muted-foreground">
                Everything you've learned is scheduled for later review. Come back when it's due.
              </p>
            </CardContent>
          </Card>
        )}

        {(phase === "review" || phase === "feedback") && current && (
          <>
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Review {Math.min(index + 1, reviews.length)} of {reviews.length}</span>
                  <span>{sessionStats.correct}/{sessionStats.answered} correct so far</span>
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
              <p className="text-sm text-muted-foreground">
                {sessionStats.correct} of {sessionStats.answered} correct this session.
              </p>
              <Button
                onClick={() => {
                  setIndex(0);
                  setSessionStats({ answered: 0, correct: 0 });
                  refetch();
                }}
              >
                Check for more
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function ForecastStrip({ forecast }: { forecast: { due_now: number; due_today: number; due_next_7_days: number; long_retention_count: number } }) {
  const stats = useMemo(
    () => [
      { icon: AlarmClockOff, label: "Overdue", value: forecast.due_now },
      { icon: Clock3, label: "Due today", value: forecast.due_today },
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
  feedback: { is_correct: boolean; correct_option: string; explanation: string | null } | null;
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
            className={cn("w-full flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all duration-200", optionStyle(key))}
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
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          {!showAnswer ? (
            <>
              <Button variant="ghost" size="sm" onClick={onSnooze} className="text-muted-foreground">
                Remind me tomorrow
              </Button>
              <Button onClick={onSubmit} disabled={!selectedOption || submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Submit
              </Button>
            </>
          ) : (
            <Button onClick={onContinue} className="ml-auto">
              {isLast ? <>Finish <Trophy className="h-4 w-4 ml-1" /></> : <>Next <ChevronRight className="h-4 w-4 ml-1" /></>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
