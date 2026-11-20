// src/components/copilot/SuggestionCard.tsx
// One AI proposal, shown as ORIGINAL vs REVISED with the reason, difficulty / marks change, correct answer and explanation.
// Nothing is applied until the teacher presses Accept; Reject leaves the paper untouched.
import { useState } from "react";
import { ArrowRight, Check, Pencil, RefreshCw, X, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL, type PaperQuestion, type QuestionDraft, type Suggestion } from "@/lib/paperRefine";

export type SuggestionStatus = "pending" | "accepted" | "rejected" | "stale" | "superseded";

const ACTION_LABEL = { revise: "Revise", add: "New question", marks: "Marks / difficulty" } as const;

function Body({ q, showAnswer = true }: { q: Pick<QuestionDraft, "type" | "stem" | "options" | "correct_option" | "explanation" | "model_answer" | "context_passage">; showAnswer?: boolean }) {
  return (
    <div className="space-y-1.5 text-sm">
      {q.context_passage && <p className="rounded bg-muted/60 p-1.5 text-xs whitespace-pre-wrap">{q.context_passage}</p>}
      <p className="whitespace-pre-wrap">{q.stem}</p>
      {q.options && (
        <ul className="grid gap-0.5 ps-1 text-[13px]">
          {Object.entries(q.options).map(([k, v]) => (
            <li key={k} className={showAnswer && k === q.correct_option ? "text-emerald-700 font-medium" : ""}>({k}) {v}{showAnswer && k === q.correct_option ? " ✓" : ""}</li>
          ))}
        </ul>
      )}
      {showAnswer && (q.explanation || q.model_answer) && (
        <p className="text-xs text-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-200 rounded p-1.5 whitespace-pre-wrap">
          <span className="font-medium">{q.model_answer ? "Suggested answer: " : "Explanation: "}</span>{q.model_answer || q.explanation}
        </p>
      )}
    </div>
  );
}

interface Props {
  suggestion: Suggestion; original: PaperQuestion | null; status: SuggestionStatus;
  /** Set when accepting would move the paper's total away from the required total / change it at all. */
  totalWarning: string | null; busy?: boolean;
  onAccept: () => void; onReject: () => void; onEdit: () => void; onRegenerate: () => void;
}

export function SuggestionCard({ suggestion: s, original, status, totalWarning, busy, onAccept, onReject, onEdit, onRegenerate }: Props) {
  const [confirm, setConfirm] = useState(false);
  const p = s.proposed;
  const decided = status !== "pending";
  const diffChanged = s.original_difficulty && s.original_difficulty !== p.difficulty;
  const marksChanged = s.original_marks !== null && s.original_marks !== p.marks;

  const accept = () => {
    if (totalWarning && !confirm) { setConfirm(true); return; }
    setConfirm(false); onAccept();
  };

  return (
    <div className={`rounded-lg border bg-background p-3 space-y-2 ${status === "accepted" ? "border-emerald-300" : status === "rejected" || status === "superseded" ? "opacity-60" : ""}`} data-testid="suggestion-card" data-status={status}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px]">{ACTION_LABEL[s.action]}</Badge>
        {s.target_number && <Badge variant="outline" className="text-[10px]">Question {s.target_number}</Badge>}
        <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[p.type] ?? p.type}</Badge>
        {status !== "pending" && <Badge className="text-[10px] capitalize">{status === "stale" ? "No longer applicable" : status}</Badge>}
      </div>

      <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{s.reason}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {s.original_difficulty !== null || s.action !== "add" ? (
          <span>Difficulty: {s.original_difficulty ? <span className="capitalize">{s.original_difficulty}</span> : "not rated"} <ArrowRight className="inline h-3 w-3" /> <b className={diffChanged ? "text-blue-700 capitalize" : "capitalize"}>{p.difficulty}</b></span>
        ) : <span>Difficulty: <b className="capitalize">{p.difficulty}</b></span>}
        <span>Marks: {s.original_marks ?? "-"} <ArrowRight className="inline h-3 w-3" /> <b className={marksChanged || s.action === "add" ? "text-blue-700" : ""}>{p.marks}</b></span>
      </div>

      {s.action === "marks" ? (
        original && <div className="rounded border p-2"><Body q={original} showAnswer={false} /></div>
      ) : (
        <div className={s.action === "revise" ? "grid gap-2 md:grid-cols-2" : ""}>
          {s.action === "revise" && original && (
            <div className="rounded border p-2 bg-muted/30"><p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Original</p><Body q={original} /></div>
          )}
          <div className="rounded border border-blue-200 p-2 bg-blue-50/40 dark:bg-blue-950/20"><p className="text-[10px] uppercase tracking-wide text-blue-700 mb-1">{s.action === "revise" ? "Revised" : "Proposed"}</p><Body q={p} /></div>
        </div>
      )}

      {s.similar_to.length > 0 && (
        <p className="text-[11px] text-amber-700 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />Looks similar to question{s.similar_to.length > 1 ? "s" : ""} {s.similar_to.join(", ")}.</p>
      )}
      {!decided && totalWarning && <p className="text-[11px] text-amber-700 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{totalWarning}</p>}

      {!decided && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" className="h-8 gap-1" onClick={accept} disabled={busy}><Check className="h-3.5 w-3.5" />{confirm ? "Confirm & accept" : "Accept"}</Button>
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onReject} disabled={busy}><X className="h-3.5 w-3.5" />Reject</Button>
          {s.action !== "marks" && <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onEdit} disabled={busy}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
          <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={onRegenerate} disabled={busy}><RefreshCw className="h-3.5 w-3.5" />Regenerate</Button>
        </div>
      )}
    </div>
  );
}
