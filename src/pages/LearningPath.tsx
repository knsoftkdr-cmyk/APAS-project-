import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Route, RotateCw, Wrench, Sparkles, Dumbbell, CheckCircle2, XCircle,
  ChevronRight, Trophy, Loader2, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLearningPath, useAnswerPathStep, type LearningPathStep, type PathStepType } from "@/hooks/useLearningPath";

interface BookOption { id: number; subject: string; class_name: string | null }

const STEP_META: Record<PathStepType, { label: string; icon: typeof Route; className: string }> = {
  review: { label: "Review", icon: RotateCw, className: "bg-blue-100 text-blue-800 border-blue-300" },
  remediate: { label: "Fix a gap", icon: Wrench, className: "bg-red-100 text-red-800 border-red-300" },
  learn: { label: "New concept", icon: Sparkles, className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  practice: { label: "Practice", icon: Dumbbell, className: "bg-amber-100 text-amber-800 border-amber-300" },
};

export default function LearningPath() {
  const [books, setBooks] = useState<BookOption[]>([]);
  const [bookId, setBookId] = useState<string>("");

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookOption[]) ?? []));
  }, []);

  const { data, isLoading, refetch, isFetching } = useLearningPath(bookId ? Number(bookId) : undefined, { length: 8 });
  const answerStep = useAnswerPathStep();

  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [feedback, setFeedback] = useState<Awaited<ReturnType<typeof answerStep.mutateAsync>> | null>(null);

  const steps = data?.path ?? [];
  const current = steps[index];

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
          <Route className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Your Learning Path</h1>
        </div>

        <Select value={bookId} onValueChange={setBookId}>
          <SelectTrigger><SelectValue placeholder="Choose a subject" /></SelectTrigger>
          <SelectContent>
            {books.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.subject}{b.class_name ? ` · ${b.class_name}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!bookId && (
          <p className="text-sm text-muted-foreground text-center py-6">Pick a subject to see what's next for you.</p>
        )}

        {bookId && isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </CardContent></Card>
        )}

        {bookId && !isLoading && steps.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center space-y-2">
              <Trophy className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="font-medium">You're all caught up here</p>
              <p className="text-sm text-muted-foreground">
                Nothing due, nothing at risk, and everything ready is already attempted. Check back later.
              </p>
            </CardContent>
          </Card>
        )}

        {bookId && current && (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>Step {index + 1} of {steps.length}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Refresh path
              </Button>
            </div>
            <StepCard
              step={current}
              selectedOption={selectedOption}
              onSelect={setSelectedOption}
              feedback={feedback}
              submitting={answerStep.isPending}
              onSubmit={handleSubmit}
              onContinue={handleContinue}
              isLast={index === steps.length - 1}
            />
          </>
        )}

        {bookId && !current && steps.length > 0 && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Trophy className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="font-medium text-lg">Path complete!</p>
              <Button onClick={() => refetch()}>Generate a new path</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}

function StepCard({
  step, selectedOption, onSelect, feedback, submitting, onSubmit, onContinue, isLast,
}: {
  step: LearningPathStep;
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
          <span>{step.subject} · {step.chapter_name} · {step.topic_name}</span>
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
              {isLast ? <>Finish <Trophy className="h-4 w-4 ml-1" /></> : <>Next step <ChevronRight className="h-4 w-4 ml-1" /></>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
