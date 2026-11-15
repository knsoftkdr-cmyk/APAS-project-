import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useFlashcardCatalog, useGenerateFlashcards } from "@/hooks/useFlashcards";
import { CARD_TYPES, CARD_TYPE_LABELS, type CardType, type GenerateResult } from "@/lib/flashcards";
import { CARD_THEME } from "./cardTheme";
import { subjectEmoji } from "./subjectEmoji";

const TYPE_HELP: Record<CardType, string> = {
  definition: "What does a word mean?",
  concept: "Why or how does it work?",
  fact: "Key things to remember",
  qa: "Quick exam-style questions",
};
const COUNTS = [5, 10, 15] as const;


interface Props {
  onCreated: (result: GenerateResult, scope: { topicId?: number; chapterId?: number }) => void;
  onCancel: () => void;
}

export function FlashcardPicker({ onCreated, onCancel }: Props) {
  const [subject, setSubject] = useState<string | undefined>();
  const [chapterId, setChapterId] = useState<string>("");
  const [topicId, setTopicId] = useState<string>("all");
  const [types, setTypes] = useState<CardType[]>([...CARD_TYPES]);
  const [count, setCount] = useState<number>(10);

  const subjects = useFlashcardCatalog();
  const tree = useFlashcardCatalog(subject);
  const generate = useGenerateFlashcards();

  const chapter = useMemo(() => tree.data?.chapters?.find((c) => String(c.id) === chapterId), [tree.data, chapterId]);
  const canGo = !!subject && !!chapter && types.length > 0 && !generate.isPending;

  const toggleType = (t: CardType) => setTypes((cur) => (cur.includes(t) ? (cur.length > 1 ? cur.filter((x) => x !== t) : cur) : [...cur, t]));

  const go = async () => {
    if (!chapter) return;
    const scope = topicId === "all" ? { chapterId: chapter.id } : { topicId: Number(topicId) };
    try {
      const res = await generate.mutateAsync({ ...scope, types, count });
      if (res.added === 0) toast.info(res.message ?? "No new cards this time.");
      else onCreated(res, scope);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't make flashcards. Please try again.");
    }
  };

  if (subjects.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-32 w-full" /></div>;
  if (subjects.isError) {
    return (
      <div className="text-center space-y-3 py-6">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
        <p className="font-medium">Couldn't load your subjects</p>
        <p className="text-sm text-muted-foreground">{subjects.error instanceof Error ? subjects.error.message : "Something went wrong."}</p>
        <Button variant="outline" onClick={() => subjects.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!subjects.data?.subjects.length) {
    return <p className="text-center text-sm text-muted-foreground py-6">{subjects.data?.message ?? "No subjects are set up for your class yet."}</p>;
  }

  return (
    <div className="space-y-6" data-testid="flashcard-picker">
      <section className="space-y-2">
        <h3 className="font-bold text-base">1. Pick a subject</h3>
        <div className="flex flex-wrap gap-2">
          {subjects.data.subjects.map((s) => (
            <button key={s.key} type="button" onClick={() => { setSubject(s.label); setChapterId(""); setTopicId("all"); }}
              aria-pressed={subject === s.label}
              className={cn("rounded-2xl border-2 px-4 py-3 min-h-[48px] text-sm font-semibold flex items-center gap-2 transition active:scale-95",
                subject === s.label ? "border-primary bg-primary/10" : "border-border bg-white hover:bg-muted")}>
              <span className="text-xl" aria-hidden>{subjectEmoji(s.label)}</span>{s.label}
            </button>
          ))}
        </div>
      </section>

      {subject && (
        <section className="space-y-2">
          <h3 className="font-bold text-base">2. Pick a chapter and topic</h3>
          {tree.isLoading ? <Skeleton className="h-10 w-full" /> : tree.isError ? (
            <p className="text-sm text-destructive">{tree.error instanceof Error ? tree.error.message : "Couldn't load chapters."}</p>
          ) : !tree.data?.chapters?.length ? (
            <p className="text-sm text-muted-foreground">No chapters have been added for this subject yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={chapterId} onValueChange={(v) => { setChapterId(v); setTopicId("all"); }}>
                <SelectTrigger className="h-12 rounded-xl" aria-label="Chapter"><SelectValue placeholder="Choose a chapter" /></SelectTrigger>
                <SelectContent>
                  {tree.data.chapters.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={topicId} onValueChange={setTopicId} disabled={!chapter}>
                <SelectTrigger className="h-12 rounded-xl" aria-label="Topic"><SelectValue placeholder="Whole chapter" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Whole chapter</SelectItem>
                  {chapter?.topics.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}{t.in_deck ? ` (${t.in_deck} in your deck)` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-bold text-base">3. What kind of cards?</h3>
        <div className="grid grid-cols-2 gap-2">
          {CARD_TYPES.map((t) => {
            const on = types.includes(t);
            return (
              <button key={t} type="button" onClick={() => toggleType(t)} aria-pressed={on}
                className={cn("rounded-2xl border-2 p-3 text-start min-h-[64px] transition active:scale-95", on ? `bg-gradient-to-br ${CARD_THEME[t].front}` : "bg-white border-border opacity-70")}>
                <div className="font-bold text-sm"><span aria-hidden>{CARD_THEME[t].emoji}</span> {CARD_TYPE_LABELS[t]}</div>
                <div className="text-xs text-muted-foreground">{TYPE_HELP[t]}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-bold text-base">4. How many?</h3>
        <div className="flex gap-2">
          {COUNTS.map((n) => (
            <button key={n} type="button" onClick={() => setCount(n)} aria-pressed={count === n}
              className={cn("flex-1 rounded-xl border-2 py-3 min-h-[48px] font-bold transition", count === n ? "border-primary bg-primary/10" : "border-border bg-white hover:bg-muted")}>{n}</button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Cards are made from your own textbook, so they match what you learn in class.</p>
      </section>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={generate.isPending}>Back</Button>
        <Button size="lg" className="flex-1 h-14 text-base rounded-2xl" disabled={!canGo} onClick={go}>
          {generate.isPending ? <><Loader2 className="h-5 w-5 animate-spin me-2" /> Making your cards…</> : <><Sparkles className="h-5 w-5 me-2" /> Make my flashcards</>}
        </Button>
      </div>
      {generate.isPending && <p className="text-center text-xs text-muted-foreground">This can take up to half a minute - good flashcards take a moment to make! ✨</p>}
    </div>
  );
}
