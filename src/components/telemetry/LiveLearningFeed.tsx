import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Activity, BookOpen, Bot, CheckCircle2, ClipboardCheck, Clock, Compass, FileText, Mic, MousePointerClick, RefreshCw, XCircle,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLearningEventStream } from "@/hooks/useLearningEventStream";
import { fetchLearningSummary, type ActivityStatus, type LearningEvent } from "@/lib/learningEvents";

interface Props {
  /** students.id. Student viewing themself, a parent, or staff looking at one student. */
  studentId?: string;
  /** classes.id - staff only; shows the whole class. */
  classId?: string;
  /** True when the viewer IS the student: also listens to Realtime for instant updates. */
  isOwnView?: boolean;
}

const STATUS: Record<ActivityStatus, { label: string; cls: string }> = {
  active_now: { label: "Active now", cls: "bg-green-100 text-green-800 hover:bg-green-100" },
  active_today: { label: "Active today", cls: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  idle: { label: "Quiet for a few days", cls: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" },
  inactive: { label: "Not seen in 3+ days", cls: "bg-red-100 text-red-800 hover:bg-red-100" },
  no_data: { label: "No activity yet", cls: "bg-gray-100 text-gray-600 hover:bg-gray-100" },
};

function iconFor(e: LearningEvent) {
  switch (e.event_type) {
    case "question_answered": return e.is_correct
      ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-500" />;
    case "tutor_message": return <Bot className="h-4 w-4 text-violet-600" />;
    case "adaptive_test_started":
    case "adaptive_test_completed": return <Compass className="h-4 w-4 text-indigo-600" />;
    case "assessment_submitted": return <ClipboardCheck className="h-4 w-4 text-emerald-600" />;
    case "pronunciation_attempt": return <Mic className="h-4 w-4 text-pink-600" />;
    case "resource_opened":
    case "resource_completed": return <BookOpen className="h-4 w-4 text-amber-600" />;
    case "page_view": return <MousePointerClick className="h-4 w-4 text-slate-500" />;
    default: return <FileText className="h-4 w-4 text-slate-500" />;
  }
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  return ms < 45_000 ? "just now" : `${formatDistanceToNowStrict(new Date(iso))} ago`;
};

const minutesLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
const dayLabel = (d: string) => d.slice(5).replace("-", "/");

/** Re-render on an interval so "2 min ago" keeps moving without refetching. */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const id = window.setInterval(() => set((n) => n + 1), ms); return () => window.clearInterval(id); }, [ms]);
}

const RANGES = [{ days: 1, label: "Today" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }];

export default function LiveLearningFeed({ studentId, classId, isOwnView = false }: Props) {
  const isClass = !!classId;
  const [days, setDays] = useState(7);
  useTick(30_000);

  const scope = isClass ? { classId } : { studentId };
  const stream = useLearningEventStream(scope, { realtimeStudentId: isOwnView && !isClass ? studentId : undefined });
  const summaryQ = useQuery({
    queryKey: ["lel-summary", classId ?? "", studentId ?? "", days],
    queryFn: () => fetchLearningSummary(scope, days),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // New events change the numbers too: refresh the summary shortly after the feed moves.
  const newest = stream.events[0]?.id;
  const { refetch } = summaryQ;
  useEffect(() => {
    if (!newest) return;
    const t = window.setTimeout(() => void refetch(), 1500);
    return () => window.clearTimeout(t);
  }, [newest, refetch]);

  if (stream.loading && summaryQ.isLoading) return <Skeleton className="h-72 w-full" />;

  const unavailable = stream.persistence === "unavailable" || summaryQ.data?.persistence === "unavailable";
  if (unavailable) {
    return (
      <Card><CardContent className="py-8 text-center">
        <p className="font-medium">Live learning activity isn't switched on yet.</p>
        <p className="text-sm text-muted-foreground mt-1">An administrator needs to apply the latest database update (learning event stream). Nothing else is affected.</p>
      </CardContent></Card>
    );
  }
  if (stream.error && !stream.events.length) {
    return (
      <Card><CardContent className="py-8 text-center">
        <p className="text-destructive font-medium">Couldn't load learning activity.</p>
        <p className="text-sm text-muted-foreground mt-1">{stream.error}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={stream.refresh}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Try again</Button>
      </CardContent></Card>
    );
  }

  const s = summaryQ.data?.summary;
  const roster = summaryQ.data?.students ?? [];
  const counts = summaryQ.data?.status_counts;
  const chart = (s?.daily ?? []).map((d) => ({ day: dayLabel(d.date), Events: d.events, Questions: d.questions }));

  return (
    <div className="space-y-4">
      {/* header: live indicator + range */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex h-2.5 w-2.5">
            {stream.live && <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 animate-ping" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${stream.live ? "bg-green-500" : "bg-gray-400"}`} />
          </span>
          <span>{stream.live ? "Live" : "Paused"}{stream.lastUpdated ? ` · updated ${ago(new Date(stream.lastUpdated).toISOString())}` : ""}</span>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button key={r.days} size="sm" variant={days === r.days ? "default" : "outline"} onClick={() => setDays(r.days)}>{r.label}</Button>
          ))}
        </div>
      </div>

      {/* tiles */}
      {summaryQ.isLoading || !s ? <Skeleton className="h-24 w-full" /> : isClass ? (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Tile title="Active now" value={String(counts?.active_now ?? 0)} note={`of ${roster.length} students`} />
          <Tile title="Active today" value={String((counts?.active_now ?? 0) + (counts?.active_today ?? 0))} note="including right now" />
          <Tile title="Not seen in 3+ days" value={String((counts?.inactive ?? 0) + (counts?.no_data ?? 0))} note="or never" />
          <Tile title="Questions answered" value={String(s.questions.answered)} note={s.questions.accuracy_pct !== null ? `${s.questions.accuracy_pct}% correct` : "—"} />
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card><CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge className={`mt-1 ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</Badge>
            <p className="text-xs text-muted-foreground mt-1.5">Last seen {ago(s.last_active_at)}</p>
          </CardContent></Card>
          <Tile title="Questions answered" value={String(s.questions.answered)} note={s.questions.accuracy_pct !== null ? `${s.questions.accuracy_pct}% correct` : "—"} />
          <Tile title="Active time (approx.)" value={minutesLabel(s.active_minutes)} note={`${s.sessions} session${s.sessions === 1 ? "" : "s"}`} />
          <Tile title="Days active" value={`${s.active_days}/${s.window_days}`} note={`${s.total_events} events`} />
        </div>
      )}
      {summaryQ.data?.truncated && (
        <p className="text-xs text-muted-foreground">Very busy period: numbers cover the most recent {`5,000`} events.</p>
      )}

      {/* chart */}
      {s && days > 1 && chart.some((d) => d.Events || d.Questions) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Activity per day</CardTitle></CardHeader>
          <CardContent className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Events" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Questions" fill="#2563eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* class roster */}
      {isClass && roster.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Students</CardTitle>
            <CardDescription>Most recently active first. Quiet students are listed last so they are easy to spot.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left font-medium px-4 py-2">Student</th>
                  <th className="text-left font-medium px-2 py-2">Status</th>
                  <th className="text-right font-medium px-2 py-2">Questions</th>
                  <th className="text-right font-medium px-2 py-2">Correct</th>
                  <th className="text-right font-medium px-2 py-2">Active</th>
                  <th className="text-right font-medium px-4 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.student_id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{r.name ?? "Student"}</td>
                    <td className="px-2 py-2"><Badge className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.questions}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.accuracy_pct !== null ? `${r.accuracy_pct}%` : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.active_minutes ? minutesLabel(r.active_minutes) : "—"}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{r.last_active_at ? ago(r.last_active_at) : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summaryQ.data?.roster_truncated && <p className="text-xs text-muted-foreground px-4 py-2">Showing the first 300 students.</p>}
          </CardContent>
        </Card>
      )}

      {/* the live feed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Live feed</CardTitle>
          <CardDescription>
            Answers, tutor questions, tests and exams as they happen. Page visits are included; chat messages and answers themselves are never recorded here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stream.events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No activity yet. It will appear here as soon as it happens.</p>
          ) : (
            <ul className="divide-y max-h-[28rem] overflow-y-auto" aria-live="polite">
              {stream.events.map((e) => (
                <li key={e.id} className={`flex items-start gap-3 py-2.5 px-1 transition-colors ${stream.freshIds.has(e.id) ? "bg-blue-50" : ""}`}>
                  <span className="mt-0.5 shrink-0">{iconFor(e)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {isClass && e.student_name && <span className="font-medium">{e.student_name} · </span>}
                      {e.label}
                    </p>
                    {e.detail && <p className="text-xs text-muted-foreground truncate">{e.detail}</p>}
                  </div>
                  <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />{ago(e.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <Card><CardContent className="pt-5">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </CardContent></Card>
  );
}
