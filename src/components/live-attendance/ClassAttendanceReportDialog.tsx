import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, Download } from "lucide-react";
import {
  DEFAULT_RULES,
  classReportCsv,
  fetchClassReport,
  fetchRules,
  fetchSessionReport,
  formatClock,
  formatDuration,
  sessionReportCsv,
  utcToday,
  type ClassReportRow,
  type LiveAttendanceRules,
  type SessionReportRow,
} from "@/lib/liveAttendance";

interface ClassOption {
  class_id: string;
  class_name: string;
  section: string;
  subject: string;
}

const ALL = "__all__";

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function download(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ClassAttendanceReportDialog({ classes }: { classes: ClassOption[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState(ALL);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(utcToday());
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<ClassReportRow[]>([]);
  const [sessions, setSessions] = useState<SessionReportRow[]>([]);
  const [rules, setRules] = useState<LiveAttendanceRules | null>(null);
  const [loaded, setLoaded] = useState(false);

  // one entry per class (a teacher can teach several subjects to the same class)
  const classList = useMemo(() => {
    const m = new Map<string, ClassOption>();
    classes.forEach((c) => { if (!m.has(c.class_id)) m.set(c.class_id, c); });
    return [...m.values()];
  }, [classes]);
  const subjects = useMemo(
    () => [...new Set(classes.filter((c) => c.class_id === classId).map((c) => c.subject).filter(Boolean))],
    [classes, classId],
  );

  useEffect(() => {
    if (open && !classId && classList.length > 0) setClassId(classList[0].class_id);
  }, [open, classId, classList]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchRules().then((r) => { if (alive) setRules(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [open]);

  async function run() {
    if (!classId) return;
    if (to < from) {
      toast({ title: "Check the dates", description: "The end date is before the start date.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const subj = subject === ALL ? null : subject;
      const [s, x] = await Promise.all([fetchClassReport(classId, from, to, subj), fetchSessionReport(classId, from, to, subj)]);
      setStudents(s);
      setSessions(x);
      setLoaded(true);
    } catch (e) {
      toast({ title: "Failed to load report", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // reload whenever the filters change while the dialog is open
  useEffect(() => {
    if (open && classId) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, classId, subject, from, to]);

  const presentMin = rules?.present_min_percent ?? DEFAULT_RULES.present_min_percent;
  const partialMin = rules?.partial_min_percent ?? DEFAULT_RULES.partial_min_percent;
  const pctClass = (p: number | null) =>
    p == null ? "text-muted-foreground" : p >= presentMin ? "text-green-700" : p >= partialMin ? "text-amber-700" : "text-red-700";

  const totals = useMemo(() => {
    const held = sessions.length;
    const pool = sessions.reduce((n, s) => n + s.roster_size - s.excused, 0);
    const attended = sessions.reduce((n, s) => n + s.present + s.partial, 0);
    return { held, avg: pool > 0 ? Math.round((attended / pool) * 1000) / 10 : null };
  }, [sessions]);

  const className = classList.find((c) => c.class_id === classId);
  const fileBase = `live-attendance-${className ? `${className.class_name}-${className.section}` : "class"}-${from}_to_${to}`.replace(/\s+/g, "_");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-teal-200 text-teal-700 hover:bg-teal-50 shrink-0">
          <BarChart3 className="h-4 w-4 me-1.5" /> Attendance Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl w-[calc(100%-2rem)] sm:w-full max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="text-white text-base">Live class attendance report</DialogTitle>
          </DialogHeader>
        </div>

        <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Class</Label>
              <Select value={classId} onValueChange={(v) => { setClassId(v); setSubject(ALL); }}>
                <SelectTrigger className="border-slate-200"><SelectValue placeholder="Select a class" /></SelectTrigger>
                <SelectContent>
                  {classList.map((c) => (
                    <SelectItem key={c.class_id} value={c.class_id}>{c.class_name} {c.section}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Subject</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger className="border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All subjects</SelectItem>
                  {subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">From</Label>
              <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="border-slate-200" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">To</Label>
              <Input type="date" value={to} min={from} max={utcToday()} onChange={(e) => e.target.value && setTo(e.target.value)} className="border-slate-200" />
            </div>
          </div>

          {loading && !loaded ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <span className="w-4 h-4 rounded-full border-2 border-teal-300 border-t-teal-600 animate-spin" /> Loading report...
            </div>
          ) : !loaded ? null : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                  <p className="text-[11px] text-muted-foreground">Classes held</p>
                  <p className="text-xl font-bold text-slate-800">{totals.held}</p>
                </div>
                <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                  <p className="text-[11px] text-muted-foreground">Average attended</p>
                  <p className={`text-xl font-bold ${pctClass(totals.avg)}`}>{totals.avg == null ? "—" : `${totals.avg}%`}</p>
                </div>
                <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                  <p className="text-[11px] text-muted-foreground">Students</p>
                  <p className="text-xl font-bold text-slate-800">{students.length}</p>
                </div>
                <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                  <p className="text-[11px] text-muted-foreground">Rules</p>
                  <p className="text-xs font-medium text-slate-700">Present ≥ {presentMin}% · Partial ≥ {partialMin}%</p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                "Attended" counts Present and Partial; Excused classes are left out. Recurring sessions count every day of their date range.
              </p>

              <Tabs defaultValue="students">
                <TabsList className="grid grid-cols-2 w-full sm:w-72">
                  <TabsTrigger value="students">By student</TabsTrigger>
                  <TabsTrigger value="sessions">By session</TabsTrigger>
                </TabsList>

                <TabsContent value="students" className="space-y-3">
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" disabled={students.length === 0} onClick={() => download(`${fileBase}-students.csv`, classReportCsv(students))}>
                      <Download className="h-3.5 w-3.5 me-1.5" /> CSV
                    </Button>
                  </div>
                  {students.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No students in this class.</p>
                  ) : (
                    <>
                      {/* mobile: one card per student */}
                      <div className="space-y-2 md:hidden">
                        {students.map((s) => (
                          <div key={s.student_id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate">{s.full_name}</p>
                                <p className="text-xs text-muted-foreground">Roll: {s.roll_number ?? "-"}</p>
                              </div>
                              <span className={`text-lg font-bold ${pctClass(s.attended_percent)}`}>
                                {s.attended_percent == null ? "—" : `${s.attended_percent}%`}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge className="bg-green-100 text-green-800 hover:opacity-90">Present {s.present}</Badge>
                              <Badge className="bg-amber-100 text-amber-800 hover:opacity-90">Partial {s.partial}</Badge>
                              <Badge className="bg-red-100 text-red-800 hover:opacity-90">Absent {s.absent}</Badge>
                              {s.excused > 0 && <Badge className="bg-sky-100 text-sky-800 hover:opacity-90">Excused {s.excused}</Badge>}
                              {s.late > 0 && <Badge variant="outline" className="border-amber-300 text-amber-700">Late {s.late}</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {s.sessions_held} classes · {formatDuration(s.total_seconds)} in class
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* desktop: table */}
                      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Roll</TableHead><TableHead>Student</TableHead>
                              <TableHead className="text-right">Held</TableHead>
                              <TableHead className="text-right">Present</TableHead>
                              <TableHead className="text-right">Partial</TableHead>
                              <TableHead className="text-right">Absent</TableHead>
                              <TableHead className="text-right">Excused</TableHead>
                              <TableHead className="text-right">Late</TableHead>
                              <TableHead className="text-right">Time in class</TableHead>
                              <TableHead className="text-right">Attended</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {students.map((s) => (
                              <TableRow key={s.student_id}>
                                <TableCell>{s.roll_number ?? "-"}</TableCell>
                                <TableCell className="font-medium">{s.full_name}</TableCell>
                                <TableCell className="text-right">{s.sessions_held}</TableCell>
                                <TableCell className="text-right">{s.present}</TableCell>
                                <TableCell className="text-right">{s.partial}</TableCell>
                                <TableCell className="text-right">{s.absent}</TableCell>
                                <TableCell className="text-right">{s.excused}</TableCell>
                                <TableCell className="text-right">{s.late}</TableCell>
                                <TableCell className="text-right">{formatDuration(s.total_seconds)}</TableCell>
                                <TableCell className={`text-right font-semibold ${pctClass(s.attended_percent)}`}>
                                  {s.attended_percent == null ? "—" : `${s.attended_percent}%`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="sessions" className="space-y-3">
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" disabled={sessions.length === 0} onClick={() => download(`${fileBase}-sessions.csv`, sessionReportCsv(sessions))}>
                      <Download className="h-3.5 w-3.5 me-1.5" /> CSV
                    </Button>
                  </div>
                  {sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No live classes were held in this period.</p>
                  ) : (
                    <>
                      <div className="space-y-2 md:hidden">
                        {sessions.map((s) => (
                          <div key={`${s.session_id}-${s.session_date}`} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-1.5">
                            <p className="font-medium text-sm">{s.title || s.subject}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(`${s.session_date}T00:00:00`).toLocaleDateString()} · {formatClock(s.window_start)}–{formatClock(s.window_end)} · {s.subject}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <Badge className="bg-green-100 text-green-800 hover:opacity-90">Present {s.present}</Badge>
                              <Badge className="bg-amber-100 text-amber-800 hover:opacity-90">Partial {s.partial}</Badge>
                              <Badge className="bg-red-100 text-red-800 hover:opacity-90">Absent {s.absent}</Badge>
                              {s.excused > 0 && <Badge className="bg-sky-100 text-sky-800 hover:opacity-90">Excused {s.excused}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead><TableHead>Session</TableHead><TableHead>Time</TableHead>
                              <TableHead className="text-right">Roster</TableHead>
                              <TableHead className="text-right">Present</TableHead>
                              <TableHead className="text-right">Partial</TableHead>
                              <TableHead className="text-right">Absent</TableHead>
                              <TableHead className="text-right">Excused</TableHead>
                              <TableHead className="text-right">Late</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sessions.map((s) => (
                              <TableRow key={`${s.session_id}-${s.session_date}`}>
                                <TableCell>{new Date(`${s.session_date}T00:00:00`).toLocaleDateString()}</TableCell>
                                <TableCell className="font-medium">{s.title || s.subject}</TableCell>
                                <TableCell>{formatClock(s.window_start)}–{formatClock(s.window_end)}</TableCell>
                                <TableCell className="text-right">{s.roster_size}</TableCell>
                                <TableCell className="text-right">{s.present}</TableCell>
                                <TableCell className="text-right">{s.partial}</TableCell>
                                <TableCell className="text-right">{s.absent}</TableCell>
                                <TableCell className="text-right">{s.excused}</TableCell>
                                <TableCell className="text-right">{s.late}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ClassAttendanceReportDialog;
