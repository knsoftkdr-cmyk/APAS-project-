import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, RotateCw, Wrench, Dumbbell, Route, CheckCircle2, XCircle,
  ChevronRight, Trophy, Loader2, Info, Clock, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNextBestAction } from "@/hooks/useNextBestAction";
import { useAnswerPathStep, type LearningPathStep, type PathStepType } from "@/hooks/useLearningPath";

const STEP_META: Record<PathStepType, { label: string; icon: typeof Route; className: string }> = {
  review: { label: "Review", icon: RotateCw, className: "bg-blue-100 text-blue-800 border-blue-300" },
  remediate: { label: "Fix a gap", icon: Wrench, className: "bg-red-100 text-red-800 border-red-300" },
  learn: { label: "New concept", icon: Sparkles, className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  practice: { label: "Practice", icon: Dumbbell, className: "bg-amber-100 text-amber-800 border-amber-300" },
};

const MINUTE_OPTIONS = [5, 10, 15, 30];

export default function NextBestAction() {
  const [minutes, setMinutes] = useState(15);
  const { data, isLoading, refetch, isFetching } = useNextBestAction({ minutesAvailable: minutes, maxSteps: 5 });
  const answerStep = useAnswerPathStep();

  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [feedback, setFeedback] = useState<Awaited<ReturnType<typeof answerStep.mutateAsync>> | null>(null);

  const plan = data?.session_plan ?? [];
  const current = plan[index];

  useEffect(() => {
    setIndex(0);
    setFeedback(null);
    setSelectedOption(null);
  }, [data]);

  const handleSubmit = async () => {
    if (!current?.item || !selectedOption) return;
    try {
      const result = await answerStep.mutateAsync({
        stepType: current.step_type,
        learningObjectiveId: current.learning_objective_id,
        itemId: current.item.item_id,
        selectedOption,
        scheduleId: current.schedule_id,
      });
      setFeedback(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't grade that answer.");
    }
  };

  const handleContinue = () => {
    setFeedback(null);
    setSelectedOption(null);
    setIndex((i) => i + 1);
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">What should I do now?</h1>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground shrink-0">I have</span>
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MINUTE_OPTIONS.map((m) => <SelectItem key={m} value={String(m)}>{m} min</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </CardContent></Card>
        )}

        {!isLoading && data && !data.has_recommendation && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <Trophy className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-medium">{data.message ?? "Nothing to recommend right now"}</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && data?.has_recommendation && !current && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Trophy className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="font-medium text-lg">Session complete!</p>
              <Button onClick={() => refetch()}>What's next?</Button>
            </CardContent>
          </Card>
        )}

        {data?.has_recommendation && data.primary_subject && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span className="flex items-center gap-1">
              <Badge variant="secondary" className="text-[11px]">{data.primary_subject.subject}</Badge>
              {data.why_this_subject}
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Refresh
            </Button>
          </div>
        )}

        {current && (
          <StepCard
            step={current}
            stepNumber={index + 1}
            totalSteps={plan.length}
            selectedOption={selectedOption}
            onSelect={setSelectedOption}
            feedback={feedback}
            submitting={answerStep.isPending}
            onSubmit={handleSubmit}
            onContinue={handleContinue}
            isLast={index === plan.length - 1}
          />
        )}

        {data?.alternates && data.alternates.length > 0 && (
          <div className="pt-2">
            <p className="text-xs text-muted-foreground mb-2">Also getting urgent:</p>
            <div className="flex gap-2 flex-wrap">
              {data.alternates.map((alt) => (
                <Badge key={alt.book_id} variant="outline" className="text-xs gap-1">
                  {alt.subject} <ArrowRight className="h-3 w-3" />
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function StepCard({
  step, stepNumber, totalSteps, selectedOption, onSelect, feedback, submitting, onSubmit, onContinue, isLast,
}: {
  step: LearningPathStep;
  stepNumber: number;
  totalSteps: number;
  selectedOption: "A" | "B" | "C" | "D" | null;
  onSelect: (opt: "A" | "B" | "C" | "D") => void;
  feedback: { is_correct: boolean; correct_option: string; explanation: string | null } | null;
  submitting: boolean;
  onSubmit: () => void;
  onContinue: () => void;
  isLast: boolean;
}) {
  const meta = STEP_META[step.step_type];
  const showAnswer = !!feedback;
  const item = step.item;

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
          <Badge variant="outline" className={cn("text-[11px] gap-1", meta.className)}>
            <meta.icon className="h-3 w-3" /> {meta.label}
          </Badge>
          <span>{step.chapter_name} · {step.topic_name}</span>
          <span className="ml-auto">{stepNumber} of {totalSteps}</span>
        </div>
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2 mb-2">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{step.reason}</span>
        </div>
        <CardTitle className="text-base leading-relaxed">{item?.stem ?? step.objective_text}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {item ? (
          (Object.entries(item.options) as [string, string][]).map(([key, value]) => (
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
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No item available for this step.</p>
        )}

        {showAnswer && (
          <div className={cn(
            "mt-2 rounded-lg p-3 text-sm",
            feedback!.is_correct ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-amber-50 border border-amber-200 text-amber-800",
          )}>
            <p className="font-medium mb-1">{feedback!.is_correct ? "Correct!" : "Not quite"}</p>
            {feedback!.explanation && <p>{feedback!.explanation}</p>}
          </div>
        )}

        <div className="flex justify-end pt-1">
          {!showAnswer ? (
            <Button onClick={onSubmit} disabled={!selectedOption || submitting || !item}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Submit
            </Button>
          ) : (
            <Button onClick={onContinue}>
              {isLast ? <>Done <Trophy className="h-4 w-4 ml-1" /></> : <>Next <ChevronRight className="h-4 w-4 ml-1" /></>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
