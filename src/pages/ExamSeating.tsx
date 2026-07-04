import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Shuffle, Building2, Trash2, Printer, Download } from "lucide-react";

interface ExamHall {
  id: string;
  name: string;
  rows: number | null;
  columns: number | null;
  capacity: number;
}

interface ExamSchedule {
  id: string;
  subject: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  classes: string[];
}

interface Student {
  id: string;
  full_name: string | null;
  class: string | null;
  section: string | null;
  roll_number: string | null;
}

interface SeatAssignment {
  student_id: string;
  hall_id: string;
  seat_row: number | null;
  seat_col: number | null;
  seat_number: number;
}

interface SavedLayout {
  exam_schedule_id: string;
  hall_id: string;
  seat_count: number;
}

function normalizeClass(cls: string | null): string {
  if (!cls) return "";
  return cls.toLowerCase().replace(/^class\s*/i, "").trim();
}

export default function ExamSeating() {
  const { profile } = useAuth();
  const [halls, setHalls] = useState<ExamHall[]>([]);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const [hallDialogOpen, setHallDialogOpen] = useState(false);
  const [newHallName, setNewHallName] = useState("");
  const [newHallRows, setNewHallRows] = useState("");
  const [newHallCols, setNewHallCols] = useState("");
  const [newHallCapacity, setNewHallCapacity] = useState("");
  const [savingHall, setSavingHall] = useState(false);

  const [schedDialogOpen, setSchedDialogOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newClasses, setNewClasses] = useState("");
  const [savingSched, setSavingSched] = useState(false);

  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [selectedHallIds, setSelectedHallIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [seatingResult, setSeatingResult] = useState<Record<string, SeatAssignment[]>>({});
  const [studentsById, setStudentsById] = useState<Record<string, Student>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [layoutActionKey, setLayoutActionKey] = useState<string | null>(null);

  const fetchAll = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const [hallsRes, schedRes, seatingRes] = await Promise.all([
      supabase.from("exam_halls").select("*").eq("school_id", profile.school_id).order("name"),
      supabase.from("exam_schedules").select("*").eq("school_id", profile.school_id).order("exam_date", { ascending: false }),
      supabase.from("seating_arrangements").select("exam_schedule_id, hall_id").eq("school_id", profile.school_id),
    ]);
    setHalls((hallsRes.data as ExamHall[]) || []);
    setSchedules((schedRes.data as ExamSchedule[]) || []);

    const rows = (seatingRes.data as { exam_schedule_id: string; hall_id: string }[]) || [];
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = `${r.exam_schedule_id}::${r.hall_id}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    const layouts: SavedLayout[] = Object.keys(counts).map((key) => {
      const [exam_schedule_id, hall_id] = key.split("::");
      return { exam_schedule_id, hall_id, seat_count: counts[key] };
    });
    setSavedLayouts(layouts);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [profile?.school_id]);

  const saveHall = async () => {
    if (!profile?.school_id || !newHallName.trim()) {
      toast.error("Hall name is required");
      return;
    }
    const rows = newHallRows ? parseInt(newHallRows) : null;
    const cols = newHallCols ? parseInt(newHallCols) : null;
    const capacity = newHallCapacity ? parseInt(newHallCapacity) : (rows && cols ? rows * cols : null);
    if (!capacity || capacity <= 0) {
      toast.error("Provide either capacity, or both rows and columns");
      return;
    }
    setSavingHall(true);
    const { error } = await supabase.from("exam_halls").insert({
      school_id: profile.school_id,
      name: newHallName.trim(),
      rows, columns: cols, capacity,
    });
    setSavingHall(false);
    if (error) { toast.error("Failed to save hall"); return; }
    toast.success("Hall added");
    setNewHallName(""); setNewHallRows(""); setNewHallCols(""); setNewHallCapacity("");
    setHallDialogOpen(false);
    fetchAll();
  };

  const deleteHall = async (hallId: string) => {
    if (!confirm("Delete this hall? Any existing seating arrangements using it will also be removed.")) return;
    setDeletingId(hallId);
    await supabase.from("seating_arrangements").delete().eq("hall_id", hallId);
    const { error } = await supabase.from("exam_halls").delete().eq("id", hallId);
    setDeletingId(null);
    if (error) { toast.error("Failed to delete hall"); return; }
    toast.success("Hall deleted");
    setSelectedHallIds((prev) => prev.filter((id) => id !== hallId));
    fetchAll();
  };

  const saveSchedule = async () => {
    if (!profile?.school_id || !newSubject.trim() || !newDate || !newStart || !newEnd || !newClasses.trim()) {
      toast.error("All fields are required");
      return;
    }
    setSavingSched(true);
    const classesArr = newClasses.split(",").map((c) => c.trim()).filter(Boolean);
    const { error } = await supabase.from("exam_schedules").insert({
      school_id: profile.school_id,
      subject: newSubject.trim(),
      exam_date: newDate,
      start_time: newStart,
      end_time: newEnd,
      classes: classesArr,
    });
    setSavingSched(false);
    if (error) { toast.error("Failed to save exam schedule"); return; }
    toast.success("Exam schedule added");
    setNewSubject(""); setNewDate(""); setNewStart(""); setNewEnd(""); setNewClasses("");
    setSchedDialogOpen(false);
    fetchAll();
  };

  const deleteSchedule = async (scheduleId: string) => {
    if (!confirm("Delete this exam schedule? Any seating arrangements for it will also be removed.")) return;
    setDeletingId(scheduleId);
    await supabase.from("seating_arrangements").delete().eq("exam_schedule_id", scheduleId);
    const { error } = await supabase.from("exam_schedules").delete().eq("id", scheduleId);
    setDeletingId(null);
    if (error) { toast.error("Failed to delete exam schedule"); return; }
    toast.success("Exam schedule deleted");
    if (selectedScheduleId === scheduleId) setSelectedScheduleId("");
    fetchAll();
  };

  const toggleHallSelection = (hallId: string) => {
    setSelectedHallIds((prev) => prev.includes(hallId) ? prev.filter((id) => id !== hallId) : [...prev, hallId]);
  };

  const generateSeating = async () => {
    const sched = schedules.find((s) => s.id === selectedScheduleId);
    if (!sched) { toast.error("Select an exam schedule"); return; }
    if (selectedHallIds.length === 0) { toast.error("Select at least one hall"); return; }
    if (!profile?.school_id) return;

    setGenerating(true);

    const normalizedTargets = sched.classes.map((c) => normalizeClass(c));
    const { data: allStudents } = await supabase
      .from("students")
      .select("id, full_name, class, section, roll_number")
      .eq("school_id", profile.school_id);

    const eligible = ((allStudents as Student[]) || []).filter((s) =>
      normalizedTargets.includes(normalizeClass(s.class))
    );

    if (eligible.length === 0) {
      toast.error("No students found for the classes in this exam schedule");
      setGenerating(false);
      return;
    }

    const buckets: Record<string, Student[]> = {};
    for (const s of eligible) {
      const key = `${normalizeClass(s.class)}-${s.section ?? ""}`;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(s);
    }
    Object.values(buckets).forEach((arr) =>
      arr.sort((a, b) => (a.roll_number ?? "").localeCompare(b.roll_number ?? "", undefined, { numeric: true }))
    );

    const bucketKeys = Object.keys(buckets);
    const interleaved: Student[] = [];
    let exhausted = false;
    while (!exhausted) {
      exhausted = true;
      for (const key of bucketKeys) {
        const bucket = buckets[key];
        if (bucket.length > 0) {
          interleaved.push(bucket.shift()!);
          exhausted = false;
        }
      }
    }

    const selectedHalls = halls.filter((h) => selectedHallIds.includes(h.id));
    const assignments: SeatAssignment[] = [];
    let cursor = 0;

    for (const hall of selectedHalls) {
      const capacity = hall.capacity;
      const hasGrid = !!(hall.rows && hall.columns);
      for (let seatNum = 1; seatNum <= capacity && cursor < interleaved.length; seatNum++) {
        const student = interleaved[cursor];
        let seat_row: number | null = null;
        let seat_col: number | null = null;
        if (hasGrid) {
          seat_row = Math.floor((seatNum - 1) / hall.columns!) + 1;
          seat_col = ((seatNum - 1) % hall.columns!) + 1;
        }
        assignments.push({ student_id: student.id, hall_id: hall.id, seat_row, seat_col, seat_number: seatNum });
        cursor++;
      }
    }

    if (cursor < interleaved.length) {
      toast.error(`Not enough seats: ${interleaved.length} students but only ${cursor} seats across selected halls. Add more halls or increase capacity.`);
      setGenerating(false);
      return;
    }

    await supabase.from("seating_arrangements")
      .delete()
      .eq("exam_schedule_id", selectedScheduleId)
      .in("hall_id", selectedHallIds);

    const { error } = await supabase.from("seating_arrangements").insert(
      assignments.map((a) => ({ ...a, school_id: profile.school_id, exam_schedule_id: selectedScheduleId }))
    );

    setGenerating(false);
    if (error) { toast.error("Failed to save seating arrangement"); return; }

    toast.success(`Seating generated for ${interleaved.length} students`);

    const byHall: Record<string, SeatAssignment[]> = {};
    for (const a of assignments) {
      if (!byHall[a.hall_id]) byHall[a.hall_id] = [];
      byHall[a.hall_id].push(a);
    }
    setSeatingResult(byHall);
    const sMap: Record<string, Student> = {};
    for (const s of eligible) sMap[s.id] = s;
    setStudentsById(sMap);
    fetchAll();
  };

  const buildLayoutHtml = (hall: ExamHall, sched: ExamSchedule | undefined, assignments: SeatAssignment[], studentsMap: Record<string, Student>) => {
    const hasGrid = !!(hall.rows && hall.columns);
    const rows = hall.rows ?? Math.ceil(hall.capacity / 10);
    const cols = hall.columns ?? Math.min(hall.capacity, 10);

    const seatMap: Record<string, SeatAssignment> = {};
    for (const a of assignments) {
      const key = hasGrid ? `${a.seat_row}-${a.seat_col}` : `${a.seat_number}`;
      seatMap[key] = a;
    }

    let gridHtml = "";
    for (let r = 1; r <= rows; r++) {
      gridHtml += `<tr>`;
      for (let col = 1; col <= cols; col++) {
        const seatNum = (r - 1) * cols + col;
        const key = hasGrid ? `${r}-${col}` : `${seatNum}`;
        const a = seatMap[key];
        const student = a ? studentsMap[a.student_id] : null;
        gridHtml += `
          <td style="border:1px solid #cbd5e1;padding:10px;text-align:center;vertical-align:middle;width:${100 / cols}%;height:70px;${student ? "background:#f8fafc" : "background:#f1f5f9;color:#cbd5e1"}">
            ${student
              ? `<div style="font-size:15px;font-weight:700">${student.roll_number ?? "-"}</div><div style="font-size:10px;color:#64748b;margin-top:2px">${student.class ?? ""}${student.section ? "-" + student.section : ""}</div>`
              : `<div style="font-size:11px">Seat ${seatNum}</div>`}
          </td>`;
      }
      gridHtml += `</tr>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Seating Layout - ${hall.name}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI', Arial, sans-serif; padding:32px; color:#111827; }
    .header { text-align:center; margin-bottom:20px; }
    .header h1 { font-size:22px; font-weight:800; }
    .header p { font-size:13px; color:#6b7280; margin-top:4px; }
    table { border-collapse:collapse; width:100%; margin-top:16px; }
    .front-label { text-align:center; font-size:11px; color:#9ca3af; text-transform:uppercase; letter-spacing:2px; margin-bottom:8px; }
    .footer { margin-top:20px; text-align:center; font-size:11px; color:#9ca3af; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${hall.name} — Seating Layout</h1>
    <p>${sched ? `${sched.subject} · ${sched.exam_date} · ${sched.start_time}-${sched.end_time}` : ""}</p>
  </div>
  <div class="front-label">Front of Hall</div>
  <table>${gridHtml}</table>
  <div class="footer">Generated by APAS · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</div>
</body>
</html>`;
  };

  const openLayoutPrint = (hall: ExamHall, sched: ExamSchedule | undefined, assignments: SeatAssignment[], studentsMap: Record<string, Student>) => {
    const html = buildLayoutHtml(hall, sched, assignments, studentsMap);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) setTimeout(() => win.print(), 800);
    URL.revokeObjectURL(url);
  };

  const downloadLayoutHtml = (hall: ExamHall, sched: ExamSchedule | undefined, assignments: SeatAssignment[], studentsMap: Record<string, Student>) => {
    const html = buildLayoutHtml(hall, sched, assignments, studentsMap);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SeatingLayout_${hall.name.replace(/\s+/g, "_")}_${sched?.subject?.replace(/\s+/g, "_") ?? "exam"}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Layout downloaded");
  };

  // For layouts generated earlier in this session (data already in memory)
  const generateLayoutPDF = (hallId: string) => {
    const hall = halls.find((h) => h.id === hallId);
    const assignments = seatingResult[hallId] || [];
    const sched = schedules.find((s) => s.id === selectedScheduleId);
    if (!hall || assignments.length === 0) return;
    openLayoutPrint(hall, sched, assignments, studentsById);
  };

  // For saved layouts loaded fresh from the DB (works after a page refresh, no regeneration needed)
  const loadAndRunSavedLayout = async (examScheduleId: string, hallId: string, action: "view" | "download") => {
    const key = `${examScheduleId}::${hallId}::${action}`;
    setLayoutActionKey(key);
    const hall = halls.find((h) => h.id === hallId);
    const sched = schedules.find((s) => s.id === examScheduleId);
    if (!hall) { setLayoutActionKey(null); return; }

    const { data: seatRows } = await supabase
      .from("seating_arrangements")
      .select("student_id, hall_id, seat_row, seat_col, seat_number")
      .eq("exam_schedule_id", examScheduleId)
      .eq("hall_id", hallId);

    const assignments = (seatRows as SeatAssignment[]) || [];
    if (assignments.length === 0) {
      toast.error("No seating data found for this layout");
      setLayoutActionKey(null);
      return;
    }

    const studentIds = assignments.map((a) => a.student_id);
    const { data: studentRows } = await supabase
      .from("students")
      .select("id, full_name, class, section, roll_number")
      .in("id", studentIds);

    const studentsMap: Record<string, Student> = {};
    for (const s of (studentRows as Student[]) || []) studentsMap[s.id] = s;

    if (action === "view") {
      openLayoutPrint(hall, sched, assignments, studentsMap);
    } else {
      downloadLayoutHtml(hall, sched, assignments, studentsMap);
    }
    setLayoutActionKey(null);
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
          <h1 className="text-2xl font-bold">Exam Seating</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage exam halls, schedules, and generate seating arrangements</p>
        </div>

        {/* Halls */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Exam Halls</CardTitle>
            <Dialog open={hallDialogOpen} onOpenChange={setHallDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add Hall</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Exam Hall</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Hall Name</Label><Input value={newHallName} onChange={(e) => setNewHallName(e.target.value)} placeholder="e.g. Hall A" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Rows (optional)</Label><Input type="number" value={newHallRows} onChange={(e) => setNewHallRows(e.target.value)} /></div>
                    <div><Label>Columns (optional)</Label><Input type="number" value={newHallCols} onChange={(e) => setNewHallCols(e.target.value)} /></div>
                  </div>
                  <div><Label>Capacity (required if no rows/columns)</Label><Input type="number" value={newHallCapacity} onChange={(e) => setNewHallCapacity(e.target.value)} placeholder="Total seats" /></div>
                  <Button onClick={saveHall} disabled={savingHall} className="w-full">
                    {savingHall ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Save Hall
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {halls.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No exam halls yet. Add one to get started.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Layout</TableHead><TableHead className="text-center">Capacity</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {halls.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.rows && h.columns ? `${h.rows} × ${h.columns} grid` : "Flat capacity"}</TableCell>
                      <TableCell className="text-center">{h.capacity}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => deleteHall(h.id)} disabled={deletingId === h.id}>
                          {deletingId === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-red-500" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Exam Schedules */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Exam Schedules</CardTitle>
            <Dialog open={schedDialogOpen} onOpenChange={setSchedDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add Exam</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Exam Schedule</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Subject</Label><Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="e.g. Mathematics" /></div>
                  <div><Label>Date</Label><Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Start Time</Label><Input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} /></div>
                    <div><Label>End Time</Label><Input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></div>
                  </div>
                  <div><Label>Classes (comma-separated)</Label><Input value={newClasses} onChange={(e) => setNewClasses(e.target.value)} placeholder="e.g. 9, 10" /></div>
                  <Button onClick={saveSchedule} disabled={savingSched} className="w-full">
                    {savingSched ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Save Exam Schedule
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {schedules.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No exam schedules yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Classes</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.subject}</TableCell>
                      <TableCell className="text-sm">{s.exam_date}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.start_time} - {s.end_time}</TableCell>
                      <TableCell>{s.classes.map((c) => <Badge key={c} variant="outline" className="mr-1">{c}</Badge>)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => deleteSchedule(s.id)} disabled={deletingId === s.id}>
                          {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-red-500" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Generate Seating */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shuffle className="h-4 w-4" /> Generate Seating</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select Exam" /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.subject} — {s.exam_date}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={generateSeating} disabled={generating || !selectedScheduleId || selectedHallIds.length === 0}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shuffle className="h-4 w-4 mr-2" />}
                Generate Seating
              </Button>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Select Halls to Use</Label>
              <div className="flex flex-wrap gap-2">
                {halls.map((h) => (
                  <Badge
                    key={h.id}
                    variant={selectedHallIds.includes(h.id) ? "default" : "outline"}
                    className="cursor-pointer px-3 py-1.5"
                    onClick={() => toggleHallSelection(h.id)}
                  >
                    {h.name} ({h.capacity})
                  </Badge>
                ))}
              </div>
            </div>

            {Object.keys(seatingResult).length > 0 && (
              <div className="space-y-4 pt-2">
                {Object.entries(seatingResult).map(([hallId, assignments]) => {
                  const hall = halls.find((h) => h.id === hallId);
                  return (
                    <div key={hallId}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold">{hall?.name}</h3>
                        <Button size="sm" variant="outline" onClick={() => generateLayoutPDF(hallId)}>
                          <Printer className="h-3.5 w-3.5 mr-1.5" /> Layout
                        </Button>
                      </div>
                      <Table>
                        <TableHeader><TableRow><TableHead>Seat #</TableHead><TableHead>Student</TableHead><TableHead>Class</TableHead><TableHead>Roll No.</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {assignments.sort((a, b) => a.seat_number - b.seat_number).map((a) => {
                            const student = studentsById[a.student_id];
                            return (
                              <TableRow key={a.student_id}>
                                <TableCell>{a.seat_row && a.seat_col ? `R${a.seat_row}C${a.seat_col}` : a.seat_number}</TableCell>
                                <TableCell className="font-medium">{student?.full_name ?? "-"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{student?.class} {student?.section}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{student?.roll_number ?? "-"}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Saved Layouts - persisted, visible across sessions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Saved Seating Layouts</CardTitle></CardHeader>
          <CardContent>
            {savedLayouts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No saved layouts yet. Generate seating above to create one.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Exam</TableHead><TableHead>Hall</TableHead><TableHead className="text-center">Seats Assigned</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {savedLayouts.map((l) => {
                    const sched = schedules.find((s) => s.id === l.exam_schedule_id);
                    const hall = halls.find((h) => h.id === l.hall_id);
                    const viewKey = `${l.exam_schedule_id}::${l.hall_id}::view`;
                    const downloadKey = `${l.exam_schedule_id}::${l.hall_id}::download`;
                    return (
                      <TableRow key={`${l.exam_schedule_id}-${l.hall_id}`}>
                        <TableCell className="font-medium">{sched ? `${sched.subject} — ${sched.exam_date}` : "Unknown exam"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{hall?.name ?? "Unknown hall"}</TableCell>
                        <TableCell className="text-center">{l.seat_count}</TableCell>
                        <TableCell className="flex gap-2 justify-end">
                          <Button size="sm" variant="outline" onClick={() => loadAndRunSavedLayout(l.exam_schedule_id, l.hall_id, "view")} disabled={layoutActionKey === viewKey}>
                            {layoutActionKey === viewKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 mr-1.5" />}
                            View
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => loadAndRunSavedLayout(l.exam_schedule_id, l.hall_id, "download")} disabled={layoutActionKey === downloadKey}>
                            {layoutActionKey === downloadKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                            Download
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
