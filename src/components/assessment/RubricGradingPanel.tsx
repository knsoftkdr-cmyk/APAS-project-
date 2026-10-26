// src/components/assessment/RubricGradingPanel.tsx
//
// Interactive rubric grading (sheet row 44). The teacher marks each rubric criterion (0 / half / full or an exact
// value), adds a comment, and pins EVIDENCE - a quote selected straight from the student's answer. The question's
// marks are computed from the rubric (rescaled to the question's max), so every answer is judged against the same
// criteria. Saved through evaluate-assessment "review_open_response" { teacher_rubric }.
import { useMemo, type RefObject } from "react";
import { Quote, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RubricRow, TeacherRubricRow } from "@/hooks/useExamReviews";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors rubricScore() in supabase/functions/_shared/rubricGradingModel.ts. */
export function rubricTotal(rows: TeacherRubricRow[], itemMax: number): number {
  const max = rows.reduce((s, r) => s + r.max_marks, 0);
  const got = rows.reduce((s, r) => s + (Number(r.awarded) || 0), 0);
  return max > 0 && itemMax > 0 ? r2((got / max) * itemMax) : 0;
}

/** Starting rows: the teacher's saved rubric, else the question's rubric pre-filled with the AI's per-criterion marks. */
export function initialRubricRows(
  // deno-lint-ignore no-explicit-any
  defs: any[], aiRows: RubricRow[], saved: TeacherRubricRow[] | null,
): TeacherRubricRow[] {
  if (saved?.length) return saved.map((r) => ({ ...r }));
  const base = defs.length ? defs : aiRows;
  return base
    .filter((d) => d && d.criterion && Number(d.max_marks) > 0)
    .map((d, i) => {
      const ai = aiRows.find((a) => a.criterion === d.criterion) ?? aiRows[i];
      const aiAward = ai && Number.isFinite(Number(ai.awarded)) ? Math.min(Number(d.max_marks), Number(ai.awarded)) : 0;
      return { criterion: String(d.criterion), max_marks: Number(d.max_marks), awarded: aiAward, comment: null, evidence: null };
    });
}

/** Renders the answer with every evidence quote highlighted. */
export function HighlightedAnswer({ text, quotes }: { text: string; quotes: string[] }) {
  const parts = useMemo(() => {
    const qs = [...new Set(quotes.filter((q) => q && text.includes(q)))].sort((a, b) => b.length - a.length);
    if (!qs.length) return [{ t: text, hit: false }];
    const re = new RegExp(`(${qs.map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return text.split(re).filter(Boolean).map((t) => ({ t, hit: qs.includes(t) }));
  }, [text, quotes]);
  return <>{parts.map((p, i) => p.hit ? <mark key={i} className="bg-amber-200/70 rounded px-0.5">{p.t}</mark> : <span key={i}>{p.t}</span>)}</>;
}

export function RubricGradingPanel({
  rows, onChange, aiRows, answerRef, itemMax, disabled,
}: {
  rows: TeacherRubricRow[];
  onChange: (rows: TeacherRubricRow[]) => void;
  aiRows: RubricRow[];
  answerRef: RefObject<HTMLDivElement>;
  itemMax: number;
  disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<TeacherRubricRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const quoteSelection = (i: number) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const inAnswer = !!sel?.anchorNode && !!answerRef.current?.contains(sel.anchorNode);
    if (!text || !inAnswer) {
      window.alert("Select some words in the student's answer first, then press this button.");
      return;
    }
    set(i, { evidence: text.slice(0, 1000) });
    sel?.removeAllRanges();
  };

  const total = rubricTotal(rows, itemMax);
  const rubricMax = rows.reduce((s, r) => s + r.max_marks, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Rubric grading</span>
        <span className="text-muted-foreground">
          {r2(rows.reduce((s, r) => s + (Number(r.awarded) || 0), 0))} / {rubricMax} rubric points → <b className="text-foreground tabular-nums">{total} / {itemMax}</b> marks
        </span>
      </div>
      {rows.map((r, i) => {
        const ai = aiRows.find((a) => a.criterion === r.criterion) ?? aiRows[i];
        const levels = [0, r2(r.max_marks / 2), r.max_marks];
        return (
          <div key={i} className="rounded-md border bg-background p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm flex-1 min-w-[10rem]">{r.criterion}</span>
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={`Level for ${r.criterion}`}>
                {levels.map((lv, k) => (
                  <button key={k} type="button" disabled={disabled}
                    className={cn("px-2 py-0.5 text-xs rounded", Number(r.awarded) === lv ? (k === 0 ? "bg-red-600 text-white" : k === 1 ? "bg-amber-500 text-white" : "bg-emerald-600 text-white") : "text-muted-foreground hover:bg-muted")}
                    onClick={() => set(i, { awarded: lv })}>{k === 0 ? "Not met" : k === 1 ? "Partly" : "Met"}</button>
                ))}
              </div>
              <Input type="number" min={0} max={r.max_marks} step={0.5} disabled={disabled} aria-label={`Marks for ${r.criterion}`}
                className="h-7 w-16 text-xs tabular-nums" value={r.awarded}
                onChange={(e) => set(i, { awarded: Math.min(r.max_marks, Math.max(0, Number(e.target.value) || 0)) })} />
              <span className="text-xs text-muted-foreground">/ {r.max_marks}</span>
            </div>
            {ai?.reasoning && (
              <p className="flex items-start gap-1 text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3 mt-0.5 shrink-0" />AI ({r2(Number(ai.awarded ?? 0))}): {ai.reasoning}</p>
            )}
            <Input className="h-8 text-xs" placeholder="Comment for this criterion (what was good / missing)" maxLength={1000} disabled={disabled}
              value={r.comment ?? ""} onChange={(e) => set(i, { comment: e.target.value || null })} />
            <div className="flex flex-wrap items-center gap-2">
              {r.evidence ? (
                <blockquote className="flex-1 min-w-0 border-l-2 border-amber-400 pl-2 text-xs italic text-muted-foreground line-clamp-2">“{r.evidence}”</blockquote>
              ) : <span className="flex-1 text-[11px] text-muted-foreground">No evidence yet - select words in the answer above, then press Quote.</span>}
              {r.evidence && !disabled && (
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label="Remove evidence" onClick={() => set(i, { evidence: null })}><X className="h-3 w-3" /></Button>
              )}
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={disabled} onClick={() => quoteSelection(i)}>
                <Quote className="h-3 w-3" />Quote selection
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Student-facing feedback assembled from the rubric comments. */
export function feedbackFromRubric(rows: TeacherRubricRow[]): string {
  return rows
    .map((r) => `• ${r.criterion}: ${r2(Number(r.awarded) || 0)}/${r.max_marks}${r.comment ? ` - ${r.comment}` : ""}`)
    .join("\n");
}
