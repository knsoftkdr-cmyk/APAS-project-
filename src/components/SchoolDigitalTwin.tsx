import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  AlertTriangle, ChevronDown, ChevronRight, CircleAlert, Info, RefreshCw, Users, GraduationCap, BookOpen,
  CalendarCheck, Brain, Network,
} from "lucide-react";
import { fetchTwinSnapshot, type TwinClass, type TwinSignal } from "@/lib/schoolTwin";

const dash = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);

const healthStyle: Record<TwinClass["health_label"], string> = {
  healthy: "bg-green-100 text-green-800 hover:bg-green-100",
  watch: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  attention: "bg-red-100 text-red-800 hover:bg-red-100",
  no_data: "bg-gray-100 text-gray-600 hover:bg-gray-100",
};
const healthText: Record<TwinClass["health_label"], string> = {
  healthy: "Healthy", watch: "Watch", attention: "Needs attention", no_data: "No data",
};
const loadStyle: Record<string, string> = {
  ok: "bg-green-100 text-green-800 hover:bg-green-100",
  high: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  overloaded: "bg-red-100 text-red-800 hover:bg-red-100",
  none: "bg-gray-100 text-gray-600 hover:bg-gray-100",
};

function RiskBar({ risk }: { risk: { high: number; medium: number; low: number } }) {
  const total = risk.high + risk.medium + risk.low;
  if (total === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted" title={`${risk.high} high · ${risk.medium} medium · ${risk.low} low`}>
        <div className="bg-red-500" style={{ width: `${(risk.high / total) * 100}%` }} />
        <div className="bg-yellow-400" style={{ width: `${(risk.medium / total) * 100}%` }} />
        <div className="bg-green-500" style={{ width: `${(risk.low / total) * 100}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{risk.high}H</span>
    </div>
  );
}

function SignalRow({ s }: { s: TwinSignal }) {
  const Icon = s.severity === "critical" ? CircleAlert : s.severity === "warning" ? AlertTriangle : Info;
  const tone = s.severity === "critical" ? "border-red-200 bg-red-50 text-red-800"
    : s.severity === "warning" ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-blue-100 bg-blue-50 text-blue-800";
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${tone}`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{s.message}</span>
    </div>
  );
}

export default function SchoolDigitalTwin() {
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["school-digital-twin"],
    queryFn: fetchTwinSnapshot,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="flex min-h-[240px] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-sm text-red-600">Couldn't build the digital twin: {(error as Error)?.message ?? "no data returned"}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const { summary: s, data_quality: dq } = data;
  const kpis = [
    { label: "Students", value: s.students, icon: GraduationCap, color: "text-blue-600" },
    { label: "Teachers", value: s.teachers, icon: Users, color: "text-green-600" },
    { label: "Avg predicted score", value: dash(s.avg_predicted, "%"), icon: Brain, color: "text-purple-600" },
    { label: "Syllabus covered", value: dash(s.avg_syllabus_pct, "%"), icon: BookOpen, color: "text-indigo-600" },
    { label: `Attendance (${data.window_days}d)`, value: dash(s.student_attendance_pct, "%"), icon: CalendarCheck, color: "text-teal-600" },
    { label: "High-risk students", value: s.risk.high, icon: AlertTriangle, color: "text-red-600" },
  ];
  const notes: string[] = [];
  if (dq.students_without_predictions > 0) notes.push(`${dq.students_without_predictions} student(s) have no prediction yet (run Predictions).`);
  if (dq.classes_without_timetable > 0) notes.push(`${dq.classes_without_timetable} class(es) have no readable timetable.`);
  if (dq.class_subjects_without_syllabus > 0) notes.push(`${dq.class_subjects_without_syllabus} class/subject pair(s) have no chapters in the school's books.`);
  if (dq.unmatched_timetable_cells > 0) notes.push(`${dq.unmatched_timetable_cells} timetable entries couldn't be matched to a teacher.`);
  if (dq.mastery_sampled) notes.push("Mastery averages are based on a sample of mastery records.");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <Network className="h-5 w-5 mt-0.5 text-blue-600" />
          <div>
            <h2 className="text-lg font-semibold leading-tight">
              {data.scope === "teacher" ? "Your Classes — Academic Digital Twin" : "School Academic Digital Twin"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Students, teachers, classes, timetable, syllabus and performance in one live model · built {new Date(data.generated_at).toLocaleString()}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-4 w-4" /></div>
              <div>
                <p className="text-xl font-bold leading-none">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.signals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What the twin is flagging</CardTitle>
            <CardDescription>Signals that only show up when timetable, syllabus, attendance and performance are read together.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.signals.slice(0, 8).map((sig, i) => <SignalRow key={i} s={sig} />)}
            {data.signals.length > 8 && <p className="text-xs text-muted-foreground">+ {data.signals.length - 8} more lower-priority signals.</p>}
            {data.signals.some((x) => x.type === "risk_concentration") && (
              <p className="text-xs text-muted-foreground pt-1">
                Tip: test remedial periods or extra classes for these in Timetable → What-If before changing the timetable.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Classes</CardTitle>
          <CardDescription>Select a row to see each subject, its teacher, weekly periods, syllabus and performance.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Class</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-center">Students</TableHead>
                <TableHead className="text-center">Avg predicted</TableHead>
                <TableHead>Risk mix</TableHead>
                <TableHead className="text-center">Attendance</TableHead>
                <TableHead className="text-center">Syllabus</TableHead>
                <TableHead className="text-center">Periods/wk</TableHead>
                <TableHead className="text-center">Free slots</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.classes.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No classes found.</TableCell></TableRow>
              )}
              {data.classes.map((c) => (
                <Fragment key={c.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <TableCell>{open === c.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                    <TableCell className="font-medium">{c.name}-{c.section}</TableCell>
                    <TableCell><Badge className={healthStyle[c.health_label]}>{healthText[c.health_label]}{c.health !== null ? ` · ${c.health}` : ""}</Badge></TableCell>
                    <TableCell className="text-center">{c.student_count}</TableCell>
                    <TableCell className="text-center">{dash(c.avg_predicted, "%")}</TableCell>
                    <TableCell><RiskBar risk={c.risk} /></TableCell>
                    <TableCell className="text-center">{dash(c.attendance_pct, "%")}</TableCell>
                    <TableCell className="text-center">{dash(c.syllabus_pct, "%")}</TableCell>
                    <TableCell className="text-center">{c.has_timetable ? c.weekly_periods : "—"}</TableCell>
                    <TableCell className="text-center">{c.has_timetable ? c.free_slots : "—"}</TableCell>
                  </TableRow>
                  {open === c.id && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={9} className="py-3">
                        {c.subjects.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No subject teachers are assigned to this class in Class Management.</p>
                        ) : (
                          <div className="grid gap-2 md:grid-cols-2">
                            {c.subjects.map((sub) => (
                              <div key={`${sub.subject}-${sub.teacher_id}`} className="rounded-lg border bg-background p-3 text-sm space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold">{sub.subject}</span>
                                  <span className="text-xs text-muted-foreground">{sub.teacher_name}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                  <div><p className="text-muted-foreground">Periods/wk</p><p className="font-medium">{c.has_timetable ? sub.weekly_periods : "—"}</p></div>
                                  <div><p className="text-muted-foreground">Syllabus</p><p className="font-medium">{sub.syllabus.total > 0 ? `${sub.syllabus.covered}/${sub.syllabus.total} (${sub.syllabus.pct}%)` : "No chapters"}</p></div>
                                  <div><p className="text-muted-foreground">Avg predicted</p><p className="font-medium">{dash(sub.avg_predicted, "%")}</p></div>
                                </div>
                                <RiskBar risk={sub.risk} />
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.teachers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Teachers</CardTitle>
            <CardDescription>Timetable load next to the syllabus progress and student outcomes in the same classes.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Classes &amp; subjects</TableHead>
                  <TableHead className="text-center">Periods/wk</TableHead>
                  <TableHead className="text-center">Syllabus</TableHead>
                  <TableHead className="text-center">Students' avg predicted</TableHead>
                  <TableHead className="text-center">Attendance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.teachers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[320px]">
                      {t.assignments.map((a) => `${a.class} ${a.subject}`).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-center"><Badge className={loadStyle[t.load_status]}>{t.weekly_periods || "—"}</Badge></TableCell>
                    <TableCell className="text-center">{dash(t.syllabus_pct, "%")}</TableCell>
                    <TableCell className="text-center">{dash(t.avg_student_predicted, "%")}</TableCell>
                    <TableCell className="text-center">{dash(t.attendance_pct, "%")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {notes.length > 0 && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground space-y-0.5">
          <p className="font-medium text-foreground">Data coverage</p>
          {notes.map((n) => <p key={n}>• {n}</p>)}
        </div>
      )}
    </div>
  );
}
