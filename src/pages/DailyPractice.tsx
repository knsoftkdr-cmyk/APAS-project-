import { useMemo, useState } from "react";
import { BookOpenCheck, CalendarDays, Flame, History as HistoryIcon, Loader2, Play, RotateCcw, Sparkles, Target, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdaptivePracticeWidget } from "@/components/AdaptivePracticeWidget";
import { DppRunner } from "@/components/dpp/DppRunner";
import { DppResultView } from "@/components/dpp/DppResultView";
import { AccuracyBars, WeekTrendChart } from "@/components/dpp/DppCharts";
import { recordGameRound } from "@/lib/gamification2";
import { DIFFICULTY_CLASS, formatDuration, friendlyDppError, percentTone, TONE_CLASS, type DppAssignment, type DppResult, type DppRun } from "@/lib/dpp";
import { useDppHistory, useDppRecommendations, useDppResult, useDppStats, useDppToday, useStartDpp } from "@/hooks/useDpp";
import { useQueryClient } from "@tanstack/react-query";

type View = { kind: "home" } | { kind: "run"; run: DppRun } | { kind: "result"; attemptId: string; fresh?: DppResult };

function AssignmentCard({ a, busy, onStart, onReview }: { a: DppAssignment; busy: boolean; onStart: () => void; onReview: () => void }) {
  const done = a.status === "submitted";
  return (
    <Card className={a.overdue ? "border-amber-300" : undefined}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{a.title}</p>
            <Badge variant="outline" className={DIFFICULTY_CLASS[a.difficulty] ?? DIFFICULTY_CLASS.mixed}>{a.difficulty}</Badge>
            {a.source === "auto" && <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" />Picked for you</Badge>}
            {a.overdue && <Badge variant="outline" className="border-amber-400 text-amber-700">From an earlier day</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {a.subject}{a.chapter ? ` · ${a.chapter}` : ""} · {a.question_count} questions · {a.total_marks} marks
            {a.time_limit_minutes ? ` · ${a.time_limit_minutes} min` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {done && a.percent != null && <Badge variant="outline" className={TONE_CLASS[percentTone(a.percent)]}>{Math.round(a.percent)}%{a.grading_status === "pending_manual" ? " · marking" : ""}</Badge>}
          {done
            ? <Button variant="outline" onClick={onReview}>View result</Button>
            : <Button onClick={onStart} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : a.status === "in_progress" ? <RotateCcw className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}{a.status === "in_progress" ? "Resume" : "Start practice"}</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultScreen({ attemptId, fresh, onBack }: { attemptId: string; fresh?: DppResult; onBack: () => void }) {
  const q = useDppResult(fresh ? null : attemptId);
  const result = fresh ?? q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="ghost" onClick={onBack}>← Back to Daily Practice</Button>
      {!result && !q.error && <Skeleton className="h-64 w-full" />}
      {q.error && <p className="text-sm text-red-600">{friendlyDppError(q.error)}</p>}
      {result && <DppResultView result={result} showTutor />}
    </div>
  );
}

export default function DailyPractice() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [subject, setSubject] = useState<string>("all");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [practice, setPractice] = useState<{ id: number; label: string } | null>(null);
  const qc = useQueryClient();
  const today = useDppToday();
  const stats = useDppStats();
  const history = useDppHistory();
  const recs = useDppRecommendations();
  const start = useStartDpp();

  const assignments = useMemo(() => today.data?.assignments ?? [], [today.data]);
  const subjects = useMemo(() => Array.from(new Set(assignments.map((a) => a.subject))), [assignments]);
  const shown = assignments.filter((a) => subject === "all" || a.subject === subject);
  const todays = shown.filter((a) => a.assigned_for === today.data?.today);
  const earlier = shown.filter((a) => a.assigned_for !== today.data?.today);
  const streak = today.data?.streak ?? stats.data?.streak;

  const begin = async (a: DppAssignment) => {
    setStartingId(a.assignment_id);
    try {
      const run = await start.mutateAsync(a.assignment_id);
      if (run.time_up) { toast.info("The time for this practice ran out, so it was submitted."); qc.invalidateQueries({ queryKey: ["dpp"] }); setView({ kind: "result", attemptId: run.attempt_id }); return; }
      setView({ kind: "run", run });
    } catch (e) {
      const msg = friendlyDppError(e);
      toast.error(msg);
      if (msg.includes("already submitted")) qc.invalidateQueries({ queryKey: ["dpp"] });
    } finally { setStartingId(null); }
  };

  const finished = (r: DppResult) => {
    qc.invalidateQueries({ queryKey: ["dpp"] });
    setView({ kind: "result", attemptId: r.attempt_id, fresh: r });
    // Gamification 2.0: one round per attempt (dedupe key), never blocks the result screen.
    void recordGameRound({
      game_id: "dpp", subject: r.subject, accuracy: Math.round(r.accuracy), score: r.score, max_score: r.max_score,
      questions_attempted: r.correct + r.incorrect, duration_seconds: r.time_taken_seconds ?? 0,
    }, `dpp:${r.attempt_id}`).then((g) => {
      const xp = (g.awarded?.round_xp ?? 0) + (g.awarded?.mission_xp ?? 0) + (g.awarded?.badge_bonus_xp ?? 0);
      if (!g.duplicate && xp > 0) toast.success(`+${xp} XP for finishing practice!`);
    }).catch(() => { /* rewards are optional */ });
  };

  if (view.kind === "run") {
    return <AppLayout><DppRunner run={view.run} onFinished={finished} onExit={() => { qc.invalidateQueries({ queryKey: ["dpp"] }); setView({ kind: "home" }); }} /></AppLayout>;
  }
  if (view.kind === "result") {
    return <AppLayout><ResultScreen attemptId={view.attemptId} fresh={view.fresh} onBack={() => setView({ kind: "home" })} /></AppLayout>;
  }

  return (
    <AppLayout>
      <PageHeader title="Daily Practice" subtitle="A fresh set every day, matched to your class and what you need to practise." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Flame} label="Day streak" value={streak ? `${streak.current}` : "0"} />
        <StatCard icon={Trophy} label="Best streak" value={streak ? `${streak.longest}` : "0"} />
        <StatCard icon={Target} label="Average score" value={stats.data ? `${Math.round(stats.data.totals.avg_percent)}%` : "—"} />
        <StatCard icon={BookOpenCheck} label="Sets completed" value={streak ? `${streak.total_completed}` : "0"} />
      </div>

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today"><CalendarDays className="mr-1 h-4 w-4" />Today</TabsTrigger>
          <TabsTrigger value="progress"><Target className="mr-1 h-4 w-4" />My progress</TabsTrigger>
          <TabsTrigger value="history"><HistoryIcon className="mr-1 h-4 w-4" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-4">
          {today.isLoading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
          {today.error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{friendlyDppError(today.error)} <Button size="sm" variant="link" onClick={() => today.refetch()}>Retry</Button></p>}
          {today.data && subjects.length > 1 && (
            <div className="flex flex-wrap gap-2" aria-label="Filter by subject">
              {["all", ...subjects].map((s) => (
                <Button key={s} size="sm" variant={subject === s ? "default" : "outline"} onClick={() => setSubject(s)}>{s === "all" ? "All subjects" : s}</Button>
              ))}
            </div>
          )}
          {today.data && todays.length === 0 && earlier.length === 0 && (
            <EmptyState icon={CalendarDays} title="No practice for today yet" description="Your teacher hasn't assigned a set, and there aren't enough reviewed questions for your class to build one automatically. Check back later." />
          )}
          {todays.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold text-muted-foreground">Today</h3>
            {todays.map((a) => <AssignmentCard key={a.assignment_id} a={a} busy={startingId === a.assignment_id} onStart={() => void begin(a)} onReview={() => setView({ kind: "result", attemptId: a.attempt_id! })} />)}</div>}
          {earlier.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold text-muted-foreground">Still to do</h3>
            {earlier.map((a) => <AssignmentCard key={a.assignment_id} a={a} busy={startingId === a.assignment_id} onStart={() => void begin(a)} onReview={() => setView({ kind: "result", attemptId: a.attempt_id! })} />)}</div>}

          {(recs.data?.length ?? 0) > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" />Practise your weak spots</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {recs.data!.map((r) => (
                  <div key={r.subtopic_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div><p className="text-sm font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{[r.subject, r.chapter].filter(Boolean).join(" · ")} · {r.accuracy}% correct over {r.answered} questions</p></div>
                    <Button size="sm" variant="outline" onClick={() => setPractice({ id: r.subtopic_id, label: r.name })}>Adaptive practice</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="progress" className="space-y-4">
          {stats.isLoading && <Skeleton className="h-64 w-full" />}
          {stats.data && stats.data.totals.attempts === 0 && <EmptyState icon={Target} title="No results yet" description="Finish your first practice and your progress will show up here." />}
          {stats.data && stats.data.totals.attempts > 0 && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader><CardTitle className="text-base">This week</CardTitle></CardHeader><CardContent><WeekTrendChart data={stats.data.week} /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Accuracy by subject</CardTitle></CardHeader><CardContent><AccuracyBars data={stats.data.by_subject} nameKey="subject" /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Accuracy by difficulty</CardTitle></CardHeader><CardContent><AccuracyBars data={stats.data.by_difficulty} nameKey="difficulty" /></CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Needs more practice</CardTitle></CardHeader><CardContent className="space-y-2">
                  {stats.data.improve.length === 0 && <p className="text-sm text-muted-foreground">Nothing stands out - keep going!</p>}
                  {stats.data.improve.map((i) => <div key={i.subject + i.chapter} className="flex items-center justify-between text-sm"><span>{i.subject} · {i.chapter}</span><Badge variant="outline" className={TONE_CLASS.low}>{i.accuracy}%</Badge></div>)}
                </CardContent></Card>
              </div>
              <p className="text-sm text-muted-foreground">{stats.data.totals.correct} correct and {stats.data.totals.incorrect} wrong out of {stats.data.totals.questions} questions · {formatDuration(stats.data.totals.time_seconds)} spent practising.</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {history.isLoading && <Skeleton className="h-40 w-full" />}
          {history.data?.length === 0 && <EmptyState icon={HistoryIcon} title="No history yet" description="Completed practice sets will be listed here." />}
          {history.data?.map((h) => (
            <Card key={h.attempt_id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><p className="font-medium">{h.title}</p><p className="text-sm text-muted-foreground">{h.subject} · {new Date(h.submitted_at).toLocaleDateString()} · <Timer className="mr-0.5 inline h-3 w-3" />{formatDuration(h.time_taken_seconds)}</p></div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={TONE_CLASS[percentTone(h.percent)]}>{Math.round(h.percent)}% · {h.score}/{h.max_score}</Badge>
                <Button size="sm" variant="outline" onClick={() => setView({ kind: "result", attemptId: h.attempt_id })}>Review</Button>
              </div>
            </CardContent></Card>
          ))}
        </TabsContent>
      </Tabs>

      {practice && (
        <AdaptivePracticeWidget open onOpenChange={(o) => { if (!o) { setPractice(null); qc.invalidateQueries({ queryKey: ["dpp"] }); } }}
          scopeType="concept" scopeId={practice.id} scopeLabel={practice.label} source="direct" />
      )}
    </AppLayout>
  );
}
