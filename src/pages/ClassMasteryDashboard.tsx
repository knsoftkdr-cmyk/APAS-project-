import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, BarChart3, Loader2, Sparkles } from "lucide-react";
import { ClassCohortView, ClassReadinessView } from "@/components/exam/ExamReadinessPanels";
import { PeerGroupsPanel } from "@/components/grouping/PeerGroupsPanel";
import { LearningGroupsPanel } from "@/components/grouping/LearningGroupsPanel";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClassMastery, useGenerateLearningObjectives } from "@/hooks/useMastery";
import { useToast } from "@/hooks/use-toast";

interface ClassOption { id: string; label: string; name: string }
interface BookOption { id: number; subject: string | null; class_name: string | null }
interface SubjectOption { bookId: number; subject: string }
interface ChapterOption { id: number; name: string }

const ROMAN: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12",
};

/** "Class 4", "class 4", "Grade 4", "4", "4th", "IV" -> "4", so classes.name and books.class_name compare reliably. */
function classKey(raw?: string | null): string {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/\b(class|grade|std|standard)\b\.?/g, "")
    .replace(/\s+/g, "")
    .replace(/^(\d+)(st|nd|rd|th)$/, "$1");
  return ROMAN[s] ?? s;
}

const subjectKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Loads every active book for the school, paging past the 1000-row API limit. */
async function fetchSchoolBooks(schoolId?: string | null): Promise<BookOption[]> {
  const out: BookOption[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("id").range(from, from + page - 1);
    if (schoolId) q = q.eq("school_id", schoolId);
    const { data, error } = await q;
    if (error || !data) break;
    out.push(...(data as BookOption[]));
    if (data.length < page) break;
  }
  return out;
}

interface CurriculumScan { units: number; chapters: number; topicIds: number[] }

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Walks book -> units -> chapters -> topics (same path the textbook loader writes and other pages read).
 * Pass chapterId to limit the topics to a single chapter of the book.
 */
async function scanBookCurriculum(bookId: number, chapterId?: number): Promise<CurriculumScan> {
  const { data: units, error: uErr } = await supabase.from("units").select("id").eq("book_id", bookId);
  if (uErr) throw uErr;
  const unitIds = (units ?? []).map((u) => u.id as number);

  let chapterIds: number[] = [];
  for (const ids of chunk(unitIds, 30)) {
    const { data, error } = await supabase.from("curriculum_chapters").select("id").in("unit_id", ids);
    if (error) throw error;
    chapterIds.push(...(data ?? []).map((c) => c.id as number));
  }
  if (chapterId !== undefined) chapterIds = chapterIds.filter((id) => id === chapterId);

  const topicIds: number[] = [];
  for (const ids of chunk(chapterIds, 30)) {
    const { data, error } = await supabase.from("topics").select("id").in("chapter_id", ids).order("id");
    if (error) throw error;
    topicIds.push(...(data ?? []).map((t) => t.id as number));
  }
  return { units: unitIds.length, chapters: chapterIds.length, topicIds };
}

/** Chapters of one book (book -> units -> chapters), in the order they were loaded. */
async function fetchBookChapters(bookId: number): Promise<ChapterOption[]> {
  const { data: units, error: uErr } = await supabase.from("units").select("id").eq("book_id", bookId);
  if (uErr) throw uErr;
  const unitIds = (units ?? []).map((u) => u.id as number);

  const out: ChapterOption[] = [];
  for (const ids of chunk(unitIds, 30)) {
    const { data, error } = await supabase.from("curriculum_chapters").select("id, chapter_name").in("unit_id", ids);
    if (error) throw error;
    // deno-lint-ignore no-explicit-any
    for (const c of (data ?? []) as any[]) out.push({ id: c.id as number, name: String(c.chapter_name ?? `Chapter ${c.id}`) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The edge function returns a generic message on non-2xx; the real reason is in the response body. */
async function describeInvokeError(err: unknown): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const ctx = (err as any)?.context;
  try {
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    }
  } catch { /* fall through */ }
  return err instanceof Error ? err.message : "Request failed";
}

export default function ClassMasteryDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [classId, setClassId] = useState<string>("");
  const [bookId, setBookId] = useState<string>("");
  const [chapterId, setChapterId] = useState<string>("all");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [view, setView] = useState<"mastery" | "readiness" | "cohort" | "peers" | "groups">("mastery");
  const [blueprints, setBlueprints] = useState<{ id: string; title: string }[]>([]);

  const numericBookId = bookId && bookId !== "all" ? Number(bookId) : undefined;
  const numericChapterId = chapterId !== "all" ? Number(chapterId) : undefined;
  const { data: topics, isLoading, refetch } = useClassMastery(classId || undefined, numericBookId);
  const generateObjectives = useGenerateLearningObjectives();

  useEffect(() => {
    async function loadOptions() {
      setLoadingOptions(true);
      const isStaffAdmin = ["admin", "principal", "school_admin", "hod"].includes(profile?.role ?? "");

      const classQuery = isStaffAdmin
        ? supabase.from("classes").select("id, name, section")
        : supabase.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", profile?.id ?? "");

      const [{ data: classData }, bookData] = await Promise.all([
        classQuery,
        fetchSchoolBooks(profile?.school_id),
      ]);

      const classOptions: ClassOption[] = isStaffAdmin
        // deno-lint-ignore no-explicit-any
        ? (classData as any[] ?? []).map((c) => ({ id: c.id, name: c.name, label: `${c.name}${c.section ? " - " + c.section : ""}` }))
        // deno-lint-ignore no-explicit-any
        : (classData as any[] ?? [])
            .filter((c) => c.classes)
            .map((c) => ({ id: c.classes.id, name: c.classes.name, label: `${c.classes.name}${c.classes.section ? " - " + c.classes.section : ""}` }));

      setClasses(classOptions);
      setBooks(bookData);
      setLoadingOptions(false);
    }
    if (profile?.id) loadOptions();
  }, [profile?.id, profile?.role, profile?.school_id]);

  // Subjects for the chosen class only, one entry per subject. If a subject has
  // more than one book for the class, keep the one with the most topics.
  const selectedClassKey = useMemo(
    () => classKey(classes.find((c) => c.id === classId)?.name),
    [classes, classId],
  );

  useEffect(() => {
    let cancelled = false;
    async function resolveSubjects() {
      if (!classId || !selectedClassKey) { setSubjectOptions([]); return; }
      const groups = new Map<string, { subject: string; ids: number[] }>();
      for (const b of books) {
        if (!b.subject || classKey(b.class_name) !== selectedClassKey) continue;
        const k = subjectKey(b.subject);
        const g = groups.get(k) ?? { subject: b.subject.trim(), ids: [] };
        g.ids.push(b.id);
        groups.set(k, g);
      }
      const picked: SubjectOption[] = [];
      for (const g of groups.values()) {
        let bookId = Math.min(...g.ids);
        if (g.ids.length > 1) {
          let best = -1;
          for (const id of g.ids) {
            let score = 0;
            try {
              const scan = await scanBookCurriculum(id);
              score = scan.topicIds.length * 1000 + scan.chapters;
            } catch { /* unreadable book scores 0 */ }
            if (score > best) { best = score; bookId = id; }
          }
        }
        picked.push({ bookId, subject: g.subject });
      }
      picked.sort((a, b) => a.subject.localeCompare(b.subject));
      if (!cancelled) setSubjectOptions(picked);
    }
    resolveSubjects();
    return () => { cancelled = true; };
  }, [books, classId, selectedClassKey]);

  // Drop a stale subject when the class changes and the subject isn't taught there.
  useEffect(() => {
    if (bookId && bookId !== "all" && !subjectOptions.some((s) => String(s.bookId) === bookId)) setBookId("");
  }, [subjectOptions, bookId]);

  // Chapters of the chosen subject. Changing the subject always resets the chapter to "All chapters".
  useEffect(() => {
    let cancelled = false;
    setChapterId("all");
    setChapterOptions([]);
    if (!numericBookId) { setLoadingChapters(false); return; }
    setLoadingChapters(true);
    fetchBookChapters(numericBookId)
      .then((list) => { if (!cancelled) setChapterOptions(list); })
      .catch(() => { if (!cancelled) setChapterOptions([]); })
      .finally(() => { if (!cancelled) setLoadingChapters(false); });
    return () => { cancelled = true; };
  }, [numericBookId]);

  // Generate learning objectives for every topic in the selected subject (or just the selected chapter).
  // The edge function works per topic (or per concept), so we call it once per
  // topic, which also keeps each request well inside the function's time limit.
  async function handleGenerate() {
    if (!numericBookId || genProgress) return;
    setGenProgress({ done: 0, total: 0 });
    try {
      const scan = await scanBookCurriculum(numericBookId, numericChapterId);
      const topicIds = scan.topicIds;
      if (topicIds.length === 0) {
        const subjectName = subjectOptions.find((o) => o.bookId === numericBookId)?.subject ?? "this subject";
        if (numericChapterId !== undefined) {
          const chapterName = chapterOptions.find((c) => c.id === numericChapterId)?.name ?? "this chapter";
          toast({
            title: `No topics to generate from for ${chapterName}`,
            description: `This chapter of ${subjectName} has no topics yet. Re-run the textbook loader so its topics are extracted.`,
            variant: "destructive",
          });
          return;
        }
        const found =
          scan.units === 0 ? "no units"
          : scan.chapters === 0 ? `${scan.units} unit(s) but no chapters`
          : `${scan.chapters} chapter(s) but no topics`;
        toast({
          title: `No topics to generate from for ${subjectName}`,
          description:
            `This textbook (book #${numericBookId}) has ${found}. Upload or re-run the textbook loader so its units, chapters and topics are extracted. ` +
            "If you know they exist, check that your account can read this book's curriculum.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Generating learning objectives…", description: `${topicIds.length} topics. This can take a few minutes.` });
      let created = 0, topicsWithNew = 0, skipped = 0, failedStreak = 0, conceptsMade = 0;
      const errors = new Set<string>();

      for (let i = 0; i < topicIds.length; i++) {
        setGenProgress({ done: i, total: topicIds.length });
        try {
          const res = await generateObjectives.mutateAsync({ topicId: topicIds[i], createMissingConcepts: true });
          failedStreak = 0;
          conceptsMade += res?.concepts_created ?? 0;
          let madeHere = 0;
          // deno-lint-ignore no-explicit-any
          for (const r of (res?.results ?? []) as any[]) {
            if (r.error) errors.add(String(r.error));
            else if (r.skipped) skipped++;
            else madeHere += r.generated ?? 0;
          }
          created += madeHere;
          if (madeHere > 0) topicsWithNew++;
        } catch (e) {
          errors.add(await describeInvokeError(e));
          // Same failure every time (permissions, missing API key): stop instead of hammering it.
          if (++failedStreak >= 3) break;
        }
      }

      if (created > 0) {
        toast({
          title: "Learning objectives generated",
          description: `${created} objectives across ${topicsWithNew} topics` + (conceptsMade ? `, plus ${conceptsMade} new concepts.` : ".") + (errors.size ? ` Some concepts failed: ${[...errors][0]}` : ""),
        });
      } else if (errors.size > 0) {
        toast({ title: "Couldn't generate learning objectives", description: [...errors][0], variant: "destructive" });
      } else {
        toast({
          title: skipped > 0 ? "Objectives already exist" : "No concepts to generate for",
          description: skipped > 0
            ? `Every concept in this ${numericChapterId !== undefined ? "chapter" : "subject"} already has learning objectives.`
            : `This ${numericChapterId !== undefined ? "chapter" : "subject"}'s topics have no concepts (subtopics) yet.`,
        });
      }
    } catch (e) {
      toast({ title: "Couldn't generate learning objectives", description: await describeInvokeError(e), variant: "destructive" });
    } finally {
      setGenProgress(null);
      refetch();
    }
  }

  // Saved exam blueprints, so readiness can be weighted the way a specific exam is.
  useEffect(() => {
    if (!profile?.id) return;
    // deno-lint-ignore no-explicit-any
    (supabase as any).from("assessment_blueprints").select("id, title").eq("status", "active").order("created_at", { ascending: false }).limit(50)
      .then(({ data }: { data: { id: string; title: string }[] | null }) => setBlueprints(data ?? []));
  }, [profile?.id]);

  // The class-mastery query returns the whole subject; the chapter filter is applied here.
  const visibleTopics = useMemo(
    () => (topics ?? []).filter((t) => numericChapterId === undefined || String(t.chapter_id) === String(numericChapterId)),
    [topics, numericChapterId],
  );
  const weakTopics = visibleTopics.filter((t) => t.is_weak_spot);
  const chapterName = chapterOptions.find((c) => c.id === numericChapterId)?.name;

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-violet-600 to-indigo-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Class Mastery</h1>
              <p className="text-violet-100 text-xs md:text-sm mt-0.5">
                Topic mastery, exam readiness and how your section compares with its grade and school.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <Select value={classId} onValueChange={setClassId} disabled={loadingOptions}>
              <SelectTrigger className="sm:w-56"><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bookId} onValueChange={setBookId} disabled={loadingOptions || !classId}>
              <SelectTrigger className="sm:w-64">
                <SelectValue placeholder={!classId ? "Choose a class first" : view === "mastery" ? "Choose a subject" : "All subjects"} />
              </SelectTrigger>
              <SelectContent>
                {view !== "mastery" && <SelectItem value="all">All subjects</SelectItem>}
                {subjectOptions.map((s) => <SelectItem key={s.bookId} value={String(s.bookId)}>{s.subject}</SelectItem>)}
                {subjectOptions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No subjects found for this class.</div>
                )}
              </SelectContent>
            </Select>
            {view === "mastery" && numericBookId !== undefined && (
              <Select value={chapterId} onValueChange={setChapterId} disabled={loadingChapters}>
                <SelectTrigger className="sm:w-64">
                  <SelectValue placeholder={loadingChapters ? "Loading chapters…" : "All chapters"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All chapters</SelectItem>
                  {chapterOptions.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  {!loadingChapters && chapterOptions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No chapters found for this subject.</div>
                  )}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList>
            <TabsTrigger value="mastery">Mastery</TabsTrigger>
            <TabsTrigger value="readiness">Exam readiness</TabsTrigger>
            <TabsTrigger value="cohort">Cohort intelligence</TabsTrigger>
            <TabsTrigger value="peers">Peer groups</TabsTrigger>
            <TabsTrigger value="groups">Learning groups</TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "readiness" ? (
          classId ? <ClassReadinessView key={`r-${classId}-${numericBookId ?? "all"}`} classId={classId} bookId={numericBookId} blueprints={blueprints} />
            : <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">Pick a class to see how ready its students are for the exam.</CardContent></Card>
        ) : view === "cohort" ? (
          classId ? <ClassCohortView key={`c-${classId}-${numericBookId ?? "all"}`} classId={classId} bookId={numericBookId} />
            : <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">Pick a class to compare it with its grade and school.</CardContent></Card>
        ) : view === "peers" ? (
          classId ? <PeerGroupsPanel key={`p-${classId}-${numericBookId ?? "all"}`} classId={classId} bookId={numericBookId} />
            : <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">Pick a class to find students who share the same learning gaps.</CardContent></Card>
        ) : view === "groups" ? (
          classId ? <LearningGroupsPanel key={`g-${classId}-${numericBookId ?? "all"}`} classId={classId} bookId={numericBookId} />
            : <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">Pick a class to see its remedial, regular and enrichment groups.</CardContent></Card>
        ) : !classId || !bookId || bookId === "all" ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Pick a class and a subject to see mastery by topic.
          </CardContent></Card>
        ) : isLoading ? (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
          </CardContent></Card>
        ) : visibleTopics.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center space-y-3">
            <p>
              {numericChapterId !== undefined
                ? `No learning objectives exist for ${chapterName ?? "this chapter"} yet, so there's nothing to track.`
                : "No learning objectives exist for this subject yet, so there's nothing to track."}
            </p>
            <Button size="sm" disabled={!!genProgress} onClick={handleGenerate}>
              {genProgress ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  {genProgress.total > 0 ? `Generating ${genProgress.done + 1} of ${genProgress.total}…` : "Preparing…"}</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1.5" /> {numericChapterId !== undefined ? "Generate for this chapter's concepts" : "Generate for this subject's concepts"}</>
              )}
            </Button>
          </CardContent></Card>
        ) : (
          <>
            {weakTopics.length > 0 && (
              <Card className="border-rose-200 dark:border-rose-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4" /> {weakTopics.length} weak spot{weakTopics.length > 1 ? "s" : ""} — class average below 50%
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {weakTopics.map((t) => (
                    <div key={t.topic_id} className="text-sm flex items-center justify-between">
                      <span>{t.chapter_name} → {t.topic_name}</span>
                      <Badge variant="outline" className="text-rose-600 border-rose-200">{Math.round(t.class_avg_mastery * 100)}%</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{chapterName ? `Topics in ${chapterName}` : "All topics"}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {visibleTopics.map((t) => (
                  <div key={t.topic_id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.topic_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.chapter_name}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {t.students_attempted}/{t.students_total} attempted
                    </span>
                    <Badge variant="outline" className={t.is_weak_spot ? "text-rose-600 border-rose-200" : ""}>
                      {Math.round(t.class_avg_mastery * 100)}%
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}