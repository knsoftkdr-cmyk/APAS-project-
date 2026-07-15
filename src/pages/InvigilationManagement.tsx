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
    <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Loading invigilation data...
    </div>
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
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
      <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-violet-300 opacity-[0.08] blur-3xl" />

      <div className="relative z-10 p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">My Invigilation Duties</h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Exams you've been assigned to invigilate</p>
            </div>
          </div>
        </div>

        <Card className="overflow-hidden border-indigo-100 shadow-sm">
          <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <CardContent className="pt-6">
            {myDuties.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                  <Users className="h-6 w-6 text-indigo-300" />
                </div>
                <p className="text-sm text-muted-foreground">No invigilation duties assigned yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table className="min-w-[560px] md:min-w-0">
                <TableHeader>
                  <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
                    <TableHead>Subject</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Hall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myDuties.map(({ assignment, sched, hall }) => (
                    <TableRow key={assignment.id} className="hover:bg-indigo-50/30">
                      <TableCell className="font-medium text-slate-800">{sched?.subject ?? "-"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium">
                          {sched?.exam_date ?? "-"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{sched ? `${sched.start_time} - ${sched.end_time}` : "-"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="inline-flex items-center gap-1 bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full text-xs font-medium">
                          {hall?.name ?? "-"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  </AppLayout>
);
  }

  const selectedSched = schedules.find((s) => s.id === selectedScheduleId);

return (
  <AppLayout>
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
      <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-violet-300 opacity-[0.08] blur-3xl" />
      <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.08] blur-3xl" />

      <div className="relative z-10 p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Invigilation Management</h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Assign teachers to invigilate exam halls</p>
            </div>
          </div>
        </div>

        {/* Teacher-Subject Mapping */}
       <Card className="overflow-hidden border-indigo-100 shadow-sm">
  <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
  <CardHeader className="pb-3">
    <CardTitle className="text-base flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
        <Users className="h-4 w-4 text-indigo-600" />
      </div>
      Teacher Subjects
    </CardTitle>
  </CardHeader>
  <CardContent>
    {teachers.length === 0 ? (
      <div className="text-center py-8">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-2">
          <Users className="h-5 w-5 text-indigo-300" />
        </div>
        <p className="text-sm text-muted-foreground">No teachers found</p>
      </div>
    ) : (
      <div className="space-y-2.5">
        {teachers.map((t) => (
          <div key={t.id} className="flex items-center gap-3 flex-wrap p-3 rounded-xl border border-indigo-100 bg-indigo-50/20">
            <span className="font-semibold text-sm text-slate-800 w-full sm:w-40 shrink-0">{t.full_name ?? "Unnamed"}</span>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {(teacherSubjects[t.id] || []).map((subj) => (
                <Badge key={subj} className="gap-1 bg-violet-100 text-violet-700 hover:bg-violet-100">
                  {subj}
                  <button onClick={() => removeSubject(t.id, subj)}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5 w-full sm:w-auto">
              <Input
                className="h-8 w-full sm:w-32 text-sm border-slate-200 focus-visible:ring-indigo-400"
                placeholder="Add subject"
                value={newSubjectByTeacher[t.id] || ""}
                onChange={(e) => setNewSubjectByTeacher((prev) => ({ ...prev, [t.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") addSubject(t.id); }}
              />
              <Button size="sm" className="h-8 shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => addSubject(t.id)} disabled={savingSubjectFor === t.id}>
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
<Card className="overflow-hidden border-indigo-100 shadow-sm">
  <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
  <CardHeader className="pb-3">
    <CardTitle className="text-base flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
        <Wand2 className="h-4 w-4 text-violet-600" />
      </div>
      Assign Invigilators
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

    {!selectedScheduleId ? (
      <div className="text-center py-10">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
          <Wand2 className="h-6 w-6 text-indigo-300" />
        </div>
        <p className="text-sm text-muted-foreground">Select an exam to assign invigilators</p>
      </div>
    ) : usedHallIds.length === 0 ? (
      <div className="text-center py-10 border-2 border-dashed border-amber-100 rounded-xl bg-amber-50/30">
        <p className="text-sm text-muted-foreground">No seating has been generated for this exam yet. Generate seating first in Exam Seating.</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
      <Table className="min-w-[680px] md:min-w-0">
        <TableHeader>
          <TableRow className="bg-indigo-50/50 hover:bg-indigo-50/50">
            <TableHead>Hall</TableHead>
            <TableHead>Assigned Invigilator</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usedHallIds.map((hallId) => {
                    const hall = halls.find((h) => h.id === hallId);
                    const existing = allAssignments.find((a) => a.exam_schedule_id === selectedScheduleId && a.hall_id === hallId);
                    const currentValue = pendingSelection[hallId] ?? existing?.teacher_id ?? "";
                    return (
                  <TableRow key={hallId} className="hover:bg-indigo-50/30">
                    <TableCell className="font-medium text-slate-800">
                      <span className="inline-flex items-center gap-1 bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full text-xs font-medium">
                        {hall?.name ?? "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select value={currentValue} onValueChange={(v) => setPendingSelection((prev) => ({ ...prev, [hallId]: v }))}>
                        <SelectTrigger className="w-56 border-slate-200 focus:ring-indigo-400"><SelectValue placeholder="Select teacher" /></SelectTrigger>
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
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" className="border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => autoSuggestForHall(hallId)}>
                          <Wand2 className="h-3.5 w-3.5 mr-1" /> Suggest
                        </Button>
                        <Button size="sm" className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700" onClick={() => saveAssignment(hallId)} disabled={savingHallId === hallId || !currentValue}>
                          {savingHallId === hallId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                        </Button>
                        {existing && (
                          <Button size="sm" variant="ghost" className="hover:bg-red-50" onClick={() => removeAssignment(existing.id)}>
                            <X className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        )}
                      </div>
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
  </div>
</AppLayout>
  );
}
