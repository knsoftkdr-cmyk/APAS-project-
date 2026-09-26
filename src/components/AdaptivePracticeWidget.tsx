import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Loader2, TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAdaptivePractice, type PracticeScopeType, type DifficultyLabel,
} from "@/hooks/useAdaptivePractice";

const DIFFICULTY_META: Record<DifficultyLabel, { label: string; icon: typeof TrendingUp; className: string }> = {
  foundational: { label: "Foundational", icon: TrendingDown, className: "bg-blue-100 text-blue-800 border-blue-300" },
  moderate: { label: "Moderate", icon: Minus, className: "bg-amber-100 text-amber-800 border-amber-300" },
  challenging: { label: "Challenging", icon: TrendingUp, className: "bg-rose-100 text-rose-800 border-rose-300" },
};

interface AdaptivePracticeWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeType: PracticeScopeType;
  scopeId: number;
  scopeLabel: string;
  /** Where this round was launched from, for analytics only. */
  source?: "adaptive_homework" | "worksheet" | "ai_tutor" | "direct";
  length?: number;
}

/**
 * Drop this in anywhere a (scopeType, scopeId) is known - a concept
 * (subtopic), topic, chapter or subject. Each answer immediately shapes
 * the next question's difficulty (same engine as the formal adaptive
 * test), shown here as a simple three-tier badge instead of psychometric
 * jargon (theta/SE never surface to the student).
 */
export function AdaptivePracticeWidget({
  open, onOpenChange, scopeType, scopeId, scopeLabel, source = "direct", length = 5,
}: AdaptivePracticeWidgetProps) {
  const { session, item, feedback, result, loading, error, start, submit, acknowledgeFeedback, reset } = useAdaptivePractice();
  const [selected, setSelected] = useState<string | null>(null);
  const [prevDifficulty, setPrevDifficulty] = useState<DifficultyLabel | null>(null);
  const [trend, setTrend] = useState<"up" | "down" | "same" | null>(null);

  useEffect(() => {
    if (open) {
      reset();
      setSelected(null);
      setPrevDifficulty(null);
      setTrend(null);
      start({ scopeType, scopeId, length, source }).catch(() => void 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!item) return;
    const order: DifficultyLabel[] = ["foundational", "moderate", "challenging"];
    if (prevDifficulty) {
      const delta = order.indexOf(item.difficulty_label) - order.indexOf(prevDifficulty);
      setTrend(delta > 0 ? "up" : delta < 0 ? "down" : "same");
    }
    setPrevDifficulty(item.difficulty_label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.item_id]);

  const handleSubmit = async () => {
    if (!selected) return;
    await submit(selected).catch(() => void 0);
  };

  const handleContinue = () => {
    setSelected(null);
    acknowledgeFeedback();
  };

  const progressPct = session ? Math.min(100, (session.items_administered / session.max_items) * 100) : 0;
  const diffMeta = item ? DIFFICULTY_META[item.difficulty_label] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Adaptive Practice — {scopeLabel}</DialogTitle>
        </DialogHeader>

        {loading && !item && !result && (
          <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" /><p className="text-sm">Finding your starting point…</p>
          </div>
        )}

        {error && !item && !result && (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => start({ scopeType, scopeId, length, source })}>Try again</Button>
          </div>
        )}

        {result && (
          <div className="py-2 space-y-4 text-center">
            <Trophy className="h-10 w-10 text-amber-500 mx-auto" />
            <p className="text-lg font-semibold">{Math.round(result.accuracy * 100)}% correct</p>
            {result.by_objective.length > 0 && (
              <div className="text-left space-y-1.5 max-h-48 overflow-y-auto">
                {result.by_objective.map((o) => (
                  <div key={o.learning_objective_id} className="flex justify-between text-xs gap-2 border-b pb-1 last:border-0">
                    <span className="text-muted-foreground truncate">{o.text}</span>
                    <span className="shrink-0 font-medium">{o.correct}/{o.answered}</span>
                  </div>
                ))}
              </div>
            )}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}

        {item && !result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Progress value={progressPct} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground shrink-0">
                {session?.items_administered ?? 0}/{session?.max_items ?? length}
              </span>
            </div>

            {diffMeta && (
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className={cn("text-[11px] gap-1", diffMeta.className)}>
                  <diffMeta.icon className="h-3 w-3" /> {diffMeta.label}
                </Badge>
                {trend && !feedback && (
                  <span className="text-[11px] text-muted-foreground">
                    {trend === "up" ? "↑ got harder" : trend === "down" ? "↓ got easier" : "steady"}
                  </span>
                )}
              </div>
            )}

            <p className="text-sm font-medium leading-relaxed">{item.stem}</p>

            <div className="space-y-2">
              {Object.entries(item.options).map(([key, value]) => {
                const isCorrectKey = feedback && key === feedback.correct_option;
                const isWrongPick = feedback && key === selected && key !== feedback.correct_option;
                return (
                  <button
                    key={key}
                    disabled={!!feedback}
                    onClick={() => !feedback && setSelected(key)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg border-2 p-3 text-left text-sm transition-colors",
                      isCorrectKey ? "border-emerald-500 bg-emerald-50" :
                      isWrongPick ? "border-red-500 bg-red-50" :
                      !feedback && selected === key ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <span className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold",
                      isCorrectKey ? "bg-emerald-500 text-white" : isWrongPick ? "bg-red-500 text-white" :
                      !feedback && selected === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}>
                      {isCorrectKey ? <CheckCircle2 className="h-4 w-4" /> : isWrongPick ? <XCircle className="h-4 w-4" /> : key}
                    </span>
                    {value}
                  </button>
                );
              })}
            </div>

            {feedback && (
              <div className={cn(
                "rounded-lg p-3 text-sm",
                feedback.is_correct ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-amber-50 border border-amber-200 text-amber-800",
              )}>
                <p className="font-medium mb-0.5">{feedback.is_correct ? "Correct!" : "Not quite"}</p>
                {feedback.explanation && <p>{feedback.explanation}</p>}
              </div>
            )}

            <div className="flex justify-end">
              {!feedback ? (
                <Button onClick={handleSubmit} disabled={!selected || loading} size="sm">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Submit
                </Button>
              ) : (
                <Button onClick={handleContinue} size="sm" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Next question
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
