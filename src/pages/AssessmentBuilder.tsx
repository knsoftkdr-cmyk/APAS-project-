// src/pages/AssessmentBuilder.tsx  (staff, route /assessment-builder; also a tab of the Assessments hub)
//
// One-screen assessment builder (sheet row 42): pick questions from the item bank, set marks and order,
// preview exactly what students will see, and assign - without leaving the page.
//   Left:  question bank for a class + subject + chapter, filterable by type, difficulty and text.
//   Right: the test being built (marks, order, total) + Preview + Assign.
// Server: evaluate-assessment { action: "build_paper" } then { action: "assign_paper" }. Students take it in My Exams,
// MCQs auto-mark and written answers go to Exam Reviews - the same pipeline as Mock Exams.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, CheckCircle2, ClipboardList, Eye, Loader2, Plus, Printer, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useClassSubjectPicker } from "@/hooks/useClassSubjectPicker";
import { classKey } from "@/lib/Classsubjects";
import { useAssignPaper, useBuildManualPaper } from "@/hooks/useExamIntelligence";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

interface BankItem {
  key: string;                       // "mcq:<id>" | "extended:<id>"
  kind: "mcq" | "extended";
  id: string;
  type: string;                      // mcq | descriptive | case_based | hots | competency | scenario
  stem: string;
  options?: Record<string, string>;
  correct_option?: string;
  explanation?: string | null;
  context_passage?: string | null;
  sub_questions?: { id: string; text: string; max_marks: number }[];
  model_answer?: string | null;
  difficulty: string | null;
  bloom_level: string | null;
  default_marks: number;
  topic: string | null;
}
interface Picked extends BankItem { marks: number }

const TYPE_LABEL: Record<string, string> = {
  mcq: "MCQ", descriptive: "Short/long answer", case_based: "Case-based", hots: "HOTS", competency: "Competency", scenario: "Scenario",
};
const ALL = "all";

function Shell({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;
}

/** MCQs store difficulty as an IRT b value (easy ≈ -1, medium ≈ 0, hard ≈ +1; see _shared/irt.ts priorDifficulty). */
function difficultyFromIrt(b: unknown): string | null {
  if (b == null || !Number.isFinite(Number(b))) return null;
  const v = Number(b);
  return v < -0.5 ? "easy" : v > 0.5 ? "hard" : "medium";
}

/** PostgREST returns at most 1000 rows per request, so page through bigger sets. */
// deno-lint-ignore no-explicit-any
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export default function AssessmentBuilder({ embedded = false }: { embedded?: boolean } = {}) {
  const { classes, classId, setClassId, selectedClass, subjects, bookId, setBookId, selectedSubject, loadingClasses, loadingSubjects } = useClassSubjectPicker();
  const build = useBuildManualPaper();
  const assign = useAssignPaper();

  const [chapters, setChapters] = useState<{ id: number; chapter_name: string }[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [bank, setBank] = useState<BankItem[] | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [diffFilter, setDiffFilter] = useState(ALL);
  const [search, setSearch] = useState("");

  const [picked, setPicked] = useState<Picked[]>([]);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("Answer all questions.\nWrite clearly and show your working.");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);

  const [assignClassId, setAssignClassId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [timeLimit, setTimeLimit] = useState("");
  const [strict, setStrict] = useState(false);
  const [done, setDone] = useState<{ paperId: string; students: number } | null>(null);

  useEffect(() => { setAssignClassId(classId); }, [classId]);
  const sameGradeClasses = useMemo(() => {
    const key = classKey(selectedClass?.name);
    return key ? classes.filter((c) => classKey(c.name) === key) : selectedClass ? [selectedClass] : [];
  }, [classes, selectedClass]);

  // Chapters of the chosen subject
  useEffect(() => {
    setChapters([]); setChapterId(""); setBank(null);
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      const { data: units } = await db.from("units").select("id").eq("book_id", Number(bookId));
      const unitIds = (units ?? []).map((u: { id: number }) => u.id);
      if (!unitIds.length) return;
      const { data } = await db.from("curriculum_chapters").select("id, chapter_name").in("unit_id", unitIds).eq("is_active", true).order("id");
      if (!cancelled) setChapters(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  // Question bank of the chosen chapter (active, not rejected by the quality check)
  useEffect(() => {
    setBank(null);
    if (!chapterId) return;
    let cancelled = false;
    setBankLoading(true);
    (async () => {
      try {
        const topics = await fetchAll((a, b) => db.from("topics").select("id, topic_name").eq("chapter_id", Number(chapterId)).range(a, b));
        const topicName = new Map<number, string>(topics.map((t) => [t.id, t.topic_name]));
        const subs = topics.length ? await fetchAll((a, b) => db.from("subtopics").select("id, topic_id").in("topic_id", topics.map((t) => t.id)).range(a, b)) : [];
        const topicOfSub = new Map<number, string | null>(subs.map((s) => [s.id, topicName.get(s.topic_id) ?? null]));
        const subIds = subs.map((s) => s.id);
        if (!subIds.length) { if (!cancelled) setBank([]); return; }
        const [mcq, ext] = await Promise.all([
          fetchAll((a, b) => db.from("question_bank").select("id, stem, options, correct_option, explanation, irt_b, bloom_level, subtopic_id")
            .in("subtopic_id", subIds).eq("status", "active").or("quality_flag.is.null,quality_flag.neq.reject").range(a, b)),
          fetchAll((a, b) => db.from("question_bank_extended").select("id, question_type, stem, context_passage, sub_questions, model_answer, max_marks, difficulty, bloom_level, subtopic_id")
            .in("subtopic_id", subIds).eq("status", "active").or("quality_flag.is.null,quality_flag.neq.reject").range(a, b)),
        ]);
        const items: BankItem[] = [
          ...mcq.map((q) => ({
            key: `mcq:${q.id}`, kind: "mcq" as const, id: q.id, type: "mcq", stem: q.stem, options: q.options, correct_option: q.correct_option,
            explanation: q.explanation, difficulty: difficultyFromIrt(q.irt_b), bloom_level: q.bloom_level, default_marks: 1, topic: topicOfSub.get(q.subtopic_id) ?? null,
          })),
          ...ext.map((q) => ({
            key: `extended:${q.id}`, kind: "extended" as const, id: q.id, type: q.question_type, stem: q.stem, context_passage: q.context_passage,
            sub_questions: q.sub_questions ?? [], model_answer: q.model_answer, difficulty: q.difficulty, bloom_level: q.bloom_level,
            default_marks: Number(q.max_marks) || 5, topic: topicOfSub.get(q.subtopic_id) ?? null,
          })),
        ];
        if (!cancelled) setBank(items);
      } catch (e) {
        const msg = e instanceof Error ? e.message : (e as { message?: string })?.message;
        if (!cancelled) { setBank([]); toast.error(`Couldn't load questions: ${msg || "unknown error"}`); }
      } finally {
        if (!cancelled) setBankLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chapterId]);

  const pickedKeys = useMemo(() => new Set(picked.map((p) => p.key)), [picked]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (bank ?? []).filter((b) =>
      (typeFilter === ALL || (typeFilter === "written" ? b.kind === "extended" : b.type === typeFilter)) &&
      (diffFilter === ALL || b.difficulty === diffFilter) &&
      (!q || b.stem.toLowerCase().includes(q) || (b.topic ?? "").toLowerCase().includes(q)));
  }, [bank, typeFilter, diffFilter, search]);

  const total = picked.reduce((s, p) => s + (Number(p.marks) || 0), 0);
  const add = (b: BankItem) => { if (!pickedKeys.has(b.key)) { setPicked((p) => [...p, { ...b, marks: b.default_marks }]); setDone(null); } };
  const addAllVisible = () => { setPicked((p) => [...p, ...visible.filter((b) => !pickedKeys.has(b.key)).map((b) => ({ ...b, marks: b.default_marks }))]); setDone(null); };
  const remove = (key: string) => { setPicked((p) => p.filter((x) => x.key !== key)); setDone(null); };
  const move = (i: number, d: -1 | 1) => setPicked((p) => {
    const j = i + d; if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const setMarks = (key: string, v: string) => setPicked((p) => p.map((x) => (x.key === key ? { ...x, marks: Number(v) } : x)));

  const marksValid = picked.every((p) => p.marks > 0 && p.marks <= 100);
  const canAssign = picked.length > 0 && marksValid && title.trim() && assignClassId && (!strict || Number(timeLimit) > 0);

  async function onAssign() {
    if (!canAssign) return;
    try {
      const paper = await build.mutateAsync({
        title: title.trim(),
        instructions: instructions.split("\n").map((s) => s.trim()).filter(Boolean),
        items: picked.map((p) => ({ kind: p.kind, id: p.id, marks: p.marks })),
      });
      const r = await assign.mutateAsync({
        paperId: paper.paper_id, classId: assignClassId, title: title.trim(), strictTimer: strict,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null, timeLimitMinutes: Number(timeLimit) > 0 ? Number(timeLimit) : null,
      });
      setDone({ paperId: paper.paper_id, students: r.student_count });
      toast.success(`Test assigned to ${r.student_count} students`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the test");
    }
  }

  const busy = build.isPending || assign.isPending;
  const noClasses = !loadingClasses && classes.length === 0;

  return (
    <Shell embedded={embedded}>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-7xl mx-auto pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-6">
        <div className="rounded-2xl p-5 relative overflow-hidden bg-gradient-to-r from-violet-600 to-indigo-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><ClipboardList className="h-5 w-5 text-white" /></div>
            <div><h1 className="text-xl md:text-2xl font-bold text-white">Assessment Builder</h1>
              <p className="text-violet-100 text-xs md:text-sm mt-0.5">Pick questions from the item bank, preview, and assign - all on one screen.</p></div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* ── Question bank ─────────────────────────────────────────────── */}
          <Card className="flex flex-col lg:max-h-[calc(100vh-12rem)]">
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-sm">Question bank</CardTitle>
              <div className="grid grid-cols-2 gap-2">
                <Select value={classId} onValueChange={setClassId} disabled={loadingClasses || noClasses}>
                  <SelectTrigger aria-label="Class"><SelectValue placeholder={loadingClasses ? "Loading…" : noClasses ? "No classes" : "Class"} /></SelectTrigger>
                  <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={bookId} onValueChange={setBookId} disabled={!classId || loadingSubjects || !subjects.length}>
                  <SelectTrigger aria-label="Subject"><SelectValue placeholder={loadingSubjects ? "Loading…" : "Subject"} /></SelectTrigger>
                  <SelectContent>{subjects.map((s) => <SelectItem key={s.bookId} value={String(s.bookId)}>{s.subject}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={chapterId} onValueChange={setChapterId} disabled={!chapters.length}>
                  <SelectTrigger className="col-span-2" aria-label="Chapter"><SelectValue placeholder={bookId ? (chapters.length ? "Chapter" : "No chapters yet") : "Choose a subject first"} /></SelectTrigger>
                  <SelectContent>{chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger aria-label="Question type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All types</SelectItem>
                    <SelectItem value="mcq">MCQ</SelectItem>
                    <SelectItem value="written">All written</SelectItem>
                    {["descriptive", "case_based", "hots", "competency", "scenario"].map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={diffFilter} onValueChange={setDiffFilter}>
                  <SelectTrigger aria-label="Difficulty"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Any difficulty</SelectItem>
                    <SelectItem value="easy">Easy</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
                <div className="col-span-2 relative">
                  <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search question text or topic" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              {bank && visible.length > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{visible.length} question{visible.length > 1 ? "s" : ""}</span>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addAllVisible}><Plus className="h-3.5 w-3.5 mr-1" />Add all shown</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-2">
              {!chapterId ? <p className="text-sm text-muted-foreground">Choose a class, subject and chapter to see its questions.</p>
                : bankLoading ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
                : !visible.length ? (
                  <p className="text-sm text-muted-foreground">No active questions match. Add or approve questions in the <Link to="/item-bank" className="underline">Item Bank</Link>.</p>
                ) : visible.map((b) => {
                  const inTest = pickedKeys.has(b.key);
                  return (
                    <div key={b.key} className={`rounded-lg border p-2.5 text-sm ${inTest ? "bg-muted/50" : ""}`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-3">{b.stem}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[b.type] ?? b.type}</Badge>
                            {b.difficulty && <Badge variant="secondary" className="text-[10px] capitalize">{b.difficulty}</Badge>}
                            {b.bloom_level && <Badge variant="secondary" className="text-[10px] capitalize">{b.bloom_level}</Badge>}
                            {b.topic && <span className="text-[10px] text-muted-foreground truncate">{b.topic}</span>}
                          </div>
                        </div>
                        <Button size="sm" variant={inTest ? "ghost" : "outline"} className="h-7 shrink-0" disabled={inTest} onClick={() => add(b)}>
                          {inTest ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>

          {/* ── The test ──────────────────────────────────────────────────── */}
          <Card className="flex flex-col lg:max-h-[calc(100vh-12rem)]">
            <CardHeader className="pb-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Your test · {picked.length} question{picked.length === 1 ? "" : "s"} · {total} marks</CardTitle>
                <Button variant="outline" size="sm" className="h-8" disabled={!picked.length} onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4 mr-1" />Preview</Button>
              </div>
              <Input placeholder="Test title, e.g. Unit Test - Fractions" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setDone(null); }} />
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-3">
              {!picked.length ? <p className="text-sm text-muted-foreground">Add questions from the bank on the left.</p> : (
                <ol className="space-y-2">
                  {picked.map((p, i) => (
                    <li key={p.key} className="rounded-lg border p-2.5 text-sm flex gap-2">
                      <span className="font-semibold text-muted-foreground w-6 shrink-0">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="line-clamp-2">{p.stem}</p>
                        <span className="text-[11px] text-muted-foreground">{TYPE_LABEL[p.type] ?? p.type}{p.difficulty ? ` · ${p.difficulty}` : ""}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Input aria-label={`Marks for question ${i + 1}`} type="number" min={0.5} max={100} step={0.5} className="h-8 w-16" value={p.marks} onChange={(e) => setMarks(p.key, e.target.value)} />
                        <div className="flex flex-col">
                          <Button variant="ghost" size="icon" className="h-4 w-6" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-4 w-6" onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label="Move down"><ArrowDown className="h-3 w-3" /></Button>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(p.key)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {!marksValid && <p className="text-xs text-destructive">Every question needs marks between 0 and 100.</p>}

              <div className="border-t pt-3 space-y-3">
                <div className="space-y-1.5"><Label className="text-xs">Instructions (one per line)</Label>
                  <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label className="text-xs">Assign to</Label>
                    <Select value={assignClassId} onValueChange={(v) => { setAssignClassId(v); setDone(null); }}>
                      <SelectTrigger><SelectValue placeholder="Class / section" /></SelectTrigger>
                      <SelectContent>{sameGradeClasses.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-1.5"><Label htmlFor="ab-due" className="text-xs">Due by (optional)</Label><Input id="ab-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="ab-time" className="text-xs">Time limit, min (optional)</Label><Input id="ab-time" type="number" min={1} max={600} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} /></div>
                </div>
                <div className="flex items-center gap-2"><Switch id="ab-strict" checked={strict} onCheckedChange={setStrict} />
                  <Label htmlFor="ab-strict" className="text-sm">Enforce the timer on the server {strict && !(Number(timeLimit) > 0) && <span className="text-destructive text-xs">(set a time limit)</span>}</Label></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={onAssign} disabled={!canAssign || busy || !!done} className="gap-1.5">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {busy ? "Assigning…" : done ? "Assigned" : "Save & assign"}
                  </Button>
                  {done && (
                    <>
                      <span className="text-sm text-emerald-700">Assigned to {done.students} students - they'll find it in My Exams.</span>
                      <Button asChild variant="outline" size="sm"><Link to={`/assessment-paper-print?paper_id=${done.paperId}`}><Printer className="h-4 w-4 mr-1" />Print / answer key</Link></Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{title.trim() || "Untitled test"}</DialogTitle></DialogHeader>
          <div className="flex items-center justify-between text-xs text-muted-foreground -mt-2">
            <span>{selectedSubject?.subject ?? ""}{selectedSubject ? " · " : ""}{total} marks{Number(timeLimit) > 0 ? ` · ${timeLimit} min` : ""}</span>
            <label className="inline-flex items-center gap-1.5"><Switch checked={showAnswers} onCheckedChange={setShowAnswers} /> Show answers</label>
          </div>
          {instructions.trim() && (
            <ul className="text-sm list-disc pl-5 text-muted-foreground">{instructions.split("\n").filter((s) => s.trim()).map((s, i) => <li key={i}>{s}</li>)}</ul>
          )}
          <ol className="space-y-4 mt-2">
            {picked.map((p, i) => (
              <li key={p.key} className="text-sm">
                <div className="flex justify-between gap-3"><p className="font-medium">{i + 1}. {p.stem}</p><span className="text-xs text-muted-foreground shrink-0">[{p.marks}]</span></div>
                {p.context_passage && <p className="mt-1 rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">{p.context_passage}</p>}
                {p.options && (
                  <div className="grid sm:grid-cols-2 gap-1 mt-1.5 pl-4">
                    {Object.entries(p.options).map(([k, v]) => (
                      <span key={k} className={showAnswers && k === p.correct_option ? "text-emerald-700 font-medium" : ""}>({k}) {v}</span>
                    ))}
                  </div>
                )}
                {!!p.sub_questions?.length && (
                  <ol className="list-[lower-alpha] pl-8 mt-1 space-y-0.5">{p.sub_questions.map((s) => <li key={s.id}>{s.text} <span className="text-xs text-muted-foreground">[{s.max_marks}]</span></li>)}</ol>
                )}
                {showAnswers && (p.explanation || p.model_answer) && (
                  <p className="mt-1.5 text-xs text-emerald-800 bg-emerald-50 rounded p-2 whitespace-pre-wrap">{p.explanation || p.model_answer}</p>
                )}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
