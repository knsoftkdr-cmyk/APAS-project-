import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Flame, Loader2, Plus, RotateCw, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FlashcardPicker } from "@/components/flashcards/FlashcardPicker";
import { StudySession } from "@/components/flashcards/StudySession";
import { useFlashcardOverview, useStartStudy } from "@/hooks/useFlashcards";
import type { DeckSummary, StudyCard } from "@/lib/flashcards";

type View = "home" | "create" | "study" | "empty";
interface StudyState { cards: StudyCard[]; title: string }

export default function Flashcards({ embedded = false }: { embedded?: boolean } = {}) {
  const overview = useFlashcardOverview();
  const start = useStartStudy();
  const [view, setView] = useState<View>("home");
  const [session, setSession] = useState<StudyState | null>(null);

  const begin = async (args: Parameters<typeof start.mutateAsync>[0], title: string) => {
    try {
      const q = await start.mutateAsync(args);
      if (!q.cards.length) { setView("empty"); return; }
      setSession({ cards: q.cards, title });
      setView("study");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start your session.");
    }
  };

  const exitStudy = () => { setSession(null); setView("home"); overview.refetch(); };

  return (
    <PageShell embedded={embedded}>
      <div className="max-w-2xl mx-auto p-4 space-y-5">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>🃏</span>
          <h1 className="text-xl font-bold">Flashcards</h1>
        </div>

        {view === "study" && session && <StudySession cards={session.cards} title={session.title} onExit={exitStudy} />}

        {view === "create" && (
          <Card><CardContent className="p-4 sm:p-6">
            <FlashcardPicker
              onCancel={() => setView("home")}
              onCreated={(res, scope) => {
                toast.success(`${res.added} new flashcard${res.added === 1 ? "" : "s"} ready!`);
                void begin({ ...scope, mode: "due", newLimit: Math.max(res.added, 5), limit: 30 }, res.chapter.name);
              }}
            />
          </CardContent></Card>
        )}

        {view === "empty" && (
          <Card><CardContent className="p-8 text-center space-y-3">
            <Trophy className="h-10 w-10 text-emerald-500 mx-auto" />
            <p className="font-medium">You're all caught up!</p>
            <p className="text-sm text-muted-foreground">No cards are waiting right now. Make some new ones, or come back later.</p>
            <Button onClick={() => setView("home")}>Back</Button>
          </CardContent></Card>
        )}

        {view === "home" && (
          <Home
            overview={overview}
            starting={start.isPending}
            onCreate={() => setView("create")}
            onStudyAll={() => begin({ mode: "due", limit: 20 }, "Today's flashcards")}
            onStudyDeck={(d) => begin({ topicId: d.topic_id, mode: "due", limit: 20 }, d.topic_name)}
            onPracticeDeck={(d) => begin({ topicId: d.topic_id, mode: "practice", limit: 20 }, d.topic_name)}
          />
        )}
      </div>
    </PageShell>
  );
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────

interface HomeProps {
  overview: ReturnType<typeof useFlashcardOverview>;
  starting: boolean;
  onCreate: () => void;
  onStudyAll: () => void;
  onStudyDeck: (d: DeckSummary) => void;
  onPracticeDeck: (d: DeckSummary) => void;
}

function Home({ overview, starting, onCreate, onStudyAll, onStudyDeck, onPracticeDeck }: HomeProps) {
  const { data, isLoading, isError, error, refetch } = overview;

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (isError || !data) {
    const msg = error instanceof Error ? error.message : "Something went wrong.";
    return (
      <Card><CardContent className="p-8 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
        <p className="font-medium">Couldn't load your flashcards</p>
        <p className="text-sm text-muted-foreground">{msg}</p>
        <Button variant="outline" onClick={() => refetch()}>Try again</Button>
      </CardContent></Card>
    );
  }

  const { stats, decks, streak, recent_days, weak_topics } = data;
  const ready = stats.due_now + Math.min(stats.new, data.new_per_session);
  const maxDay = Math.max(1, ...recent_days.map((d) => d.reviews));

  return (
    <div className="space-y-5">
      {/* hero */}
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/10 via-white to-amber-50 overflow-hidden">
        <CardContent className="p-5 space-y-4">
          <div>
            <p className="text-lg font-extrabold">{stats.total === 0 ? "Make your first flashcards!" : ready > 0 ? `${ready} card${ready === 1 ? "" : "s"} ready for you` : "You're all caught up! 🎉"}</p>
            <p className="text-sm text-muted-foreground">
              {stats.total === 0 ? "Pick a chapter and we'll turn your textbook into flip cards." : "A few minutes a day helps you remember for much longer."}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button size="lg" className="h-14 text-base rounded-2xl flex-1" disabled={ready === 0 || starting} onClick={onStudyAll}>
              {starting ? <Loader2 className="h-5 w-5 animate-spin me-2" /> : <RotateCw className="h-5 w-5 me-2" />} Study now
            </Button>
            <Button size="lg" variant="outline" className="h-14 text-base rounded-2xl flex-1" onClick={onCreate}>
              <Sparkles className="h-5 w-5 me-2" /> Make new flashcards
            </Button>
          </div>
        </CardContent>
      </Card>

      {stats.total > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="flashcard-stats">
            <Tile emoji="⏰" label="Due now" value={stats.due_now} />
            <Tile emoji="🌱" label="New" value={stats.new} />
            <Tile emoji="🏆" label="Mastered" value={stats.mastered} />
            <Tile emoji={streak > 0 ? "🔥" : "✨"} label={streak === 1 ? "Day streak" : "Days streak"} value={streak} icon={streak > 0 ? <Flame className="h-4 w-4 text-orange-500" /> : null} />
          </div>

          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">Your last 7 days</p>
              <p className="text-xs text-muted-foreground">{stats.accuracy == null ? "No reviews yet" : `${stats.accuracy}% remembered overall`}</p>
            </div>
            <div className="flex items-end gap-1.5 h-16" role="img" aria-label="Cards reviewed per day, last 7 days">
              {recent_days.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-md bg-primary/70" style={{ height: `${Math.max(4, (d.reviews / maxDay) * 48)}px`, opacity: d.reviews ? 1 : 0.2 }} title={`${d.reviews} reviewed`} />
                  <span className="text-[10px] text-muted-foreground">{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                </div>
              ))}
            </div>
          </CardContent></Card>

          {weak_topics.length > 0 && (
            <Card className="border-rose-200 bg-rose-50/50"><CardContent className="p-4 space-y-1">
              <p className="font-semibold text-sm">💪 Topics to practise</p>
              {weak_topics.map((d) => (
                <p key={d.topic_id} className="text-sm text-muted-foreground">{d.topic_name} - you remember {d.accuracy}% so far</p>
              ))}
            </CardContent></Card>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">My decks</h2>
              <Button size="sm" variant="ghost" onClick={onCreate}><Plus className="h-4 w-4 me-1" /> New</Button>
            </div>
            {decks.map((d) => (
              <Card key={d.topic_id}><CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{d.topic_name}</p>
                    {d.chapter_name && <p className="text-xs text-muted-foreground truncate">{d.chapter_name}</p>}
                  </div>
                  <div className="text-end text-xs shrink-0 space-y-0.5">
                    {d.due > 0 && <p className="text-amber-700 font-semibold">{d.due} due</p>}
                    {d.new > 0 && <p className="text-emerald-700">{d.new} new</p>}
                  </div>
                </div>
                <div className="space-y-1">
                  <Progress value={d.total ? (d.mastered / d.total) * 100 : 0} className="h-2" />
                  <p className="text-[11px] text-muted-foreground">{d.mastered} of {d.total} mastered{d.accuracy != null ? ` · ${d.accuracy}% remembered` : ""}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 min-h-[44px] rounded-xl" disabled={(d.due + d.new) === 0 || starting} onClick={() => onStudyDeck(d)}>Study</Button>
                  <Button size="sm" variant="outline" className="flex-1 min-h-[44px] rounded-xl" disabled={starting} onClick={() => onPracticeDeck(d)}>Practise all</Button>
                </div>
              </CardContent></Card>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Tricky cards also bring their topic back sooner in your <Link to="/daily-review" className="underline">Daily Review</Link>.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ emoji, label, value, icon }: { emoji: string; label: string; value: number; icon?: React.ReactNode }) {
  return (
    <Card><CardContent className="p-3 text-center space-y-0.5">
      <div className="text-xl" aria-hidden>{icon ?? emoji}</div>
      <div className="text-2xl font-extrabold leading-none">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}
