import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, CheckCircle2, Clock3, Target } from "lucide-react";
import { AccuracyBars, WeekTrendChart } from "@/components/dpp/DppCharts";
import { friendlyDppError, percentTone, TONE_CLASS } from "@/lib/dpp";
import { useDppAdminOverview, useDppOverview, useDppPendingManual, useDppSettings, useDppStaffMutations } from "@/hooks/useDpp";

export function PendingMarkingPanel() {
  const q = useDppPendingManual();
  const { grade } = useDppStaffMutations();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [fb, setFb] = useState<Record<string, string>>({});
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!q.data?.length) return <EmptyState icon={CheckCircle2} title="Nothing to mark" description="Open-ended answers appear here after students submit." />;
  return (
    <div className="space-y-3">
      {q.data.map((a) => (
        <Card key={a.answer_id}><CardContent className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">{a.student} · {a.set_title}</p>
          <p className="font-medium">{a.stem}</p>
          <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm">{a.answer}</p>
          {a.explanation && <p className="text-xs text-muted-foreground">Model answer/notes: {a.explanation}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label htmlFor={`m-${a.answer_id}`}>Marks (max {a.marks})</Label>
              <Input id={`m-${a.answer_id}`} type="number" min={0} max={a.marks} step={0.5} className="w-28" value={marks[a.answer_id] ?? ""} onChange={(e) => setMarks({ ...marks, [a.answer_id]: e.target.value })} /></div>
            <div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`f-${a.answer_id}`}>Feedback (optional)</Label>
              <Textarea id={`f-${a.answer_id}`} rows={1} value={fb[a.answer_id] ?? ""} onChange={(e) => setFb({ ...fb, [a.answer_id]: e.target.value })} /></div>
            <Button disabled={grade.isPending || (marks[a.answer_id] ?? "") === ""} onClick={async () => {
              const m = Number(marks[a.answer_id]);
              if (Number.isNaN(m) || m < 0 || m > a.marks) return toast.error(`Marks must be between 0 and ${a.marks}.`);
              try { await grade.mutateAsync({ answerId: a.answer_id, marks: m, feedback: fb[a.answer_id] }); toast.success("Marked."); } catch (e) { toast.error(friendlyDppError(e)); }
            }}>Save mark</Button>
          </div>
        </CardContent></Card>
      ))}
    </div>
  );
}

export function InsightsPanel() {
  const q = useDppOverview(30);
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error) return <p className="text-sm text-red-600">{friendlyDppError(q.error)}</p>;
  const d = q.data!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Students who need support (last 30 days, below 50%)</CardTitle></CardHeader><CardContent className="space-y-2">
        {d.weak_students.length === 0 && <p className="text-sm text-muted-foreground">No students are below 50% right now.</p>}
        {d.weak_students.map((s) => <div key={s.student_id} className="flex items-center justify-between text-sm"><span>{s.name} <span className="text-muted-foreground">{s.class}</span></span><Badge variant="outline" className={TONE_CLASS.low}>{s.avg_percent}% · {s.attempts} sets</Badge></div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Hardest questions (under 40% correct)</CardTitle></CardHeader><CardContent className="space-y-2">
        {d.difficult_questions.length === 0 && <p className="text-sm text-muted-foreground">No question is stumping the class yet (needs at least 3 answers).</p>}
        {d.difficult_questions.map((x) => <div key={x.item_id} className="flex items-start justify-between gap-2 text-sm"><span>{x.stem}<span className="block text-xs text-muted-foreground">{x.set_title} · {x.answered} answers</span></span><Badge variant="outline" className={TONE_CLASS.low}>{x.correct_percent}%</Badge></div>)}
      </CardContent></Card>
    </div>
  );
}

export function AdminAnalyticsPanel() {
  const [days, setDays] = useState(30);
  const q = useDppAdminOverview(days, true);
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error) return <p className="text-sm text-red-600">{friendlyDppError(q.error)}</p>;
  const d = q.data!;
  const completion = d.totals.assigned ? Math.round((100 * d.totals.submitted) / d.totals.assigned) : 0;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">{[7, 30, 60].map((n) => <Button key={n} size="sm" variant={days === n ? "default" : "outline"} onClick={() => setDays(n)}>Last {n} days</Button>)}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Students practising" value={`${d.totals.participants} / ${d.totals.students}`} />
        <StatCard icon={CheckCircle2} label="Completion" value={`${completion}%`} />
        <StatCard icon={Target} label="Average score" value={d.totals.avg_percent != null ? `${Math.round(d.totals.avg_percent)}%` : "—"} />
        <StatCard icon={Clock3} label="Pending now" value={d.totals.pending} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Daily average score</CardTitle></CardHeader><CardContent><WeekTrendChart data={d.daily.map((x) => ({ date: x.date, percent: x.avg_percent, attempts: x.submitted }))} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Subject performance</CardTitle></CardHeader><CardContent>
          <AccuracyBars data={d.by_subject as unknown as Record<string, unknown>[]} nameKey="subject" valueKey="avg_percent" />
          {d.by_subject.filter((s) => s.weak).map((s) => <p key={s.subject} className="mt-1 text-xs text-red-700">Weak subject: {s.subject} ({s.avg_percent}% over {s.answers} answers)</p>)}
        </CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Class-wise activity</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table><TableHeader><TableRow><TableHead>Class</TableHead><TableHead>Assigned</TableHead><TableHead>Submitted</TableHead><TableHead>Completion</TableHead><TableHead>Avg score</TableHead></TableRow></TableHeader>
          <TableBody>{d.by_class.map((c) => <TableRow key={c.class}><TableCell className="font-medium">{c.class}</TableCell><TableCell>{c.assigned}</TableCell><TableCell>{c.submitted}</TableCell><TableCell>{c.completion ?? 0}%</TableCell>
            <TableCell>{c.avg_percent != null ? <Badge variant="outline" className={TONE_CLASS[percentTone(c.avg_percent)]}>{Math.round(c.avg_percent)}%</Badge> : "—"}</TableCell></TableRow>)}
            {d.by_class.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No practice assigned in this period.</TableCell></TableRow>}</TableBody></Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Teacher assignment activity</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table><TableHeader><TableRow><TableHead>Teacher</TableHead><TableHead>Sets created</TableHead><TableHead>Assignments</TableHead><TableHead>Submissions</TableHead></TableRow></TableHeader>
          <TableBody>{d.teachers.map((t) => <TableRow key={t.teacher_id ?? "none"}><TableCell className="font-medium">{t.name ?? "Unknown"}</TableCell><TableCell>{t.sets}</TableCell><TableCell>{t.assignments}</TableCell><TableCell>{t.submissions}</TableCell></TableRow>)}
            {d.teachers.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No teacher-created sets in this period.</TableCell></TableRow>}</TableBody></Table>
      </CardContent></Card>
    </div>
  );
}

export function SettingsPanel() {
  const q = useDppSettings();
  const { saveSettings } = useDppStaffMutations();
  const [tz, setTz] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [count, setCount] = useState<string | null>(null);
  if (q.isLoading) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin" />;
  const cur = q.data!;
  const timezone = tz ?? cur.timezone, autoAssign = auto ?? cur.auto_assign, n = count ?? String(cur.daily_question_count);
  return (
    <Card className="max-w-xl"><CardHeader><CardTitle className="text-base">Daily Practice settings</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="space-y-1"><Label htmlFor="dpp-tz">School time zone (IANA name)</Label><Input id="dpp-tz" value={timezone} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Kolkata" />
        <p className="text-xs text-muted-foreground">Decides when "today" starts for assignments and streaks.</p></div>
      <div className="flex items-center justify-between rounded-md border p-3"><div><p className="text-sm font-medium">Automatic daily practice</p><p className="text-xs text-muted-foreground">Build a personal set for each student every day from reviewed questions.</p></div>
        <Switch checked={autoAssign} onCheckedChange={setAuto} aria-label="Automatic daily practice" /></div>
      <div className="space-y-1"><Label htmlFor="dpp-n">Questions per automatic set (3-30)</Label><Input id="dpp-n" type="number" min={3} max={30} className="w-28" value={n} onChange={(e) => setCount(e.target.value)} /></div>
      <Button disabled={saveSettings.isPending} onClick={async () => {
        try { await saveSettings.mutateAsync({ timezone, autoAssign, count: Number(n) }); toast.success("Settings saved."); } catch (e) { toast.error(friendlyDppError(e)); }
      }}>{saveSettings.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save settings</Button>
    </CardContent></Card>
  );
}
