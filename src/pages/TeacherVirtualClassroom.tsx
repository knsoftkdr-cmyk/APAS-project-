import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, PenLine } from "lucide-react";
import { WhiteboardCanvas } from "@/components/whiteboard/WhiteboardCanvas";

// ---------- Types ----------

interface TeacherClass {
  class_id: string;
  class_name: string;
  section: string;
  subject: string;
}

interface VirtualSession {
  id: string;
  class_id: string;
  subject: string;
  title: string | null;
  meet_link: string;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  recurrence_end_date: string | null;
  class_name?: string;
  section?: string;
}

interface AttendanceRow {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  attendance_status: string;
  joined_at: string | null;
}

interface TopicLogEntry {
  log_date: string;
  topic_covered: string | null;
  next_topic: string | null;
}

const emptyForm = {
  classId: "",
  subject: "",
  title: "",
  meetLink: "",
  scheduledStart: "",
  scheduledEnd: "",
  isRecurring: false,
  recurrenceEndDate: "",
};

// ---------- Component ----------

export default function TeacherVirtualClassroom() {
  const { toast } = useToast();

  const [teacherClasses, setTeacherClasses] = useState<TeacherClass[]>([]);
  const [sessions, setSessions] = useState<VirtualSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);

  // Attendance + topic log dialog state
  const [attendanceSession, setAttendanceSession] = useState<VirtualSession | null>(null);
  const [attendanceDate, setAttendanceDate] = useState<string>("");
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [topicCovered, setTopicCovered] = useState("");
  const [nextTopic, setNextTopic] = useState("");
  const [topicHistory, setTopicHistory] = useState<TopicLogEntry[]>([]);
  const [savingTopic, setSavingTopic] = useState(false);

  // Whiteboard dialog state
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [whiteboardLoading, setWhiteboardLoading] = useState(false);
  const [activeWhiteboardId, setActiveWhiteboardId] = useState<string | null>(null);
  const [activeSessionForWhiteboard, setActiveSessionForWhiteboard] = useState<VirtualSession | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    loadTeacherClasses();
    loadSessions();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) setCurrentUserId(data.user.id);
    });
  }, []);

  async function loadTeacherClasses() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;

    const { data, error } = await supabase
      .from("class_teachers")
      .select(`class_id, subject, classes:class_id ( name, section )`)
      .eq("teacher_id", userData.user.id);

    if (error) {
      toast({ title: "Failed to load classes", description: error.message, variant: "destructive" });
      return;
    }

    const mapped: TeacherClass[] = (data || []).map((row: any) => ({
      class_id: row.class_id,
      subject: row.subject,
      class_name: row.classes?.name ?? "Unknown",
      section: row.classes?.section ?? "",
    }));
    setTeacherClasses(mapped);
  }

  async function loadSessions() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("virtual_classroom_sessions")
      .select(
        `id, class_id, subject, title, meet_link, scheduled_start, scheduled_end,
         status, recurrence_end_date, classes:class_id ( name, section )`
      )
      .eq("teacher_id", userData.user.id)
      .order("scheduled_start", { ascending: false });

    if (error) {
      toast({ title: "Failed to load sessions", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const mapped: VirtualSession[] = (data || []).map((row: any) => ({
      id: row.id,
      class_id: row.class_id,
      subject: row.subject,
      title: row.title,
      meet_link: row.meet_link,
      scheduled_start: row.scheduled_start,
      scheduled_end: row.scheduled_end,
      status: row.status,
      recurrence_end_date: row.recurrence_end_date,
      class_name: row.classes?.name,
      section: row.classes?.section,
    }));
    setSessions(mapped);
    setLoading(false);
  }

  function handleClassChange(classId: string) {
    const match = teacherClasses.find((c) => c.class_id === classId);
    setForm((f) => ({ ...f, classId, subject: match?.subject ?? "" }));
  }

  async function handleCreateSession() {
    if (!form.classId || !form.subject || !form.meetLink || !form.scheduledStart || !form.scheduledEnd) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    if (form.isRecurring && !form.recurrenceEndDate) {
      toast({ title: "Missing end date", description: "Pick the last day this class repeats until.", variant: "destructive" });
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("school_id")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile?.school_id) {
      toast({ title: "Could not determine school", description: profileError?.message, variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("virtual_classroom_sessions").insert({
      school_id: profile.school_id,
      class_id: form.classId,
      teacher_id: userData.user.id,
      subject: form.subject,
      title: form.title || null,
      meet_link: form.meetLink,
      scheduled_start: new Date(form.scheduledStart).toISOString(),
      scheduled_end: new Date(form.scheduledEnd).toISOString(),
      recurrence_end_date: form.isRecurring ? form.recurrenceEndDate : null,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Failed to create session", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Session created", description: form.isRecurring ? "Recurring class scheduled." : "Class scheduled." });
    setCreateOpen(false);
    setForm(emptyForm);
    loadSessions();
  }

  function openEditDialog(session: VirtualSession) {
    setEditingSessionId(session.id);
    setForm({
      classId: session.class_id,
      subject: session.subject,
      title: session.title || "",
      meetLink: session.meet_link,
      scheduledStart: toLocalInputValue(session.scheduled_start),
      scheduledEnd: toLocalInputValue(session.scheduled_end),
      isRecurring: !!session.recurrence_end_date,
      recurrenceEndDate: session.recurrence_end_date || "",
    });
    setEditOpen(true);
  }

  function toLocalInputValue(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function handleUpdateSession() {
    if (!editingSessionId) return;
    if (!form.classId || !form.subject || !form.meetLink || !form.scheduledStart || !form.scheduledEnd) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("virtual_classroom_sessions")
      .update({
        class_id: form.classId,
        subject: form.subject,
        title: form.title || null,
        meet_link: form.meetLink,
        scheduled_start: new Date(form.scheduledStart).toISOString(),
        scheduled_end: new Date(form.scheduledEnd).toISOString(),
        recurrence_end_date: form.isRecurring ? form.recurrenceEndDate : null,
      })
      .eq("id", editingSessionId);
    setSaving(false);

    if (error) {
      toast({ title: "Failed to update session", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Session updated" });
    setEditOpen(false);
    setEditingSessionId(null);
    setForm(emptyForm);
    loadSessions();
  }

  async function handleDeleteSession() {
    if (!deleteTargetId) return;
    const { error } = await supabase.from("virtual_classroom_sessions").delete().eq("id", deleteTargetId);
    if (error) {
      toast({ title: "Failed to delete session", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Session deleted" });
      loadSessions();
    }
    setDeleteTargetId(null);
  }

  function sessionDateBounds(session: VirtualSession) {
    const start = session.scheduled_start.slice(0, 10);
    const end = session.recurrence_end_date || start;
    return { start, end };
  }

  async function openAttendance(session: VirtualSession) {
    setAttendanceSession(session);
    const today = new Date().toISOString().slice(0, 10);
    const { start, end } = sessionDateBounds(session);
    const defaultDate = today < start ? start : today > end ? end : today;
    setAttendanceDate(defaultDate);
    await loadAttendanceForDate(session, defaultDate);
    await loadTopicHistory(session.id, defaultDate);
  }

  async function loadAttendanceForDate(session: VirtualSession, date: string) {
    setAttendanceLoading(true);

    const { data: classStudents, error: csError } = await supabase
      .from("class_students")
      .select(`student_id, students:student_id ( full_name, roll_number )`)
      .eq("class_id", session.class_id);

    if (csError) {
      toast({ title: "Failed to load roster", description: csError.message, variant: "destructive" });
      setAttendanceLoading(false);
      return;
    }

    const { data: attendance, error: attError } = await supabase
      .from("virtual_classroom_attendance")
      .select("student_id, attendance_status, joined_at")
      .eq("session_id", session.id)
      .eq("session_date", date);

    if (attError) {
      toast({ title: "Failed to load attendance", description: attError.message, variant: "destructive" });
      setAttendanceLoading(false);
      return;
    }

    const attendanceMap = new Map((attendance || []).map((a) => [a.student_id, a]));
    const rows: AttendanceRow[] = (classStudents || []).map((row: any) => {
      const att = attendanceMap.get(row.student_id);
      return {
        student_id: row.student_id,
        full_name: row.students?.full_name ?? "Unknown",
        roll_number: row.students?.roll_number ?? null,
        attendance_status: att?.attendance_status ?? "absent",
        joined_at: att?.joined_at ?? null,
      };
    });
    rows.sort((a, b) => (a.roll_number || "").localeCompare(b.roll_number || ""));
    setAttendanceRows(rows);
    setAttendanceLoading(false);
  }

  async function loadTopicHistory(sessionId: string, currentDate: string) {
    const { data, error } = await supabase
      .from("virtual_classroom_topic_log")
      .select("log_date, topic_covered, next_topic")
      .eq("session_id", sessionId)
      .order("log_date", { ascending: false });

    if (error) {
      toast({ title: "Failed to load topic history", description: error.message, variant: "destructive" });
      return;
    }

    setTopicHistory((data || []).filter((d) => d.log_date !== currentDate));
    const todayEntry = (data || []).find((d) => d.log_date === currentDate);
    setTopicCovered(todayEntry?.topic_covered || "");
    setNextTopic(todayEntry?.next_topic || "");
  }

  async function handleAttendanceDateChange(newDate: string) {
    setAttendanceDate(newDate);
    if (!attendanceSession) return;
    await loadAttendanceForDate(attendanceSession, newDate);
    await loadTopicHistory(attendanceSession.id, newDate);
  }

  async function markAttendance(studentId: string, status: string) {
    if (!attendanceSession || !attendanceDate) return;

    const { error } = await supabase.from("virtual_classroom_attendance").upsert(
      {
        session_id: attendanceSession.id,
        student_id: studentId,
        session_date: attendanceDate,
        attendance_status: status,
        marked_by_teacher: true,
      },
      { onConflict: "session_id,student_id,session_date" }
    );

    if (error) {
      toast({ title: "Failed to update attendance", description: error.message, variant: "destructive" });
      return;
    }
    setAttendanceRows((rows) =>
      rows.map((r) => (r.student_id === studentId ? { ...r, attendance_status: status } : r))
    );
  }

  async function saveTopicLog() {
    if (!attendanceSession || !attendanceDate) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;

    setSavingTopic(true);
    const { error } = await supabase.from("virtual_classroom_topic_log").upsert(
      {
        session_id: attendanceSession.id,
        class_id: attendanceSession.class_id,
        log_date: attendanceDate,
        topic_covered: topicCovered || null,
        next_topic: nextTopic || null,
        created_by: userData.user.id,
      },
      { onConflict: "session_id,log_date" }
    );
    setSavingTopic(false);

    if (error) {
      toast({ title: "Failed to save topic log", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Topic log saved" });
  }

  // ---------- Whiteboard: get-or-create for this session, then open modal ----------
  async function openWhiteboard(session: VirtualSession) {
    setActiveSessionForWhiteboard(session);
    setWhiteboardLoading(true);
    setWhiteboardOpen(true);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      setWhiteboardLoading(false);
      return;
    }

    // Look for an existing whiteboard tied to this session
    const { data: existing, error: findError } = await supabase
      .from("whiteboards")
      .select("id")
      .eq("classroom_session_id", session.id)
      .eq("is_archived", false)
      .maybeSingle();

    if (findError) {
      toast({ title: "Failed to load whiteboard", description: findError.message, variant: "destructive" });
      setWhiteboardLoading(false);
      setWhiteboardOpen(false);
      return;
    }

    if (existing?.id) {
      setActiveWhiteboardId(existing.id);
      setWhiteboardLoading(false);
      return;
    }

    // None yet — create one, tied to this classroom session
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("school_id")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile?.school_id) {
      toast({ title: "Could not determine school", description: profileError?.message, variant: "destructive" });
      setWhiteboardLoading(false);
      setWhiteboardOpen(false);
      return;
    }

    const { data: created, error: createError } = await supabase
      .from("whiteboards")
      .insert({
        school_id: profile.school_id,
        classroom_session_id: session.id,
        title: `${session.title || session.subject} — Whiteboard`,
        created_by: userData.user.id,
        mode: "teacher_only",
      })
      .select("id")
      .single();

    if (createError || !created) {
      toast({ title: "Failed to create whiteboard", description: createError?.message, variant: "destructive" });
      setWhiteboardOpen(false);
      setWhiteboardLoading(false);
      return;
    }

    setActiveWhiteboardId(created.id);
    setWhiteboardLoading(false);
  }

  function statusColor(status: string) {
    switch (status) {
      case "joined":
        return "bg-green-100 text-green-800";
      case "excused":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-red-100 text-red-800";
    }
  }

  function renderScheduleBadge(session: VirtualSession) {
    if (!session.recurrence_end_date) {
      return <Badge variant="outline">{new Date(session.scheduled_start).toLocaleDateString()}</Badge>;
    }
    return (
      <Badge variant="outline">
        {new Date(session.scheduled_start).toLocaleDateString()} → {new Date(session.recurrence_end_date).toLocaleDateString()}
      </Badge>
    );
  }

  return (
    <AppLayout>
    <div className="min-h-screen relative overflow-x-hidden">
  <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-teal-300 opacity-[0.12] blur-3xl" />
  <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-cyan-300 opacity-[0.10] blur-3xl" />
  <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-teal-200 opacity-[0.10] blur-3xl" />

  <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-7xl mx-auto">
    <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-teal-600 to-cyan-600 shadow-lg">
      <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
      <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
      <div className="relative flex items-center gap-3 md:gap-4">
        <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
          <PenLine className="h-5 w-5 md:h-6 md:w-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Virtual Classrooms</h1>
          <p className="text-teal-100 text-xs md:text-sm mt-0.5">Schedule sessions, track attendance, log topics</p>
        </div>
      </div>
    </div>

    <div className="flex justify-end">
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) setForm(emptyForm); }}>
        <DialogTrigger asChild>
          <Button className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white shrink-0">+ New Session</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg w-[calc(100%-2rem)] sm:w-full p-0 overflow-hidden max-h-[85vh] flex flex-col">
          <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-4 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-white text-base">Create Virtual Classroom Session</DialogTitle>
            </DialogHeader>
          </div>
          <div className="overflow-y-auto flex-1 px-5 py-4">
            <SessionForm
              form={form}
              setForm={setForm}
              teacherClasses={teacherClasses}
              onClassChange={handleClassChange}
            />
          </div>
          <div className="px-5 py-4 border-t border-slate-100 shrink-0">
            <Button className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700" onClick={handleCreateSession} disabled={saving}>
              {saving ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <span className="w-4 h-4 rounded-full border-2 border-teal-300 border-t-teal-600 animate-spin" /> Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-teal-100 rounded-xl bg-teal-50/30">
          <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center mx-auto mb-3">
            <PenLine className="h-6 w-6 text-teal-400" />
          </div>
          <p className="text-sm text-muted-foreground">No sessions scheduled yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sessions.map((s) => {
  const statusAccent =
    s.status === "live" ? "border-l-red-400" :
    s.status === "completed" ? "border-l-slate-300" :
    "border-l-teal-400";
  const statusBadge =
    s.status === "live" ? "bg-red-100 text-red-700" :
    s.status === "completed" ? "bg-slate-100 text-slate-600" :
    "bg-teal-100 text-teal-700";
  return (
  <Card key={s.id} className={`overflow-hidden border-l-4 ${statusAccent} border-teal-300 shadow-sm hover:shadow-md transition-shadow`}>
    <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3">
      <CardTitle className="text-base md:text-lg flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
          <PenLine className="h-4 w-4 text-teal-600" />
        </div>
        <span className="truncate">{s.title || s.subject} — {s.class_name} {s.section}</span>
      </CardTitle>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {renderScheduleBadge(s)}
        <Badge className={`${statusBadge} hover:opacity-90`}>{s.status}</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
        {new Date(s.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} →{" "}
        {new Date(s.scheduled_end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {s.recurrence_end_date && " • repeats daily"}
      </p>
      <div className="flex gap-2 flex-wrap">
        <a href={s.meet_link} target="_blank" rel="noopener noreferrer">
          <Button size="sm" className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white">Open Meet Link</Button>
        </a>

                  <Dialog onOpenChange={(open) => { if (open) openAttendance(s); }}>
  <DialogTrigger asChild>
    <Button variant="outline" size="sm" className="border-teal-200 text-teal-700 hover:bg-teal-50">Attendance & Topic Log</Button>
  </DialogTrigger>
  <DialogContent className="max-w-lg w-[calc(100%-2rem)] sm:w-full max-h-[85vh] p-0 overflow-hidden flex flex-col">
    <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-4 shrink-0">
      <DialogHeader>
        <DialogTitle className="text-white text-base">{s.class_name} {s.section}</DialogTitle>
      </DialogHeader>
    </div>

    <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
      <div className="space-y-1">
        <Label className="text-xs font-semibold text-slate-600">Date</Label>
        <Input
          type="date"
          value={attendanceDate}
          min={sessionDateBounds(s).start}
          max={sessionDateBounds(s).end}
          onChange={(e) => handleAttendanceDateChange(e.target.value)}
          className="border-slate-200 focus-visible:ring-teal-400"
        />
      </div>

      <div className="space-y-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3.5">
        <Label className="text-xs font-semibold text-teal-700">Topic covered on this day</Label>
        <Textarea
          value={topicCovered}
          onChange={(e) => setTopicCovered(e.target.value)}
          placeholder="e.g. Introduction to Fractions"
          rows={2}
          className="bg-white border-slate-200 focus-visible:ring-teal-400"
        />
        <Label className="text-xs font-semibold text-teal-700">Next class topic (optional)</Label>
        <Textarea
          value={nextTopic}
          onChange={(e) => setNextTopic(e.target.value)}
          placeholder="e.g. Adding Fractions"
          rows={2}
          className="bg-white border-slate-200 focus-visible:ring-teal-400"
        />
        <Button size="sm" onClick={saveTopicLog} disabled={savingTopic} className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700">
          {savingTopic ? "Saving..." : "Save Topic Log"}
        </Button>
      </div>

      {topicHistory.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Previous days</Label>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {topicHistory.map((h) => (
              <div key={h.log_date} className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span className="font-semibold text-slate-700">{new Date(h.log_date).toLocaleDateString()}:</span>{" "}
                <span className="text-slate-600">{h.topic_covered || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {attendanceLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <span className="w-4 h-4 rounded-full border-2 border-teal-300 border-t-teal-600 animate-spin" /> Loading roster...
        </div>
      ) : (
        <div className="space-y-2">
          {attendanceRows.map((r) => (
            <div key={r.student_id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-sm text-slate-800 truncate">{r.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  Roll: {r.roll_number ?? "-"}
                  {r.joined_at && ` • Joined ${new Date(r.joined_at).toLocaleTimeString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={`${statusColor(r.attendance_status)} hover:opacity-90`}>{r.attendance_status}</Badge>
                <Select value={r.attendance_status} onValueChange={(v) => markAttendance(r.student_id, v)}>
                  <SelectTrigger className="w-28 h-8 border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="joined">Joined</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                    <SelectItem value="excused">Excused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </DialogContent>
</Dialog>

                  <Button size="sm" className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white" onClick={() => openWhiteboard(s)}>
                    <PenLine className="h-3.5 w-3.5 mr-1" /> Whiteboard
                  </Button>

                  <Button variant="outline" size="sm" className="border-slate-200" onClick={() => openEditDialog(s)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => setDeleteTargetId(s.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
  <DialogContent className="max-w-lg w-[calc(100%-2rem)] sm:w-full p-0 overflow-hidden max-h-[85vh] flex flex-col">
    <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-5 py-4 shrink-0">
      <DialogHeader>
        <DialogTitle className="text-white text-base">Edit Session</DialogTitle>
      </DialogHeader>
    </div>
    <div className="overflow-y-auto flex-1 px-5 py-4">
      <SessionForm
        form={form}
        setForm={setForm}
        teacherClasses={teacherClasses}
        onClassChange={handleClassChange}
      />
    </div>
    <div className="px-5 py-4 border-t border-slate-100 shrink-0">
      <Button className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700" onClick={handleUpdateSession} disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  </DialogContent>
</Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] sm:w-full">
  <AlertDialogHeader>
    <AlertDialogTitle className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
        <Trash2 className="h-4 w-4 text-red-600" />
      </div>
      Delete this session?
    </AlertDialogTitle>
    <AlertDialogDescription>
      This will permanently delete the session, its attendance records, and its topic log. This cannot be undone.
    </AlertDialogDescription>
  </AlertDialogHeader>
  <AlertDialogFooter>
    <AlertDialogCancel>Cancel</AlertDialogCancel>
    <AlertDialogAction onClick={handleDeleteSession} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
  </AlertDialogFooter>
</AlertDialogContent>
      </AlertDialog>

      {/* Whiteboard dialog */}
      <Dialog open={whiteboardOpen} onOpenChange={(open) => { setWhiteboardOpen(open); if (!open) setActiveWhiteboardId(null); }}>
        <DialogContent className="max-w-6xl w-full sm:w-[calc(100%-2rem)] h-[100dvh] sm:h-[85vh] max-h-[100dvh] sm:max-h-[85vh] rounded-none sm:rounded-lg p-0 overflow-hidden flex flex-col">
  <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-3 shrink-0">
    <DialogHeader>
      <DialogTitle className="text-white text-sm sm:text-base flex items-center gap-2 min-w-0">
        <PenLine className="h-4 w-4 shrink-0" />
        <span className="truncate">
          Whiteboard{activeSessionForWhiteboard ? ` — ${activeSessionForWhiteboard.title || activeSessionForWhiteboard.subject}` : ""}
        </span>
      </DialogTitle>
    </DialogHeader>
  </div>
  <div className="flex-1 min-h-0">
    {whiteboardLoading || !activeWhiteboardId || !currentUserId ? (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
        <span className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" /> Loading whiteboard...
      </div>
    ) : (
              <WhiteboardCanvas
                whiteboardId={activeWhiteboardId}
                lessonId={undefined}
                currentUserId={currentUserId}
                currentUserRole="teacher"
                initialMode="teacher_only"
                isOwner={true}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>
    </AppLayout>
  );
}

// ---------- Shared create/edit form ----------

function SessionForm({
  form,
  setForm,
  teacherClasses,
  onClassChange,
}: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  teacherClasses: TeacherClass[];
  onClassChange: (classId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-semibold text-slate-600">Class</Label>
        <Select value={form.classId} onValueChange={onClassChange}>
          <SelectTrigger className="mt-1 border-slate-200 focus:ring-teal-400">
            <SelectValue placeholder="Select a class" />
          </SelectTrigger>
          <SelectContent>
            {teacherClasses.map((c) => (
              <SelectItem key={c.class_id} value={c.class_id}>
                {c.class_name} - {c.section} ({c.subject})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs font-semibold text-slate-600">Title (optional)</Label>
        <Input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Chapter 4 Revision"
          className="mt-1 border-slate-200 focus-visible:ring-teal-400"
        />
      </div>

      <div>
        <Label className="text-xs font-semibold text-slate-600">Meet Link</Label>
        <Input
          value={form.meetLink}
          onChange={(e) => setForm((f) => ({ ...f, meetLink: e.target.value }))}
          placeholder="https://meet.google.com/..."
          className="mt-1 border-slate-200 focus-visible:ring-teal-400"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs font-semibold text-slate-600">Start Time (Day 1)</Label>
          <Input
            type="datetime-local"
            value={form.scheduledStart}
            onChange={(e) => setForm((f) => ({ ...f, scheduledStart: e.target.value }))}
            className="mt-1 border-slate-200 focus-visible:ring-teal-400"
          />
        </div>
        <div>
          <Label className="text-xs font-semibold text-slate-600">End Time (Day 1)</Label>
          <Input
            type="datetime-local"
            value={form.scheduledEnd}
            onChange={(e) => setForm((f) => ({ ...f, scheduledEnd: e.target.value }))}
            className="mt-1 border-slate-200 focus-visible:ring-teal-400"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
        <Checkbox
          id="isRecurring"
          checked={form.isRecurring}
          onCheckedChange={(checked) => setForm((f) => ({ ...f, isRecurring: !!checked }))}
        />
        <Label htmlFor="isRecurring" className="cursor-pointer text-sm text-slate-700">
          Repeat this same time slot daily until an end date
        </Label>
      </div>

      {form.isRecurring && (
        <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3.5">
          <Label className="text-xs font-semibold text-teal-700">Repeat Until (inclusive)</Label>
          <Input
            type="date"
            value={form.recurrenceEndDate}
            onChange={(e) => setForm((f) => ({ ...f, recurrenceEndDate: e.target.value }))}
            className="mt-1 bg-white border-slate-200 focus-visible:ring-teal-400"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Same meet link and time will be valid every day up to and including this date. Students will only see today's class on their Home page.
          </p>
        </div>
      )}
    </div>
  );
}