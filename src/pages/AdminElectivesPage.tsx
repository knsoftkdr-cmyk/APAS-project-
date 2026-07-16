import { useCallback, useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { GraduationCap, Plus, Trash2, Pencil, Users, BookOpen, Clock, MapPin, Sparkles } from "lucide-react";

interface Teacher {
  id: string;
  full_name: string;
}

interface Elective {
  id: string;
  name: string;
  subject: string;
  grade: string;
  teacher_id: string;
  capacity: number;
  room: string;
  day_of_week: string;
  period_number: number;
  is_active: boolean;
  teacher_name?: string;
  chosen_count?: number;
}

interface EnrolledStudent {
  student_profile_id: string;
  full_name: string;
  chosen_at: string;
}

// Matches the day-name matching in the choose-elective edge function (case-insensitive,
// first-3-letters), so exact casing here isn't load-bearing — kept Title Case for readability.
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function AdminElectivesPage() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;

  const [electives, setElectives] = useState<Elective[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedElective, setSelectedElective] = useState<Elective | null>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
  const [loadingEnrolled, setLoadingEnrolled] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [capacity, setCapacity] = useState("30");
  const [room, setRoom] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("");
  const [periodNumber, setPeriodNumber] = useState("");

  const fetchAll = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);

    const [electivesRes, teachersRes, gradesRes] = await Promise.all([
      supabase.from("electives").select("*").eq("school_id", schoolId).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").eq("role", "teacher").eq("school_id", schoolId),
      supabase.from("profiles").select("class_grade").eq("role", "student").eq("school_id", schoolId),
    ]);

    if (electivesRes.error) {
      toast.error("Failed to load electives: " + electivesRes.error.message);
      setLoading(false);
      return;
    }

    const teacherList = teachersRes.data ?? [];
    setTeachers(teacherList);

    const grades = Array.from(
      new Set((gradesRes.data ?? []).map((r) => r.class_grade).filter((g): g is string => Boolean(g)))
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    setAvailableGrades(grades);

    const electiveIds = (electivesRes.data ?? []).map((e) => e.id);
    const counts: Record<string, number> = {};
    if (electiveIds.length > 0) {
      const { data: choiceRows } = await supabase
        .from("student_elective_choices")
        .select("elective_id")
        .in("elective_id", electiveIds);
      (choiceRows ?? []).forEach((row) => {
        counts[row.elective_id] = (counts[row.elective_id] ?? 0) + 1;
      });
    }

    const merged: Elective[] = (electivesRes.data ?? []).map((e) => ({
      ...e,
      teacher_name: teacherList.find((t) => t.id === e.teacher_id)?.full_name ?? "—",
      chosen_count: counts[e.id] ?? 0,
    }));
    setElectives(merged);
    setLoading(false);
    setSelectedElective((prev) => (prev ? merged.find((e) => e.id === prev.id) ?? prev : prev));
  }, [schoolId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const fetchEnrolled = useCallback(async (electiveId: string) => {
    setLoadingEnrolled(true);
    const { data: choices, error } = await supabase
      .from("student_elective_choices")
      .select("student_profile_id, chosen_at")
      .eq("elective_id", electiveId)
      .order("chosen_at", { ascending: true });

    if (error || !choices || choices.length === 0) {
      setEnrolledStudents([]);
      setLoadingEnrolled(false);
      return;
    }

    const studentIds = choices.map((c) => c.student_profile_id);
    const { data: studentProfiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", studentIds);

    const merged: EnrolledStudent[] = choices.map((c) => ({
      student_profile_id: c.student_profile_id,
      chosen_at: c.chosen_at,
      full_name: studentProfiles?.find((p) => p.id === c.student_profile_id)?.full_name ?? "Unknown student",
    }));
    setEnrolledStudents(merged);
    setLoadingEnrolled(false);
  }, []);

  useEffect(() => {
    if (selectedElective) {
      fetchEnrolled(selectedElective.id);
    } else {
      setEnrolledStudents([]);
    }
  }, [selectedElective?.id, fetchEnrolled]);

  const resetForm = () => {
    setName("");
    setSubject("");
    setGrade("");
    setTeacherId("");
    setCapacity("30");
    setRoom("");
    setDayOfWeek("");
    setPeriodNumber("");
  };

  const openCreateDialog = () => {
    setEditingId(null);
    resetForm();
    setFormOpen(true);
  };

  const openEditDialog = (elective: Elective) => {
    setEditingId(elective.id);
    setName(elective.name);
    setSubject(elective.subject);
    setGrade(elective.grade);
    setTeacherId(elective.teacher_id);
    setCapacity(String(elective.capacity));
    setRoom(elective.room);
    setDayOfWeek(elective.day_of_week);
    setPeriodNumber(String(elective.period_number));
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!schoolId || !profile?.id) return;
    if (!name.trim() || !subject.trim() || !grade || !teacherId || !capacity || !room.trim() || !dayOfWeek || !periodNumber) {
      toast.error("All fields are required");
      return;
    }
    setSaving(true);

    const payload = {
      name: name.trim(),
      subject: subject.trim(),
      grade,
      teacher_id: teacherId,
      capacity: parseInt(capacity, 10),
      room: room.trim(),
      day_of_week: dayOfWeek,
      period_number: parseInt(periodNumber, 10),
    };

    if (editingId) {
      const { error } = await supabase.from("electives").update(payload).eq("id", editingId);
      setSaving(false);
      if (error) {
        toast.error("Failed to update elective: " + error.message);
        return;
      }
      toast.success("Elective updated");
    } else {
      const { error } = await supabase.from("electives").insert({
        school_id: schoolId,
        ...payload,
        is_active: true,
        created_by: profile.id,
      });
      setSaving(false);
      if (error) {
        toast.error("Failed to create elective: " + error.message);
        return;
      }
      toast.success("Elective created");
    }

    resetForm();
    setEditingId(null);
    setFormOpen(false);
    fetchAll();
  };

  const toggleActive = async (elective: Elective) => {
    const { error } = await supabase
      .from("electives")
      .update({ is_active: !elective.is_active })
      .eq("id", elective.id);
    if (error) {
      toast.error("Failed to update: " + error.message);
      return;
    }
    setElectives((prev) => prev.map((e) => (e.id === elective.id ? { ...e, is_active: !e.is_active } : e)));
    setSelectedElective((prev) => (prev && prev.id === elective.id ? { ...prev, is_active: !prev.is_active } : prev));
  };

  const handleDelete = async (elective: Elective) => {
    if (!confirm(`Delete "${elective.name}"? This cannot be undone. Students who already chose it will lose their selection.`)) return;
    const { error } = await supabase.from("electives").delete().eq("id", elective.id);
    if (error) {
      toast.error("Failed to delete: " + error.message);
      return;
    }
    toast.success("Elective deleted");
    setElectives((prev) => prev.filter((e) => e.id !== elective.id));
    setSelectedElective((prev) => (prev?.id === elective.id ? null : prev));
  };

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-blue-300 opacity-[0.12] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-sky-300 opacity-[0.10] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-blue-200 opacity-[0.10] blur-3xl" />

        <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-blue-600 to-sky-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-white">Electives</h1>
                  <p className="text-blue-100 text-xs md:text-sm mt-0.5">Create and manage elective offerings for students to choose from</p>
                </div>
              </div>

              <Dialog
                open={formOpen}
                onOpenChange={(open) => {
                  setFormOpen(open);
                  if (!open) { resetForm(); setEditingId(null); }
                }}
              >
                <DialogTrigger asChild>
                  <Button onClick={openCreateDialog} className="bg-white text-blue-700 hover:bg-blue-50">
                    <Plus className="h-4 w-4 mr-1" /> Create Elective
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingId ? "Edit Elective" : "Create New Elective"}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Name</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Robotics Club" />
                    </div>
                    <div>
                      <Label>Subject</Label>
                      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Robotics" />
                    </div>
                    <div>
                      <Label>Grade</Label>
                      <Select value={grade} onValueChange={setGrade}>
                        <SelectTrigger>
                          <SelectValue placeholder={availableGrades.length ? "Select grade" : "No student grades found"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableGrades.map((g) => (
                            <SelectItem key={g} value={g}>
                              Class {g}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Teacher</Label>
                      <Select value={teacherId} onValueChange={setTeacherId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select teacher" />
                        </SelectTrigger>
                        <SelectContent>
                          {teachers.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Day</Label>
                        <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select day" />
                          </SelectTrigger>
                          <SelectContent>
                            {DAYS.map((d) => (
                              <SelectItem key={d} value={d}>
                                {d}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Period</Label>
                        <Input
                          type="number"
                          min="1"
                          max="10"
                          value={periodNumber}
                          onChange={(e) => setPeriodNumber(e.target.value)}
                          placeholder="e.g. 7"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Capacity</Label>
                        <Input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                      </div>
                      <div>
                        <Label>Room</Label>
                        <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. Room 101" />
                      </div>
                    </div>
                    <Button className="w-full bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700" onClick={handleSave} disabled={saving}>
                      {saving ? "Saving..." : editingId ? "Save Changes" : "Create Elective"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading electives...</p>
          ) : electives.length === 0 ? (
            <Card className="border-2 border-dashed border-blue-200 bg-gradient-to-b from-blue-50/50 to-white rounded-2xl">
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-sky-500 flex items-center justify-center mx-auto mb-4 shadow-md shadow-blue-200">
                  <GraduationCap className="h-7 w-7 text-white" />
                </div>
                <h3 className="text-base font-semibold text-slate-800 mb-1">No electives yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">Click "Create Elective" above to add your first one.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {electives.map((e) => {
                const isSelected = selectedElective?.id === e.id;
                return (
                  <Card
                    key={e.id}
                    onClick={() => setSelectedElective(e)}
                    className={`overflow-hidden border-t-4 cursor-pointer shadow-sm hover:shadow-md transition-shadow ${
                      isSelected ? "border-t-blue-500 ring-1 ring-blue-200" : "border-t-sky-300 border-slate-200"
                    }`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                            <BookOpen className="h-4 w-4 text-blue-600" />
                          </div>
                          <CardTitle className="text-base truncate">{e.name}</CardTitle>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge className={e.is_active ? "bg-emerald-100 text-emerald-700 hover:opacity-90" : "bg-slate-100 text-slate-500 hover:opacity-90"}>
                            {e.chosen_count}/{e.capacity}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-blue-50 hover:text-blue-700 rounded-full"
                            onClick={(ev) => { ev.stopPropagation(); openEditDialog(e); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground pl-11.5 mt-1">
                        {e.subject} · Grade {e.grade}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pl-11.5 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {e.day_of_week} · Period {e.period_number}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {e.room}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
                        <Users className="h-3.5 w-3.5 text-blue-500" /> Enrolled Students
                      </div>
                      {isSelected && loadingEnrolled ? (
                        <p className="text-sm text-muted-foreground italic">Loading...</p>
                      ) : isSelected && enrolledStudents.length > 0 ? (
                        <div className="space-y-1.5">
                          {enrolledStudents.map((s, i) => (
                            <div key={s.student_profile_id} className="flex items-center gap-2.5 rounded-lg bg-blue-50/50 border border-blue-100 px-3 py-2">
                              <div className="w-5 h-5 rounded-full bg-blue-200 text-blue-800 text-[11px] font-bold flex items-center justify-center shrink-0">
                                {i + 1}
                              </div>
                              <span className="text-sm text-slate-700 truncate">{s.full_name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          {isSelected ? "No students enrolled yet." : e.chosen_count === 0 ? "No students enrolled yet." : `Click to view ${e.chosen_count} enrolled student${e.chosen_count === 1 ? "" : "s"}`}
                        </p>
                      )}
                      {isSelected && (
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Active</span>
                            <Switch
                              checked={e.is_active}
                              onCheckedChange={(ev) => { toggleActive(e); }}
                              onClick={(ev) => ev.stopPropagation()}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-destructive hover:bg-red-50"
                            onClick={(ev) => { ev.stopPropagation(); handleDelete(e); }}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
