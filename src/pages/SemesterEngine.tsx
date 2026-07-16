import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Loader2, BookOpen, GraduationCap, BarChart3, ArrowRight, RotateCcw, CheckCircle2, XCircle, Clock, Lock, Trash2, AlertCircle, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SemesterStatus = "planning" | "active" | "assessment" | "closed";
type PromotionStatus = "promoted" | "retained" | "pending";

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  is_completed: boolean;
  completed_at: string | null;
  structure: "term" | "semester";
  school_id: string;
}

interface Semester {
  id: string;
  academic_year_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: SemesterStatus;
  locked: boolean;
}

interface Student {
  id: string;
  full_name: string | null;
  class: string | null;
  section: string | null;
  profile_id: string | null;
}

interface SemesterMark {
  student_id: string;
  subject: string;
  marks_obtained: number | null;
  max_marks: number;
}

interface StudentGPA {
  student_id: string;
  gpa: number | null;
  combined_score: number | null;
  result_status: string;
}

interface Progression {
  student_id: string;
  promotion_status: PromotionStatus;
  remarks: string | null;
  from_class: string | null;
  to_class: string | null;
}

const STATUS_COLORS: Record<SemesterStatus, string> = {
  planning: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-700",
  assessment: "bg-blue-100 text-blue-700",
  closed: "bg-red-100 text-red-700",
};

const STATUS_NEXT: Record<SemesterStatus, SemesterStatus | null> = {
  planning: "active",
  active: "closed",
  assessment: "closed",
  closed: null,
};

const STATUS_LABELS: Record<SemesterStatus, string> = {
  planning: "Planning",
  active: "Active",
  assessment: "Assessment",
  closed: "Closed",
};

const NEXT_CLASS: Record<string, string> = {
  nursery: "lkg", lkg: "ukg", ukg: "1",
  "1": "2", "2": "3", "3": "4", "4": "5", "5": "6",
  "6": "7", "7": "8", "8": "9", "9": "10", "10": "11", "11": "12",
};

function normalizeClass(cls: string | null): string {
  if (!cls) return "";
  return cls.toLowerCase().replace(/^class\s*/i, "").trim();
}



// ── Admin/Teacher results card view ─────────────────────────────
function AdminResultsView({ profile, semesters, academicYears, students, isAdmin, isTeacher, uniqueClasses, teacherUniqueClasses, resultsClassFilter, setResultsClassFilter, teacherClassLabel }: {
  profile: any;
  semesters: any[];
  academicYears: any[];
  students: any[];
  isAdmin: boolean;
  isTeacher: boolean;
  uniqueClasses: string[];
  teacherUniqueClasses: string[];
  resultsClassFilter: string;
  setResultsClassFilter: (v: string) => void;
  teacherClassLabel: string;
}) {
  const [semId, setSemId] = useState("");
  const [loading, setLoading] = useState(false);
  const [gpaMap, setGpaMap] = useState<Record<string, any>>({});
  const [marksMap, setMarksMap] = useState<Record<string, any[]>>({});
  const [viewingStudent, setViewingStudent] = useState<{ student: any; gpa: any; marks: any[] } | null>(null);

  useEffect(() => {
    if (!semId || students.length === 0) return;
    setLoading(true);
    const studentIds = students.map((s: any) => s.id);
    Promise.all([
      supabase.from("student_gpa").select("*").eq("semester_id", semId).in("student_id", studentIds),
      supabase.from("semester_marks").select("*").eq("semester_id", semId).in("student_id", studentIds),
    ]).then(([gpaRes, marksRes]) => {
      const gm: Record<string, any> = {};
      for (const g of gpaRes.data || []) gm[g.student_id] = g;
      setGpaMap(gm);
      const mm: Record<string, any[]> = {};
      for (const m of marksRes.data || []) {
        if (!mm[m.student_id]) mm[m.student_id] = [];
        mm[m.student_id].push(m);
      }
      setMarksMap(mm);
      setLoading(false);
    });
  }, [semId, students.length, resultsClassFilter]);

  const selectedSem = semesters.find((s: any) => s.id === semId);
  const selectedYr = selectedSem ? academicYears.find((y: any) => y.id === selectedSem.academic_year_id) : null;

  return (
    <div className="space-y-4">
  {/* Filters */}
  <div className="flex items-center justify-between flex-wrap gap-2">
    <h2 className="font-semibold text-slate-800">Term-wise Results</h2>
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={semId} onValueChange={setSemId}>
        <SelectTrigger className="w-full sm:w-48 border-indigo-100 focus:ring-indigo-400"><SelectValue placeholder="Select Term" /></SelectTrigger>
            <SelectContent>
              {semesters.map((sem: any) => {
                const yr = academicYears.find((y: any) => y.id === sem.academic_year_id);
                return <SelectItem key={sem.id} value={sem.id}>{yr ? `${yr.name} — ${sem.name}` : sem.name}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Select value={resultsClassFilter} onValueChange={setResultsClassFilter}>
              <SelectTrigger className="w-36 border-indigo-100 focus:ring-indigo-400"><SelectValue placeholder="All Classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {uniqueClasses.map((cl: string) => (
                  <SelectItem key={cl} value={cl}>{/^\d+$/.test(cl) ? `Class ${cl}` : cl.charAt(0).toUpperCase() + cl.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isTeacher && (
            <Select value={resultsClassFilter} onValueChange={setResultsClassFilter}>
              <SelectTrigger className="w-36 border-indigo-100 focus:ring-indigo-400"><SelectValue placeholder="All Classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {teacherUniqueClasses.map((cl: string) => (
                  <SelectItem key={cl} value={cl}>{/^\d+$/.test(cl) ? `Class ${cl}` : cl.charAt(0).toUpperCase() + cl.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!semId ? (
    <Card className="border-indigo-100 bg-indigo-50/20"><CardContent className="py-12 text-center text-muted-foreground">Select a term above to view results.</CardContent></Card>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Loading results...</div>
      ) : students.length === 0 ? (
        <Card className="border-slate-200"><CardContent className="py-12 text-center text-muted-foreground">No students found.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {students.map((s: any) => {
            const gpa = gpaMap[s.id];
            const sm = marksMap[s.id] || [];
            const avgPct = sm.length > 0
              ? Math.round(sm.reduce((acc: number, m: any) => acc + ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100, 0) / sm.length)
              : null;
            return (
              <Card key={s.id} className="overflow-hidden cursor-pointer border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all" onClick={() => setViewingStudent({ student: s, gpa, marks: sm })}>
                <div className={`h-1 ${gpa?.result_status === "pass" ? "bg-emerald-400" : gpa?.result_status === "fail" ? "bg-red-400" : "bg-slate-200"}`} />
                <CardContent className="py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {(s.full_name ?? "U")[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate text-slate-800">{s.full_name ?? "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.class ?? "-"} · Section {s.section ?? "-"} · {sm.length} subjects</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-center">
                      <p className="text-lg font-bold text-indigo-700">{gpa?.gpa ?? "-"}</p>
                      <p className="text-[10px] text-muted-foreground">GPA</p>
                    </div>
                    {gpa ? (
                      <Badge className={gpa.result_status === "pass" ? "bg-emerald-500 text-white hover:bg-emerald-500" : gpa.result_status === "fail" ? "bg-red-500 text-white hover:bg-red-500" : "bg-slate-200 text-slate-600 hover:bg-slate-200"}>
                        {gpa.result_status === "pass" ? "✓ Pass" : gpa.result_status === "fail" ? "✗ Fail" : "Pending"}
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-100">No marks</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Marks detail dialog */}
      <Dialog open={!!viewingStudent} onOpenChange={(v) => { if (!v) setViewingStudent(null); }}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col">
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-white text-base">{viewingStudent?.student.full_name} — {selectedSem?.name}</DialogTitle>
            </DialogHeader>
          </div>
          {viewingStudent && (
            <div className="space-y-4 px-5 py-4 overflow-y-auto flex-1">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50/50 border border-indigo-100">
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-indigo-700">{viewingStudent.gpa?.gpa ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">GPA / 10</p>
                </div>
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-violet-700">
                    {viewingStudent.marks.length > 0
                      ? `${Math.round(viewingStudent.marks.reduce((a: number, m: any) => a + ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100, 0) / viewingStudent.marks.length)}%`
                      : "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">Overall %</p>
                </div>
                {viewingStudent.gpa && (
                  <Badge className={viewingStudent.gpa.result_status === "pass" ? "bg-emerald-500 text-white hover:bg-emerald-500" : "bg-red-500 text-white hover:bg-red-500"}>
                    {viewingStudent.gpa.result_status === "pass" ? "Pass" : "Fail"}
                  </Badge>
                )}
              </div>
              {viewingStudent.marks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No marks recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
                      <TableHead>Subject</TableHead>
                      <TableHead>Marks</TableHead>
                      <TableHead>%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewingStudent.marks.map((m: any, i: number) => {
                      const pct = m.marks_obtained !== null ? Math.round(((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100) : null;
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium capitalize">{m.subject}</TableCell>
                          <TableCell>{m.marks_obtained ?? "-"}/{m.max_marks}</TableCell>
                          <TableCell>
                            <span className={pct !== null ? (pct >= 50 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold") : ""}>
                              {pct !== null ? `${pct}%` : "-"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Standalone student results component ────────────────────────
function StudentResultsView({ profile, semesters, academicYears, myStudentRecord }: {
  profile: any;
  semesters: any[];
  academicYears: any[];
  myStudentRecord: any;
}) {
  const [semFilter, setSemFilter] = useState("all");
  const [myResults, setMyResults] = useState<Record<string, { gpa: any; marks: any[]; semester: any }>>({});
  const [loading, setLoading] = useState(true);
  const [viewingMarks, setViewingMarks] = useState<{ gpa: any; marks: any[]; semester: any } | null>(null);

  useEffect(() => {
    if (!profile?.school_id || !myStudentRecord?.id) { setLoading(false); return; }
    const fetchMyResults = async () => {
      setLoading(true);
      const [gpaRes, marksRes] = await Promise.all([
        supabase.from("student_gpa").select("*").eq("student_id", myStudentRecord.id),
        supabase.from("semester_marks").select("*").eq("student_id", myStudentRecord.id),
      ]);
      const semMap: Record<string, any> = {};
      for (const s of semesters) semMap[s.id] = s;
      const results: Record<string, any> = {};
      for (const g of gpaRes.data || []) {
        const sem = semMap[g.semester_id];
        if (!sem) continue;
        const yr = academicYears.find((y: any) => y.id === sem.academic_year_id);
        results[g.semester_id] = {
          gpa: g,
          marks: (marksRes.data || []).filter((m: any) => m.semester_id === g.semester_id),
          semester: { ...sem, yearName: yr?.name ?? "" },
        };
      }
      setMyResults(results);
      setLoading(false);
    };
    fetchMyResults();
  }, [profile?.school_id, myStudentRecord?.id, semesters.length]);

  const resultList = Object.values(myResults);
  const filtered = semFilter === "all" ? resultList : resultList.filter((r) => r.semester.id === semFilter);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (resultList.length === 0) return (
    <Card className="border-2 border-dashed border-indigo-100 bg-indigo-50/20">
      <CardContent className="py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
          <GraduationCap className="h-7 w-7 text-indigo-400" />
        </div>
        <p className="font-medium text-slate-800">No results yet</p>
        <p className="text-sm text-muted-foreground mt-1">Your results will appear here after your teacher publishes them.</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Term filter pills */}
      <div className="flex flex-wrap gap-2 bg-indigo-50/50 border border-indigo-100 p-1.5 rounded-full w-fit max-w-full overflow-x-auto">
        <button onClick={() => setSemFilter("all")} className={"px-3.5 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap " + (semFilter === "all" ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}>All Terms</button>
        {resultList.map((r) => (
          <button key={r.semester.id} onClick={() => setSemFilter(r.semester.id)}
            className={"px-3.5 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap " + (semFilter === r.semester.id ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}>
            {r.semester.name}
          </button>
        ))}
      </div>

      {/* Result cards */}
      <div className="grid gap-4">
        {filtered.map((r) => (
        <Card key={r.semester.id} className="overflow-hidden cursor-pointer border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all" onClick={() => setViewingMarks(r)}>
          <div className={`h-1 ${r.gpa.result_status === "pass" ? "bg-emerald-400" : r.gpa.result_status === "fail" ? "bg-red-400" : "bg-slate-200"}`} />
          <CardContent className="py-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0">
                <FileText className="h-4.5 w-4.5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-base text-slate-800">{r.semester.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{r.semester.yearName} · Click to view subject marks</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-700">{r.gpa.gpa ?? "-"}</p>
                <p className="text-xs text-muted-foreground">GPA / 10</p>
              </div>
              <Badge className={r.gpa.result_status === "pass" ? "bg-emerald-500 text-white hover:bg-emerald-500 text-sm px-3 py-1" : r.gpa.result_status === "fail" ? "bg-red-500 text-white hover:bg-red-500 text-sm px-3 py-1" : "bg-slate-200 text-slate-600 hover:bg-slate-200 text-sm px-3 py-1"}>
                {r.gpa.result_status === "pass" ? "✓ Pass" : r.gpa.result_status === "fail" ? "✗ Fail" : "Pending"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
      </div>

      {/* Marks detail dialog */}
      <Dialog open={!!viewingMarks} onOpenChange={(v) => { if (!v) setViewingMarks(null); }}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col">
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-white text-base">{viewingMarks?.semester.name} — Subject Marks</DialogTitle>
            </DialogHeader>
          </div>
          {viewingMarks && (
            <div className="space-y-4 px-5 py-4 overflow-y-auto flex-1">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50/50 border border-indigo-100">
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-indigo-700">{viewingMarks.gpa.gpa ?? "-"}</p>
                  <p className="text-xs text-muted-foreground">GPA / 10</p>
                </div>
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-violet-700">{viewingMarks.gpa.combined_score !== null ? `${Math.round(viewingMarks.gpa.combined_score ?? 0)}%` : "-"}</p>
                  <p className="text-xs text-muted-foreground">Overall %</p>
                </div>
                <Badge className={viewingMarks.gpa.result_status === "pass" ? "bg-emerald-500 text-white hover:bg-emerald-500" : "bg-red-500 text-white hover:bg-red-500"}>
                  {viewingMarks.gpa.result_status === "pass" ? "Pass" : "Fail"}
                </Badge>
              </div>
              {viewingMarks.marks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No subject marks recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
                      <TableHead>Subject</TableHead>
                      <TableHead>Marks</TableHead>
                      <TableHead>%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewingMarks.marks.map((m: any, i: number) => {
                      const pct = m.marks_obtained !== null ? Math.round(((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100) : null;
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium capitalize">{m.subject}</TableCell>
                          <TableCell>{m.marks_obtained ?? "-"}/{m.max_marks}</TableCell>
                          <TableCell>
                            <span className={pct !== null ? (pct >= 50 ? "text-green-600 font-medium" : "text-red-500 font-medium") : ""}>
                              {pct !== null ? `${pct}%` : "-"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SemesterEngine() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "principal", "school_admin"].includes(profile?.role ?? "");
  const isTeacher = profile?.role === "teacher";
  const isStudent = profile?.role === "student";
  const [teacherStudentIds, setTeacherStudentIds] = useState<Set<string> | null>(null);
  const [teacherClassLabel, setTeacherClassLabel] = useState("");

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [marks, setMarks] = useState<Record<string, SemesterMark[]>>({});
  const [gpas, setGpas] = useState<Record<string, StudentGPA>>({});
  const [progressions, setProgressions] = useState<Record<string, Progression>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [activeYear, setActiveYear] = useState<AcademicYear | null>(null);
  const [activeSemester, setActiveSemester] = useState<Semester | null>(null);
  const [classFilter, setClassFilter] = useState("all");

  // Results tab state
  const [resultsSemesterId, setResultsSemesterId] = useState("");
  const [resultsClassFilter, setResultsClassFilter] = useState("all");
  const [resultsSectionFilter, setResultsSectionFilter] = useState("all");
  const [resultsMarks, setResultsMarks] = useState<Record<string, SemesterMark[]>>({});
  const [resultsLoading, setResultsLoading] = useState(false);

  const [showYearForm, setShowYearForm] = useState(false);
  const [showSemForm, setShowSemForm] = useState(false);
  const [showMarksDialog, setShowMarksDialog] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [marksForm, setMarksForm] = useState<{ subject: string; marks: string; max: string }[]>([
    { subject: "", marks: "", max: "100" },
  ]);

  const [yearForm, setYearForm] = useState({ name: "", start_date: "", end_date: "", structure: "term" as "term" | "semester" });
  const [semForm, setSemForm] = useState({ name: "", start_date: "", end_date: "", year_id: "" });

  const fetchAll = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const [yearsRes, semsRes, studentsRes] = await Promise.all([
      supabase.from("academic_years").select("*").eq("school_id", profile.school_id).order("created_at", { ascending: false }),
      supabase.from("academic_semesters").select("*").eq("school_id", profile.school_id).order("created_at"),
      supabase.from("students").select("id, full_name, class, section, profile_id").eq("school_id", profile.school_id).order("class").order("full_name"),
    ]);
    const years = (yearsRes.data as AcademicYear[]) || [];
    setAcademicYears(years);
    setSemesters((semsRes.data as Semester[]) || []);
    setStudents((studentsRes.data as Student[]) || []);
    const active = years.find((y) => y.is_active) || years[0] || null;
    setActiveYear(active);
    setLoading(false);
  };

  const fetchSemesterData = async (semId: string) => {
    const [marksRes, gpaRes, progRes] = await Promise.all([
      supabase.from("semester_marks").select("*").eq("semester_id", semId),
      supabase.from("student_gpa").select("*").eq("semester_id", semId),
      supabase.from("student_progression").select("*").eq("semester_id", semId),
    ]);
    const marksMap: Record<string, SemesterMark[]> = {};
    for (const m of marksRes.data || []) {
      if (!marksMap[m.student_id]) marksMap[m.student_id] = [];
      marksMap[m.student_id].push(m);
    }
    setMarks(marksMap);
    const gpaMap: Record<string, StudentGPA> = {};
    for (const g of gpaRes.data || []) gpaMap[g.student_id] = g;
    setGpas(gpaMap);
    const progMap: Record<string, Progression> = {};
    for (const p of progRes.data || []) progMap[p.student_id] = p;
    setProgressions(progMap);
  };

  const fetchResultsMarks = async (semId: string) => {
    setResultsLoading(true);
    const { data } = await supabase.from("semester_marks").select("*").eq("semester_id", semId);
    const map: Record<string, SemesterMark[]> = {};
    for (const m of data || []) {
      if (!map[m.student_id]) map[m.student_id] = [];
      map[m.student_id].push(m);
    }
    setResultsMarks(map);
    setResultsLoading(false);
  };

  const fetchTeacherRoster = async () => {
    if (!profile?.id) return;
    const { data: ctRows } = await supabase
      .from("class_teachers")
      .select("class_id, classes(name)")
      .eq("teacher_id", profile.id);
    const classIds = (ctRows || []).map((r: any) => r.class_id);
    setTeacherClassLabel((ctRows || []).map((r: any) => r.classes?.name).filter(Boolean).join(", "));
    if (classIds.length === 0) { setTeacherStudentIds(new Set()); return; }
    const { data: csRows } = await supabase
      .from("class_students")
      .select("student_id")
      .in("class_id", classIds);
    setTeacherStudentIds(new Set((csRows || []).map((r: any) => r.student_id)));
  };

  useEffect(() => { fetchAll(); }, [profile?.school_id]);
  useEffect(() => { if (isTeacher) fetchTeacherRoster(); }, [profile?.id]);
  useEffect(() => { if (activeSemester) fetchSemesterData(activeSemester.id); }, [activeSemester?.id]);
  useEffect(() => { if (resultsSemesterId) fetchResultsMarks(resultsSemesterId); }, [resultsSemesterId]);

  const saveYear = async () => {
    if (!yearForm.name || !yearForm.start_date || !yearForm.end_date) { toast.error("Fill all fields"); return; }
    setSaving(true);
    const { error } = await supabase.from("academic_years").insert({
      school_id: profile!.school_id,
      name: yearForm.name,
      start_date: yearForm.start_date,
      end_date: yearForm.end_date,
      structure: yearForm.structure,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Academic year created");
    setShowYearForm(false);
    setYearForm({ name: "", start_date: "", end_date: "", structure: "term" });
    fetchAll();
  };

  const setYearActive = async (yearId: string) => {
    await supabase.from("academic_years").update({ is_active: false }).eq("school_id", profile!.school_id);
    await supabase.from("academic_years").update({ is_active: true }).eq("id", yearId);
    toast.success("Active year updated");
    fetchAll();
  };

  const deleteYear = async (year: AcademicYear) => {
    if (!confirm(`Delete "${year.name}"? This will also delete all its semesters, marks, GPA records, and promotion decisions. This cannot be undone.`)) return;
    const { error } = await supabase.from("academic_years").delete().eq("id", year.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Academic year deleted");
    if (activeYear?.id === year.id) setActiveYear(null);
    if (activeSemester && semesters.find((s) => s.id === activeSemester.id)?.academic_year_id === year.id) setActiveSemester(null);
    fetchAll();
  };

  const completeYear = async (year: AcademicYear) => {
    if (!confirm(`Mark "${year.name}" as complete? This opens up Promotion and Rollover for this year. Make sure marks are entered and GPA has been calculated first.`)) return;
    const { error } = await supabase.from("academic_years").update({ is_completed: true, completed_at: new Date().toISOString() }).eq("id", year.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${year.name}" marked complete — Promotion is now available`);
    fetchAll();
  };

  const reopenYear = async (year: AcademicYear) => {
    if (!confirm(`Reopen "${year.name}"? This will hide Promotion and Rollover again until you mark it complete.`)) return;
    const { error } = await supabase.from("academic_years").update({ is_completed: false, completed_at: null }).eq("id", year.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${year.name}" reopened`);
    fetchAll();
  };

  const saveSemester = async () => {
    if (!semForm.name || !semForm.year_id) { toast.error("Fill all fields"); return; }
    setSaving(true);
    const { error } = await supabase.from("academic_semesters").insert({
      school_id: profile!.school_id,
      academic_year_id: semForm.year_id,
      name: semForm.name,
      start_date: semForm.start_date || null,
      end_date: semForm.end_date || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Semester created");
    setShowSemForm(false);
    setSemForm({ name: "", start_date: "", end_date: "", year_id: "" });
    fetchAll();
  };

  const deleteSemester = async (sem: Semester) => {
    if (!confirm(`Delete "${sem.name}"? This will also delete its marks, GPA records, and promotion decisions. This cannot be undone.`)) return;
    const { error } = await supabase.from("academic_semesters").delete().eq("id", sem.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Semester deleted");
    if (activeSemester?.id === sem.id) setActiveSemester(null);
    fetchAll();
  };

  const advanceSemesterStatus = async (sem: Semester) => {
    const next = STATUS_NEXT[sem.status];
    if (!next) return;
    const updates: Record<string, unknown> = { status: next };
    if (next === "closed") { updates.locked = true; updates.closed_at = new Date().toISOString(); }
    const { error } = await supabase.from("academic_semesters").update(updates).eq("id", sem.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Status → ${STATUS_LABELS[next]}`);
    fetchAll();
    if (activeSemester?.id === sem.id) setActiveSemester({ ...sem, status: next, locked: next === "closed" });
  };

  const openMarksDialog = (student: Student) => {
    setSelectedStudent(student);
    const existing = marks[student.id] || [];
    if (existing.length > 0) {
      setMarksForm(existing.map((m) => ({ subject: m.subject, marks: String(m.marks_obtained ?? ""), max: String(m.max_marks) })));
    } else {
      setMarksForm([{ subject: "", marks: "", max: "100" }]);
    }
    setShowMarksDialog(true);
  };

  const saveMarks = async () => {
    if (!activeSemester || !selectedStudent) return;
    if (activeSemester.status !== "active") {
      toast.error("This term is not active. Marks can only be entered while the term is Active.");
      return;
    }
    setSaving(true);
    const valid = marksForm.filter((m) => m.subject.trim() && m.marks.trim());
    const validSubjects = valid.map((m) => m.subject.trim());
    const existingSubjects = (marks[selectedStudent.id] || []).map((m) => m.subject);
    const removedSubjects = existingSubjects.filter((subj) => !validSubjects.includes(subj));

    for (const m of valid) {
      await supabase.from("semester_marks").upsert({
        semester_id: activeSemester.id,
        student_id: selectedStudent.id,
        school_id: profile!.school_id,
        subject: m.subject.trim(),
        marks_obtained: parseFloat(m.marks),
        max_marks: parseFloat(m.max) || 100,
        entered_by: profile!.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "semester_id,student_id,subject" });
    }
    for (const subj of removedSubjects) {
      await supabase.from("semester_marks").delete()
        .eq("semester_id", activeSemester.id)
        .eq("student_id", selectedStudent.id)
        .eq("subject", subj);
    }
    await recalculateStudentGPA(selectedStudent.id, activeSemester.id);
    setSaving(false);
    toast.success("Marks saved");
    setShowMarksDialog(false);
    fetchSemesterData(activeSemester.id);
  };

  const deleteMarkRow = async (index: number) => {
    const row = marksForm[index];
    if (marksForm.length === 1) {
      setMarksForm([{ subject: "", marks: "", max: "100" }]);
      return;
    }
    setMarksForm((f) => f.filter((_, j) => j !== index));
    if (row.subject.trim() && activeSemester && selectedStudent && (marks[selectedStudent.id] || []).some((m) => m.subject === row.subject.trim())) {
      await supabase.from("semester_marks").delete()
        .eq("semester_id", activeSemester.id)
        .eq("student_id", selectedStudent.id)
        .eq("subject", row.subject.trim());
      await recalculateStudentGPA(selectedStudent.id, activeSemester.id);
      fetchSemesterData(activeSemester.id);
      toast.success(`${row.subject} removed`);
    }
  };

  const recalculateStudentGPA = async (studentId: string, semesterId: string) => {
    const { data: freshMarks } = await supabase
      .from("semester_marks")
      .select("*")
      .eq("semester_id", semesterId)
      .eq("student_id", studentId);
    const studentMarks = freshMarks || [];
    let marksScore: number | null = null;
    if (studentMarks.length > 0) {
      const pcts = studentMarks.map((m: any) => ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100);
      marksScore = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    }
    const gpa = marksScore !== null ? Math.round((marksScore / 10) * 100) / 100 : null;
    const result_status = gpa !== null ? (gpa >= 5 ? "pass" : "fail") : "pending";
    if (studentMarks.length === 0) {
      await supabase.from("student_gpa").delete().eq("student_id", studentId).eq("semester_id", semesterId);
    } else {
      await supabase.from("student_gpa").upsert({
        student_id: studentId,
        semester_id: semesterId,
        school_id: profile!.school_id,
        marks_score: marksScore,
        combined_score: marksScore,
        gpa,
        result_status,
        generated_at: new Date().toISOString(),
      }, { onConflict: "student_id,semester_id" });
    }
  };

  const calculateGPAs = async () => {
    if (!activeSemester) return;
    setSaving(true);
    for (const student of filteredStudents) {
      const studentMarks = marks[student.id] || [];
      let marksScore: number | null = null;
      if (studentMarks.length > 0) {
        const pcts = studentMarks.map((m) => ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100);
        marksScore = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      }
      const combined = marksScore;
      const gpa = combined !== null ? Math.round((combined / 10) * 100) / 100 : null;
      const result_status = gpa !== null ? (gpa >= 5 ? "pass" : "fail") : "pending";
      await supabase.from("student_gpa").upsert({
        student_id: student.id,
        semester_id: activeSemester.id,
        school_id: profile!.school_id,
        marks_score: marksScore,
        combined_score: combined,
        gpa,
        result_status,
        generated_at: new Date().toISOString(),
      }, { onConflict: "student_id,semester_id" });
    }
    setSaving(false);
    toast.success("GPA calculated");
    fetchSemesterData(activeSemester.id);
  };

  const setPromotion = async (student: Student, status: PromotionStatus) => {
    if (!activeSemester) return;
    const fromClass = normalizeClass(student.class);
    const toClass = status === "promoted" ? (NEXT_CLASS[fromClass] ?? fromClass) : fromClass;
    await supabase.from("student_progression").upsert({
      student_id: student.id,
      semester_id: activeSemester.id,
      school_id: profile!.school_id,
      from_class: fromClass,
      to_class: toClass,
      promotion_status: status,
      approved_by: profile!.id,
      approved_at: new Date().toISOString(),
    }, { onConflict: "student_id,semester_id" });
    setProgressions((prev) => ({ ...prev, [student.id]: { student_id: student.id, promotion_status: status, remarks: null, from_class: fromClass, to_class: toClass } }));
    toast.success(`${student.full_name} marked as ${status}`);
  };

  const doRollover = async () => {
    if (!activeSemester || !activeYear) return;
    if (!confirm("This will update class grades for all promoted students. Continue?")) return;
    setSaving(true);
    const promoted = Object.entries(progressions).filter(([, p]) => p.promotion_status === "promoted");
    let count = 0;
    let graduatedCount = 0;

    const { data: schoolRow } = await supabase
      .from("schools")
      .select("terminal_class")
      .eq("id", profile!.school_id)
      .single();
    const terminalClass = schoolRow?.terminal_class ?? null;

    for (const [studentId, prog] of promoted) {
      const isGraduating = terminalClass && prog.from_class === terminalClass;

      if (isGraduating) {
        const pid = students.find((s) => s.id === studentId)?.profile_id;
        await supabase.from("alumni_profiles").insert({
          student_id: pid ?? studentId,
          school_id: profile!.school_id,
          graduated_class: /^\d+$/.test(prog.from_class) ? `Class ${prog.from_class}` : prog.from_class,
          batch_year: activeYear.name,
          graduation_date: new Date().toISOString().slice(0, 10),
        });
        if (pid) {
          await supabase.from("profiles").update({ status: "alumni" }).eq("id", pid);
          await supabase.from("student_lifecycle_events").insert({
            student_id: pid,
            school_id: profile!.school_id,
            event_type: "alumni_conversion",
            event_date: new Date().toISOString().slice(0, 10),
            details: { graduated_class: prog.from_class, batch_year: activeYear.name },
            created_by: profile!.id,
          });
        }
        graduatedCount++;
      } else if (prog.to_class && prog.to_class !== prog.from_class) {
        const displayClass = /^\d+$/.test(prog.to_class) ? `Class ${prog.to_class}` : prog.to_class.charAt(0).toUpperCase() + prog.to_class.slice(1);
        await supabase.from("students").update({ class: displayClass }).eq("id", studentId);
        const pid = students.find((s) => s.id === studentId)?.profile_id;
        if (pid) {
          await supabase.from("profiles").update({ class_grade: prog.to_class }).eq("id", pid);
          await supabase.from("student_lifecycle_events").insert({
            student_id: pid,
            school_id: profile!.school_id,
            event_type: "promotion",
            event_date: new Date().toISOString().slice(0, 10),
            details: { from_class: prog.from_class, to_class: prog.to_class, academic_year: activeYear?.name },
            created_by: profile!.id,
          });
        }
        count++;
      }
    }

    await supabase.from("semester_rollover_logs").insert({
      school_id: profile!.school_id,
      from_academic_year: activeYear.id,
      processed_students: promoted.length,
      promoted_count: count,
      retained_count: promoted.length - count - graduatedCount,
      completed_at: new Date().toISOString(),
      status: "completed",
      triggered_by: profile!.id,
    });
    setSaving(false);
    toast.success(`Rollover complete — ${count} moved up, ${graduatedCount} graduated to alumni`);
    fetchAll();
  };

  const uniqueClasses = Array.from(new Set(students.map((s) => normalizeClass(s.class)).filter(Boolean))).sort();
  const teacherUniqueClasses = Array.from(
  new Set(
    students
      .filter((s) => teacherStudentIds?.has(s.id))
      .map((s) => normalizeClass(s.class))
      .filter(Boolean)
  )
).sort();
  const myStudentRecord = isStudent ? students.find((s) => s.profile_id === profile?.id) ?? null : null;
const filteredStudents = isTeacher
  ? students.filter(
      (s) => teacherStudentIds?.has(s.id) && (classFilter === "all" || normalizeClass(s.class) === classFilter)
    )
  : students.filter((s) => classFilter === "all" || normalizeClass(s.class) === classFilter);
  const yearSemesters = semesters.filter((s) => s.academic_year_id === activeYear?.id);

  const resultsFilteredStudents = isStudent
    ? students.filter((s) => s.id === myStudentRecord?.id)
    : isTeacher
    ? students.filter(
        (s) => teacherStudentIds?.has(s.id) && (resultsClassFilter === "all" || normalizeClass(s.class) === resultsClassFilter)
      )
    : students.filter((s) =>
        (resultsClassFilter === "all" || normalizeClass(s.class) === resultsClassFilter) &&
        (resultsSectionFilter === "all" || (s.section ?? "").toLowerCase() === resultsSectionFilter.toLowerCase())
      );
  const resultsUniqueSections = Array.from(new Set(students.map((s) => s.section).filter((v): v is string => !!v))).sort();
  const resultsSubjects = Array.from(
    new Set(
      resultsFilteredStudents.flatMap((s) => (resultsMarks[s.id] || []).map((m) => m.subject))
    )
  ).sort();

  if (!isAdmin && !isTeacher && !isStudent) {
    return (
      <AppLayout>
        <div className="p-6 text-center text-muted-foreground pt-20">
          <GraduationCap className="h-10 w-10 mx-auto mb-3" />
          <p>You don't have access to the Semester Engine.</p>
        </div>
      </AppLayout>
    );
  }

return (
  <AppLayout>
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
      <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-violet-300 opacity-[0.08] blur-3xl" />
      <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.08] blur-3xl" />

      <div className="relative z-10 p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <GraduationCap className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Semester Engine</h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Manage academic years, semesters, marks, GPA, and student promotion</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue={isAdmin ? "years" : isTeacher ? "marks" : "results"}>
            <div className="overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
            <TabsList className="inline-flex w-max flex-nowrap gap-1 h-auto bg-indigo-50 border border-indigo-100 p-1 rounded-xl">
              {isAdmin && <TabsTrigger value="years" className="gap-1.5 whitespace-nowrap data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><BookOpen className="h-4 w-4" /> Academic Years</TabsTrigger>}
              {isAdmin && <TabsTrigger value="semesters" className="gap-1.5 whitespace-nowrap data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><Clock className="h-4 w-4" /> Semesters</TabsTrigger>}
              {(isAdmin || isTeacher) && <TabsTrigger value="marks" className="gap-1.5 whitespace-nowrap data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><BarChart3 className="h-4 w-4" /> Marks & GPA</TabsTrigger>}
              <TabsTrigger value="results" className="gap-1.5 whitespace-nowrap data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><FileText className="h-4 w-4" /> {isStudent ? "My Results" : "Results"}</TabsTrigger>
              {isAdmin && <TabsTrigger value="promotion" className="gap-1.5 whitespace-nowrap data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><GraduationCap className="h-4 w-4" /> Promotion</TabsTrigger>}
              {isAdmin && <TabsTrigger value="rollover" className="gap-1.5 whitespace-nowrap data-[state=active]:bg-indigo-600 data-[state=active]:text-white"><RotateCcw className="h-4 w-4" /> Year Rollover</TabsTrigger>}
            </TabsList>
            </div>

            {/* ACADEMIC YEARS */}
            <TabsContent value="years" className="space-y-4 mt-4">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <h2 className="font-semibold text-slate-800">Academic Years</h2>
                <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={() => setShowYearForm(true)}><Plus className="h-4 w-4 mr-1" />New Year</Button>
              </div>
              {academicYears.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No academic years yet. Create one to get started.</CardContent></Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {academicYears.map((y) => (
                    <Card key={y.id} className={`overflow-hidden shadow-sm ${y.is_active ? "border-indigo-300 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2">
                            {y.name}
                            {y.is_active && <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">Active</Badge>}
                            {y.is_completed && <Badge className="bg-blue-500 text-white hover:bg-blue-500">Completed</Badge>}
                          </CardTitle>
                          <div className="flex items-center gap-1.5">
                            {!y.is_active && <Button size="sm" variant="outline" onClick={() => setYearActive(y.id)}>Set Active</Button>}
                            {y.is_completed ? (
                              <Button size="sm" variant="outline" onClick={() => reopenYear(y)}>Reopen</Button>
                            ) : (
                              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => completeYear(y)}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Complete
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteYear(y)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground space-y-1">
                        <p>{y.start_date} → {y.end_date}</p>
                        <p>Structure: <span className="capitalize font-medium text-foreground">{y.structure}-based</span></p>
                        <p>Semesters/Terms: {semesters.filter((s) => s.academic_year_id === y.id).length}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* SEMESTERS */}
            <TabsContent value="semesters" className="space-y-4 mt-4">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Semesters / Terms</h2>
                  {activeYear && <Badge variant="outline">{activeYear.name}</Badge>}
                </div>
                <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={() => { setSemForm((f) => ({ ...f, year_id: activeYear?.id ?? "" })); setShowSemForm(true); }}>
                  <Plus className="h-4 w-4 mr-1" />New Semester
                </Button>
              </div>
              {yearSemesters.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No semesters yet for the active year.</CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {yearSemesters.map((sem) => (
                    <Card key={sem.id} className={`overflow-hidden shadow-sm border-l-4 ${
  sem.status === 'active' ? 'border-l-emerald-400' :
  sem.status === 'closed' ? 'border-l-red-400' :
  sem.status === 'assessment' ? 'border-l-blue-400' : 'border-l-slate-300'
} ${activeSemester?.id === sem.id ? "border-indigo-300 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                      <CardContent className="py-4 flex items-center justify-between flex-wrap gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{sem.name}</span>
                            <Badge className={STATUS_COLORS[sem.status]}>{STATUS_LABELS[sem.status]}</Badge>
                            {sem.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                          </div>
                          {sem.start_date && <p className="text-xs text-muted-foreground">{sem.start_date} → {sem.end_date}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          {!sem.locked && STATUS_NEXT[sem.status] && (
                            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => advanceSemesterStatus(sem)}>
                              {sem.status === "planning" ? "Activate" : `→ ${STATUS_LABELS[STATUS_NEXT[sem.status]!]}`}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteSemester(sem)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* MARKS & GPA */}
            <TabsContent value="marks" className="space-y-4 mt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold">Marks & GPA</h2>
                  <Select
                    value={activeSemester?.id ?? ""}
                    onValueChange={(id) => setActiveSemester(semesters.find((s) => s.id === id) ?? null)}
                  >
                    <SelectTrigger className="w-48"><SelectValue placeholder="Select Term" /></SelectTrigger>
                    <SelectContent>
                      {semesters.map((sem) => {
                        const yr = academicYears.find((y) => y.id === sem.academic_year_id);
                        return <SelectItem key={sem.id} value={sem.id}>{yr ? `${yr.name} — ${sem.name}` : sem.name}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {isAdmin ? (
                    <Select value={classFilter} onValueChange={setClassFilter}>
                      <SelectTrigger className="w-36"><SelectValue placeholder="All Classes" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Classes</SelectItem>
                        {uniqueClasses.map((c) => (
                          <SelectItem key={c} value={c}>{/^\d+$/.test(c) ? `Class ${c}` : c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={classFilter} onValueChange={setClassFilter}>
                      <SelectTrigger className="w-36"><SelectValue placeholder="All Classes" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Classes</SelectItem>
                        {teacherUniqueClasses.map((c) => (
                          <SelectItem key={c} value={c}>{/^\d+$/.test(c) ? `Class ${c}` : c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {isAdmin && (
                    <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={calculateGPAs} disabled={saving || !activeSemester}>
                      {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Calculate GPA
                    </Button>
                  )}
                </div>
              </div>
              {!activeSemester ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">Select a term above to enter marks.</CardContent></Card>
              ) : activeSemester.status !== "active" ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                  <Lock className="h-5 w-5" />
                  {activeSemester.status === "planning" ? "This term hasn't been activated yet. Ask an admin to activate it before entering marks." : "This term is closed. Marks are locked."}
                </CardContent></Card>
              ) : (
                <Card className="overflow-hidden border-indigo-100 shadow-sm">
                  <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px] md:min-w-0">
                    <TableHeader>
                      <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
                        <TableHead>Student</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>Subjects</TableHead>
                        <TableHead>Avg %</TableHead>
                        <TableHead>GPA</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStudents.map((s) => {
                        const sm = marks[s.id] || [];
                        const gpa = gpas[s.id];
                        const avgPct = sm.length > 0 ? Math.round(sm.reduce((acc, m) => acc + ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100, 0) / sm.length) : null;
                        return (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.full_name ?? "Unnamed"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{s.class ?? "-"}</TableCell>
                            <TableCell>{sm.length > 0 ? `${sm.length} subjects` : <span className="text-muted-foreground text-xs">None</span>}</TableCell>
                            <TableCell>{avgPct !== null ? `${avgPct}%` : "-"}</TableCell>
                            <TableCell>{gpa?.gpa ?? "-"}</TableCell>
                            <TableCell>
                              {gpa ? (
                                <Badge className={gpa.result_status === "pass" ? "bg-green-100 text-green-700" : gpa.result_status === "fail" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}>
                                  {gpa.result_status}
                                </Badge>
                              ) : "-"}
                            </TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" className="border-indigo-200 text-indigo-700 hover:bg-indigo-50" onClick={() => openMarksDialog(s)}>
                                {sm.length > 0 ? "Edit" : "Enter"} Marks
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </Card>
              )}
            </TabsContent>

            {/* RESULTS */}
            <TabsContent value="results" className="space-y-4 mt-4">
              {isStudent ? (
                /* ── Student card view ── */
                <StudentResultsView
                  profile={profile}
                  semesters={semesters}
                  academicYears={academicYears}
                  myStudentRecord={myStudentRecord}
                />
              ) : (
                <AdminResultsView
                  profile={profile}
                  semesters={semesters}
                  academicYears={academicYears}
                  students={resultsFilteredStudents}
                  isAdmin={isAdmin}
                  isTeacher={isTeacher}
                  uniqueClasses={uniqueClasses}
                  teacherUniqueClasses={teacherUniqueClasses}
                  resultsClassFilter={resultsClassFilter}
                  setResultsClassFilter={setResultsClassFilter}
                  teacherClassLabel={(isTeacher && profile) ? `Class ${(profile as any).class_grade || "-"}` : ""}
                />
              )}
            </TabsContent>

            {/* PROMOTION */}
            <TabsContent value="promotion" className="space-y-4 mt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Student Promotion</h2>
                  {activeSemester && <Badge variant="outline">{activeSemester.name}</Badge>}
                </div>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="All Classes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Classes</SelectItem>
                    {uniqueClasses.map((c) => (
                      <SelectItem key={c} value={c}>{/^\d+$/.test(c) ? `Class ${c}` : c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!activeSemester ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">Select a semester from the Semesters tab first.</CardContent></Card>
              ) : !activeYear?.is_completed ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground space-y-2">
                    <AlertCircle className="h-8 w-8 mx-auto text-amber-500" />
                    <p className="font-medium text-foreground">Promotion isn't open yet</p>
                    <p className="text-sm max-w-md mx-auto">
                      Promotion decisions unlock once the academic year <strong>{activeYear?.name}</strong> is marked complete.
                      Make sure marks are entered and GPA is calculated, then go to the Academic Years tab and click <strong>Complete</strong>.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden border-indigo-100 shadow-sm">
                  <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
                  <div className="overflow-x-auto">
                  <Table className="min-w-[700px] md:min-w-0">
                    <TableHeader>
                      <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
                        <TableHead>Student</TableHead>
                        <TableHead>Class</TableHead>
                        <TableHead>GPA</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Decision</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStudents.map((s) => {
                        const gpa = gpas[s.id];
                        const prog = progressions[s.id];
                        return (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.full_name ?? "Unnamed"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{s.class ?? "-"}</TableCell>
                            <TableCell>{gpa?.gpa ?? "-"}</TableCell>
                            <TableCell>
                              {gpa ? (
                                <Badge className={gpa.result_status === "pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>{gpa.result_status}</Badge>
                              ) : <span className="text-xs text-muted-foreground">No GPA</span>}
                            </TableCell>
                            <TableCell>
                              {prog ? (
                                <Badge className={prog.promotion_status === "promoted" ? "bg-green-100 text-green-700" : prog.promotion_status === "retained" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}>
                                  {prog.promotion_status}
                                </Badge>
                              ) : <span className="text-xs text-muted-foreground">Pending</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1.5">
                                <Button size="sm" variant="outline" className="text-green-700 border-green-200 hover:bg-green-50" onClick={() => setPromotion(s, "promoted")}>
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Promote
                                </Button>
                                <Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50" onClick={() => setPromotion(s, "retained")}>
                                  <XCircle className="h-3.5 w-3.5 mr-1" /> Retain
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </Card>
              )}
            </TabsContent>

            {/* ROLLOVER */}
            <TabsContent value="rollover" className="space-y-4 mt-4">
              <h2 className="font-semibold">Year Rollover</h2>
              {!activeSemester ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">Select a semester from the Semesters tab first.</CardContent></Card>
              ) : !activeYear?.is_completed ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground space-y-2">
                    <AlertCircle className="h-8 w-8 mx-auto text-amber-500" />
                    <p className="font-medium text-foreground">Rollover isn't available yet</p>
                    <p className="text-sm max-w-md mx-auto">
                      Mark the academic year <strong>{activeYear?.name}</strong> as complete first (Academic Years tab), then finish promotion decisions here before running rollover.
                    </p>
                  </CardContent>
                </Card>
              ) : (
              <Card>
                <CardContent className="py-8 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-center min-w-[90px] flex-1 sm:flex-none">
                      <p className="font-bold text-2xl text-emerald-700">{Object.values(progressions).filter((p) => p.promotion_status === "promoted").length}</p>
                      <p className="text-xs text-emerald-600 mt-1 font-medium">Promoted</p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-indigo-300 hidden sm:block" />
                    <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-center min-w-[90px] flex-1 sm:flex-none">
                      <p className="font-bold text-2xl text-red-700">{Object.values(progressions).filter((p) => p.promotion_status === "retained").length}</p>
                      <p className="text-xs text-red-600 mt-1 font-medium">Retained</p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-indigo-300 hidden sm:block" />
                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-center min-w-[90px] flex-1 sm:flex-none">
                      <p className="font-bold text-2xl text-slate-700">{filteredStudents.length - Object.values(progressions).length}</p>
                      <p className="text-xs text-slate-500 mt-1 font-medium">Pending</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-lg">
                    Triggering rollover will update all promoted students to their next class grade in the database.
                    Make sure all promotion decisions are finalized before proceeding. This action cannot be undone.
                  </p>
                  <Button
                    onClick={doRollover}
                    disabled={saving || Object.values(progressions).filter((p) => p.promotion_status === "promoted").length === 0}
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                    Trigger Year Rollover
                  </Button>
                </CardContent>
              </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Year Dialog */}
      <Dialog open={showYearForm} onOpenChange={setShowYearForm}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)]">
  <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-indigo-600" /> New Academic Year</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div><Label>Year Name *</Label><Input className="mt-1" placeholder="e.g. 2026-27" value={yearForm.name} onChange={(e) => setYearForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date *</Label><Input className="mt-1" type="date" value={yearForm.start_date} onChange={(e) => setYearForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
              <div><Label>End Date *</Label><Input className="mt-1" type="date" value={yearForm.end_date} onChange={(e) => setYearForm((f) => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Structure</Label>
              <Select value={yearForm.structure} onValueChange={(v) => setYearForm((f) => ({ ...f, structure: v as "term" | "semester" }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="term">Term-based (Term 1, Term 2)</SelectItem>
                  <SelectItem value="semester">Semester-based (Sem 1, Sem 2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowYearForm(false)}>Cancel</Button>
              <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={saveYear} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Semester Dialog */}
      <Dialog open={showSemForm} onOpenChange={setShowSemForm}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)]">
  <DialogHeader><DialogTitle className="flex items-center gap-2"><Clock className="h-4 w-4 text-indigo-600" /> New Semester / Term</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label>Academic Year *</Label>
              <Select value={semForm.year_id} onValueChange={(v) => setSemForm((f) => ({ ...f, year_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {academicYears.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Name *</Label><Input className="mt-1" placeholder="e.g. Term 1" value={semForm.name} onChange={(e) => setSemForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input className="mt-1" type="date" value={semForm.start_date} onChange={(e) => setSemForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
              <div><Label>End Date</Label><Input className="mt-1" type="date" value={semForm.end_date} onChange={(e) => setSemForm((f) => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowSemForm(false)}>Cancel</Button>
              <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={saveSemester} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Marks Dialog */}
      <Dialog open={showMarksDialog} onOpenChange={setShowMarksDialog}>
        <DialogContent className="max-w-lg w-[calc(100%-2rem)] max-h-[80vh] overflow-y-auto">
  <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-600" /> Marks — {selectedStudent?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            {marksForm.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs">Subject</Label><Input className="mt-1" placeholder="e.g. Math" value={m.subject} onChange={(e) => setMarksForm((f) => f.map((r, j) => j === i ? { ...r, subject: e.target.value } : r))} /></div>
                <div><Label className="text-xs">Marks</Label><Input className="mt-1" type="number" placeholder="75" value={m.marks} onChange={(e) => setMarksForm((f) => f.map((r, j) => j === i ? { ...r, marks: e.target.value } : r))} /></div>
                <div><Label className="text-xs">Max</Label><Input className="mt-1" type="number" placeholder="100" value={m.max} onChange={(e) => setMarksForm((f) => f.map((r, j) => j === i ? { ...r, max: e.target.value } : r))} /></div>
                <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteMarkRow(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setMarksForm((f) => [...f, { subject: "", marks: "", max: "100" }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Subject
            </Button>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowMarksDialog(false)}>Cancel</Button>
              <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={saveMarks} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save Marks</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
      
    </AppLayout>
  );
}
