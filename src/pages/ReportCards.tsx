import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, Loader2, FileText, GraduationCap } from "lucide-react";

interface Student {
  id: string;
  full_name: string | null;
  class: string | null;
  section: string | null;
  profile_id: string | null;
  roll_number: string | null;
}

interface Mark {
  subject: string;
  marks_obtained: number | null;
  max_marks: number;
}

interface GPA {
  gpa: number | null;
  combined_score: number | null;
  result_status: string;
}

interface Semester {
  id: string;
  name: string;
  academic_year_id: string;
}

interface AcademicYear {
  id: string;
  name: string;
}

function normalizeClass(cls: string | null): string {
  if (!cls) return "";
  return cls.toLowerCase().replace(/^class\s*/i, "").trim();
}

function getGrade(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  return "F";
}

export default function ReportCards() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "principal", "school_admin"].includes(profile?.role ?? "");
  const isTeacher = profile?.role === "teacher";
  const isStudent = profile?.role === "student";
  const isParent = profile?.role === "parent";

  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedSemId, setSelectedSemId] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [marksMap, setMarksMap] = useState<Record<string, Mark[]>>({});
  const [gpaMap, setGpaMap] = useState<Record<string, GPA>>({});
  const [semLoading, setSemLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [myStudentRow, setMyStudentRow] = useState<Student | null>(null);
  const [schoolName, setSchoolName] = useState<string>("");
  const [linkedChildren, setLinkedChildren] = useState<Student[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile?.school_id) return;
    const fetchBase = async () => {
      setLoading(true);
      const [semsRes, yearsRes, studentsRes, schoolRes] = await Promise.all([
        supabase.from("academic_semesters").select("id, name, academic_year_id").eq("school_id", profile.school_id).order("created_at"),
        supabase.from("academic_years").select("id, name").eq("school_id", profile.school_id).order("created_at", { ascending: false }),
        supabase.from("students").select("id, full_name, class, section, profile_id, roll_number").eq("school_id", profile.school_id).order("class").order("full_name"),
        supabase.from("schools").select("name").eq("id", profile.school_id).single(),
      ]);
      setSemesters((semsRes.data as Semester[]) || []);
      setAcademicYears((yearsRes.data as AcademicYear[]) || []);
      setSchoolName((schoolRes.data as { name: string } | null)?.name ?? "");
      const allStudents = (studentsRes.data as Student[]) || [];
      setStudents(allStudents);
      if (isStudent) {
        const mine = allStudents.find((s) => s.profile_id === profile.id) ?? null;
        setMyStudentRow(mine);
      }
      if (isParent) {
        const { data: linkRows } = await supabase
          .from("parent_students")
          .select("student_id")
          .eq("parent_id", profile.id);
        const linkedProfileIds = (linkRows || []).map((r: any) => r.student_id);
        const kids = allStudents.filter((s) => s.profile_id && linkedProfileIds.includes(s.profile_id));
        setLinkedChildren(kids);
        if (kids.length > 0) setSelectedChildId(kids[0].id);
      }
      setLoading(false);
    };
    fetchBase();
  }, [profile?.school_id]);

  const activeChildForEffect = isParent ? (linkedChildren.find((c) => c.id === selectedChildId) ?? null) : null;

  useEffect(() => {
    if (!selectedSemId || !profile?.school_id) return;
    setSemLoading(true);
    const relevantStudents = isStudent
      ? (myStudentRow ? [myStudentRow] : [])
      : isParent
      ? (activeChildForEffect ? [activeChildForEffect] : [])
      : isTeacher
      ? students.filter((s) => normalizeClass(s.class) === normalizeClass((profile as any).class_grade ?? ""))
      : students.filter((s) => classFilter === "all" || normalizeClass(s.class) === classFilter);

    if (relevantStudents.length === 0) { setSemLoading(false); return; }
    const ids = relevantStudents.map((s) => s.id);
    Promise.all([
      supabase.from("semester_marks").select("*").eq("semester_id", selectedSemId).in("student_id", ids),
      supabase.from("student_gpa").select("*").eq("semester_id", selectedSemId).in("student_id", ids),
    ]).then(([marksRes, gpaRes]) => {
      const mm: Record<string, Mark[]> = {};
      for (const m of marksRes.data || []) {
        if (!mm[m.student_id]) mm[m.student_id] = [];
        mm[m.student_id].push(m);
      }
      setMarksMap(mm);
      const gm: Record<string, GPA> = {};
      for (const g of gpaRes.data || []) gm[g.student_id] = g;
      setGpaMap(gm);
      setSemLoading(false);
    });
  }, [selectedSemId, classFilter, students.length, myStudentRow?.id, selectedChildId]);

  const selectedSem = semesters.find((s) => s.id === selectedSemId);
  const activeChild = isStudent ? myStudentRow : isParent ? (linkedChildren.find((c) => c.id === selectedChildId) ?? null) : null;
  const selectedYear = selectedSem ? academicYears.find((y) => y.id === selectedSem.academic_year_id) : null;
  const uniqueClasses = Array.from(new Set(students.map((s) => normalizeClass(s.class)).filter(Boolean))).sort();

  const displayStudents = isStudent
    ? (activeChild ? [activeChild] : [])
    : isParent
    ? (activeChild ? [activeChild] : [])
    : isTeacher
    ? students.filter((s) => normalizeClass(s.class) === normalizeClass((profile as any).class_grade ?? ""))
    : students.filter((s) => classFilter === "all" || normalizeClass(s.class) === classFilter);

  const generatePDF = async (student: Student) => {
    setGeneratingPdf(student.id);
    const marks = marksMap[student.id] || [];
    const gpa = gpaMap[student.id];
    const sem = selectedSem;
    const yr = selectedYear;

    const avgPct = marks.length > 0
      ? Math.round(marks.reduce((a, m) => a + ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100, 0) / marks.length)
      : null;

    const subjectRows = marks.map((m) => {
      const pct = m.marks_obtained !== null ? Math.round(((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100) : null;
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-transform:capitalize">${m.subject}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${m.marks_obtained ?? "-"}/${m.max_marks}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${pct !== null ? pct + "%" : "-"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:${pct !== null && pct >= 50 ? "#16a34a" : "#dc2626"}">${pct !== null ? getGrade(pct) : "-"}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Report Card - ${student.full_name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background:#f9fafb; padding:32px; color:#111827; }
    .page { background:white; max-width:700px; margin:0 auto; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .header { background:linear-gradient(135deg,#1e40af,#3b82f6); padding:32px; color:white; text-align:center; }
    .header h1 { font-size:28px; font-weight:800; letter-spacing:2px; }
    .header p { font-size:13px; opacity:0.85; margin-top:4px; }
    .report-title { font-size:15px; font-weight:600; margin-top:12px; background:rgba(255,255,255,0.15); display:inline-block; padding:4px 16px; border-radius:20px; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:0; border-bottom:1px solid #e5e7eb; }
    .info-cell { padding:14px 20px; border-right:1px solid #e5e7eb; }
    .info-cell:nth-child(even) { border-right:none; }
    .info-label { font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px; }
    .info-value { font-size:14px; font-weight:600; color:#111827; }
    .section-title { padding:12px 20px; background:#f8fafc; border-bottom:1px solid #e5e7eb; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#6b7280; }
    table { width:100%; border-collapse:collapse; }
    thead tr { background:#f8fafc; }
    thead th { padding:10px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#6b7280; border-bottom:2px solid #e5e7eb; }
    thead th:not(:first-child) { text-align:center; }
    .summary { display:grid; grid-template-columns:1fr 1fr 1fr; border-top:2px solid #e5e7eb; }
    .summary-cell { padding:16px 20px; text-align:center; border-right:1px solid #e5e7eb; }
    .summary-cell:last-child { border-right:none; }
    .summary-value { font-size:28px; font-weight:800; }
    .summary-label { font-size:11px; color:#6b7280; margin-top:2px; text-transform:uppercase; letter-spacing:0.5px; }
    .pass { color:#16a34a; }
    .fail { color:#dc2626; }
    .result-badge { display:inline-block; padding:4px 14px; border-radius:20px; font-size:13px; font-weight:700; }
    .result-pass { background:#dcfce7; color:#16a34a; }
    .result-fail { background:#fee2e2; color:#dc2626; }
    .footer { padding:16px 20px; text-align:center; font-size:11px; color:#9ca3af; border-top:1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${schoolName || "APAS"}</h1>
      <p>${schoolName ? "Powered by APAS" : "Adaptive Pedagogy Assessment System"}</p>
      <div class="report-title">Student Report Card</div>
    </div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Student Name</div><div class="info-value">${student.full_name ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Roll Number</div><div class="info-value">${student.roll_number ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Class</div><div class="info-value">${student.class ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Section</div><div class="info-value">${student.section ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Academic Year</div><div class="info-value">${yr?.name ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Term / Semester</div><div class="info-value">${sem?.name ?? "—"}</div></div>
    </div>
    <div class="section-title">Subject-wise Marks</div>
    ${marks.length === 0
      ? `<div style="padding:24px;text-align:center;color:#9ca3af">No marks recorded for this term.</div>`
      : `<table><thead><tr><th>Subject</th><th>Marks</th><th>Percentage</th><th>Grade</th></tr></thead><tbody>${subjectRows}</tbody></table>`
    }
    <div class="summary">
      <div class="summary-cell">
        <div class="summary-value ${gpa?.result_status === "pass" ? "pass" : gpa?.result_status === "fail" ? "fail" : ""}">${gpa?.gpa ?? "—"}</div>
        <div class="summary-label">GPA / 10</div>
      </div>
      <div class="summary-cell">
        <div class="summary-value">${avgPct !== null ? avgPct + "%" : "—"}</div>
        <div class="summary-label">Overall %</div>
      </div>
      <div class="summary-cell" style="display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span class="result-badge ${gpa?.result_status === "pass" ? "result-pass" : gpa?.result_status === "fail" ? "result-fail" : ""}">${gpa?.result_status === "pass" ? "✓ PASS" : gpa?.result_status === "fail" ? "✗ FAIL" : "PENDING"}</span>
        <div class="summary-label" style="margin-top:6px">Result</div>
      </div>
    </div>
    <div class="footer">Generated by APAS · ${new Date().toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" })} · This is a computer-generated report card.</div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      setTimeout(() => { win.print(); }, 800);
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = `ReportCard_${student.full_name?.replace(/\s+/g, "_")}_${sem?.name?.replace(/\s+/g, "_")}.html`;
      a.click();
    }
    URL.revokeObjectURL(url);
    setGeneratingPdf(null);
    toast.success("Report card opened — use Print → Save as PDF");
  };

  if (loading) return (
    <AppLayout>
      <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Report Cards</h1>
            {schoolName && <p className="text-sm font-medium text-foreground/80 mt-0.5">{schoolName}</p>}
            <p className="text-muted-foreground text-sm mt-1">
              {isStudent ? "Download your report card" : "View gradebook and generate student report cards"}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedSemId} onValueChange={setSelectedSemId}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Select Term / Semester" /></SelectTrigger>
            <SelectContent>
              {semesters.map((sem) => {
                const yr = academicYears.find((y) => y.id === sem.academic_year_id);
                return <SelectItem key={sem.id} value={sem.id}>{yr ? `${yr.name} — ${sem.name}` : sem.name}</SelectItem>;
              })}
            </SelectContent>
          </Select>

          {isParent && linkedChildren.length > 1 && (
            <Select value={selectedChildId} onValueChange={setSelectedChildId}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Select Child" /></SelectTrigger>
              <SelectContent>
                {linkedChildren.map((child) => (
                  <SelectItem key={child.id} value={child.id}>{child.full_name ?? "Unnamed"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isAdmin && (
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All Classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {uniqueClasses.map((c) => (
                  <SelectItem key={c} value={c}>{/^\d+$/.test(c) ? `Class ${c}` : c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isTeacher && (
            <Badge variant="outline" className="px-3 py-1.5">
              Class {normalizeClass((profile as any)?.class_grade ?? "") || "-"}
            </Badge>
          )}
        </div>

        {!selectedSemId ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3" />
              <p className="font-medium">Select a term to view report cards</p>
            </CardContent>
          </Card>
        ) : semLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (isStudent || isParent) ? (
          /* Student or Parent: show the linked student report card directly */
          activeChild ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  {activeChild.full_name} — {selectedSem?.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-muted rounded-lg flex-wrap">
                  <div className="text-center">
                    <p className="text-3xl font-bold">{gpaMap[activeChild.id]?.gpa ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">GPA / 10</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold">
                      {(marksMap[activeChild.id] || []).length > 0
                        ? `${Math.round((marksMap[activeChild.id] || []).reduce((a, m) => a + ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100, 0) / (marksMap[activeChild.id] || []).length)}%`
                        : "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">Overall %</p>
                  </div>
                  {gpaMap[activeChild.id] && (
                    <Badge className={gpaMap[activeChild.id].result_status === "pass" ? "bg-green-100 text-green-700 text-sm px-3 py-1" : "bg-red-100 text-red-700 text-sm px-3 py-1"}>
                      {gpaMap[activeChild.id].result_status === "pass" ? "✓ Pass" : "✗ Fail"}
                    </Badge>
                  )}
                  <Button className="ml-auto" onClick={() => generatePDF(activeChild)} disabled={generatingPdf === activeChild.id}>
                    {generatingPdf === activeChild.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                    Download Report Card
                  </Button>
                </div>
                {(marksMap[activeChild.id] || []).length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead className="text-center">Marks</TableHead>
                        <TableHead className="text-center">%</TableHead>
                        <TableHead className="text-center">Grade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(marksMap[activeChild.id] || []).map((m, i) => {
                        const pct = m.marks_obtained !== null ? Math.round(((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100) : null;
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-medium capitalize">{m.subject}</TableCell>
                            <TableCell className="text-center">{m.marks_obtained ?? "-"}/{m.max_marks}</TableCell>
                            <TableCell className="text-center">{pct !== null ? `${pct}%` : "-"}</TableCell>
                            <TableCell className="text-center">
                              <span className={pct !== null ? (pct >= 50 ? "text-green-600 font-semibold" : "text-red-500 font-semibold") : ""}>{pct !== null ? getGrade(pct) : "-"}</span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Could not find the linked student record. Contact your school admin.</CardContent></Card>
          )
        ) : (
          /* Admin/Teacher: gradebook grid */
          displayStudents.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No students found for this filter.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{displayStudents.length} students</p>
                <Button variant="outline" size="sm" onClick={() => displayStudents.forEach((s) => generatePDF(s))} disabled={!!generatingPdf}>
                  <Download className="h-4 w-4 mr-2" /> Generate All PDFs
                </Button>
              </div>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead className="text-center">GPA</TableHead>
                      <TableHead className="text-center">Overall %</TableHead>
                      <TableHead className="text-center">Result</TableHead>
                      <TableHead className="text-center">Subjects</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.map((s) => {
                      const gpa = gpaMap[s.id];
                      const sm = marksMap[s.id] || [];
                      const avgPct = sm.length > 0 ? Math.round(sm.reduce((a, m) => a + ((m.marks_obtained ?? 0) / (m.max_marks || 100)) * 100, 0) / sm.length) : null;
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.full_name ?? "Unnamed"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.class ?? "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.section ?? "-"}</TableCell>
                          <TableCell className="text-center font-semibold">{gpa?.gpa ?? "-"}</TableCell>
                          <TableCell className="text-center">{avgPct !== null ? `${avgPct}%` : "-"}</TableCell>
                          <TableCell className="text-center">
                            {gpa ? (
                              <Badge className={gpa.result_status === "pass" ? "bg-green-100 text-green-700" : gpa.result_status === "fail" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}>
                                {gpa.result_status === "pass" ? "Pass" : gpa.result_status === "fail" ? "Fail" : "Pending"}
                              </Badge>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">{sm.length}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => generatePDF(s)} disabled={generatingPdf === s.id}>
                              {generatingPdf === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                              PDF
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )
        )}
      </div>
    </AppLayout>
  );
}
