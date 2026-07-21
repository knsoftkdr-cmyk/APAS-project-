import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Download, Ticket } from "lucide-react";
import html2pdf from "html2pdf.js";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
interface ExamSchedule {
  id: string;
  subject: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  classes: string[];
}

interface ExamHall {
  id: string;
  name: string;
}

interface Student {
  id: string;
  full_name: string | null;
  class: string | null;
  section: string | null;
  roll_number: string | null;
  profile_id?: string | null;
}

interface SeatRow {
  student_id: string;
  hall_id: string;
  seat_row: number | null;
  seat_col: number | null;
  seat_number: number;
}

export default function HallTicketEngine() {
  const { profile } = useAuth();
  const isStudent = profile?.role === "student";
  const isParent = profile?.role === "parent";
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [halls, setHalls] = useState<ExamHall[]>([]);
  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState("");
  const [myStudentRow, setMyStudentRow] = useState<Student | null>(null);
  const [linkedChildren, setLinkedChildren] = useState<Student[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("");

  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [seatByStudent, setSeatByStudent] = useState<Record<string, SeatRow>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);

  const activeChild = isStudent ? myStudentRow : isParent ? (linkedChildren.find((c) => c.id === selectedChildId) ?? null) : null;

  const fetchBase = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const [schedRes, hallsRes, schoolRes] = await Promise.all([
      supabase.from("exam_schedules").select("*").eq("school_id", profile.school_id).order("exam_date", { ascending: false }),
      supabase.from("exam_halls").select("id, name").eq("school_id", profile.school_id),
      supabase.from("schools").select("name").eq("id", profile.school_id).single(),
    ]);
    const allSchedules = (schedRes.data as ExamSchedule[]) || [];
    setHalls((hallsRes.data as ExamHall[]) || []);
    setSchoolName((schoolRes.data as { name: string } | null)?.name ?? "");

    if (isStudent && profile.id) {
      const { data: myRow } = await supabase
        .from("students")
        .select("id, full_name, class, section, roll_number")
        .eq("profile_id", profile.id)
        .eq("school_id", profile.school_id)
        .maybeSingle();
      const mine = (myRow as Student) || null;
      setMyStudentRow(mine);
      const myClass = (mine?.class ?? "").toLowerCase().replace(/^class\s*/i, "").trim();
      setSchedules(allSchedules.filter((s) => s.classes.some((c) => c.toLowerCase().replace(/^class\s*/i, "").trim() === myClass)));
    } else if (isParent && profile.id) {
      const [{ data: linkRows }, { data: allStudents }] = await Promise.all([
        supabase.from("parent_students").select("student_id").eq("parent_id", profile.id),
        supabase.from("students").select("id, full_name, class, section, roll_number, profile_id").eq("school_id", profile.school_id),
      ]);
      const linkedProfileIds = (linkRows || []).map((r: any) => r.student_id);
      const kids = ((allStudents as Student[]) || []).filter((s: any) => s.profile_id && linkedProfileIds.includes(s.profile_id));
      setLinkedChildren(kids);
      if (kids.length > 0) setSelectedChildId(kids[0].id);
      const myClasses = kids.map((k) => (k.class ?? "").toLowerCase().replace(/^class\s*/i, "").trim());
      setSchedules(allSchedules.filter((s) => s.classes.some((c) => myClasses.includes(c.toLowerCase().replace(/^class\s*/i, "").trim()))));
    } else {
      setSchedules(allSchedules);
    }
    setLoading(false);
  };

  useEffect(() => { fetchBase(); }, [profile?.school_id]);

  useEffect(() => {
    const loadMySeat = async () => {
      if ((!isStudent && !isParent) || !selectedScheduleId || !activeChild) { setSeatByStudent({}); return; }
      const { data } = await supabase
        .from("seating_arrangements")
        .select("student_id, hall_id, seat_row, seat_col, seat_number")
        .eq("exam_schedule_id", selectedScheduleId)
        .eq("student_id", activeChild.id)
        .maybeSingle();
      setSeatByStudent(data ? { [activeChild.id]: data as SeatRow } : {});
    };
    loadMySeat();
  }, [selectedScheduleId, isStudent, isParent, activeChild?.id]);

  useEffect(() => {
    const loadRoster = async () => {
      if (isStudent || isParent) return;
      if (!selectedScheduleId || !profile?.school_id) { setStudents([]); setSeatByStudent({}); return; }
      setRosterLoading(true);
      const sched = schedules.find((s) => s.id === selectedScheduleId);
      const normalizedTargets = (sched?.classes || []).map((c) => c.toLowerCase().replace(/^class\s*/i, "").trim());

      const [studentsRes, seatingRes] = await Promise.all([
        supabase.from("students").select("id, full_name, class, section, roll_number").eq("school_id", profile.school_id),
        supabase.from("seating_arrangements").select("student_id, hall_id, seat_row, seat_col, seat_number").eq("exam_schedule_id", selectedScheduleId),
      ]);

      const allStudents = (studentsRes.data as Student[]) || [];
      const eligible = allStudents.filter((s) => {
        const norm = (s.class ?? "").toLowerCase().replace(/^class\s*/i, "").trim();
        return normalizedTargets.includes(norm);
      });
      eligible.sort((a, b) => (a.roll_number ?? "").localeCompare(b.roll_number ?? "", undefined, { numeric: true }));
      setStudents(eligible);

      const seatMap: Record<string, SeatRow> = {};
      for (const row of (seatingRes.data as SeatRow[]) || []) seatMap[row.student_id] = row;
      setSeatByStudent(seatMap);
      setRosterLoading(false);
    };
    loadRoster();
  }, [selectedScheduleId, profile?.school_id]);

  const buildTicketHtml = (student: Student, sched: ExamSchedule, seat: SeatRow | undefined) => {
    const hall = seat ? halls.find((h) => h.id === seat.hall_id) : null;
    const seatLabel = seat
      ? (seat.seat_row && seat.seat_col ? `Row ${seat.seat_row}, Col ${seat.seat_col}` : `Seat ${seat.seat_number}`)
      : "Not yet assigned";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Hall Ticket - ${student.full_name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI', Arial, sans-serif; background:#f9fafb; padding:32px; color:#111827; }
    .ticket { background:white; max-width:650px; margin:0 auto; border:2px solid #1e40af; border-radius:10px; overflow:hidden; }
    .header { background:linear-gradient(135deg,#1e40af,#3b82f6); padding:24px 32px; color:white; text-align:center; }
    .header h1 { font-size:22px; font-weight:800; letter-spacing:1px; }
    .header p { font-size:12px; opacity:0.85; margin-top:2px; }
    .title-bar { background:#eef2ff; padding:10px; text-align:center; font-size:14px; font-weight:700; color:#1e40af; letter-spacing:1px; text-transform:uppercase; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; }
    .info-cell { padding:14px 24px; border-bottom:1px solid #e5e7eb; border-right:1px solid #e5e7eb; }
    .info-cell:nth-child(even) { border-right:none; }
    .info-label { font-size:10px; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px; }
    .info-value { font-size:15px; font-weight:700; color:#111827; }
    .seat-banner { background:#111827; color:white; padding:20px 24px; display:flex; justify-content:space-around; text-align:center; }
    .seat-banner .block .label { font-size:10px; opacity:0.7; text-transform:uppercase; letter-spacing:1px; }
    .seat-banner .block .value { font-size:20px; font-weight:800; margin-top:4px; }
    .footer { padding:16px 24px; text-align:center; font-size:10px; color:#9ca3af; }
    .signatures { display:flex; justify-content:space-between; padding:24px; }
    .sig-line { border-top:1px solid #9ca3af; width:160px; text-align:center; font-size:11px; color:#6b7280; padding-top:6px; }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="header">
      <h1>${schoolName || "APAS"}</h1>
      <p>${schoolName ? "Powered by APAS" : "Adaptive Pedagogy Assessment System"}</p>
    </div>
    <div class="title-bar">Examination Hall Ticket</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Student Name</div><div class="info-value">${student.full_name ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Roll Number</div><div class="info-value">${student.roll_number ?? "—"}</div></div>
      <div class="info-cell"><div class="info-label">Class</div><div class="info-value">${student.class ?? "—"}${student.section ? " - " + student.section : ""}</div></div>
      <div class="info-cell"><div class="info-label">Subject</div><div class="info-value">${sched.subject}</div></div>
      <div class="info-cell"><div class="info-label">Exam Date</div><div class="info-value">${sched.exam_date}</div></div>
      <div class="info-cell"><div class="info-label">Time</div><div class="info-value">${sched.start_time} - ${sched.end_time}</div></div>
    </div>
    <div class="seat-banner">
      <div class="block"><div class="label">Hall</div><div class="value">${hall?.name ?? "—"}</div></div>
      <div class="block"><div class="label">Seat</div><div class="value">${seatLabel}</div></div>
    </div>
    <div class="signatures">
      <div class="sig-line">Student Signature</div>
      <div class="sig-line">Invigilator Signature</div>
    </div>
    <div class="footer">Generated by APAS · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} · This is a computer-generated hall ticket.</div>
  </div>
</body>
</html>`;
  };

  const generateTicket = async (student: Student) => {
    const sched = schedules.find((s) => s.id === selectedScheduleId);
    if (!sched) return;
    setGeneratingId(student.id);

    const html = buildTicketHtml(student, sched, seatByStudent[student.id]);

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.innerHTML = html;
    document.body.appendChild(container);
    const ticketEl = (container.querySelector(".ticket") as HTMLElement) || container;

    const filename = `HallTicket_${student.full_name?.replace(/\s+/g, "_")}_${sched.subject.replace(/\s+/g, "_")}.pdf`;

    try {
      const worker = html2pdf()
        .set({
          margin: 0,
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
        })
        .from(ticketEl);

      if (!Capacitor.isNativePlatform()) {
        // Browser
        await worker.save();
        toast.success("Hall ticket downloaded!");
      } else {
        // Native app (Android/iOS)
        const pdfData = await worker.outputPdf("datauristring");
        const base64 = pdfData.split(",")[1];

        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Documents,
        });

        toast.success("Hall ticket saved successfully!");
      }
    } catch (err) {
      console.error("Hall ticket generation failed:", err);
      toast.error("Failed to generate hall ticket. Please try again.");
    } finally {
      document.body.removeChild(container);
      setGeneratingId(null);
    }
  };

  const generateAllTickets = async () => {
    setBulkGenerating(true);
    for (const student of students) {
      generateTicket(student);
      await new Promise((r) => setTimeout(r, 400));
    }
    setBulkGenerating(false);
  };

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Loading hall tickets...
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-violet-300 opacity-[0.08] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.08] blur-3xl" />

        <div className="relative z-10 p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
          {/* Header */}
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <Ticket className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Hall Tickets</h1>
                {schoolName && <p className="text-indigo-100 text-sm font-medium mt-0.5">{schoolName}</p>}
                <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Generate and download exam hall tickets for students</p>
              </div>
            </div>
          </div>

          <Card className="overflow-hidden border-indigo-100 shadow-sm">
            <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                  <Ticket className="h-4.5 w-4.5 text-indigo-600" />
                </div>
                Select Exam
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
                <SelectTrigger className="w-full sm:w-72 border-slate-200 focus:ring-indigo-400"><SelectValue placeholder="Select Exam" /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.subject} — {s.exam_date}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(isStudent || isParent) ? (
                isParent && linkedChildren.length > 1 ? (
                  <div className="space-y-3">
                    <Select value={selectedChildId} onValueChange={setSelectedChildId}>
                      <SelectTrigger className="w-full sm:w-64 border-slate-200 focus:ring-indigo-400"><SelectValue placeholder="Select Child" /></SelectTrigger>
                      <SelectContent>
                        {linkedChildren.map((child) => (
                          <SelectItem key={child.id} value={child.id}>{child.full_name ?? "Unnamed"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!activeChild ? null : !selectedScheduleId ? (
                      <div className="text-center py-8">
                        <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
                          <Ticket className="h-6 w-6 text-indigo-400" />
                        </div>
                        <p className="text-sm text-muted-foreground">Select an exam to view the hall ticket</p>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <p className="font-semibold text-slate-800">{activeChild.full_name}</p>
                          <p className="text-sm text-muted-foreground">
                            Roll No. {activeChild.roll_number ?? "-"} · Class {activeChild.class} {activeChild.section}
                          </p>
                          {seatByStudent[activeChild.id] ? (
                            <p className="text-sm mt-1">
                              Hall: <span className="font-medium text-indigo-700">{halls.find((h) => h.id === seatByStudent[activeChild.id].hall_id)?.name ?? "-"}</span>
                              {" · "}Seat: <span className="font-medium text-indigo-700">
                                {seatByStudent[activeChild.id].seat_row && seatByStudent[activeChild.id].seat_col
                                  ? `R${seatByStudent[activeChild.id].seat_row}C${seatByStudent[activeChild.id].seat_col}`
                                  : seatByStudent[activeChild.id].seat_number}
                              </span>
                            </p>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 mt-1">Seat not yet assigned</Badge>
                          )}
                        </div>
                        <Button
                          onClick={() => generateTicket(activeChild)}
                          disabled={generatingId === activeChild.id}
                          className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
                        >
                          {generatingId === activeChild.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                          Download Hall Ticket
                        </Button>
                      </div>
                    )}
                  </div>
                ) : !activeChild ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">Could not find the linked student record. Contact your school admin.</p>
                  </div>
                ) : !selectedScheduleId ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
                      <Ticket className="h-6 w-6 text-indigo-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">Select an exam to view the hall ticket</p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-semibold text-slate-800">{activeChild.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Roll No. {activeChild.roll_number ?? "-"} · Class {activeChild.class} {activeChild.section}
                      </p>
                      {seatByStudent[activeChild.id] ? (
                        <p className="text-sm mt-1">
                          Hall: <span className="font-medium text-indigo-700">{halls.find((h) => h.id === seatByStudent[activeChild.id].hall_id)?.name ?? "-"}</span>
                          {" · "}Seat: <span className="font-medium text-indigo-700">
                            {seatByStudent[activeChild.id].seat_row && seatByStudent[activeChild.id].seat_col
                              ? `R${seatByStudent[activeChild.id].seat_row}C${seatByStudent[activeChild.id].seat_col}`
                              : seatByStudent[activeChild.id].seat_number}
                          </span>
                        </p>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 mt-1">Seat not yet assigned</Badge>
                      )}
                    </div>
                    <Button
                      onClick={() => generateTicket(activeChild)}
                      disabled={generatingId === activeChild.id}
                      className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
                    >
                      {generatingId === activeChild.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                      Download Hall Ticket
                    </Button>
                  </div>
                )
              ) : !selectedScheduleId ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center mx-auto mb-3">
                    <Ticket className="h-6 w-6 text-indigo-400" />
                  </div>
                  <p className="text-sm text-muted-foreground">Select an exam to view its student roster</p>
                </div>
              ) : rosterLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Loading roster...
                </div>
              ) : students.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">No students found for the classes in this exam</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm text-muted-foreground">{students.length} students</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                      onClick={generateAllTickets}
                      disabled={bulkGenerating}
                    >
                      {bulkGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                      Generate All Tickets
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-indigo-100">
                    <Table className="min-w-[700px] md:min-w-0">
                      <TableHeader>
                        <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
                          <TableHead>Student</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Roll No.</TableHead>
                          <TableHead>Hall</TableHead>
                          <TableHead>Seat</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {students.map((s) => {
                          const seat = seatByStudent[s.id];
                          const hall = seat ? halls.find((h) => h.id === seat.hall_id) : null;
                          return (
                            <TableRow key={s.id} className="hover:bg-indigo-50/30">
                              <TableCell className="font-medium text-slate-800">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                    {(s.full_name ?? "U")[0]}
                                  </div>
                                  {s.full_name ?? "Unnamed"}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{s.class} {s.section}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{s.roll_number ?? "-"}</TableCell>
                              <TableCell className="text-sm">{hall?.name ?? <Badge variant="outline" className="text-amber-600 border-amber-300">No seat</Badge>}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {seat ? (seat.seat_row && seat.seat_col ? `R${seat.seat_row}C${seat.seat_col}` : seat.seat_number) : "-"}
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                  onClick={() => generateTicket(s)}
                                  disabled={generatingId === s.id}
                                >
                                  {generatingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5 mr-1" />}
                                  Ticket
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
