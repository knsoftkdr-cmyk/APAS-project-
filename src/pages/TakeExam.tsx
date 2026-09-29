// src/pages/TakeExam.tsx  (student, route /exam/:assignmentId)
//
// Exam Simulation Mode, student side.
//   - Nothing is fetched until the student presses Start on an unstarted exam:
//     opening the exam starts the server-side clock.
//   - The countdown runs against the SERVER's clock (offset measured when the
//     paper loaded), so changing the device time does nothing.
//   - Answers autosave every few seconds; a refresh or a dropped connection
//     restores them. When time runs out the exam submits automatically.
//   - After submitting: score, by-section / Bloom / topic analysis, and a
//     question-by-question review with feedback.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertTriangle, CheckCircle2, Clock, Flag, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeFn, useExamAttempt, useSubmitExam, type AnalysisRow, type AttemptPayload, type ExamItem } from "@/hooks/useExamIntelligence";
import { ScoreBar } from "@/components/exam/ExamReadinessPanels";

const OPTION_ORDER = ["A", "B", "C", "D"] as const;
const AUTOSAVE_MS = 8000;

const fmtClock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

export default function TakeExam() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [started, setStarted] = useState(false);
  const [peek, setPeek] = useState<{ status: string; loading: boolean; missing: boolean }>({ status: "", loading: true, missing: false });

  // Peek at the attempt WITHOUT opening it (RLS lets a student read their own attempt row).
  useEffect(() => {
    if (!assignmentId) return;
    (async () => {
      // deno-lint-ignore no-explicit-any
      const { data } = await (supabase as any).from("generated_assessment_paper_attempts").select("status").eq("assignment_id", assignmentId).maybeSingle();
      setPeek({ status: data?.status ?? "", loading: false, missing: !data });
    })();
  }, [assignmentId]);

  const canLoad = started || (!peek.loading && !peek.missing && peek.status !== "assigned");
  const { data, isLoading, error } = useExamAttempt(canLoad ? assignmentId : undefined);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        {peek.loading ? <Skeleton className="h-40 w-full" />
          : peek.missing ? <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">This exam isn't assigned to you. <Link className="underline" to="/my-exams">Back to My Exams</Link></CardContent></Card>
          : !canLoad ? <StartScreen onStart={() => setStarted(true)} />
          : isLoading ? <Skeleton className="h-64 w-full" />
          : error || !data ? <ErrorPanel message={error instanceof Error ? error.message : "Couldn't load the exam."} />
          : data.attempt.status === "in_progress" ? <ExamRunner key={data.attempt.id} data={data} />
          : <ResultView data={data} />}
      </div>
    </AppLayout>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return <Card><CardContent className="p-6 text-sm space-y-2"><p className="text-destructive">{message}</p><Link className="underline text-sm" to="/my-exams">Back to My Exams</Link></CardContent></Card>;
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <Card><CardContent className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Ready to start?</h1>
      <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
        <li>The timer starts the moment you press Start and can't be paused.</li>
        <li>Your answers are saved automatically, so a refresh won't lose your work.</li>
        <li>When time runs out, your exam is submitted automatically.</li>
        <li>Find a quiet place and make sure your connection is stable.</li>
      </ul>
      <div className="flex gap-2"><Button onClick={onStart}>Start exam</Button><Button asChild variant="outline"><Link to="/my-exams">Not yet</Link></Button></div>
    </CardContent></Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function ExamRunner({ data }: { data: AttemptPayload }) {
  const qc = useQueryClient();
  const submit = useSubmitExam();
  const attemptId = data.attempt.id;

  const [mcq, setMcq] = useState<Record<string, string>>(data.draft?.mcq ?? {});
  const [open, setOpen] = useState<Record<string, string>>(data.draft?.open ?? {});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [remaining, setRemaining] = useState<number | null>(data.timing.seconds_remaining);

  const answers = useRef({ mcq, open });
  answers.current = { mcq, open };
  const dirty = useRef(false);
  const submitting = useRef(false);
  const finished = useRef(false);

  const items = data.items;
  const sections = useMemo(() => {
    const m = new Map<string, ExamItem[]>();
    for (const it of items) { const a = m.get(it.section_label) ?? []; a.push(it); m.set(it.section_label, a); }
    return [...m.entries()];
  }, [items]);
  const answered = (it: ExamItem) => (it.question_type === "mcq" ? !!mcq[it.item_id] : !!open[it.item_id]?.trim());
  const answeredCount = items.filter(answered).length;

  // ── autosave ─────────────────────────────────────────────────────────
  const saveNow = useCallback(async () => {
    if (!dirty.current || submitting.current) return;
    dirty.current = false;
    setSaveState("saving");
    try {
      await invokeFn("cat-session", { action: "paper_save_draft", attempt_id: attemptId, answers: answers.current });
      setSaveState(dirty.current ? "unsaved" : "saved");
    } catch (e) {
      dirty.current = true;
      setSaveState("error");
      if (e instanceof Error && /time is up/i.test(e.message)) doSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  useEffect(() => { const id = setInterval(saveNow, AUTOSAVE_MS); return () => clearInterval(id); }, [saveNow]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (!finished.current) { saveNow(); e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveNow]);

  const setMcqAnswer = (id: string, opt: string) => { dirty.current = true; setSaveState("unsaved"); setMcq((p) => ({ ...p, [id]: opt })); };
  const clearMcqAnswer = (id: string) => {
    dirty.current = true; setSaveState("unsaved");
    setMcq((p) => { const c = { ...p }; delete c[id]; return c; });
  };
  const setOpenAnswer = (id: string, text: string) => { dirty.current = true; setSaveState("unsaved"); setOpen((p) => ({ ...p, [id]: text })); };

  // ── submit ───────────────────────────────────────────────────────────
  const doSubmit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const r = await submit.mutateAsync({ attemptId, mcq: answers.current.mcq, open: answers.current.open });
      finished.current = true;
      if (r.note) toast.info(r.note);
      else toast.success("Exam submitted");
    } catch (e) {
      submitting.current = false;
      toast.error(e instanceof Error ? e.message : "Couldn't submit - please try again");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // ── countdown against the server clock ───────────────────────────────
  useEffect(() => {
    const deadlineIso = data.timing.deadline_at;
    if (!deadlineIso) return;
    const offset = new Date(data.timing.server_now).getTime() - Date.now();
    const deadline = new Date(deadlineIso).getTime();
    const tick = () => {
      const r = Math.max(0, Math.round((deadline - (Date.now() + offset)) / 1000));
      setRemaining(r);
      if (r === 0) doSubmit();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data.timing.deadline_at, data.timing.server_now, doSubmit]);

  // Reopened after a strict exam already expired: submit whatever was autosaved.
  useEffect(() => { if (data.timing.expired) doSubmit(); }, [data.timing.expired, doSubmit]);

  const low = remaining != null && remaining <= 300;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur border-b flex items-center gap-3">
        <div className="min-w-0 flex-1"><p className="font-semibold truncate">{data.exam.title}</p>
          <p className="text-xs text-muted-foreground">{answeredCount}/{items.length} answered · {saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save — retrying" : "Unsaved changes"}</p></div>
        {remaining != null && (
          <div className={`flex items-center gap-1.5 font-mono text-lg tabular-nums ${low ? "text-rose-600 animate-pulse" : ""}`} role="timer" aria-label="Time remaining"><Clock className="h-4 w-4" />{fmtClock(remaining)}</div>
        )}
        <Button onClick={() => { saveNow(); setConfirmOpen(true); }} disabled={submit.isPending}>Submit</Button>
      </div>

      {data.exam.instructions.length > 0 && (
        <Card><CardContent className="p-4 text-sm"><p className="font-medium mb-1">Instructions</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">{data.exam.instructions.map((t, i) => <li key={i}>{t}</li>)}</ul></CardContent></Card>
      )}

      <nav aria-label="Question navigator" className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <a key={it.item_id} href={`#q-${it.item_id}`}
            className={`h-8 w-8 rounded-md border text-xs flex items-center justify-center relative ${answered(it) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
            {i + 1}{flagged.has(it.item_id) && <Flag className="h-2.5 w-2.5 absolute -top-1 -right-1 text-amber-500 fill-amber-500" />}
          </a>
        ))}
      </nav>

      {sections.map(([label, its]) => (
        <section key={label} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide pt-2">{label}</h2>
          {its.map((it) => {
            const n = items.indexOf(it) + 1;
            return (
              <Card key={it.item_id} id={`q-${it.item_id}`}><CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <span className="font-semibold text-sm">Q{n}.</span>
                  <div className="flex-1 space-y-2">
                    {it.context_passage && <p className="text-sm rounded-md bg-muted/50 p-3 whitespace-pre-wrap">{it.context_passage}</p>}
                    <p className="text-sm whitespace-pre-wrap">{it.stem}</p>
                    {it.sub_questions && it.sub_questions.length > 0 && (
                      <ol className="text-sm list-[lower-alpha] pl-5 space-y-1">{it.sub_questions.map((sq) => <li key={sq.id}>{sq.text} <span className="text-xs text-muted-foreground">[{sq.max_marks}]</span></li>)}</ol>)}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">[{it.marks}]</span>
                  <button type="button" onClick={() => setFlagged((f) => { const x = new Set(f); x.has(it.item_id) ? x.delete(it.item_id) : x.add(it.item_id); return x; })}
                    aria-label={flagged.has(it.item_id) ? "Remove flag" : "Flag for review"} className="shrink-0"><Flag className={`h-4 w-4 ${flagged.has(it.item_id) ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} /></button>
                </div>
                {it.question_type === "mcq" ? (
                  <div className="space-y-1.5" role="radiogroup" aria-label={`Question ${n} options`}>
                    {OPTION_ORDER.filter((o) => it.options?.[o] != null).map((o) => (
                      <label key={o} className={`flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer ${mcq[it.item_id] === o ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                        <input type="radio" name={`q-${it.item_id}`} className="mt-1" checked={mcq[it.item_id] === o} onChange={() => setMcqAnswer(it.item_id, o)} />
                        <span><span className="font-medium mr-1">{o}.</span>{it.options![o]}</span>
                      </label>
                    ))}
                    {mcq[it.item_id] && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => clearMcqAnswer(it.item_id)}>Clear answer</button>}
                  </div>
                ) : (
                  <Textarea aria-label={`Answer to question ${n}`} rows={it.marks >= 4 ? 8 : 4} placeholder="Write your answer here" value={open[it.item_id] ?? ""} maxLength={20000}
                    onChange={(e) => setOpenAnswer(it.item_id, e.target.value)} onBlur={saveNow} />
                )}
              </CardContent></Card>
            );
          })}
        </section>
      ))}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Submit your exam?</AlertDialogTitle>
            <AlertDialogDescription>
              You've answered {answeredCount} of {items.length} questions.
              {answeredCount < items.length && <> The {items.length - answeredCount} unanswered question{items.length - answeredCount > 1 ? "s" : ""} will score zero.</>}
              {flagged.size > 0 && <> You have {flagged.size} flagged for review.</>} You can't change your answers after submitting.
            </AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep working</AlertDialogCancel><AlertDialogAction onClick={doSubmit}>Submit now</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function BreakdownCard({ title, rows, labelKey }: { title: string; rows: AnalysisRow[]; labelKey: "label" | "bloom_level" | "difficulty" | "topic_name" }) {
  if (!rows.length) return null;
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={String(r[labelKey])} className="flex items-center gap-3 text-xs">
            <span className="w-32 sm:w-48 truncate capitalize" title={String(r[labelKey])}>{String(r[labelKey]).replace(/_/g, " ")}</span>
            <ScoreBar value={r.pct} className="flex-1" />
            <span className="w-16 text-right tabular-nums">{r.marks}/{r.max_marks}</span>
          </div>
        ))}
      </CardContent></Card>
  );
}

function ResultView({ data }: { data: AttemptPayload }) {
  const r = data.result;
  const qc = useQueryClient();
  useEffect(() => { qc.invalidateQueries({ queryKey: ["my-exams"] }); }, [qc]);
  if (!r) return <ErrorPanel message="Your result isn't available yet." />;
  const byId = new Map(r.items.map((i) => [i.item_id, i]));
  const secs = data.attempt.time_taken_seconds;

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1"><p className="text-xs text-muted-foreground">{data.exam.title}</p>
          <p className="text-4xl font-bold tabular-nums">{r.score}<span className="text-xl text-muted-foreground">/{r.max_marks}</span>
            <span className="text-lg text-muted-foreground ml-2">{r.pct != null ? `${Math.round(r.pct)}%` : ""}</span></p></div>
        <div className="text-xs space-y-1 text-muted-foreground">
          {r.provisional && <p className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Written answers are scored by AI for now — your teacher will confirm.</p>}
          {data.attempt.auto_submitted && <p>Submitted automatically when time ran out.</p>}
          {data.attempt.late_submission && !data.attempt.auto_submitted && <p>Submitted after the deadline.</p>}
          {secs != null && <p>Time taken: {fmtClock(secs)}</p>}
          {r.unanswered > 0 && <p>{r.unanswered} question{r.unanswered > 1 ? "s" : ""} unanswered</p>}
        </div>
      </CardContent></Card>

      {r.analysis.weak_topics.length > 0 && (
        <Card className="border-amber-200"><CardHeader className="pb-2"><CardTitle className="text-sm">Topics to revise</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{r.analysis.weak_topics.map((t) => <Badge key={t.topic_name} variant="outline">{t.topic_name} · {Math.round(t.pct ?? 0)}%</Badge>)}</CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <BreakdownCard title="By section" rows={r.analysis.sections} labelKey="label" />
        <BreakdownCard title="By thinking level" rows={r.analysis.bloom} labelKey="bloom_level" />
        <BreakdownCard title="By difficulty" rows={r.analysis.difficulty} labelKey="difficulty" />
        <BreakdownCard title="By topic" rows={r.analysis.topics} labelKey="topic_name" />
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Question review</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {data.items.map((it, i) => {
            const res = byId.get(it.item_id);
            if (!res) return null;
            const full = res.awarded >= res.marks;
            return (
              <div key={it.item_id} className="py-3 space-y-1.5 text-sm">
                <div className="flex items-start gap-2">
                  {res.question_type === "mcq" ? (res.is_correct ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />)
                    : full ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" /> : res.awarded > 0 ? <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />}
                  <p className="flex-1 whitespace-pre-wrap"><span className="font-medium">Q{i + 1}.</span> {it.stem}</p>
                  <span className="tabular-nums text-xs shrink-0">{res.awarded}/{res.marks}{res.provisional ? " *" : ""}</span>
                </div>
                {res.question_type === "mcq" && (
                  <p className="text-xs text-muted-foreground pl-6">
                    {res.answered ? <>You chose {res.selected_option}. </> : <>Not answered. </>}
                    {!res.is_correct && <>Correct answer: <span className="font-medium text-foreground">{res.correct_option}</span>. </>}{res.explanation}
                  </p>
                )}
                {res.question_type === "open_ended" && !res.answered && <p className="text-xs text-muted-foreground pl-6">Not answered.</p>}
                {res.question_type === "open_ended" && res.feedback && <p className="text-xs text-muted-foreground pl-6">{res.teacher_reviewed ? "Teacher feedback" : "AI feedback"}: {res.feedback}</p>}
              </div>
            );
          })}
          {r.provisional && <p className="text-xs text-muted-foreground pt-3">* Provisional until your teacher reviews it.</p>}
        </CardContent></Card>

      <div className="flex gap-2"><Button asChild variant="outline"><Link to="/my-exams">Back to My Exams</Link></Button>
        <Button asChild variant="outline"><Link to="/exam-readiness">See my exam readiness</Link></Button></div>
    </div>
  );
}
