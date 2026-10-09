import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Layers, Sparkles, Gauge, CheckCircle2, XCircle, Loader2, RotateCcw,
  AlertTriangle, Archive, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import { useAuth } from "@/contexts/AuthContext";
import {
  classKey, fetchClassOptions, fetchSchoolBooks, resolveSubjectsForClass,
  type BookOption as ClassBookOption, type ClassOption, type SubjectOption,
} from "@/lib/classSubjects";

// ── Types ─────────────────────────────────────────────────────────────────
type ScopeType = "concept" | "topic" | "chapter" | "subject";
type ItemStatus = "draft" | "active" | "retired";
type CalibrationStatus = "prior" | "rasch" | "2pl";
type ReviewFlag = "ok" | "review_key" | "low_discrimination" | "too_easy" | "too_hard" | null;

interface BookOption { id: number; subject: string; class_name: string | null }
interface ChapterOption { id: number; chapter_name: string }
interface TopicOption { id: number; topic_name: string }
interface ConceptOption { id: number; subtopic_name: string }

interface LearningObjectiveRow {
  id: number;
  subtopic_id: number;
  objective_text: string;
  bloom_level: string | null;
  difficulty: string | null;
}
interface QuestionRow {
  id: string;
  learning_objective_id: number;
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  correct_option: "A" | "B" | "C" | "D";
  explanation: string | null;
  distractor_misconceptions: Record<string, number>;
  bloom_level: string | null;
  status: ItemStatus;
  irt_a: number;
  irt_b: number;
  calibration_status: CalibrationStatus;
  n_responses: number;
  n_correct: number;
  review_flag: ReviewFlag;
  review_note: string | null;
  ai_generated: boolean;
}
interface MisconceptionRow { id: number; subtopic_id: number; misconception_text: string }

/** Free-response items (question_bank_extended): short/long answer, case-based, HOTS, scenario. */
interface ExtendedRow {
  id: string;
  learning_objective_id: number | null;
  question_type: string;
  stem: string;
  context_passage: string | null;
  sub_questions: { id: string; text: string; max_marks: number }[];
  rubric: { criterion: string; description?: string; max_marks: number }[];
  model_answer: string | null;
  max_marks: number;
  difficulty: string | null;
  bloom_level: string | null;
  status: ItemStatus;
  ai_generated: boolean;
}
type GenKind = "mcq" | "descriptive" | "case_based" | "open_both";
const EXT_TYPE_LABEL: Record<string, string> = {
  descriptive: "Short/long answer", case_based: "Case-based", hots: "HOTS", scenario: "Scenario",
};

// deno-lint-ignore no-explicit-any
const db = supabase as any; // question_bank_extended isn't in the generated client types

const FLAG_STYLES: Record<Exclude<ReviewFlag, null | "ok">, { label: string; className: string }> = {
  review_key: { label: "Check answer key", className: "bg-red-100 text-red-800 border-red-300" },
  low_discrimination: { label: "Weak item", className: "bg-amber-100 text-amber-800 border-amber-300" },
  too_easy: { label: "Very easy", className: "bg-blue-100 text-blue-800 border-blue-300" },
  too_hard: { label: "Very hard", className: "bg-purple-100 text-purple-800 border-purple-300" },
};

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const { message } = await unwrapFunctionError(error, "That request failed.");
    throw new Error(message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
  return data as T;
}


/** Standalone pages wrap themselves in AppLayout; inside the Assessments hub the hub already provides it. */
function Shell({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;
}

export default function ItemBankReview({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  // ── Scope picker (class -> subject -> chapter -> topic -> concept) ───────
  const [classId, setClassId] = useState("");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [schoolBooks, setSchoolBooks] = useState<ClassBookOption[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [subtopicId, setSubtopicId] = useState("");
  const [books, setBooks] = useState<BookOption[]>([]);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [concepts, setConcepts] = useState<ConceptOption[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    setLoadingClasses(true);
    Promise.all([fetchClassOptions(profile), fetchSchoolBooks(profile.school_id)])
      .then(([classList, bookList]) => {
        if (cancelled) return;
        setClasses(classList);
        setSchoolBooks(bookList);
        setBooks(bookList.map((b) => ({ id: b.id, subject: b.subject ?? "", class_name: b.class_name })));
      })
      .finally(() => { if (!cancelled) setLoadingClasses(false); });
    return () => { cancelled = true; };
  }, [profile?.id, profile?.role, profile?.school_id]);

  // Subjects taught in the chosen class only.
  const selectedClassKey = useMemo(
    () => classKey(classes.find((c) => c.id === classId)?.name),
    [classes, classId],
  );
  useEffect(() => {
    let cancelled = false;
    if (!classId || !selectedClassKey) { setSubjectOptions([]); return; }
    setLoadingSubjects(true);
    resolveSubjectsForClass(schoolBooks, selectedClassKey)
      .then((list) => { if (!cancelled) setSubjectOptions(list); })
      .catch(() => { if (!cancelled) setSubjectOptions([]); })
      .finally(() => { if (!cancelled) setLoadingSubjects(false); });
    return () => { cancelled = true; };
  }, [schoolBooks, classId, selectedClassKey]);

  const onClassChange = (v: string) => {
    setClassId(v);
    setBookId(""); setChapterId(""); setTopicId(""); setSubtopicId("");
    setChapters([]); setTopics([]); setConcepts([]);
  };
  const onBookChange = (v: string) => {
    setBookId(v); setChapterId(""); setTopicId(""); setSubtopicId(""); setChapters([]); setTopics([]); setConcepts([]);
    supabase.from("curriculum_chapters").select("id, chapter_name, unit_id, units!inner(book_id)").eq("units.book_id", Number(v))
      .then(({ data }) => setChapters((data as ChapterOption[]) ?? []));
  };
  const onChapterChange = (v: string) => {
    setChapterId(v); setTopicId(""); setSubtopicId(""); setTopics([]); setConcepts([]);
    supabase.from("topics").select("id, topic_name").eq("chapter_id", Number(v))
      .then(({ data }) => setTopics((data as TopicOption[]) ?? []));
  };
  const onTopicChange = (v: string) => {
    setTopicId(v); setSubtopicId(""); setConcepts([]);
    supabase.from("subtopics").select("id, subtopic_name").eq("topic_id", Number(v)).eq("is_active", true)
      .then(({ data }) => setConcepts((data as ConceptOption[]) ?? []));
  };

  const scopeReady = !!topicId;
  const genScope: { subtopic_id?: number; topic_id?: number } = subtopicId
    ? { subtopic_id: Number(subtopicId) } : { topic_id: Number(topicId) };
  const calibScopeLevels: { type: ScopeType; id: number; label: string }[] = [
    subtopicId ? { type: "concept" as const, id: Number(subtopicId), label: concepts.find((c) => c.id === Number(subtopicId))?.subtopic_name ?? "" } : null,
    topicId ? { type: "topic" as const, id: Number(topicId), label: topics.find((t) => t.id === Number(topicId))?.topic_name ?? "" } : null,
    chapterId ? { type: "chapter" as const, id: Number(chapterId), label: chapters.find((c) => c.id === Number(chapterId))?.chapter_name ?? "" } : null,
    bookId ? { type: "subject" as const, id: Number(bookId), label: books.find((b) => b.id === Number(bookId))?.subject ?? "" } : null,
  ].filter((x): x is { type: ScopeType; id: number; label: string } => x != null);

  // ── Objectives + items for the selected scope ────────────────────────────
  const bankQuery = useQuery({
    queryKey: ["item-bank", topicId, subtopicId],
    enabled: scopeReady,
    queryFn: async () => {
      let subtopicIds: number[];
      let subtopicNames = new Map<number, string>();
      if (subtopicId) {
        subtopicIds = [Number(subtopicId)];
        subtopicNames.set(Number(subtopicId), concepts.find((c) => c.id === Number(subtopicId))?.subtopic_name ?? "");
      } else {
        const { data: subs } = await supabase.from("subtopics").select("id, subtopic_name").eq("topic_id", Number(topicId)).eq("is_active", true);
        subtopicIds = (subs ?? []).map((s: { id: number }) => s.id);
        subtopicNames = new Map((subs ?? []).map((s: { id: number; subtopic_name: string }) => [s.id, s.subtopic_name]));
      }
      if (subtopicIds.length === 0) return { objectives: [] as LearningObjectiveRow[], items: [] as QuestionRow[], extItems: [] as ExtendedRow[], subtopicNames, misconceptions: new Map<number, string>() };

      const [{ data: objectives }, { data: mcs }] = await Promise.all([
        supabase.from("learning_objectives").select("id, subtopic_id, objective_text, bloom_level, difficulty")
          .in("subtopic_id", subtopicIds).eq("status", "active").order("id"),
        supabase.from("concept_misconceptions").select("id, subtopic_id, misconception_text").in("subtopic_id", subtopicIds),
      ]);
      const loIds = (objectives ?? []).map((o: { id: number }) => o.id);
      const { data: items } = loIds.length
        ? await supabase.from("question_bank")
            .select("id, learning_objective_id, stem, options, correct_option, explanation, distractor_misconceptions, bloom_level, status, irt_a, irt_b, calibration_status, n_responses, n_correct, review_flag, review_note, ai_generated")
            .in("learning_objective_id", loIds).neq("status", "retired").order("created_at", { ascending: false })
        : { data: [] };
      const { data: extItems } = loIds.length
        ? await db.from("question_bank_extended")
            .select("id, learning_objective_id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks, difficulty, bloom_level, status, ai_generated")
            .in("learning_objective_id", loIds).neq("status", "retired").neq("question_type", "competency").order("created_at", { ascending: false })
        : { data: [] };
      // Retired items are hidden from the default view to keep the list focused;
      // they're never served anyway and the audit trail lives in the DB.
      return {
        objectives: (objectives ?? []) as LearningObjectiveRow[],
        items: (items ?? []) as QuestionRow[],
        extItems: (extItems ?? []) as ExtendedRow[],
        subtopicNames,
        misconceptions: new Map(((mcs ?? []) as MisconceptionRow[]).map((m) => [m.id, m.misconception_text])),
      };
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["item-bank", topicId, subtopicId] });

  // ── Generation ────────────────────────────────────────────────────────
  const [targetPerObjective, setTargetPerObjective] = useState(8);
  const [autoActivate, setAutoActivate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genKind, setGenKind] = useState<GenKind>("mcq");
  const [targetOpen, setTargetOpen] = useState(3);
  const [wholeChapter, setWholeChapter] = useState(false);

  /** Short/long-answer and case-based generation (edge function action "open_ended"). */
  const runGenerateOpen = async () => {
    const types = genKind === "open_both" ? ["descriptive", "case_based"] : [genKind];
    const scopes: { topic_id?: number; subtopic_id?: number }[] =
      wholeChapter && topics.length > 1 ? topics.map((t) => ({ topic_id: t.id })) : [genScope];
    let inserted = 0, failedTasks = 0, skippedScopes = 0, lastError = "";
    for (const scope of scopes) {
      try {
        // One call handles at most 12 (objective, type) tasks, so keep going until nothing remains.
        for (let round = 0; round < 12; round++) {
          const res = await invokeFn<{ inserted: number; remaining_tasks?: number; per_task?: { error?: string }[] }>(
            "generate-item-bank",
            { action: "open_ended", ...scope, question_types: types, target_per_type: targetOpen, auto_activate: autoActivate },
          );
          inserted += res.inserted ?? 0;
          failedTasks += (res.per_task ?? []).filter((t) => t.error).length;
          if (!res.remaining_tasks || !res.inserted) break;
        }
      } catch (e) {
        if (scopes.length === 1) throw e; // single scope: show the real error
        skippedScopes++; lastError = (e as Error).message; // chapter mode: keep going with the other topics
      }
    }
    if (inserted === 0 && skippedScopes > 0) throw new Error(lastError || "Nothing could be generated.");
    const what = genKind === "case_based" ? "case-based" : genKind === "descriptive" ? "short/long-answer" : "short/long and case-based";
    toast.success(`Generated ${inserted} ${what} question${inserted === 1 ? "" : "s"}`, {
      description: [
        autoActivate ? "They're active and can be used in mock exams now." : "They're drafts — approve them below so mock exams can use them.",
        skippedScopes ? `${skippedScopes} topic${skippedScopes === 1 ? "" : "s"} skipped (${lastError})` : "",
        failedTasks ? `${failedTasks} item set${failedTasks === 1 ? "" : "s"} failed — run again to retry.` : "",
      ].filter(Boolean).join(" "),
    });
  };

  const runGenerate = async () => {
    setGenerating(true);
    try {
      if (genKind !== "mcq") { await runGenerateOpen(); refresh(); return; }
      const res = await invokeFn<{ inserted: number; objectives_processed: number; remaining_objectives: number }>(
        "generate-item-bank", { ...genScope, target_per_objective: targetPerObjective, auto_activate: autoActivate },
      );
      toast.success(`Generated ${res.inserted} question${res.inserted === 1 ? "" : "s"}`, {
        description: res.remaining_objectives > 0
          ? `${res.remaining_objectives} more objective${res.remaining_objectives === 1 ? "" : "s"} still need topping up — run again to continue.`
          : autoActivate ? "New questions are active and ready to serve." : "New questions are drafts — approve them below before students see them.",
      });
      refresh();
    } catch (e) {
      toast.error("Generation failed", { description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  };

  // ── Calibration ───────────────────────────────────────────────────────
  const [calibrating, setCalibrating] = useState<ScopeType | null>(null);
  const runCalibrate = async (type: ScopeType, id: number, dryRun: boolean) => {
  setCalibrating(type);
  try {
    const res = await invokeFn<{
      no_data?: boolean; message?: string;
      items_considered: number; items_calibrated: number; responses_used: number;
      flagged_count: number; auto_suspended_count: number;
      thresholds: { min_n_rasch: number };
    }>("calibrate-irt", { scope_type: type, scope_id: id, dry_run: dryRun });

    if (res.no_data) {
      toast.info("Nothing to calibrate yet", {
        description: "No student has answered questions in this scope. Calibration needs real responses.",
      });
      return;
    }
    if (res.items_calibrated === 0) {
      toast.info(dryRun ? "Preview: no changes yet" : "No items calibrated yet", {
        description: `${res.items_considered} answered item(s), but none has reached ${res.thresholds.min_n_rasch} responses.`,
      });
      return;
    }
    toast.success(dryRun ? "Preview complete (nothing saved)" : "Calibration complete", {
      description: `${res.items_calibrated} item(s) re-estimated from ${res.responses_used} responses` +
        (res.flagged_count > 0 ? ` — ${res.flagged_count} flagged${res.auto_suspended_count > 0 ? `, ${res.auto_suspended_count} auto-suspended` : ""}.` : "."),
    });
    if (!dryRun) refresh();
  } catch (e) {
    toast.error("Calibration failed", { description: (e as Error).message });
  } finally {
    setCalibrating(null);
  }
};

  // ── Item mutations (direct table writes — teachers have full RLS access) ─
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const setStatus = async (id: string, status: ItemStatus, clearFlag = false) => {
    setBusyItem(id);
    const patch: Record<string, unknown> = { status };
    if (clearFlag) { patch.review_flag = null; patch.review_note = null; }
    const { error } = await supabase.from("question_bank").update(patch).eq("id", id);
    setBusyItem(null);
    if (error) { toast.error("Couldn't update that question", { description: error.message }); return; }
    refresh();
  };
  const fixKey = async (id: string, correct: string) => {
    setBusyItem(id);
    const { error } = await supabase.from("question_bank")
      .update({ correct_option: correct, status: "active", review_flag: null, review_note: null }).eq("id", id);
    setBusyItem(null);
    if (error) { toast.error("Couldn't save the fix", { description: error.message }); return; }
    toast.success("Answer key updated and reactivated");
    refresh();
  };

  const setExtStatus = async (ids: string[], status: ItemStatus) => {
    if (!ids.length) return;
    setBusyItem(ids[0]);
    const { error } = await db.from("question_bank_extended").update({ status }).in("id", ids);
    setBusyItem(null);
    if (error) { toast.error("Couldn't update those questions", { description: error.message }); return; }
    if (ids.length > 1) toast.success(`${ids.length} questions approved`);
    refresh();
  };

  const grouped = useMemo(() => {
    if (!bankQuery.data) return [];
    const byLo = new Map<number, QuestionRow[]>();
    for (const it of bankQuery.data.items) {
      const arr = byLo.get(it.learning_objective_id) ?? [];
      arr.push(it);
      byLo.set(it.learning_objective_id, arr);
    }
    const extByLo = new Map<number, ExtendedRow[]>();
    for (const it of bankQuery.data.extItems) {
      if (it.learning_objective_id == null) continue;
      const arr = extByLo.get(it.learning_objective_id) ?? [];
      arr.push(it);
      extByLo.set(it.learning_objective_id, arr);
    }
    return bankQuery.data.objectives.map((lo) => ({ lo, items: byLo.get(lo.id) ?? [], ext: extByLo.get(lo.id) ?? [] }));
  }, [bankQuery.data]);

  const extTotals = useMemo(() => {
    const ext = bankQuery.data?.extItems ?? [];
    const count = (type: string, status: ItemStatus) => ext.filter((i) => i.question_type === type && i.status === status).length;
    return {
      descActive: count("descriptive", "active"), descDraft: count("descriptive", "draft"),
      caseActive: count("case_based", "active"), caseDraft: count("case_based", "draft"),
      draftIds: ext.filter((i) => i.status === "draft").map((i) => i.id),
    };
  }, [bankQuery.data]);

  const totals = useMemo(() => {
    const items = bankQuery.data?.items ?? [];
    return {
      active: items.filter((i) => i.status === "active").length,
      draft: items.filter((i) => i.status === "draft").length,
      flagged: items.filter((i) => i.status === "active" && i.review_flag && i.review_flag !== "ok").length,
    };
  }, [bankQuery.data]);

  return (
    <Shell embedded={embedded}>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Layers className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Item Bank</h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">
                Generate, review and calibrate the adaptive test question bank.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Class</label>
              <Select value={classId} onValueChange={onClassChange} disabled={loadingClasses}>
                <SelectTrigger><SelectValue placeholder={loadingClasses ? "Loading classes…" : "Choose a class"} /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  {!loadingClasses && classes.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No classes assigned to you.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Select value={bookId} onValueChange={onBookChange} disabled={!classId || loadingSubjects}>
                <SelectTrigger>
                  <SelectValue placeholder={!classId ? "Choose a class first" : loadingSubjects ? "Loading subjects…" : "Choose a subject"} />
                </SelectTrigger>
                <SelectContent>
                  {subjectOptions.map((b) => <SelectItem key={b.bookId} value={String(b.bookId)}>{b.subject}</SelectItem>)}
                  {!loadingSubjects && subjectOptions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No subjects found for this class.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Chapter</label>
              <Select value={chapterId} onValueChange={onChapterChange} disabled={!bookId}>
                <SelectTrigger><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
                <SelectContent>{chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Topic</label>
              <Select value={topicId} onValueChange={onTopicChange} disabled={!chapterId}>
                <SelectTrigger><SelectValue placeholder="Choose a topic" /></SelectTrigger>
                <SelectContent>{topics.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.topic_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Concept (optional)</label>
              <Select value={subtopicId} onValueChange={setSubtopicId} disabled={!topicId}>
                <SelectTrigger><SelectValue placeholder="Every concept in the topic" /></SelectTrigger>
                <SelectContent>{concepts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.subtopic_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {!scopeReady && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Choose a class, subject, chapter and topic to see and manage its question bank.
          </CardContent></Card>
        )}

        {scopeReady && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" /> Generate questions</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-muted-foreground shrink-0">Question type</label>
                    <Select value={genKind} onValueChange={(v) => setGenKind(v as GenKind)}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mcq">Multiple choice (MCQ)</SelectItem>
                        <SelectItem value="descriptive">Short / long answer</SelectItem>
                        <SelectItem value="case_based">Case-based</SelectItem>
                        <SelectItem value="open_both">Short/long + Case-based</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {genKind === "mcq"
                      ? <>Tops up every learning objective in {subtopicId ? "this concept" : "this topic"} to the target below. Already-full objectives are skipped.</>
                      : <>Writes rubric-graded questions (with a model answer) for every learning objective in {wholeChapter && topics.length > 1 ? "this chapter" : subtopicId ? "this concept" : "this topic"}. Needed for mock-exam sections B, C and D.</>}
                  </p>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-muted-foreground shrink-0">{genKind === "mcq" ? "Target per objective" : "Target per type, per objective"}</label>
                    {genKind === "mcq" ? (
                      <Input type="number" min={2} max={12} value={targetPerObjective}
                        onChange={(e) => setTargetPerObjective(Math.min(12, Math.max(2, Number(e.target.value) || 8)))}
                        className="h-8 w-20" />
                    ) : (
                      <Input type="number" min={1} max={8} value={targetOpen}
                        onChange={(e) => setTargetOpen(Math.min(8, Math.max(1, Number(e.target.value) || 3)))}
                        className="h-8 w-20" />
                    )}
                  </div>
                  {genKind !== "mcq" && topics.length > 1 && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox checked={wholeChapter} onCheckedChange={(v) => setWholeChapter(v === true)} />
                      Do the whole chapter ({topics.length} topics), not just the selected topic
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={autoActivate} onCheckedChange={(v) => setAutoActivate(v === true)} />
                    Activate immediately (skip draft review)
                  </label>
                  <Button size="sm" onClick={runGenerate} disabled={generating} className="w-full">
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                    {generating ? (genKind === "mcq" ? "Generating…" : "Generating — this can take a minute…") : "Generate"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4 text-indigo-600" /> Calibrate difficulty</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-1">
                    Re-estimates real difficulty from student responses and flags items that look mis-keyed.
                  </p>
                  {calibScopeLevels.map((lvl) => (
                    <div key={lvl.type} className="flex items-center justify-between gap-2 text-sm rounded-lg border px-3 py-2">
                      <span className="truncate">{lvl.label}</span>
                      <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={calibrating === lvl.type} onClick={() => runCalibrate(lvl.type, lvl.id, true)}>
                          {calibrating === lvl.type ? <Loader2 className="h-3 w-3 animate-spin" /> : "Preview"}
                        </Button>
                        <Button size="sm" className="h-7 px-2 text-xs" disabled={calibrating === lvl.type} onClick={() => runCalibrate(lvl.type, lvl.id, false)}>
                          Run
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300">{totals.active} active</Badge>
              <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300">{totals.draft} draft</Badge>
              {totals.flagged > 0 && <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">{totals.flagged} need review</Badge>}
              <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-300">Short/long: {extTotals.descActive} active · {extTotals.descDraft} draft</Badge>
              <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-300">Case-based: {extTotals.caseActive} active · {extTotals.caseDraft} draft</Badge>
              {extTotals.draftIds.length > 0 && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busyItem != null} onClick={() => setExtStatus(extTotals.draftIds, "active")}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve all {extTotals.draftIds.length} short/case drafts
                </Button>
              )}
            </div>

            {bankQuery.isLoading && (
              <Card><CardContent className="p-6 space-y-3">
                <Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
              </CardContent></Card>
            )}

            {bankQuery.data && grouped.length === 0 && (
              <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
                No learning objectives here yet — generate them from the Class Mastery page first, then come back to author questions.
              </CardContent></Card>
            )}

            {bankQuery.data && grouped.length > 0 && (
              <Accordion type="multiple" className="space-y-2">
                {grouped.map(({ lo, items, ext }) => {
                  const active = items.filter((i) => i.status === "active").length;
                  const draft = items.filter((i) => i.status === "draft").length;
                  const extActive = ext.filter((i) => i.status === "active").length;
                  const flagged = items.filter((i) => i.status === "active" && i.review_flag && i.review_flag !== "ok").length;
                  return (
                    <AccordionItem key={lo.id} value={String(lo.id)} className="border rounded-xl px-4">
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center justify-between gap-3 w-full pr-2 text-left">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{lo.objective_text}</p>
                            {!subtopicId && (
                              <p className="text-xs text-muted-foreground truncate">{bankQuery.data.subtopicNames.get(lo.subtopic_id)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {lo.bloom_level && <Badge variant="outline" className="text-xs capitalize">{lo.bloom_level}</Badge>}
                            <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-300">{active}</Badge>
                            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-700 border-slate-300">{draft}</Badge>
                            {flagged > 0 && <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-300">{flagged}</Badge>}
                            {ext.length > 0 && <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-300" title="Short/long + case-based questions (active / total)">{extActive}/{ext.length} S+C</Badge>}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {items.length === 0 && ext.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No questions yet — use Generate above.</p>
                        ) : (
                          <div className="space-y-3 pb-2">
                            {ext.length > 0 && <p className="text-xs font-semibold text-muted-foreground pt-1">Short-answer &amp; case-based</p>}
                            {ext.map((item) => (
                              <ExtendedItemCard
                                key={item.id} item={item} busy={busyItem === item.id}
                                onApprove={() => setExtStatus([item.id], "active")}
                                onRetire={() => setExtStatus([item.id], "retired")}
                              />
                            ))}
                            {items.length > 0 && ext.length > 0 && <p className="text-xs font-semibold text-muted-foreground pt-1">Multiple choice</p>}
                            {items.map((item) => (
                              <ItemCard
                                key={item.id} item={item} busy={busyItem === item.id}
                                misconceptions={bankQuery.data!.misconceptions}
                                onApprove={() => setStatus(item.id, "active")}
                                onRetire={() => setStatus(item.id, "retired")}
                                onFixKey={(letter) => fixKey(item.id, letter)}
                                onDismissFlag={() => setStatus(item.id, "active", true)}
                              />
                            ))}
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function ItemCard({ item, busy, misconceptions, onApprove, onRetire, onFixKey, onDismissFlag }: {
  item: QuestionRow; busy: boolean; misconceptions: Map<number, string>;
  onApprove: () => void; onRetire: () => void; onFixKey: (letter: string) => void; onDismissFlag: () => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [newKey, setNewKey] = useState(item.correct_option);
  const flagged = item.review_flag && item.review_flag !== "ok";
  const flagStyle = item.review_flag && item.review_flag !== "ok" ? FLAG_STYLES[item.review_flag as Exclude<ReviewFlag, null | "ok">] : null;

  return (
    <div className={cn("rounded-xl border-2 p-3.5 space-y-2.5", flagged ? "border-red-300 bg-red-50/40" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-snug">{item.stem}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className={cn("text-xs", item.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : item.status === "draft" ? "bg-slate-100 text-slate-700 border-slate-300" : "bg-muted text-muted-foreground")}>
            {item.status}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {(Object.entries(item.options) as [string, string][]).map(([key, value]) => {
          const mcId = item.distractor_misconceptions[key];
          const mcText = mcId != null ? misconceptions.get(mcId) : null;
          return (
            <div key={key} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs", key === item.correct_option ? "border-emerald-400 bg-emerald-50" : "border-border")}>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold", key === item.correct_option ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>
                {key === item.correct_option ? <CheckCircle2 className="h-3 w-3" /> : key}
              </span>
              <div className="min-w-0">
                <p className="leading-snug">{value}</p>
                {mcText && <p className="text-[10px] text-amber-700 mt-0.5">Catches: {mcText}</p>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
        {item.bloom_level && <Badge variant="outline" className="text-xs capitalize">{item.bloom_level}</Badge>}
        <Badge variant="outline" className="text-xs">
          {item.calibration_status === "prior" ? `Difficulty: AI estimate (b=${Number(item.irt_b).toFixed(1)})` : `Difficulty: calibrated, n=${item.n_responses} (b=${Number(item.irt_b).toFixed(1)})`}
        </Badge>
        {item.ai_generated && <Badge variant="outline" className="text-xs">AI-authored</Badge>}
        {flagStyle && <Badge variant="outline" className={cn("text-xs border", flagStyle.className)}>{flagStyle.label}</Badge>}
      </div>

      {flagged && item.review_note && (
        <div className="flex items-start gap-1.5 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{item.review_note}</span>
        </div>
      )}

      {flagged && !fixing && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFixing(true)}>Fix answer key</Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDismissFlag} disabled={busy}>Looks fine, keep active</Button>
        </div>
      )}
      {fixing && (
        <div className="flex items-center gap-2">
          <Select value={newKey} onValueChange={(v) => setNewKey(v as QuestionRow["correct_option"])}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{(["A", "B", "C", "D"] as const).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="h-8" disabled={busy} onClick={() => { onFixKey(newKey); setFixing(false); }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save & reactivate"}
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setFixing(false)}>Cancel</Button>
        </div>
      )}

      {!flagged && (
        <div className="flex gap-2 pt-0.5">
          {item.status === "draft" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onApprove}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve</>}
            </Button>
          )}
          {item.status === "active" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={onRetire}>
              <Archive className="h-3.5 w-3.5 mr-1" /> Retire
            </Button>
          )}
          {item.status === "draft" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={onRetire}>
              <XCircle className="h-3.5 w-3.5 mr-1" /> Discard
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────
function ExtendedItemCard({ item, busy, onApprove, onRetire }: {
  item: ExtendedRow; busy: boolean; onApprove: () => void; onRetire: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <p className="text-sm font-medium leading-snug">{item.stem}</p>
          {item.context_passage && (
            <p className="text-xs leading-relaxed rounded-lg bg-muted/50 border px-2.5 py-2">{item.context_passage}</p>
          )}
          {item.sub_questions.length > 0 && (
            <ol className="space-y-1">
              {item.sub_questions.map((q) => (
                <li key={q.id} className="text-xs flex gap-2">
                  <span className="font-semibold uppercase shrink-0">({q.id})</span>
                  <span className="flex-1">{q.text}</span>
                  <span className="text-muted-foreground shrink-0">[{q.max_marks}]</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <Badge variant="outline" className={cn("text-xs shrink-0", item.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : item.status === "draft" ? "bg-slate-100 text-slate-700 border-slate-300" : "bg-muted text-muted-foreground")}>
          {item.status}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-300">{EXT_TYPE_LABEL[item.question_type] ?? item.question_type}</Badge>
        <Badge variant="outline" className="text-xs">{item.max_marks} marks</Badge>
        {item.difficulty && <Badge variant="outline" className="text-xs capitalize">{item.difficulty}</Badge>}
        {item.bloom_level && <Badge variant="outline" className="text-xs capitalize">{item.bloom_level}</Badge>}
        {item.ai_generated && <Badge variant="outline" className="text-xs">AI-authored</Badge>}
      </div>

      {(item.model_answer || item.rubric.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Model answer &amp; marking scheme (teachers only)</summary>
          <div className="mt-2 space-y-2">
            {item.model_answer && <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 leading-relaxed">{item.model_answer}</p>}
            {item.rubric.map((r, i) => (
              <div key={i} className="flex gap-2">
                <span className="flex-1"><span className="font-medium">{r.criterion}</span>{r.description ? ` — ${r.description}` : ""}</span>
                <span className="text-muted-foreground shrink-0">{r.max_marks}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex gap-2 pt-0.5">
        {item.status === "draft" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={onApprove}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve</>}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={onRetire}>
          {item.status === "draft" ? <><XCircle className="h-3.5 w-3.5 mr-1" /> Discard</> : <><Archive className="h-3.5 w-3.5 mr-1" /> Retire</>}
        </Button>
      </div>
    </div>
  );
}
