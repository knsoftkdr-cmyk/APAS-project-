import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Gauge, CheckCircle2, XCircle, ChevronRight, Trophy, LogOut, Sparkles,
  Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// ── Types matching supabase/functions/cat-session/index.ts's response shapes ─

type ScopeType = "concept" | "topic" | "chapter" | "subject";
const SCOPE_LEVELS: { type: ScopeType; label: string }[] = [
  { type: "subject", label: "Whole subject" },
  { type: "chapter", label: "This chapter" },
  { type: "topic", label: "This topic" },
  { type: "concept", label: "Just this concept" },
];

interface CatSessionPublic {
  id: string;
  scope_type: ScopeType;
  scope_id: number;
  scope_label: string | null;
  status: "in_progress" | "completed" | "abandoned";
  items_administered: number;
  correct_count: number;
  min_items: number;
  max_items: number;
  precision_pct: number;
  started_at: string;
}
interface CatItemPublic {
  item_id: string;
  seq: number;
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  bloom_level: string | null;
}
interface CatFeedback {
  is_correct: boolean;
  correct_option: string;
  explanation: string | null;
  mastery_before: number | null;
  mastery_after: number | null;
}
interface CatObjectiveBreakdown {
  learning_objective_id: number;
  text: string;
  answered: number;
  correct: number;
  p_mastery: number | null;
}
interface CatMisconception {
  id: number;
  text: string;
  correction_hint: string | null;
  times_selected: number;
}
interface CatResult {
  session: CatSessionPublic & { completed_at: string | null; stop_reason: string | null };
  theta: number;
  se: number;
  scaled_score: number;
  band: "foundation" | "developing" | "proficient" | "advanced";
  provisional: boolean;
  calibrated_fraction: number;
  accuracy: number;
  by_objective: CatObjectiveBreakdown[];
  misconceptions: CatMisconception[];
}
interface CatAdvance {
  complete: boolean;
  session?: CatSessionPublic;
  item?: CatItemPublic;
  result?: CatResult;
}
interface CatAvailability {
  active_items: number;
  objectives: number;
  calibrated_items: number;
  ready: boolean;
  min_required: number;
  recommended_items: number;
}

const BAND_STYLES: Record<CatResult["band"], { label: string; className: string }> = {
  foundation: { label: "Foundation", className: "bg-orange-100 text-orange-800 border-orange-300" },
  developing: { label: "Developing", className: "bg-amber-100 text-amber-800 border-amber-300" },
  proficient: { label: "Proficient", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  advanced: { label: "Advanced", className: "bg-blue-100 text-blue-800 border-blue-300" },
};

async function invokeCat<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cat-session", { body: { action, ...body } });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Couldn't reach the adaptive test.");
    throw Object.assign(new Error(message), { code });
  }
  return data as T;
}

// ── Scope picker types ───────────────────────────────────────────────────
interface BookOption { id: number; subject: string; class_name: string | null }
interface ChapterOption { id: number; chapter_name: string }
interface TopicOption { id: number; topic_name: string }
interface ConceptOption { id: number; subtopic_name: string }

type Phase = "pick" | "question" | "feedback" | "result";

export default function AdaptiveTest() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [busyScope, setBusyScope] = useState<ScopeType | null>(null);

  // Scope picker state (subject -> chapter -> topic -> concept)
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [subtopicId, setSubtopicId] = useState("");
  const [books, setBooks] = useState<BookOption[]>([]);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [concepts, setConcepts] = useState<ConceptOption[]>([]);

  // Live test state
  const [session, setSession] = useState<CatSessionPublic | null>(null);
  const [item, setItem] = useState<CatItemPublic | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CatFeedback | null>(null);
  const [pendingNext, setPendingNext] = useState<CatAdvance | null>(null);
  const [result, setResult] = useState<CatResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    supabase.from("books").select("id, subject, class_name").eq("is_active", true).order("subject")
      .then(({ data }) => setBooks((data as BookOption[]) ?? []));
  }, []);
  useEffect(() => {
    setChapterId(""); setTopicId(""); setSubtopicId(""); setChapters([]); setTopics([]); setConcepts([]);
    if (!bookId) return;
    supabase.from("curriculum_chapters")
      .select("id, chapter_name, unit_id, units!inner(book_id)")
      .eq("units.book_id", Number(bookId))
      .then(({ data }) => setChapters((data as ChapterOption[]) ?? []));
  }, [bookId]);
  useEffect(() => {
    setTopicId(""); setSubtopicId(""); setTopics([]); setConcepts([]);
    if (!chapterId) return;
    supabase.from("topics").select("id, topic_name").eq("chapter_id", Number(chapterId))
      .then(({ data }) => setTopics((data as TopicOption[]) ?? []));
  }, [chapterId]);
  useEffect(() => {
    setSubtopicId(""); setConcepts([]);
    if (!topicId) return;
    supabase.from("subtopics").select("id, subtopic_name").eq("topic_id", Number(topicId)).eq("is_active", true)
      .then(({ data }) => setConcepts((data as ConceptOption[]) ?? []));
  }, [topicId]);

  const scopeIdFor = (type: ScopeType): number | null => {
    if (type === "subject") return bookId ? Number(bookId) : null;
    if (type === "chapter") return chapterId ? Number(chapterId) : null;
    if (type === "topic") return topicId ? Number(topicId) : null;
    return subtopicId ? Number(subtopicId) : null;
  };
  const scopeLabelFor = (type: ScopeType): string => {
    if (type === "subject") return books.find((b) => b.id === Number(bookId))?.subject ?? "";
    if (type === "chapter") return chapters.find((c) => c.id === Number(chapterId))?.chapter_name ?? "";
    if (type === "topic") return topics.find((t) => t.id === Number(topicId))?.topic_name ?? "";
    return concepts.find((c) => c.id === Number(subtopicId))?.subtopic_name ?? "";
  };

  const startTest = async (scopeType: ScopeType) => {
    const scopeId = scopeIdFor(scopeType);
    if (!scopeId) return;
    setBusyScope(scopeType);
    try {
      const res = await invokeCat<CatAdvance & { resumed: boolean }>("start", { scope_type: scopeType, scope_id: scopeId });
      if (res.resumed) toast("Resuming your in-progress test");
      applyAdvance(res);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "bank_too_small") {
        toast.error("Not ready yet", { description: err.message });
      } else {
        toast.error("Couldn't start the test", { description: err.message });
      }
    } finally {
      setBusyScope(null);
    }
  };

  const applyAdvance = (res: CatAdvance) => {
    if (res.complete && res.result) {
      setResult(res.result);
      setSession(res.result.session);
      setPhase("result");
    } else if (res.session && res.item) {
      setSession(res.session);
      setItem(res.item);
      setSelectedOption(null);
      setFeedback(null);
      setPendingNext(null);
      setPhase("question");
    }
  };

  const submitAnswer = async () => {
    if (!session || !item || !selectedOption) return;
    setSubmitting(true);
    try {
      const res = await invokeCat<{ feedback: CatFeedback } & CatAdvance>("answer", {
        session_id: session.id, item_id: item.item_id, selected_option: selectedOption,
      });
      setFeedback(res.feedback);
      setPendingNext(res);
      setPhase("feedback");
    } catch (e) {
      const err = e as Error;
      toast.error("Couldn't submit that answer", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const continueAfterFeedback = () => {
    if (pendingNext) applyAdvance(pendingNext);
  };

  const exitTest = async () => {
    setConfirmExit(false);
    if (session) {
      try { await invokeCat("abandon", { session_id: session.id }); } catch { /* best-effort */ }
    }
    resetToPicker();
  };

  const resetToPicker = () => {
    setSession(null); setItem(null); setSelectedOption(null); setFeedback(null);
    setPendingNext(null); setResult(null); setPhase("pick");
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-violet-600 to-fuchsia-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <Gauge className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Adaptive Test</h1>
                <p className="text-violet-100 text-xs md:text-sm mt-0.5">
                  Questions adjust to you as you answer — fewer questions, a truer picture.
                </p>
              </div>
            </div>
            {phase !== "pick" && phase !== "result" && (
              <Button
                variant="ghost" size="sm"
                className="text-white hover:bg-white/20 hover:text-white shrink-0"
                onClick={() => setConfirmExit(true)}
              >
                <LogOut className="h-4 w-4 mr-1" /> Exit
              </Button>
            )}
          </div>
        </div>

        {phase === "pick" && (
          <ScopePicker
            books={books} chapters={chapters} topics={topics} concepts={concepts}
            bookId={bookId} chapterId={chapterId} topicId={topicId} subtopicId={subtopicId}
            setBookId={setBookId} setChapterId={setChapterId} setTopicId={setTopicId} setSubtopicId={setSubtopicId}
            scopeIdFor={scopeIdFor} scopeLabelFor={scopeLabelFor}
            busyScope={busyScope} onStart={startTest}
          />
        )}

        {(phase === "question" || phase === "feedback") && session && item && (
          <QuestionView
            session={session} item={item} selectedOption={selectedOption}
            setSelectedOption={setSelectedOption} feedback={feedback}
            submitting={submitting} onSubmit={submitAnswer} onContinue={continueAfterFeedback}
            isLastKnown={pendingNext?.complete ?? false}
          />
        )}

        {phase === "result" && result && <ResultView result={result} onDone={resetToPicker} />}

        {phase === "pick" && <RecentSessions />}
      </div>

      <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit this test?</AlertDialogTitle>
            <AlertDialogDescription>
              Your progress on this attempt won't be scored. You can start a fresh adaptive test on this topic any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={exitTest}>Exit test</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scope picker: subject -> chapter -> topic -> concept, each level offering
// its own "start" card once selected, so the student chooses how broad a
// test to take.
// ─────────────────────────────────────────────────────────────────────────
function ScopePicker(props: {
  books: BookOption[]; chapters: ChapterOption[]; topics: TopicOption[]; concepts: ConceptOption[];
  bookId: string; chapterId: string; topicId: string; subtopicId: string;
  setBookId: (v: string) => void; setChapterId: (v: string) => void; setTopicId: (v: string) => void; setSubtopicId: (v: string) => void;
  scopeIdFor: (t: ScopeType) => number | null; scopeLabelFor: (t: ScopeType) => string;
  busyScope: ScopeType | null; onStart: (t: ScopeType) => void;
}) {
  const { books, chapters, topics, concepts, bookId, chapterId, topicId, subtopicId } = props;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-600" /> Choose what to test
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <Select value={bookId} onValueChange={props.setBookId}>
              <SelectTrigger><SelectValue placeholder="Choose a subject" /></SelectTrigger>
              <SelectContent>
                {books.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.subject}{b.class_name ? ` · Class ${b.class_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Chapter</label>
            <Select value={chapterId} onValueChange={props.setChapterId} disabled={!bookId}>
              <SelectTrigger><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
              <SelectContent>
                {chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.chapter_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Topic</label>
            <Select value={topicId} onValueChange={props.setTopicId} disabled={!chapterId}>
              <SelectTrigger><SelectValue placeholder="Choose a topic" /></SelectTrigger>
              <SelectContent>
                {topics.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.topic_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Concept (optional)</label>
            <Select value={subtopicId} onValueChange={props.setSubtopicId} disabled={!topicId}>
              <SelectTrigger><SelectValue placeholder="Every concept in the topic" /></SelectTrigger>
              <SelectContent>
                {concepts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.subtopic_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {bookId && (
          <div className="space-y-2 pt-1">
            {SCOPE_LEVELS.filter((l) => props.scopeIdFor(l.type) != null)
              // Show the most specific choice first.
              .reverse()
              .map((l) => (
                <ScopeRow
                  key={l.type} type={l.type} title={l.label} subtitle={props.scopeLabelFor(l.type)}
                  scopeId={props.scopeIdFor(l.type)!} busy={props.busyScope === l.type}
                  onStart={() => props.onStart(l.type)}
                />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeRow({ type, title, subtitle, scopeId, busy, onStart }: {
  type: ScopeType; title: string; subtitle: string; scopeId: number; busy: boolean; onStart: () => void;
}) {
  const { data: avail, isLoading } = useQuery({
    queryKey: ["cat-availability", type, scopeId],
    queryFn: () => invokeCat<CatAvailability>("availability", { scope_type: type, scope_id: scopeId }),
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        {isLoading ? (
          <Skeleton className="h-3 w-28 mt-1.5" />
        ) : avail ? (
          <p className="text-xs text-muted-foreground mt-1">
            {avail.ready
              ? `${avail.active_items} questions ready across ${avail.objectives} skill${avail.objectives === 1 ? "" : "s"}`
              : `Only ${avail.active_items} of ${avail.min_required} questions ready — ask your teacher to add more`}
          </p>
        ) : null}
      </div>
      <Button size="sm" disabled={busy || isLoading || !avail?.ready} onClick={onStart} className="shrink-0">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Start <ChevronRight className="h-4 w-4 ml-0.5" /></>}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Live question + feedback
// ─────────────────────────────────────────────────────────────────────────
function QuestionView(props: {
  session: CatSessionPublic; item: CatItemPublic; selectedOption: string | null;
  setSelectedOption: (v: string) => void; feedback: CatFeedback | null;
  submitting: boolean; onSubmit: () => void; onContinue: () => void; isLastKnown: boolean;
}) {
  const { session, item, selectedOption, feedback } = props;
  const showAnswer = feedback != null;

  const optionStyle = (key: string) => {
    if (!showAnswer) {
      return selectedOption === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40";
    }
    if (key === feedback!.correct_option) return "border-emerald-500 bg-emerald-50";
    if (key === selectedOption) return "border-red-500 bg-red-50";
    return "border-border opacity-60";
  };
  const optionBadgeStyle = (key: string) => {
    if (showAnswer && key === feedback!.correct_option) return "bg-emerald-500 text-white";
    if (showAnswer && key === selectedOption) return "bg-red-500 text-white";
    if (!showAnswer && selectedOption === key) return "bg-primary text-primary-foreground";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Question {session.items_administered + 1} of about {session.min_items}–{session.max_items}</span>
            <span>{session.precision_pct}% confident</span>
          </div>
          <Progress value={session.precision_pct} className="h-1.5" />
        </CardContent>
      </Card>

      <Card className="border-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base leading-relaxed flex items-start gap-2">
            <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
              {item.seq}
            </span>
            <span>{item.stem}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(Object.entries(item.options) as [string, string][]).map(([key, value]) => (
            <button
              key={key}
              onClick={() => !showAnswer && props.setSelectedOption(key)}
              disabled={showAnswer}
              className={cn("w-full flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all duration-200", optionStyle(key))}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors", optionBadgeStyle(key))}>
                {showAnswer && key === feedback!.correct_option ? <CheckCircle2 className="h-5 w-5" />
                  : showAnswer && key === selectedOption ? <XCircle className="h-5 w-5" /> : key}
              </span>
              <span className="text-sm">{value}</span>
            </button>
          ))}

          {showAnswer && (
            <div className={cn(
              "mt-2 rounded-lg p-3 text-sm",
              feedback!.is_correct ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-amber-50 border border-amber-200 text-amber-800",
            )}>
              <p className="font-medium mb-1">{feedback!.is_correct ? "Correct!" : "Not quite"}</p>
              {feedback!.explanation && <p>{feedback!.explanation}</p>}
            </div>
          )}

          <div className="flex justify-end pt-1">
            {!showAnswer ? (
              <Button onClick={props.onSubmit} disabled={!selectedOption || props.submitting}>
                {props.submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Submit Answer
              </Button>
            ) : (
              <Button onClick={props.onContinue}>
                {props.isLastKnown ? <>See Results <Trophy className="h-4 w-4 ml-1" /></> : <>Next Question <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Result
// ─────────────────────────────────────────────────────────────────────────
function ResultView({ result, onDone }: { result: CatResult; onDone: () => void }) {
  const band = BAND_STYLES[result.band];
  const sorted = [...result.by_objective].sort((a, b) => (a.p_mastery ?? 1) - (b.p_mastery ?? 1));

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-6 text-center text-white">
          <Trophy className="h-10 w-10 mx-auto mb-2 opacity-90" />
          <p className="text-sm text-violet-100">{result.session.scope_label}</p>
          <p className="text-4xl font-bold mt-1">{result.scaled_score}</p>
          <Badge variant="outline" className={cn("mt-2 border", band.className)}>{band.label}</Badge>
        </div>
        <CardContent className="p-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold">{Math.round(result.accuracy * 100)}%</p>
            <p className="text-xs text-muted-foreground">Accuracy</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{result.session.items_administered}</p>
            <p className="text-xs text-muted-foreground">Questions</p>
          </div>
          <div>
            <p className="text-lg font-semibold">±{Math.round(result.se * 100)}</p>
            <p className="text-xs text-muted-foreground">Margin</p>
          </div>
        </CardContent>
        {result.provisional && (
          <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>This score is provisional — most of these questions are still new and haven't been fine-tuned from real student data yet. It'll get more precise over time.</span>
          </div>
        )}
      </Card>

      {sorted.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Skill breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {sorted.map((o) => (
              <div key={o.learning_objective_id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2">{o.text}</span>
                  <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                    {o.correct}/{o.answered}
                    {o.p_mastery != null && (o.p_mastery >= 0.6 ? <TrendingUp className="h-3 w-3 text-emerald-600" /> : o.p_mastery <= 0.3 ? <TrendingDown className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />)}
                  </span>
                </div>
                <Progress value={(o.p_mastery ?? 0) * 100} className="h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {result.misconceptions.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Worth reviewing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.misconceptions.map((m) => (
              <div key={m.id} className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                <p className="font-medium">{m.text}</p>
                {m.correction_hint && <p className="text-xs mt-1 text-amber-800">{m.correction_hint}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button className="w-full" onClick={onDone}>Take another test</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Recent sessions (compact)
// ─────────────────────────────────────────────────────────────────────────
interface RecentSession {
  id: string; scope_label: string | null; status: string; items_administered: number;
  scaled_score: number | null; band: CatResult["band"] | null; provisional: boolean; completed_at: string | null;
}
function RecentSessions() {
  const { data, isLoading } = useQuery({
    queryKey: ["cat-sessions-list"],
    queryFn: () => invokeCat<{ sessions: RecentSession[] }>("list"),
  });
  const completed = (data?.sessions ?? []).filter((s) => s.status === "completed");
  if (isLoading || completed.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4" /> Past adaptive tests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {completed.slice(0, 5).map((s) => (
          <div key={s.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
            <span className="truncate pr-2">{s.scope_label}</span>
            <span className="flex items-center gap-2 shrink-0 text-muted-foreground text-xs">
              {s.items_administered} questions
              {s.scaled_score != null && <Badge variant="outline" className="text-xs">{s.scaled_score}{s.provisional ? "*" : ""}</Badge>}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}