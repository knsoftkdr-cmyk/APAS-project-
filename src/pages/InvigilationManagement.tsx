import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, X, Wand2, Users } from "lucide-react";

interface ExamSchedule {
  id: string;
  subject: string;
  exam_date: string;
  start_time: string;
  end_time: string;
}

interface ExamHall {
  id: string;
  name: string;
}

interface Teacher {
  id: string;
  full_name: string | null;
}

interface Assignment {
  id: string;
  exam_schedule_id: string;
  hall_id: string;
  teacher_id: string;
}

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && aEnd > bStart;
}

export default function InvigilationManagement() {
  const { profile } = useAuth();
  const isTeacher = profile?.role === "teacher";
  const isAdminTier = ["admin", "principal", "school_admin"].includes(profile?.role ?? "");

  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [halls, setHalls] = useState<ExamHall[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherSubjects, setTeacherSubjects] = useState<Record<string, string[]>>({});
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);

  const [newSubjectByTeacher, setNewSubjectByTeacher] = useState<Record<string, string>>({});
  const [savingSubjectFor, setSavingSubjectFor] = useState<string | null>(null);

  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [usedHallIds, setUsedHallIds] = useState<string[]>([]);
  const [pendingSelection, setPendingSelection] = useState<Record<string, string>>({});
  const [savingHallId, setSavingHallId] = useState<string | null>(null);

  const fetchAll = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const [schedRes, hallsRes, teachersRes, tsRes, assignRes] = await Promise.all([
      supabase.from("exam_schedules").select("id, subject, exam_date, start_time, end_time").eq("school_id", profile.school_id).order("exam_date", { ascending: false }),
      supabase.from("exam_halls").select("id, name").eq("school_id", profile.school_id),
      supabase.from("profiles").select("id, full_name").eq("school_id", profile.school_id).eq("role", "teacher"),
      supabase.from("teacher_subjects").select("teacher_id, subject").eq("school_id", profile.school_id),
      supabase.from("invigilation_assignments").select("id, exam_schedule_id, hall_id, teacher_id").eq("school_id", profile.school_id),
    ]);
    setSchedules((schedRes.data as ExamSchedule[]) || []);
    setHalls((hallsRes.data as ExamHall[]) || []);
    setTeachers((teachersRes.data as Teacher[]) || []);

    const tsMap: Record<string, string[]> = {};
    for (const row of (tsRes.data as { teacher_id: string; subject: string }[]) || []) {
      if (!tsMap[row.teacher_id]) tsMap[row.teacher_id] = [];
      tsMap[row.teacher_id].push(row.subject);
    }
    setTeacherSubjects(tsMap);
    setAllAssignments((assignRes.data as Assignment[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [profile?.school_id]);

  useEffect(() => {
    const loadUsedHalls = async () => {
      if (!selectedScheduleId) { setUsedHallIds([]); return; }
      const { data } = await supabase
        .from("seating_arrangements")
        .select("hall_id")
        .eq("exam_schedule_id", selectedScheduleId);
      const unique = Array.from(new Set((data || []).map((r: any) => r.hall_id)));
      setUsedHallIds(unique);
    };
    loadUsedHalls();
  }, [selectedScheduleId]);

  const addSubject = async (teacherId: string) => {
    const subject = (newSubjectByTeacher[teacherId] || "").trim();
    if (!subject || !profile?.school_id) return;
    setSavingSubjectFor(teacherId);
    const { error } = await supabase.from("teacher_subjects").insert({ school_id: profile.school_id, teacher_id: teacherId, subject });
    setSavingSubjectFor(null);
    if (error) { toast.error("Failed to add subject (maybe already added?)"); return; }
    setNewSubjectByTeacher((prev) => ({ ...prev, [teacherId]: "" }));
    fetchAll();
  };

  const removeSubject = async (teacherId: string, subject: string) => {
    await supabase.from("teacher_subjects").delete().eq("teacher_id", teacherId).eq("subject", subject);
    fetchAll();
  };

  // Conflict logic: teaches this subject, or already assigned an overlapping-time exam on the same date
  const getConflict = (teacherId: string, sched: ExamSchedule): string | null => {
    if ((teacherSubjects[teacherId] || []).includes(sched.subject)) return "Teaches this subject";
    const conflicting = allAssignments.find((a) => {
      if (a.teacher_id !== teacherId) return false;
      const otherSched = schedules.find((s) => s.id === a.exam_schedule_id);
      if (!otherSched || otherSched.id === sched.id) return false;
      if (otherSched.exam_date !== sched.exam_date) return false;
      return timesOverlap(sched.start_time, sched.end_time, otherSched.start_time, otherSched.end_time);
    });
    if (conflicting) return "Already assigned at this time";
    return null;
  };

  const getDutyCount = (teacherId: string) => allAssignments.filter((a) => a.teacher_id === teacherId).length;

  const suggestTeacher = (sched: ExamSchedule, excludeTeacherIds: string[]): Teacher | null => {
    const eligible = teachers.filter((t) => !excludeTeacherIds.includes(t.id) && !getConflict(t.id, sched));
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => getDutyCount(a.id) - getDutyCount(b.id));
    return eligible[0];
  };

  const autoSuggestForHall = (hallId: string) => {
    const sched = schedules.find((s) => s.id === selectedScheduleId);
    if (!sched) return;
    // Exclude teachers already picked (pending or saved) for other halls of this same exam
    const alreadyUsed = [
      ...Object.entries(pendingSelection).filter(([hId]) => hId !== hallId).map(([, tId]) => tId),
      ...allAssignments.filter((a) => a.exam_schedule_id === selectedScheduleId && a.hall_id !== hallId).map((a) => a.teacher_id),
    ];
    const suggestion = suggestTeacher(sched, alreadyUsed);
    if (!suggestion) { toast.error("No eligible teacher available for this hall"); return; }
    setPendingSelection((prev) => ({ ...prev, [hallId]: suggestion.id }));
  };

  const saveAssignment = async (hallId: string) => {
    const teacherId = pendingSelection[hallId];
    if (!teacherId || !profile?.school_id || !selectedScheduleId) { toast.error("Select a teacher first"); return; }
    setSavingHallId(hallId);
    const { error } = await supabase.from("invigilation_assignments").upsert(
      { school_id: profile.school_id, exam_schedule_id: selectedScheduleId, hall_id: hallId, teacher_id: teacherId },
      { onConflict: "exam_schedule_id,hall_id" }
    );
    setSavingHallId(null);
    if (error) { toast.error("Failed to save assignment"); return; }
    toast.success("Invigilator assigned");
    fetchAll();
  };

  const removeAssignment = async (assignmentId: string) => {
    await supabase.from("invigilation_assignments").delete().eq("id", assignmentId);
    fetchAll();
  };

  if (loading) return (
    <AppLayout>
      <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    </AppLayout>
  );

  // Teacher-facing view: just their own duties
  if (isTeacher) {
    const myDuties = allAssignments
      .filter((a) => a.teacher_id === profile?.id)
      .map((a) => ({
        assignment: a,
        sched: schedules.find((s) => s.id === a.exam_schedule_id),
        hall: halls.find((h) => h.id === a.hall_id),
      }))
      .sort((a, b) => (a.sched?.exam_date ?? "").localeCompare(b.sched?.exam_date ?? ""));

    return (
      <AppLayout>
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
          <div>
            <h1 className="text-2xl font-bold">My Invigilation Duties</h1>
            <p className="text-muted-foreground text-sm mt-1">Exams you've been assigned to invigilate</p>
          </div>
          <Card>
            <CardContent className="pt-6">
              {myDuties.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No invigilation duties assigned yet</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Hall</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {myDuties.map(({ assignment, sched, hall }) => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">{sched?.subject ?? "-"}</TableCell>
                        <TableCell className="text-sm">{sched?.exam_date ?? "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{sched ? `${sched.start_time} - ${sched.end_time}` : "-"}</TableCell>
                        <TableCell className="text-sm">{hall?.name ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const selectedSched = schedules.find((s) => s.id === selectedScheduleId);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">Invigilation Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Assign teachers to invigilate exam halls</p>
        </div>

        {/* Teacher-Subject Mapping */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Teacher Subjects</CardTitle></CardHeader>
          <CardContent>
            {teachers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No teachers found</p>
            ) : (
              <div className="space-y-3">
                {teachers.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 flex-wrap p-2 rounded border">
                    <span className="font-medium text-sm w-40 shrink-0">{t.full_name ?? "Unnamed"}</span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {(teacherSubjects[t.id] || []).map((subj) => (
                        <Badge key={subj} variant="secondary" className="gap-1">
                          {subj}
                          <button onClick={() => removeSubject(t.id, subj)}><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <Input
                        className="h-8 w-32 text-sm"
                        placeholder="Add subject"
                        value={newSubjectByTeacher[t.id] || ""}
                        onChange={(e) => setNewSubjectByTeacher((prev) => ({ ...prev, [t.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") addSubject(t.id); }}
                      />
                      <Button size="sm" variant="outline" className="h-8" onClick={() => addSubject(t.id)} disabled={savingSubjectFor === t.id}>
                        {savingSubjectFor === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assign Invigilators */}
        <Card>
          <CardHeader><CardTitle className="text-base">Assign Invigilators</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select Exam" /></SelectTrigger>
              <SelectContent>
                {schedules.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.subject} — {s.exam_date}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!selectedScheduleId ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Select an exam to assign invigilators</p>
            ) : usedHallIds.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No seating has been generated for this exam yet. Generate seating first in Exam Seating.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Hall</TableHead><TableHead>Assigned Invigilator</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {usedHallIds.map((hallId) => {
                    const hall = halls.find((h) => h.id === hallId);
                    const existing = allAssignments.find((a) => a.exam_schedule_id === selectedScheduleId && a.hall_id === hallId);
                    const currentValue = pendingSelection[hallId] ?? existing?.teacher_id ?? "";
                    return (
                      <TableRow key={hallId}>
                        <TableCell className="font-medium">{hall?.name ?? "-"}</TableCell>
                        <TableCell>
                          <Select value={currentValue} onValueChange={(v) => setPendingSelection((prev) => ({ ...prev, [hallId]: v }))}>
                            <SelectTrigger className="w-56"><SelectValue placeholder="Select teacher" /></SelectTrigger>
                            <SelectContent>
                              {teachers.map((t) => {
                                const conflict = selectedSched ? getConflict(t.id, selectedSched) : null;
                                return (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.full_name ?? "Unnamed"}{conflict ? ` — ⚠ ${conflict}` : ` (${getDutyCount(t.id)} duties)`}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => autoSuggestForHall(hallId)}>
                            <Wand2 className="h-3.5 w-3.5 mr-1" /> Suggest
                          </Button>
                          <Button size="sm" onClick={() => saveAssignment(hallId)} disabled={savingHallId === hallId || !currentValue}>
                            {savingHallId === hallId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                          </Button>
                          {existing && (
                            <Button size="sm" variant="ghost" onClick={() => removeAssignment(existing.id)}>
                              <X className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          )}
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
