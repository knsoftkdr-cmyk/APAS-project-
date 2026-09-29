// src/pages/MockExamBuilder.tsx  (staff, route /mock-exams)
//
// Exam Simulation Mode, teacher side: pick a real exam pattern (CBSE Class X
// board layout, half-yearly, unit test, ...), choose the chapters it covers,
// generate the paper from the item bank, then run it as a timed mock exam.
// Everything goes through existing edge functions:
//   generate-assessment-paper  (exam_pattern_code + syllabus_weightage)
//   assign-assessment-paper    (is_mock / strict_timer / opens_at)

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Printer, Timer, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAssignMockExam, useExamPatterns, useGenerateMockExam, type GeneratedMock } from "@/hooks/useExamIntelligence";

interface BookOpt { id: number; subject: string; class_name: string | null }
interface ChapterOpt { id: number; chapter_name: string }
interface ClassOpt { id: string; label: string }

// deno-lint-ignore no-explicit-any
const db = supabase as any;

export default function MockExamBuilder() {
  const { profile } = useAuth();
  const { data: patterns, isLoading: patternsLoading, error: patternsError } = useExamPatterns();
  const generate = useGenerateMockExam();
  const assign = useAssignMockExam();

  const [patternCode, setPatternCode] = useState("");
  const [books, setBooks] = useState<BookOpt[]>([]);
  const [bookId, setBookId] = useState("");
  const [chapters, setChapters] = useState<ChapterOpt[]>([]);
  const [chapterWeights, setChapterWeights] = useState<Record<number, string>>({}); // selected chapter -> weight text
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<GeneratedMock | null>(null);

  const [classes, setClasses] = useState<ClassOpt[]>([]);
  const [classId, setClassId] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [strict, setStrict] = useState(true);
  const [assigned, setAssigned] = useState<{ students: number } | null>(null);

  const pattern = patterns?.find((p) => p.code === patternCode);

  useEffect(() => {
    db.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }: { data: BookOpt[] | null }) => setBooks(data ?? []));
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    const staffAdmin = ["admin", "principal", "school_admin", "hod"].includes(profile.role ?? "");
    const q = staffAdmin
      ? db.from("classes").select("id, name, section")
      : db.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", profile.id);
    q.then(({ data }: { data: any[] | null }) => {
      const rows = staffAdmin ? (data ?? []) : (data ?? []).map((r) => r.classes).filter(Boolean);
      setClasses(rows.map((c: any) => ({ id: c.id, label: `${c.name}${c.section ? " - " + c.section : ""}` })));
    });
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    setChapters([]); setChapterWeights({});
    if (!bookId) return;
    (async () => {
      const { data: units } = await db.from("units").select("id").eq("book_id", Number(bookId));
      const unitIds = (units ?? []).map((u: { id: number }) => u.id);
      if (!unitIds.length) return;
      const { data } = await db.from("curriculum_chapters").select("id, chapter_name").in("unit_id", unitIds).eq("is_active", true).order("id");
      setChapters(data ?? []);
    })();
  }, [bookId]);

  const selected = useMemo(() => Object.keys(chapterWeights).map(Number), [chapterWeights]);
  const weightTotal = selected.reduce((s, id) => s + (Number(chapterWeights[id]) || 0), 0);
  const weightsValid = selected.length > 0 && selected.every((id) => Number(chapterWeights[id]) > 0);

  function toggleChapter(id: number, on: boolean) {
    setChapterWeights((prev) => {
      const next = { ...prev };
      if (on) next[id] = "1"; else delete next[id];
      // re-balance to equal shares whenever the selection changes
      const ids = Object.keys(next);
      const each = ids.length ? (100 / ids.length).toFixed(1) : "0";
      for (const k of ids) next[Number(k)] = each;
      return next;
    });
  }

  async function onGenerate() {
    if (!pattern || !weightsValid) return;
    setResult(null); setAssigned(null);
    try {
      const book = books.find((b) => String(b.id) === bookId);
      const res = await generate.mutateAsync({
        examPatternCode: pattern.code, title: title.trim() || undefined, subject: book?.subject,
        syllabusWeightage: selected.map((id) => ({
          scope_type: "chapter" as const, scope_id: id, label: chapters.find((c) => c.id === id)?.chapter_name, weight_pct: Number(chapterWeights[id]),
        })),
      });
      setResult(res);
      toast.success(`Assembled ${res.item_count} questions (${res.assembled_total_marks} marks)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the paper");
    }
  }

  async function onAssign() {
    if (!result || !classId) return;
    try {
      const r = await assign.mutateAsync({
        paperId: result.paper_id, classId, strictTimer: strict,
        opensAt: opensAt ? new Date(opensAt).toISOString() : null, dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      setAssigned({ students: r.student_count });
      toast.success(`Mock exam assigned to ${r.student_count} students`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not assign the exam");
    }
  }

  const shortfalls = result?.coverage_report?.shortfalls ?? [];
  const short = result ? result.assembled_total_marks < (pattern?.total_marks ?? 0) : false;

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-rose-600 to-orange-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><Timer className="h-5 w-5 md:h-6 md:w-6 text-white" /></div>
            <div><h1 className="text-xl md:text-2xl font-bold text-white">Mock Exams</h1>
              <p className="text-rose-100 text-xs md:text-sm mt-0.5">Build a paper in a real exam pattern from your item bank and run it under exam conditions.</p></div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">1. Choose an exam pattern</CardTitle></CardHeader>
          <CardContent>
            {patternsLoading ? <Skeleton className="h-20 w-full" /> : patternsError ? <p className="text-sm text-destructive">{patternsError instanceof Error ? patternsError.message : "Could not load exam patterns"}</p> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(patterns ?? []).map((p) => (
                  <button key={p.code} type="button" onClick={() => { setPatternCode(p.code); setResult(null); setAssigned(null); }}
                    className={`text-left rounded-lg border p-3 transition ${patternCode === p.code ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted/50"}`} aria-pressed={patternCode === p.code}>
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{p.name}</span>{p.board && <Badge variant="outline">{p.board}</Badge>}</div>
                    <p className="text-xs text-muted-foreground mt-1">{p.total_marks} marks · {p.duration_minutes} min · {p.question_type_mix.length} sections</p>
                    {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
                  </button>
                ))}
              </div>
            )}
            {pattern && (
              <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs space-y-1">
                {pattern.question_type_mix.map((s, i) => (
                  <div key={i} className="flex justify-between gap-3"><span>{s.section_label ?? s.question_type}</span><span className="tabular-nums shrink-0">{s.total_marks / s.marks_per_item} × {s.marks_per_item} = {s.total_marks}</span></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">2. Choose what it covers</CardTitle>
            <CardDescription className="text-xs">Tick the chapters and set how much of the marks each carries.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={bookId} onValueChange={setBookId}>
                <SelectTrigger className="sm:w-64"><SelectValue placeholder="Choose a subject" /></SelectTrigger>
                <SelectContent>{books.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.subject}{b.class_name ? ` (${b.class_name})` : ""}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Paper title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className="sm:w-72" maxLength={120} />
            </div>
            {bookId && chapters.length === 0 && <p className="text-sm text-muted-foreground">This subject has no chapters yet.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {chapters.map((c) => {
                const on = c.id in chapterWeights;
                return (
                  <div key={c.id} className="flex items-center gap-2 rounded-md border p-2">
                    <Checkbox id={`ch-${c.id}`} checked={on} onCheckedChange={(v) => toggleChapter(c.id, v === true)} />
                    <Label htmlFor={`ch-${c.id}`} className="flex-1 text-sm truncate cursor-pointer">{c.chapter_name}</Label>
                    {on && (<div className="flex items-center gap-1"><Input aria-label={`Weight for ${c.chapter_name}`} type="number" min={0.1} max={100} step={0.5} className="h-8 w-20"
                      value={chapterWeights[c.id]} onChange={(e) => setChapterWeights((w) => ({ ...w, [c.id]: e.target.value }))} /><span className="text-xs text-muted-foreground">%</span></div>)}
                  </div>
                );
              })}
            </div>
            {selected.length > 0 && Math.abs(weightTotal - 100) > 0.5 && (
              <p className="text-xs text-muted-foreground">Weights add up to {weightTotal.toFixed(1)}% — they're scaled to 100% automatically.</p>
            )}
            <Button onClick={onGenerate} disabled={!pattern || !weightsValid || generate.isPending}>
              <Wand2 className="h-4 w-4 mr-1.5" />{generate.isPending ? "Assembling…" : "Generate paper"}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card className={short ? "border-amber-300" : "border-emerald-300"}>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
              {short ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              Paper ready: {result.item_count} questions, {result.assembled_total_marks}{pattern ? ` of ${pattern.total_marks}` : ""} marks</CardTitle>
              <CardDescription className="text-xs">Match to the pattern: {result.coverage_report.match_score}%</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {shortfalls.length > 0 && (
                <div className="text-xs rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                  <p className="font-medium text-amber-800">The item bank couldn't fill {shortfalls.length} slot{shortfalls.length > 1 ? "s" : ""}:</p>
                  {shortfalls.slice(0, 6).map((s, i) => <p key={i} className="text-amber-800">• {s.reason}</p>)}
                  {shortfalls.length > 6 && <p className="text-amber-800">…and {shortfalls.length - 6} more. Generate more items for these chapters in the Item Bank.</p>}
                </div>
              )}
              <Button asChild variant="outline" size="sm"><Link to={`/assessment-paper-print?paper_id=${result.paper_id}`}><Printer className="h-4 w-4 mr-1.5" />Print / answer key</Link></Button>

              <div className="border-t pt-3 space-y-3">
                <p className="text-sm font-medium">3. Run it as a mock exam</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label className="text-xs">Class</Label>
                    <Select value={classId} onValueChange={setClassId}><SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
                      <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1.5"><Label htmlFor="opens" className="text-xs">Opens at (optional)</Label><Input id="opens" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="due" className="text-xs">Due by (optional)</Label><Input id="due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
                </div>
                <div className="flex items-center gap-3"><Switch id="strict" checked={strict} onCheckedChange={setStrict} />
                  <Label htmlFor="strict" className="text-sm">Enforce the {result.duration_minutes ?? pattern?.duration_minutes}-minute timer on the server <span className="text-muted-foreground text-xs">(unsaved work after time-up is auto-submitted from the last autosave)</span></Label></div>
                <Button onClick={onAssign} disabled={!classId || assign.isPending || !!assigned}>{assign.isPending ? "Assigning…" : assigned ? "Assigned" : "Assign mock exam"}</Button>
                {assigned && <p className="text-sm text-emerald-700">Assigned to {assigned.students} students. They'll find it under My Exams.</p>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
