import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AnswerScoring, Outcome, ScoringRules, SessionScore } from "@/hooks/useSpacedRepetition";
import { formatMarks } from "../../../supabase/functions/_shared/dailyReviewScoring";

/** "+1 for a correct answer · −0.25 for a wrong one · skipped = 0", shown above the question while marking is on. */
export function RulesBanner({ rules }: { rules: ScoringRules }) {
  if (!rules.enabled) return null;
  return (
    <p className="text-xs rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-slate-700" data-testid="rules-banner">
      <b>Marks:</b> {formatMarks(rules.marks_per_correct, { sign: true })} correct · {rules.negative_marks_per_wrong > 0 ? formatMarks(-rules.negative_marks_per_wrong) : "0"} wrong · skipped 0
    </p>
  );
}

/** The marks this one answer earned or lost, shown with the feedback. */
export function AnswerMarks({ scoring }: { scoring?: AnswerScoring }) {
  if (!scoring?.enabled) return null;
  if (scoring.duplicate) return <p className="text-xs mt-2 text-muted-foreground" data-testid="answer-marks">This question was already marked, so no extra marks.</p>;
  if (!scoring.counted) return <p className="text-xs mt-2 text-muted-foreground" data-testid="answer-marks">No marks for this one.</p>;
  const m = scoring.marks ?? 0;
  const plus = m > 0;
  return (
    <p className={cn("text-sm font-semibold mt-2", plus ? "text-emerald-700" : m < 0 ? "text-red-700" : "text-muted-foreground")} data-testid="answer-marks">
      {plus ? `${formatMarks(m, { sign: true })} marks` : m < 0 ? `${formatMarks(m)} marks deducted` : "0 marks"}
    </p>
  );
}

export interface ResultItem { key: string; stem: string; outcome: Outcome; selected?: string; correctOption?: string; marks: number | null; topic: string }

/** The end-of-session breakdown: correct, wrong, marks deducted, not answered, final score. */
export function SessionResults({ score, rules, items, hideUnansweredWhenZero = false }: { score: SessionScore; rules: ScoringRules; items: ResultItem[]; hideUnansweredWhenZero?: boolean }) {
  const showUnanswered = !(hideUnansweredWhenZero && score.unanswered === 0);
  const negative = score.net < 0;
  return (
    <div className="space-y-4 text-start" data-testid="session-results">
      <div className="text-center rounded-2xl border bg-muted/40 p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Your score</p>
        <p className={cn("text-4xl font-extrabold", negative && "text-red-600")} data-testid="final-score">
          {formatMarks(score.net)}<span className="text-lg font-semibold text-muted-foreground"> / {formatMarks(score.max_possible)}</span>
        </p>
      </div>

      <div className={cn("grid gap-2 text-center", showUnanswered ? "grid-cols-3" : "grid-cols-2")}>
        <Tile icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} label="Correct" value={score.correct} sub={`${formatMarks(score.marks_gained, { sign: true })} marks`} tone="emerald" id="tile-correct" />
        <Tile icon={<XCircle className="h-5 w-5 text-red-600" />} label="Wrong" value={score.wrong} sub={score.marks_deducted > 0 ? `${formatMarks(-score.marks_deducted)} deducted` : "0 deducted"} tone="red" id="tile-wrong" />
        {showUnanswered && <Tile icon={<MinusCircle className="h-5 w-5 text-slate-500" />} label="Not answered" value={score.unanswered} sub="0 marks" tone="slate" id="tile-unanswered" />}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        {formatMarks(rules.marks_per_correct, { sign: true })} for each correct answer · {rules.negative_marks_per_wrong > 0 ? formatMarks(-rules.negative_marks_per_wrong) : "0"} for each wrong answer{showUnanswered ? " · 0 if not answered" : ""}
      </p>

      {items.length > 0 && (
        <details className="rounded-xl border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Look back at your answers</summary>
          <ul className="mt-3 space-y-2">
            {items.map((it) => (
              <li key={it.key} className="flex items-start gap-2 border-b last:border-0 pb-2">
                {it.outcome === "correct" ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" /> : it.outcome === "wrong" ? <XCircle className="h-4 w-4 mt-0.5 text-red-600 shrink-0" /> : <MinusCircle className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">{it.stem}</p>
                  <p className="text-xs text-muted-foreground">
                    {it.topic}
                    {it.outcome === "wrong" && it.correctOption ? ` · you chose ${it.selected}, the answer was ${it.correctOption}` : ""}
                    {it.outcome === "skipped" ? " · skipped" : ""}
                  </p>
                </div>
                <span className={cn("text-xs font-semibold shrink-0", (it.marks ?? 0) > 0 ? "text-emerald-700" : (it.marks ?? 0) < 0 ? "text-red-700" : "text-muted-foreground")}>
                  {it.marks == null ? "" : formatMarks(it.marks, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Tile({ icon, label, value, sub, tone, id }: { icon: React.ReactNode; label: string; value: number; sub: string; tone: "emerald" | "red" | "slate"; id: string }) {
  const bg = tone === "emerald" ? "bg-emerald-50 border-emerald-200" : tone === "red" ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200";
  return (
    <Card className={cn("border", bg)} data-testid={id}><CardContent className="p-3 space-y-0.5">
      <div className="flex justify-center">{icon}</div>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-[11px] font-medium">{sub}</div>
    </CardContent></Card>
  );
}
