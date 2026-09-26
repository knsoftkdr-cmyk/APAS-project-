import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ClipboardList, RotateCw, Wrench, Sparkles, Dumbbell, CheckCircle2, XCircle,
  ChevronRight, Trophy, Loader2, Info, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { PathStepType, LearningPathStep } from "@/hooks/useLearningPath";
import { AdaptivePracticeWidget } from "@/components/AdaptivePracticeWidget";
import {
  useMyAdaptiveHomework, useSubmitAdaptiveHomeworkAnswer,
  type AdaptiveHomeworkItemRow, type MasteryBand,
} from "@/hooks/useAdaptiveHomework";

const STEP_META: Record<PathStepType, { label: string; icon: typeof RotateCw; className: string }> = {
  review: { label: "Review", icon: RotateCw, className: "bg-blue-100 text-blue-800 border-blue-300" },
  remediate: { label: "Fix a gap", icon: Wrench, className: "bg-red-100 text-red-800 border-red-300" },
  learn: { label: "New concept", icon: Sparkles, className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  practice: { label: "Practice", icon: Dumbbell, className: "bg-amber-100 text-amber-800 border-amber-300" },
};

const BAND_META: Record<MasteryBand, { label: string; className: string }> = {
  beginning: { label: "Foundation focus", className: "bg-red-100 text-red-800 border-red-300" },
  developing: { label: "Building up", className: "bg-amber-100 text-amber-800 border-amber-300" },
  proficient: { label: "On track", className: "bg-blue-100 text-blue-800 border-blue-300" },
  mastered: { label: "Enrichment", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
};

export default function AdaptiveHomework() {
  const { data: sets, isLoading } = useMyAdaptiveHomework();
  const [openSetId, setOpenSetId] = useState<string | null>(null);

  const openSet = (sets ?? []).find((s) => s.id === openSetId) ?? null;
  const pending = (sets ?? []).filter((s) => s.status !== "submitted");
  const done = (sets ?? []).filter((s) => s.status === "submitted");

  if (openSet) {
    return <HomeworkSetRunner set={openSet} onExit={() => setOpenSetId(null)} />;
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Adaptive Homework</h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Assigned by your teacher, shaped to where you're at right now — everyone in class may get a different mix.
        </p>

        {isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-2/3" /><Skeleton className="h-20 w-full" />
          </CardContent></Card>
        )}

        {!isLoading && (sets ?? []).length === 0 && (
          <Card><CardContent className="p-8 text-center space-y-2">
            <Trophy className="h-10 w-10 text-emerald-500 mx-auto" />
            <p className="font-medium">Nothing assigned yet</p>
            <p className="text-sm text-muted-foreground">Check back once your teacher generates a set.</p>
          </CardContent></Card>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground px-1">To do</h2>
            {pending.map((s) => <SetSummaryCard key={s.id} set={s} onOpen={() => setOpenSetId(s.id)} />)}
          </div>
        )}

        {done.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground px-1">Submitted</h2>
            {done.map((s) => <SetSummaryCard key={s.id} set={s} onOpen={() => setOpenSetId(s.id)} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function SetSummaryCard({ set, onOpen }: { set: AdaptiveHomeworkItemRow; onOpen: () => void }) {
  const band = BAND_META[set.mastery_band];
  const answeredCount = set.answers?.length ?? 0;
  const title = set.adaptive_homework_assignments?.title ?? "Homework";

  return (
    <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={onOpen}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className={cn("text-[11px]", band.className)}>{band.label}</Badge>
            <span className="text-xs text-muted-foreground">
              {set.status === "submitted"
                ? `Score: ${set.score ?? 0}%`
                : `${answeredCount}/${set.items.length} done`}
            </span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardContent>
    </Card>
  );
}

function HomeworkSetRunner({ set, onExit }: { set: AdaptiveHomeworkItemRow; onExit: () => void }) {
  const submitAnswer = useSubmitAdaptiveHomeworkAnswer();
  const answeredIds = new Set((set.answers ?? []).map((a) => a.item_id));

  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [feedback, setFeedback] = useState<Awaited<ReturnType<typeof submitAnswer.mutateAsync>> | null>(null);

  // Land on the first unanswered item.
  useEffect(() => {
    const firstUnanswered = set.items.findIndex((step) => !step.item || !answeredIds.has(step.item.item_id));
    setIndex(firstUnanswered === -1 ? set.items.length : firstUnanswered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.id]);

  const current: LearningPathStep | undefined = set.items[index];
  const band = BAND_META[set.mastery_band];

  const handleSubmit = async () => {
    if (!current?.item || !selectedOption) return;
    try {
      const result = await submitAnswer.mutateAsync({
        itemRowId: set.id,
        itemId: current.item.item_id,
        learningObjectiveId: current.learning_objective_id,
        selectedOption,
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
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onExit}>← Back</Button>
          <Badge variant="outline" className={cn("text-[11px]", band.className)}>{band.label}</Badge>
        </div>

        {current ? (
          <>
            <div className="text-xs text-muted-foreground px-1">
              Item {index + 1} of {set.items.length}
            </div>
            <StepCard
              step={current}
              selectedOption={selectedOption}
              onSelect={setSelectedOption}
              feedback={feedback}
              submitting={submitAnswer.isPending}
              onSubmit={handleSubmit}
              onContinue={handleContinue}
              isLast={index === set.items.length - 1}
            />
          </>
        ) : (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Trophy className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="font-medium text-lg">
                {set.status === "submitted" ? `Submitted — score ${set.score ?? 0}%` : "All done!"}
              </p>
              <Button onClick={onExit}>Back to homework list</Button>
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
  const [practiceOpen, setPracticeOpen] = useState(false);

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
        <div className="flex justify-end -mt-1">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setPracticeOpen(true)}>
            <Zap className="h-3.5 w-3.5" /> Practice this concept
          </Button>
        </div>
        <AdaptivePracticeWidget
          open={practiceOpen}
          onOpenChange={setPracticeOpen}
          scopeType="concept"
          scopeId={step.subtopic_id}
          scopeLabel={step.subtopic_name}
          source="adaptive_homework"
        />
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
              {isLast ? <>Finish <Trophy className="h-4 w-4 ml-1" /></> : <>Next item <ChevronRight className="h-4 w-4 ml-1" /></>}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
