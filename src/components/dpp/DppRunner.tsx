import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { DIFFICULTY_CLASS, formatClock, friendlyDppError, type DppRun } from "@/lib/dpp";
import { saveDppAnswer, useSubmitDpp } from "@/hooks/useDpp";
import type { DppResult } from "@/lib/dpp";

interface Props { run: DppRun; onFinished: (result: DppResult) => void; onExit: () => void }

/** Question-by-question practice screen. Every answer is saved to the server as the student goes, so a refresh or a
 *  dropped connection resumes exactly where they left off. Grading happens only on the server. */
export function DppRunner({ run, onFinished, onExit }: Props) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(run.answers ?? {});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirm, setConfirm] = useState(false);
  const [left, setLeft] = useState<number | null>(run.remaining_seconds);
  const submit = useSubmitDpp();
  const finishing = useRef(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const item = run.items[idx];
  const answered = useMemo(() => run.items.filter((i) => (answers[i.item_id] ?? "").trim()).length, [answers, run.items]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    Object.values(timers.current).forEach(clearTimeout);
    try {
      onFinished(await submit.mutateAsync(run.attempt_id));
    } catch (e) {
      finishing.current = false;
      toast.error(friendlyDppError(e));
    }
  }, [onFinished, run.attempt_id, submit]);

  // countdown; at zero the saved answers are submitted by the server
  useEffect(() => {
    if (left == null) return;
    if (left <= 0) { void finish(); return; }
    const t = setTimeout(() => setLeft((l) => (l == null ? l : l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left, finish]);

  const persist = useCallback(async (itemId: string, value: string) => {
    setSaveState("saving");
    try {
      const r = await saveDppAnswer(run.attempt_id, itemId, value);
      if (r === "time_up") { toast.info("Time is up - your saved answers were submitted."); void finish(); return; }
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      toast.error(friendlyDppError(e));
    }
  }, [finish, run.attempt_id]);

  const setAnswer = (itemId: string, value: string, debounce: boolean) => {
    setAnswers((a) => ({ ...a, [itemId]: value }));
    clearTimeout(timers.current[itemId]);
    if (debounce) timers.current[itemId] = setTimeout(() => void persist(itemId, value), 700);
    else void persist(itemId, value);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const flushAndGo = (n: number) => {
    const cur = run.items[idx];
    if (timers.current[cur.item_id]) { clearTimeout(timers.current[cur.item_id]); void persist(cur.item_id, answers[cur.item_id] ?? ""); }
    setIdx(Math.min(Math.max(n, 0), run.items.length - 1));
  };

  const value = answers[item.item_id] ?? "";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{run.title}</h2>
          <p className="text-sm text-muted-foreground">{run.subject} · Question {idx + 1} of {run.items.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved - retry" : ""}
          </span>
          {left != null && (
            <Badge variant="outline" className={cn("gap-1 font-mono text-sm", left < 60 && "border-red-400 text-red-700")}>
              <Clock className="h-3.5 w-3.5" /> {formatClock(left)}
            </Badge>
          )}
        </div>
      </div>
      <Progress value={(answered / run.items.length) * 100} aria-label="Questions answered" />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-base font-medium">{item.stem}</p>
            <div className="flex shrink-0 gap-2">
              <Badge variant="outline" className={DIFFICULTY_CLASS[item.difficulty]}>{item.difficulty}</Badge>
              <Badge variant="secondary">{item.marks} {item.marks === 1 ? "mark" : "marks"}</Badge>
            </div>
          </div>

          {(item.question_type === "mcq" || item.question_type === "true_false") && item.options && (
            <div className="space-y-2" role="radiogroup" aria-label="Answer options">
              {Object.entries(item.options).map(([k, text]) => (
                <button
                  key={k} type="button" role="radio" aria-checked={value === k}
                  onClick={() => setAnswer(item.item_id, value === k ? "" : k, false)}
                  className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    value === k && "border-primary bg-primary/10")}
                >
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", value === k && "border-primary bg-primary text-primary-foreground")}>{k}</span>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          )}
          {item.question_type === "short_answer" && (
            <Input value={value} maxLength={300} placeholder="Type your answer" aria-label="Your answer" onChange={(e) => setAnswer(item.item_id, e.target.value, true)} />
          )}
          {item.question_type === "numeric" && (
            <Input value={value} inputMode="decimal" maxLength={30} placeholder="Enter a number" aria-label="Your numeric answer" onChange={(e) => setAnswer(item.item_id, e.target.value, true)} />
          )}
          {item.question_type === "open_ended" && (
            <div className="space-y-1">
              <Textarea value={value} rows={6} maxLength={2000} placeholder="Write your answer. Your teacher will mark this one." aria-label="Your written answer" onChange={(e) => setAnswer(item.item_id, e.target.value, true)} />
              <p className="text-xs text-muted-foreground">Your teacher marks this question; the rest are checked instantly.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5" aria-label="Question navigator">
        {run.items.map((q, i) => (
          <button
            key={q.item_id} type="button" onClick={() => flushAndGo(i)} aria-label={`Go to question ${i + 1}${(answers[q.item_id] ?? "").trim() ? " (answered)" : ""}`}
            className={cn("flex h-9 w-9 items-center justify-center rounded-md border text-xs font-medium",
              i === idx && "ring-2 ring-primary", (answers[q.item_id] ?? "").trim() ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "bg-card")}
          >{i + 1}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onExit}>Save &amp; exit</Button>
        <div className="flex gap-2">
          <Button variant="outline" disabled={idx === 0} onClick={() => flushAndGo(idx - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
          {idx < run.items.length - 1
            ? <Button onClick={() => flushAndGo(idx + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            : <Button onClick={() => setConfirm(true)} disabled={submit.isPending}>{submit.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Submit</Button>}
        </div>
      </div>
      {idx < run.items.length - 1 && (
        <div className="text-right"><Button variant="link" size="sm" onClick={() => setConfirm(true)}><CheckCircle2 className="mr-1 h-4 w-4" />Submit now</Button></div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this practice?</AlertDialogTitle>
            <AlertDialogDescription>
              You answered {answered} of {run.items.length} questions.
              {answered < run.items.length ? ` ${run.items.length - answered} unanswered question(s) will score zero.` : ""} You can't change answers after submitting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => void finish()}>Submit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
