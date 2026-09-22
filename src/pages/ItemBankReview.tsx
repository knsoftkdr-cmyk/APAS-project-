import { useEffect, useMemo, useState } from "react";
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

export default function ItemBankReview() {
  const queryClient = useQueryClient();

  // ── Scope picker (subject -> chapter -> topic -> concept) ────────────────
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [subtopicId, setSubtopicId] = useState("");
  const [books, setBooks] = useState<BookOption[]>([]);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [concepts, setConcepts] = useState<ConceptOption[]>([]);

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookOption[]) ?? []));
  }, []);
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
      if (subtopicIds.length === 0) return { objectives: [] as LearningObjectiveRow[], items: [] as QuestionRow[], subtopicNames, misconceptions: new Map<number, string>() };

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
      // Retired items are hidden from the default view to keep the list focused;
      // they're never served anyway and the audit trail lives in the DB.
      return {
        objectives: (objectives ?? []) as LearningObjectiveRow[],
        items: (items ?? []) as QuestionRow[],
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

  const runGenerate = async () => {
    setGenerating(true);
    try {
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
        items_calibrated: number; responses_used: number; converged: boolean;
        flagged_count: number; auto_suspended_count: number; mean_abs_b_shift: number;
      }>("calibrate-irt", { scope_type: type, scope_id: id, dry_run: dryRun });
      toast.success(dryRun ? "Dry run complete" : "Calibration complete", {
        description: `${res.items_calibrated} item${res.items_calibrated === 1 ? "" : "s"} re-estimated from ${res.responses_used} responses` +
          (res.flagged_count > 0 ? ` — ${res.flagged_count} flagged for review${res.auto_suspended_count > 0 ? `, ${res.auto_suspended_count} auto-suspended` : ""}.` : "."),
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

  const grouped = useMemo(() => {
    if (!bankQuery.data) return [];
    const byLo = new Map<number, QuestionRow[]>();
    for (const it of bankQuery.data.items) {
      const arr = byLo.get(it.learning_objective_id) ?? [];
      arr.push(it);
      byLo.set(it.learning_objective_id, arr);
    }
    return bankQuery.data.objectives.map((lo) => ({ lo, items: byLo.get(lo.id) ?? [] }));
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
    <AppLayout>
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
          <CardContent className="p-4 md:p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Select value={bookId} onValueChange={onBookChange}>
                <SelectTrigger><SelectValue placeholder="Choose a subject" /></SelectTrigger>
                <SelectContent>
                  {books.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.subject}{b.class_name ? ` · Class ${b.class_name}` : ""}</SelectItem>)}
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
            Choose at least a subject, chapter and topic to see and manage its question bank.
          </CardContent></Card>
        )}

        {scopeReady && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-600" /> Generate questions</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Tops up every learning objective in {subtopicId ? "this concept" : "this topic"} to the target below. Already-full objectives are skipped.
                  </p>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-muted-foreground shrink-0">Target per objective</label>
                    <Input type="number" min={2} max={12} value={targetPerObjective}
                      onChange={(e) => setTargetPerObjective(Math.min(12, Math.max(2, Number(e.target.value) || 8)))}
                      className="h-8 w-20" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={autoActivate} onCheckedChange={(v) => setAutoActivate(v === true)} />
                    Activate immediately (skip draft review)
                  </label>
                  <Button size="sm" onClick={runGenerate} disabled={generating} className="w-full">
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                    Generate
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
                {grouped.map(({ lo, items }) => {
                  const active = items.filter((i) => i.status === "active").length;
                  const draft = items.filter((i) => i.status === "draft").length;
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
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {items.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No questions yet — use Generate above.</p>
                        ) : (
                          <div className="space-y-3 pb-2">
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
    </AppLayout>
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