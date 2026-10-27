/**
 * ExamReviews.tsx  (staff, route /exam-reviews - a tab of the Assessments hub)
 *
 * The teacher's half of "Written answers are scored by AI for now - your teacher will confirm".
 *   List    exam attempts that have written answers, newest first - "Needs review" / "Reviewed".
 *   Detail  the student's answer sheet: each written question, the student's answer, the model answer
 *           and rubric, the AI's first-pass marks - and a marks box + feedback to confirm or change.
 * Saving goes through evaluate-assessment/review_open_response; once every written answer on an
 * attempt is confirmed the database finalises the attempt and the student's "provisional" label goes.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ClipboardCheck, History, ListChecks, Loader2, Search, Sparkles } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkReviewDialog, RecentBatchesDialog } from "@/components/assessment/BulkReviewDialog";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  useExamReviewAttempts, useExamReviewDetail, useSaveReview,
  type ReviewAttempt, type ReviewDetail, type ReviewItem, type TeacherRubricRow,
} from "@/hooks/useExamReviews";
import { HighlightedAnswer, RubricGradingPanel, feedbackFromRubric, initialRubricRows, rubricTotal } from "@/components/assessment/RubricGradingPanel";

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number | null | undefined) => (n == null ? "–" : String(r2(n)));
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/** Standalone pages wrap themselves in AppLayout; inside the Assessments hub the hub already provides it. */
function Shell({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;
}

export default function ExamReviews({ embedded = false }: { embedded?: boolean } = {}) {
  const [filter, setFilter] = useState<"pending" | "reviewed">("pending");
  const [examFilter, setExamFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Bulk actions: selected answer sheets (pending tab only)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [batchesOpen, setBatchesOpen] = useState(false);

  const pending = useExamReviewAttempts("pending");
  const reviewed = useExamReviewAttempts("reviewed", filter === "reviewed");
  const active = filter === "pending" ? pending : reviewed;

  const exams = useMemo(
    () => [...new Map((active.data ?? []).map((a) => [a.assignmentId, a.examTitle] as const)).entries()],
    [active.data],
  );
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (active.data ?? []).filter((a) =>
      (examFilter === "all" || a.assignmentId === examFilter) &&
      (!q || `${a.studentName} ${a.rollNumber ?? ""}`.toLowerCase().includes(q)));
  }, [active.data, examFilter, search]);

  if (openId) {
    return (
      <Shell embedded={embedded}>
        <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6">
          <ReviewDetailView attemptId={openId} onBack={() => setOpenId(null)} />
        </div>
      </Shell>
    );
  }

  const pendingCount = pending.data?.length ?? 0;

  return (
    <Shell embedded={embedded}>
      <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><ClipboardCheck className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Exam Reviews</h1>
            <p className="text-sm text-muted-foreground">
              Written answers are marked by AI first. Open an answer sheet, then confirm or change the marks —
              the student's result stays provisional until you do.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div role="tablist" aria-label="Review status" className="inline-flex gap-1 rounded-xl bg-muted p-1 self-start">
            {([["pending", `Needs review${pending.data ? ` (${pendingCount})` : ""}`], ["reviewed", "Reviewed"]] as const).map(([key, label]) => (
              <button
                key={key} type="button" role="tab" aria-selected={filter === key}
                onClick={() => { setFilter(key); setExamFilter("all"); setSelected(new Set()); }}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  filter === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >{label}</button>
            ))}
          </div>
          <div className="flex flex-1 gap-2">
            <Select value={examFilter} onValueChange={setExamFilter}>
              <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="All exams" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All exams</SelectItem>
                {exams.map(([id, title]) => <SelectItem key={id} value={id}>{title}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student or roll no." className="pl-8" />
            </div>
          </div>
        </div>

        {active.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : active.error ? (
          <Card><CardContent className="p-5 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />Couldn't load exam attempts: {(active.error as Error).message}
          </CardContent></Card>
        ) : rows.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            {(active.data ?? []).length === 0
              ? filter === "pending" ? "Nothing to review — every written answer has been confirmed." : "No reviewed exams yet."
              : "No attempts match these filters."}
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filter === "pending" && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <Checkbox
                  aria-label="Select all shown"
                  checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.id)) : new Set())}
                />
                <span>{selected.size ? `${selected.size} selected` : "Select answer sheets to act on many at once"}</span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => setBatchesOpen(true)}><History className="h-3.5 w-3.5" />Recent</Button>
                  <Button size="sm" className="gap-1" disabled={!selected.size || selected.size > 100} onClick={() => setBulkOpen(true)}>
                    <ListChecks className="h-3.5 w-3.5" />Accept AI marks{selected.size ? ` (${selected.size})` : ""}
                  </Button>
                </div>
                {selected.size > 100 && <p className="basis-full text-xs text-destructive">Select at most 100 sheets per batch.</p>}
              </div>
            )}
            {rows.map((a) => (
              <AttemptRow key={a.id} a={a} onOpen={() => setOpenId(a.id)}
                selectable={filter === "pending"} selected={selected.has(a.id)}
                onSelect={(on) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(a.id); else n.delete(a.id); return n; })} />
            ))}
          </div>
        )}
        <BulkReviewDialog open={bulkOpen} onOpenChange={setBulkOpen} attemptIds={[...selected]} onDone={() => setSelected(new Set())} />
        <RecentBatchesDialog open={batchesOpen} onOpenChange={setBatchesOpen} />
      </div>
    </Shell>
  );
}

function AttemptRow({ a, onOpen, selectable, selected, onSelect }: {
  a: ReviewAttempt; onOpen: () => void; selectable?: boolean; selected?: boolean; onSelect?: (on: boolean) => void;
}) {
  const done = a.writtenPending === 0;
  return (
    <Card className={cn("hover:border-primary/40 transition-colors", selected && "border-primary/60 bg-primary/5")}>
      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        {selectable && <Checkbox aria-label={`Select ${a.studentName}`} checked={!!selected} onCheckedChange={(v) => onSelect?.(v === true)} />}
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">
            {a.studentName}
            {(a.studentClass || a.rollNumber) && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {[a.studentClass, a.rollNumber ? `Roll ${a.rollNumber}` : ""].filter(Boolean).join(" · ")}
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground truncate">
            {a.examTitle}{a.submittedAt ? ` · submitted ${fmtDate(a.submittedAt)}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {a.isMock && <Badge variant="outline" className="text-[10px]">Mock exam</Badge>}
            {a.autoSubmitted && <Badge variant="outline" className="text-[10px]">Auto-submitted</Badge>}
            {a.late && !a.autoSubmitted && <Badge variant="outline" className="text-[10px]">Late</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums">
              {fmt(a.totalScore)}<span className="text-muted-foreground">/{fmt(a.totalMax)}</span>
            </p>
            <p className={cn("text-xs", done ? "text-emerald-700" : "text-amber-700")}>
              {done ? "All confirmed" : `${a.writtenPending} of ${a.writtenTotal} written to review`}
            </p>
          </div>
          <Button size="sm" variant={done ? "outline" : "default"} onClick={onOpen}>{done ? "View" : "Review"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════
function ReviewDetailView({ attemptId, onBack }: { attemptId: string; onBack: () => void }) {
  const { data, isLoading, error } = useExamReviewDetail(attemptId);
  const qc = useQueryClient();
  const save = useSaveReview(attemptId);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2"><ArrowLeft className="h-4 w-4 mr-1" />Back to list</Button>
  );
  if (isLoading) return <div>{back}<div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div></div>;
  if (error || !data) {
    return <div>{back}<Card><CardContent className="p-5 text-sm text-destructive">
      Couldn't load this answer sheet{error ? `: ${(error as Error).message}` : "."}</CardContent></Card></div>;
  }

  const answered = data.items.filter((i) => i.submission);
  const confirmed = answered.filter((i) => i.submission!.status === "teacher_reviewed").length;
  const final = data.status === "graded";

  const onSave = async (item: ReviewItem, score: number, feedback: string, rubric: TeacherRubricRow[] | null) => {
    try {
      await save.mutateAsync({ submissionId: item.submission!.id, score, feedback, rubric });
      const fresh = qc.getQueryData<ReviewDetail>(["exam-reviews", "detail", attemptId]);
      if (fresh?.status === "graded" && !final) toast.success("All written answers confirmed — the student's result is now final.");
      else toast.success(`Q${item.number} marks saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the marks");
    }
  };

  return (
    <div className="space-y-4">
      <div>{back}</div>
      <Card><CardContent className="p-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold truncate">{data.studentName}</p>
          <p className="text-sm text-muted-foreground">{[data.studentClass, data.examTitle].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-bold tabular-nums">{fmt(data.totalScore)}<span className="text-lg text-muted-foreground">/{fmt(data.totalMax)}</span></p>
          <p className={cn("text-xs", final ? "text-emerald-700" : "text-amber-700")}>
            {final ? "Final — visible to the student" : `Provisional — ${confirmed} of ${answered.length} written answers confirmed`}
          </p>
        </div>
      </CardContent></Card>

      {data.items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">This paper has no written questions.</CardContent></Card>
      ) : data.items.map((item) => (
        <QuestionReviewCard
          key={`${item.itemId}:${item.submission?.status}:${item.submission?.teacherScore}`}
          item={item} saving={save.isPending} onSave={onSave}
        />
      ))}
    </div>
  );
}

function QuestionReviewCard({ item, saving, onSave }: {
  item: ReviewItem; saving: boolean; onSave: (item: ReviewItem, score: number, feedback: string, rubric: TeacherRubricRow[] | null) => Promise<void>;
}) {
  const sub = item.submission;
  const reviewed = sub?.status === "teacher_reviewed";
  const aiRowsAll = sub?.aiRubric?.length ? sub.aiRubric : [];
  // Interactive rubric grading: on by default whenever the question has a rubric.
  const [rubricRows, setRubricRows] = useState<TeacherRubricRow[]>(() => initialRubricRows(item.rubric, aiRowsAll, sub?.teacherRubric ?? null));
  const [useRubric, setUseRubric] = useState(() => rubricRows.length > 0);
  const [rubricDirty, setRubricDirty] = useState(false);
  const answerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(() => {
    if (!sub) return "";
    const v = reviewed ? sub.teacherScore : sub.aiScore;
    return v == null ? "" : String(r2(v));
  });
  const [feedback, setFeedback] = useState(() => (sub ? (reviewed ? sub.teacherFeedback ?? sub.aiFeedback : sub.aiFeedback) ?? "" : ""));
  const [busy, setBusy] = useState(false);

  const parsed = useRubric && rubricRows.length ? rubricTotal(rubricRows, item.itemMax) : score.trim() === "" ? null : Number(score);
  const problem =
    parsed == null ? "Enter the marks" :
    Number.isNaN(parsed) ? "Enter a number" :
    parsed < 0 ? "Marks can't be negative" :
    parsed > item.itemMax ? `Maximum is ${item.itemMax}` : null;
  const dirty = !reviewed || rubricDirty || (sub != null && (parsed !== sub.teacherScore || feedback.trim() !== (sub.teacherFeedback ?? sub.aiFeedback ?? "").trim()));
  // Consistency check: a big gap from the AI's mark should be explained, so moderation and the student can see why.
  const bigGap = parsed != null && sub?.aiScore != null && Math.abs(parsed - sub.aiScore) >= 0.3 * item.itemMax;
  const unexplained = bigGap && useRubric && rubricRows.some((r) => !r.comment && !r.evidence);
  const slotNote = problem == null && parsed != null && item.slotMarks !== item.itemMax
    ? `counts as ${r2((parsed * item.slotMarks) / item.itemMax)} of ${item.slotMarks} on this paper` : null;

  const submit = async () => {
    if (!sub || problem || parsed == null) return;
    setBusy(true);
    try { await onSave(item, parsed, feedback, useRubric && rubricRows.length ? rubricRows : null); setRubricDirty(false); } finally { setBusy(false); }
  };

  const aiRows = sub?.aiRubric?.length ? sub.aiRubric : [];

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Q{item.number}</span>
          {item.sectionLabel && <span className="text-xs text-muted-foreground">{item.sectionLabel}</span>}
          <span className="text-xs text-muted-foreground">· {item.slotMarks} mark{item.slotMarks === 1 ? "" : "s"}</span>
          <div className="ml-auto">
            {!sub ? <Badge variant="outline">Not answered</Badge>
              : reviewed ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100"><CheckCircle2 className="h-3 w-3 mr-1" />Confirmed</Badge>
              : <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Needs your review</Badge>}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          {item.context && <div className="rounded-md bg-muted/50 p-3 whitespace-pre-wrap text-muted-foreground">{item.context}</div>}
          <p className="whitespace-pre-wrap">{item.stem}</p>
          {item.subQuestions.length > 0 && (
            <ol className="list-[lower-alpha] pl-5 space-y-1 text-muted-foreground">
              {item.subQuestions.map((sq, i) => (
                <li key={sq.id ?? i}>{sq.question ?? sq.text ?? sq.label}{sq.marks != null ? ` [${sq.marks}]` : ""}</li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Student's answer</p>
          <div ref={answerRef} className={cn("rounded-md border p-3 text-sm whitespace-pre-wrap break-words", !sub && "text-muted-foreground italic")}>
            {sub ? <HighlightedAnswer text={sub.answerText} quotes={useRubric ? rubricRows.map((r) => r.evidence ?? "") : []} /> : "No answer submitted — this question scores 0."}
          </div>
        </div>

        {(item.modelAnswer || item.rubric.length > 0) && (
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-primary">
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />Model answer &amp; rubric
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3 text-sm">
              {item.modelAnswer && (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">Model answer</p>
                  <div className="rounded-md bg-muted/50 p-3 whitespace-pre-wrap">{item.modelAnswer}</div></div>
              )}
              {(aiRows.length > 0 || item.rubric.length > 0) && (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">Rubric{aiRows.length ? " (AI's marks)" : ""}</p>
                  <ul className="space-y-1.5">
                    {(aiRows.length ? aiRows : item.rubric).map((c, i) => (
                      <li key={i} className="rounded-md border p-2">
                        <div className="flex justify-between gap-3">
                          <span>{c.criterion}</span>
                          <span className="tabular-nums shrink-0 text-muted-foreground">
                            {aiRows.length ? `${fmt(Number(c.awarded ?? 0))} / ${c.max_marks}` : `${c.max_marks}`}
                          </span>
                        </div>
                        {c.reasoning && <p className="text-xs text-muted-foreground mt-1">{c.reasoning}</p>}
                      </li>
                    ))}
                  </ul></div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}

        {sub && (
          <div className="rounded-lg border bg-muted/30 p-3 sm:p-4 space-y-3">
            {sub.aiScore != null ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />AI suggested <b className="text-foreground tabular-nums">{fmt(sub.aiScore)} / {item.itemMax}</b>
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />The AI couldn't mark this answer — please mark it yourself.
              </p>
            )}

            {rubricRows.length > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="accent-primary" checked={useRubric} onChange={(e) => { setUseRubric(e.target.checked); setRubricDirty(true); }} />
                Mark with the rubric (marks are calculated from the criteria)
              </label>
            )}
            {useRubric && rubricRows.length > 0 && (
              <RubricGradingPanel rows={rubricRows} onChange={(r) => { setRubricRows(r); setRubricDirty(true); }} aiRows={aiRowsAll} answerRef={answerRef} itemMax={item.itemMax} />
            )}

            {!(useRubric && rubricRows.length > 0) && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor={`marks-${item.itemId}`} className="text-xs font-medium">Your marks</label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id={`marks-${item.itemId}`} type="number" inputMode="decimal" min={0} max={item.itemMax} step="0.5"
                    value={score} onChange={(e) => setScore(e.target.value)} className="w-24 tabular-nums" aria-invalid={!!problem && score !== ""}
                  />
                  <span className="text-sm text-muted-foreground">/ {item.itemMax}</span>
                </div>
              </div>
              <div className="flex gap-2 pb-0.5">
                {sub.aiScore != null && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setScore(String(r2(sub.aiScore!)))}>Use AI marks</Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => setScore(String(item.itemMax))}>Full marks</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setScore("0")}>Zero</Button>
              </div>
            </div>
            )}
            {bigGap && (
              <p className={cn("flex items-start gap-1.5 text-xs", unexplained ? "text-amber-700" : "text-muted-foreground")}>
                <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
                Your mark ({fmt(parsed)}) differs from the AI's ({fmt(sub?.aiScore)}) by a lot.{unexplained ? " Add a comment or evidence on each criterion so the decision is clear." : ""}
              </p>
            )}
            {score !== "" && problem && <p className="text-xs text-destructive">{problem}</p>}
            {slotNote && <p className="text-xs text-muted-foreground">{slotNote}</p>}

            <div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`fb-${item.itemId}`} className="text-xs font-medium">Feedback the student will see</label>
                {useRubric && rubricRows.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setFeedback(feedbackFromRubric(rubricRows))}>Build from rubric</Button>
                )}
              </div>
              <Textarea
                id={`fb-${item.itemId}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} className="mt-1"
                placeholder="Optional — a short note on what was good and what to improve"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={submit} disabled={!!problem || !dirty || busy || saving}>
                {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {reviewed ? "Save changes" : "Confirm marks"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
