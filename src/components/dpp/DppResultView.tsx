import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, Hourglass, MessageCircle, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DIFFICULTY_CLASS, formatDuration, percentTone, TONE_CLASS, tutorPromptForItem, type DppResult } from "@/lib/dpp";

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">{icon}{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

/** Score summary + per-question review. `showTutor` adds "Ask the AI Tutor" (students only, after submission). */
export function DppResultView({ result, showTutor }: { result: DppResult; showTutor?: boolean }) {
  const tone = percentTone(result.percent);
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{result.title}</h2>
              <p className="text-sm text-muted-foreground">{result.subject}{result.chapter ? ` · ${result.chapter}` : ""}</p>
            </div>
            <Badge variant="outline" className={cn("text-base", TONE_CLASS[tone])}>{Math.round(result.percent)}%</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Score" value={`${result.score} / ${result.max_score}`} icon={<Target className="h-3 w-3" />} />
            <Stat label="Accuracy" value={`${result.accuracy}%`} />
            <Stat label="Correct / Wrong" value={`${result.correct} / ${result.incorrect}`} />
            <Stat label="Time" value={formatDuration(result.time_taken_seconds)} icon={<Clock className="h-3 w-3" />} />
          </div>
          {result.unanswered > 0 && <p className="text-sm text-muted-foreground">{result.unanswered} question(s) left unanswered.</p>}
          {result.auto_submitted && <p className="text-sm text-amber-700">Time ran out, so your saved answers were submitted automatically.</p>}
          {result.pending_manual > 0 && (
            <p className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
              <Hourglass className="h-4 w-4 shrink-0" /> {result.pending_manual} open-ended answer(s) are waiting for your teacher. The score will update once they are marked.
            </p>
          )}
        </CardContent>
      </Card>

      {result.items.map((it) => {
        const label = (k: string | null) => (k && it.options?.[k] ? `${k}. ${it.options[k]}` : k ?? "—");
        const given = it.question_type === "mcq" || it.question_type === "true_false" ? label(it.answer) : it.answer || "—";
        const right = it.question_type === "mcq" || it.question_type === "true_false" ? label(it.correct_answer) : it.correct_answer;
        return (
          <Card key={it.item_id} className={cn("border-l-4", it.pending ? "border-l-amber-400" : it.is_correct ? "border-l-emerald-500" : it.answer ? "border-l-red-500" : "border-l-border")}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium"><span className="mr-2 text-muted-foreground">Q{it.position}.</span>{it.stem}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={DIFFICULTY_CLASS[it.difficulty]}>{it.difficulty}</Badge>
                  <Badge variant="secondary">{it.marks_awarded ?? 0}/{it.marks}</Badge>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <p className="flex items-start gap-2">
                  {it.pending ? <Hourglass className="mt-0.5 h-4 w-4 text-amber-600" /> : it.is_correct ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-600" />}
                  <span><span className="text-muted-foreground">Your answer: </span>{given}</span>
                </p>
                {!it.pending && it.is_correct === false && right && (
                  <p className="pl-6"><span className="text-muted-foreground">Correct answer: </span><span className="font-medium text-emerald-700">{right}</span></p>
                )}
              </div>
              {it.explanation && !it.pending && (
                <p className="rounded-md bg-muted/60 p-3 text-sm"><span className="font-semibold">Explanation: </span>{it.explanation}</p>
              )}
              {it.teacher_feedback && <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900"><span className="font-semibold">Teacher: </span>{it.teacher_feedback}</p>}
              {showTutor && !it.pending && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/ai-tutor?dpp_attempt=${result.attempt_id}&dpp_item=${it.item_id}&prompt=${encodeURIComponent(tutorPromptForItem(it.stem, it.is_correct))}`}>
                    <MessageCircle className="mr-1 h-4 w-4" /> {it.is_correct ? "Explain this to me" : "Ask the AI Tutor why"}
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
