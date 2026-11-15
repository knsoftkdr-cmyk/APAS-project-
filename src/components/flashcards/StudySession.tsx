import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, Loader2, PartyPopper, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useRateFlashcard, useReportFlashcard } from "@/hooks/useFlashcards";
import { requeueAfterRating, type Rating, type StudyCard } from "@/lib/flashcards";
import { FlipCard } from "./FlipCard";

const RATING_UI: { rating: Rating; emoji: string; label: string; sub: string; style: string; key: string }[] = [
  { rating: "easy", emoji: "😄", label: "Easy", sub: "I knew it!", style: "border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900", key: "1" },
  { rating: "medium", emoji: "🙂", label: "Medium", sub: "Almost there", style: "border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900", key: "2" },
  { rating: "difficult", emoji: "😅", label: "Difficult", sub: "Show me again", style: "border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900", key: "3" },
];

interface Tally { rated: number; correct: number; easy: number; medium: number; difficult: number; pulled: number }
const EMPTY: Tally = { rated: 0, correct: 0, easy: 0, medium: 0, difficult: 0, pulled: 0 };

const newSessionId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

interface Props {
  cards: StudyCard[];
  title?: string;
  onExit: () => void;
}

export function StudySession({ cards, title, onExit }: Props) {
  const rate = useRateFlashcard();
  const report = useReportFlashcard();
  const sessionId = useRef(newSessionId());
  const repeats = useRef(new Map<string, number>());
  const [queue, setQueue] = useState<StudyCard[]>(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Tally>(EMPTY);

  const current = queue[index];
  const done = index >= queue.length;
  const busy = rate.isPending;

  const submit = useCallback(async (rating: Rating) => {
    if (!current || busy) return;
    try {
      const res = await rate.mutateAsync({ flashcardId: current.id, rating, sessionId: sessionId.current });
      setTally((t) => ({
        rated: t.rated + 1, correct: t.correct + (res.correct ? 1 : 0),
        easy: t.easy + (rating === "easy" ? 1 : 0), medium: t.medium + (rating === "medium" ? 1 : 0), difficult: t.difficult + (rating === "difficult" ? 1 : 0),
        pulled: t.pulled + (res.daily_review_pulled ? 1 : 0),
      }));
      setQueue((q) => requeueAfterRating(q, index, rating, repeats.current));
      setIndex((i) => i + 1);
      setFlipped(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that. Please try again.");
    }
  }, [current, busy, rate, index]);

  // Keyboard: Space flips; 1 / 2 / 3 rate once the answer is showing. Ignored while a button/input has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"].includes(t.tagName)) return;
      if (!current) return;
      if (e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && ["1", "2", "3"].includes(e.key)) { void submit(RATING_UI[Number(e.key) - 1].rating); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, flipped, submit]);

  const handleReport = async () => {
    if (!current) return;
    try {
      await report.mutateAsync(current.id);
      toast.success("Thanks! We'll stop showing that card to you.");
      setQueue((q) => q.filter((c, i) => i < index || c.id !== current.id));   // drops this card and any repeat of it
      setFlipped(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that report.");
    }
  };

  const pct = useMemo(() => (queue.length ? Math.round((Math.min(index, queue.length) / queue.length) * 100) : 0), [index, queue.length]);

  if (done) return <SessionSummary tally={tally} onExit={onExit} />;

  return (
    <div className="space-y-4" data-testid="study-session">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onExit} aria-label="Stop studying" className="shrink-0"><X className="h-5 w-5" /></Button>
        <div className="flex-1 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{title ?? "Flashcards"}</span>
            <span>Card {Math.min(index + 1, queue.length)} of {queue.length}</span>
          </div>
          <Progress value={pct} className="h-2.5" />
        </div>
      </div>

      <div key={`${current.id}-${index}`} className="apas-card-in">
        <FlipCard card={current} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
      </div>

      {!flipped ? (
        <div className="space-y-2">
          <Button size="lg" className="w-full h-14 text-base rounded-2xl" onClick={() => setFlipped(true)}>
            <RotateCw className="h-5 w-5 me-2" /> Show answer
          </Button>
          <p className="text-center text-xs text-muted-foreground hidden sm:block">Tip: press Space to flip</p>
        </div>
      ) : (
        <div className="space-y-2 apas-card-in">
          <p className="text-center text-sm font-medium text-slate-700">How was that one?</p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {RATING_UI.map((r) => (
              <button
                key={r.rating}
                type="button"
                disabled={busy}
                onClick={() => submit(r.rating)}
                aria-label={`${r.label}: ${r.sub}. Shows again ${current.preview?.[r.rating] ?? ""}`}
                className={cn("rounded-2xl border-2 px-1.5 py-3 min-h-[5.25rem] flex flex-col items-center justify-center gap-0.5 transition active:scale-95 disabled:opacity-60", r.style)}
              >
                <span className="text-2xl" aria-hidden>{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : r.emoji}</span>
                <span className="font-bold text-sm sm:text-base">{r.label}</span>
                <span className="text-[11px] opacity-80 leading-tight">{current.preview?.[r.rating] ?? r.sub}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground hidden sm:block">Keys: 1 Easy · 2 Medium · 3 Difficult</p>
        </div>
      )}

      <div className="flex justify-center">
        <button type="button" onClick={handleReport} disabled={report.isPending}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 min-h-[44px] px-2">
          <Flag className="h-3.5 w-3.5" /> Something looks wrong with this card
        </button>
      </div>
    </div>
  );
}

function SessionSummary({ tally, onExit }: { tally: Tally; onExit: () => void }) {
  const pct = tally.rated ? Math.round((tally.correct / tally.rated) * 100) : 0;
  const message = tally.rated === 0 ? "No cards were studied this time."
    : pct >= 80 ? "Amazing work! You really know this!"
    : pct >= 50 ? "Great effort! The tricky ones will come back so you can master them."
    : "Good try! Practice makes perfect - we'll show the tricky cards again soon.";
  return (
    <div className="text-center space-y-4 py-6 rounded-3xl border-2 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-6" data-testid="session-summary">
      <PartyPopper className="h-14 w-14 mx-auto text-amber-500 apas-pop" />
      <h2 className="text-2xl font-extrabold">Session complete!</h2>
      <p className="text-muted-foreground">{message}</p>
      <div className="grid grid-cols-3 gap-2 max-w-sm mx-auto">
        <Stat emoji="😄" label="Easy" value={tally.easy} />
        <Stat emoji="🙂" label="Medium" value={tally.medium} />
        <Stat emoji="😅" label="Difficult" value={tally.difficult} />
      </div>
      <p className="text-sm">You remembered <b>{tally.correct}</b> of <b>{tally.rated}</b> ({pct}%)</p>
      {tally.pulled > 0 && (
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          {tally.pulled === 1 ? "One tricky card is" : `${tally.pulled} tricky cards are`} linked to a topic that will now come up sooner in your Daily Review.
        </p>
      )}
      <Button size="lg" className="rounded-2xl" onClick={onExit}>Done</Button>
    </div>
  );
}

function Stat({ emoji, label, value }: { emoji: string; label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white border p-3">
      <div className="text-2xl" aria-hidden>{emoji}</div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
