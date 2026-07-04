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

  const generateTicket = (student: Student) => {
    const sched = schedules.find((s) => s.id === selectedScheduleId);
    if (!sched) return;
    setGeneratingId(student.id);
    const html = buildTicketHtml(student, sched, seatByStudent[student.id]);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      setTimeout(() => { win.print(); }, 800);
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = `HallTicket_${student.full_name?.replace(/\s+/g, "_")}_${sched.subject.replace(/\s+/g, "_")}.html`;
      a.click();
    }
    URL.revokeObjectURL(url);
    setGeneratingId(null);
    toast.success("Hall ticket opened — use Print → Save as PDF");
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
      <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">Hall Tickets</h1>
          {schoolName && <p className="text-sm font-medium text-foreground/80 mt-0.5">{schoolName}</p>}
          <p className="text-muted-foreground text-sm mt-1">Generate and download exam hall tickets for students</p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Select Exam</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select Exam" /></SelectTrigger>
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
                    <SelectTrigger className="w-64"><SelectValue placeholder="Select Child" /></SelectTrigger>
                    <SelectContent>
                      {linkedChildren.map((child) => (
                        <SelectItem key={child.id} value={child.id}>{child.full_name ?? "Unnamed"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!activeChild ? null : !selectedScheduleId ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Select an exam to view the hall ticket</p>
                  ) : (
                    <div className="p-4 border rounded-lg bg-muted/30 flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <p className="font-semibold">{activeChild.full_name}</p>
                        <p className="text-sm text-muted-foreground">
                          Roll No. {activeChild.roll_number ?? "-"} · Class {activeChild.class} {activeChild.section}
                        </p>
                        {seatByStudent[activeChild.id] ? (
                          <p className="text-sm mt-1">
                            Hall: <span className="font-medium">{halls.find((h) => h.id === seatByStudent[activeChild.id].hall_id)?.name ?? "-"}</span>
                            {" · "}Seat: <span className="font-medium">
                              {seatByStudent[activeChild.id].seat_row && seatByStudent[activeChild.id].seat_col
                                ? `R${seatByStudent[activeChild.id].seat_row}C${seatByStudent[activeChild.id].seat_col}`
                                : seatByStudent[activeChild.id].seat_number}
                            </span>
                          </p>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 mt-1">Seat not yet assigned</Badge>
                        )}
                      </div>
                      <Button onClick={() => generateTicket(activeChild)} disabled={generatingId === activeChild.id}>
                        {generatingId === activeChild.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                        Download Hall Ticket
                      </Button>
                    </div>
                  )}
                </div>
              ) : !activeChild ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Could not find the linked student record. Contact your school admin.</p>
              ) : !selectedScheduleId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Select an exam to view the hall ticket</p>
              ) : (
                <div className="p-4 border rounded-lg bg-muted/30 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="font-semibold">{activeChild.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      Roll No. {activeChild.roll_number ?? "-"} · Class {activeChild.class} {activeChild.section}
                    </p>
                    {seatByStudent[activeChild.id] ? (
                      <p className="text-sm mt-1">
                        Hall: <span className="font-medium">{halls.find((h) => h.id === seatByStudent[activeChild.id].hall_id)?.name ?? "-"}</span>
                        {" · "}Seat: <span className="font-medium">
                          {seatByStudent[activeChild.id].seat_row && seatByStudent[activeChild.id].seat_col
                            ? `R${seatByStudent[activeChild.id].seat_row}C${seatByStudent[activeChild.id].seat_col}`
                            : seatByStudent[activeChild.id].seat_number}
                        </span>
                      </p>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-300 mt-1">Seat not yet assigned</Badge>
                    )}
                  </div>
                  <Button onClick={() => generateTicket(activeChild)} disabled={generatingId === activeChild.id}>
                    {generatingId === activeChild.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                    Download Hall Ticket
                  </Button>
                </div>
              )
            ) : !selectedScheduleId ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Select an exam to view its student roster</p>
            ) : rosterLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : students.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No students found for the classes in this exam</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{students.length} students</p>
                  <Button variant="outline" size="sm" onClick={generateAllTickets} disabled={bulkGenerating}>
                    {bulkGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                    Generate All Tickets
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
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
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.full_name ?? "Unnamed"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.class} {s.section}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.roll_number ?? "-"}</TableCell>
                          <TableCell className="text-sm">{hall?.name ?? <Badge variant="outline" className="text-amber-600 border-amber-300">No seat</Badge>}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {seat ? (seat.seat_row && seat.seat_col ? `R${seat.seat_row}C${seat.seat_col}` : seat.seat_number) : "-"}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => generateTicket(s)} disabled={generatingId === s.id}>
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
