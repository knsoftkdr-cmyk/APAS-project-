// Class / school engagement overview for teachers (their classes) and admins / principals (their school).
// One component; the server decides the scope from the caller's role.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, RefreshCw, Sparkles, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ACTIVITY_META, ACTIVITY_ORDER, CATEGORY_META, fetchClassEngagement, fetchEngagementOverview,
  type ClassSummary, type EngagementCategory, type EngagementScore, type SlimStudent, type Summary,
} from "@/lib/engagement";
import { CategoryBadge, CategoryLegend, DeltaBadge, ScoreRing, TrendChart } from "./EngagementParts";
import StudentEngagementDialog from "./StudentEngagementDialog";
import EngagementSettingsDialog from "./EngagementSettingsDialog";

const CATS = Object.keys(CATEGORY_META) as EngagementCategory[];

function Distribution({ s }: { s: Summary }) {
  const total = CATS.reduce((n, c) => n + s.category_counts[c], 0);
  if (!total) return <p className="text-xs text-slate-400">No scored students yet.</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Students by engagement category">
        {CATS.map((c) => s.category_counts[c] > 0 && <div key={c} style={{ width: `${(s.category_counts[c] / total) * 100}%`, background: CATEGORY_META[c].ring }} title={`${CATEGORY_META[c].label}: ${s.category_counts[c]}`} />)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
        {CATS.map((c) => <span key={c} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_META[c].ring }} />{CATEGORY_META[c].label}: <b>{s.category_counts[c]}</b></span>)}
      </div>
    </div>
  );
}

function StudentRow({ s, onOpen }: { s: SlimStudent; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-start hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-300">
      <span className="min-w-0 truncate text-sm font-medium text-slate-800">{s.name}</span>
      <span className="flex shrink-0 items-center gap-2">
        {s.delta !== null && <span className={`text-xs font-semibold ${s.delta < 0 ? "text-red-600" : s.delta > 0 ? "text-emerald-600" : "text-slate-400"}`}>{s.delta > 0 ? "+" : ""}{s.delta}</span>}
        <span className="w-10 text-end text-sm font-bold tabular-nums text-blue-950">{Math.round(s.score)}</span>
      </span>
    </button>
  );
}

function ClassDetail({ classId, title, onBack }: { classId: string; title: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ["engagement", "class", classId], queryFn: () => fetchClassEngagement(classId), staleTime: 30_000 });
  const [cat, setCat] = useState<string>("all");
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const students = (q.data?.students ?? []) as EngagementScore[];
  const shown = students.filter((s) => cat === "all" ? true : cat === "declining" ? s.declining : cat === "insufficient" ? s.status === "insufficient" : s.category === cat)
    .sort((a, b) => (a.score ?? -1) - (b.score ?? -1));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={onBack}><ChevronLeft className="h-4 w-4" /> All classes</Button>
        <h3 className="font-semibold text-blue-950">{title}</h3>
      </div>
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? <p className="text-sm text-red-600">{(q.error as Error).message}</p> : q.data && (
        <>
          <div className="grid gap-4 md:grid-cols-[auto,1fr]">
            <div className="flex items-center gap-4"><ScoreRing score={q.data.summary.average} category={q.data.summary.category} size={104} label="class average" />
              <div className="text-xs text-slate-500">{q.data.summary.scored} of {q.data.summary.students} students scored{q.data.summary.declining > 0 && <b className="block text-red-600">{q.data.summary.declining} declining</b>}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><Distribution s={q.data.summary} />
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Where students are not taking part</p>
                {ACTIVITY_ORDER.filter((k) => q.data!.summary.activity_gaps[k] > 0).map((k) => (
                  <p key={k} className="text-xs text-amber-800">{q.data!.summary.activity_gaps[k]} student{q.data!.summary.activity_gaps[k] > 1 ? "s" : ""} - {ACTIVITY_META[k].label}</p>
                ))}
                {ACTIVITY_ORDER.every((k) => q.data!.summary.activity_gaps[k] === 0) && <p className="text-xs text-slate-400">No gaps found.</p>}
              </div></div>
          </div>
          <TrendChart data={q.data.trend.map((t) => ({ date: t.date, value: t.average }))} height={130} ariaLabel="Class engagement trend" />
          <div className="flex items-center gap-2">
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-56 h-8"><SelectValue placeholder="Filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All students</SelectItem>
                {CATS.map((c) => <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>)}
                <SelectItem value="declining">Declining engagement</SelectItem>
                <SelectItem value="insufficient">Not enough data</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-slate-400">{shown.length} shown</span>
          </div>
          <div className="space-y-1.5">
            {shown.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No students match this filter.</p>}
            {shown.map((s) => (
              <button key={s.student_id} onClick={() => setOpen({ id: s.student_id, name: s.name ?? "Student" })}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-start hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-300">
                <span className="text-sm font-medium text-slate-800">{s.name}</span>
                <span className="flex items-center gap-2">
                  {s.declining && <span className="inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"><AlertTriangle className="h-3 w-3" />Declining</span>}
                  <CategoryBadge category={s.category} />
                  <span className="w-9 text-end text-sm font-bold tabular-nums text-blue-950">{s.score === null ? "-" : Math.round(s.score)}</span>
                </span>
              </button>
            ))}
          </div>
          {q.data.pending_refresh > 0 && <p className="text-[11px] text-slate-400">{q.data.pending_refresh} more scores are being refreshed in the background.</p>}
        </>
      )}
      <StudentEngagementDialog studentId={open?.id ?? null} name={open?.name} onClose={() => setOpen(null)} />
    </div>
  );
}

export default function EngagementOverviewPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["engagement", "overview"], queryFn: () => fetchEngagementOverview(), staleTime: 60_000 });
  const [classSel, setClassSel] = useState<ClassSummary | null>(null);
  const [studentSel, setStudentSel] = useState<{ id: string; name: string } | null>(null);
  const d = q.data;
  const isSchool = d?.scope === "school";
  const canConfigure = isSchool; // the server enforces who may actually save

  return (
    <Card className="border-blue-100 shadow-sm overflow-hidden" data-testid="engagement-overview">
      <div className="h-1 bg-gradient-to-r from-blue-950 via-blue-800 to-amber-400" />
      <CardContent className="p-4 md:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base md:text-lg font-semibold text-blue-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-900 to-blue-700"><Sparkles className="h-4 w-4 text-amber-300" /></span>
            Student Engagement {d ? `· ${isSchool ? "School" : "My classes"}` : ""}
          </h2>
          <div className="flex items-center gap-2">
            {canConfigure && <EngagementSettingsDialog />}
            <Button size="sm" variant="outline" className="gap-1.5" disabled={q.isFetching} onClick={() => { fetchEngagementOverview(true).then((r) => qc.setQueryData(["engagement", "overview"], r)).catch(() => q.refetch()); }}>
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} /> Recalculate
            </Button>
          </div>
        </div>

        {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError ? <p className="text-sm text-red-600">{(q.error as Error).message}</p> : d && (
          classSel ? <ClassDetail classId={classSel.class_id} title={`${classSel.name} ${classSel.section}`} onBack={() => setClassSel(null)} /> : (
            <>
              <div className="grid gap-5 md:grid-cols-[auto,1fr]">
                <div className="flex items-center gap-4">
                  <ScoreRing score={d.summary.average} category={d.summary.category} size={118} label={isSchool ? "school average" : "average"} />
                  <div className="space-y-1 text-xs text-slate-500">
                    <p className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {d.summary.scored} of {d.summary.roster} students scored</p>
                    {d.summary.insufficient > 0 && <p>{d.summary.insufficient} with not enough data</p>}
                    {d.summary.not_calculated > 0 && <p>{d.summary.not_calculated} being calculated</p>}
                    {d.summary.declining > 0 && <p className="font-semibold text-red-600">{d.summary.declining} with declining engagement</p>}
                  </div>
                </div>
                <div className="space-y-2"><Distribution s={d.summary} /><CategoryLegend /></div>
              </div>

              <Tabs defaultValue="classes">
                <TabsList className="flex h-auto flex-wrap justify-start">
                  <TabsTrigger value="classes">{isSchool ? "Class comparison" : "My classes"}</TabsTrigger>
                  <TabsTrigger value="students">Students</TabsTrigger>
                  <TabsTrigger value="activities">Activities</TabsTrigger>
                  <TabsTrigger value="trend">Trend</TabsTrigger>
                </TabsList>

                <TabsContent value="classes" className="space-y-2 pt-2">
                  {d.classes.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{isSchool ? "No classes with students yet." : "You are not assigned to any class yet."}</p>}
                  {d.classes.map((c) => (
                    <button key={c.class_id} onClick={() => setClassSel(c)} className="block w-full rounded-lg border border-slate-100 p-3 text-start hover:bg-blue-50/60 focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{c.name} {c.section}</span>
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          {c.declining > 0 && <span className="font-semibold text-red-600">{c.declining} declining</span>}
                          {c.scored}/{c.roster} scored
                          <b className="w-9 text-end text-sm tabular-nums text-blue-950">{c.average === null ? "-" : Math.round(c.average)}</b>
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        {c.average !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(2, c.average)}%`, background: c.category ? CATEGORY_META[c.category].ring : "#94a3b8" }} />}
                      </div>
                    </button>
                  ))}
                </TabsContent>

                <TabsContent value="students" className="grid gap-4 pt-2 md:grid-cols-3">
                  {[["Most engaged", d.most_engaged], ["Least engaged", d.least_engaged], ["Declining engagement", d.declining]].map(([title, list]) => (
                    <div key={title as string} className="space-y-1.5">
                      <p className="text-xs font-semibold text-slate-600">{title as string}</p>
                      {(list as SlimStudent[]).length === 0 && <p className="text-xs text-slate-400">{title === "Declining engagement" ? "No one is declining." : "Not enough scored students yet."}</p>}
                      {(list as SlimStudent[]).map((s) => <StudentRow key={s.student_id} s={s} onOpen={() => setStudentSel({ id: s.student_id, name: s.name })} />)}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="activities" className="space-y-3 pt-2">
                  <p className="text-xs text-slate-500">Average score per activity (only students it applied to) and how many students are not taking part.</p>
                  {ACTIVITY_ORDER.map((k) => {
                    const avg = d.summary.activity_averages[k], gap = d.summary.activity_gaps[k];
                    return (
                      <div key={k}>
                        <div className="flex justify-between text-xs"><span className="font-medium text-slate-700">{ACTIVITY_META[k].label}</span>
                          <span className="text-slate-500">{avg === null ? "not assigned" : `${Math.round(avg)}/100`}{gap > 0 && <b className="ms-2 text-amber-700">{gap} not participating</b>}</span></div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">{avg !== null && <div className="h-full rounded-full bg-blue-700" style={{ width: `${Math.max(2, avg)}%` }} />}</div>
                      </div>
                    );
                  })}
                </TabsContent>

                <TabsContent value="trend" className="pt-2"><TrendChart data={d.trend.map((t) => ({ date: t.date, value: t.average }))} height={200} ariaLabel="Engagement trend over time" /></TabsContent>
              </Tabs>
              {d.pending_refresh > 0 && <p className="text-[11px] text-slate-400">{d.pending_refresh} more scores are refreshing in the background - recalculate again in a moment.</p>}
            </>
          )
        )}
        <StudentEngagementDialog studentId={studentSel?.id ?? null} name={studentSel?.name} onClose={() => setStudentSel(null)} />
      </CardContent>
    </Card>
  );
}
