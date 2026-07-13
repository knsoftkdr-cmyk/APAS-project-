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
import { GraduationCap, Plus, Trash2, Pencil, Users } from "lucide-react";

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
      // Pull real class_grade values in use at this school so the grade dropdown can't
      // typo-mismatch against what students actually have on their profile.
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
    // Keep selectedElective in sync with fresh data (e.g. after an edit)
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
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <GraduationCap className="h-6 w-6" /> Electives
            </h1>
            <p className="text-muted-foreground text-sm">
              Create and manage elective offerings for students to choose from.
            </p>
          </div>
          <Dialog
            open={formOpen}
            onOpenChange={(open) => {
              setFormOpen(open);
              if (!open) { resetForm(); setEditingId(null); }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
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
                <Button className="w-full" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : editingId ? "Save Changes" : "Create Elective"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Elective list */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Electives</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
              {!loading && electives.length === 0 && (
                <p className="text-sm text-muted-foreground">No electives yet. Create one to get started.</p>
              )}
              {electives.map((e) => (
                <div
                  key={e.id}
                  onClick={() => setSelectedElective(e)}
                  className={`p-3 rounded-lg border cursor-pointer transition ${
                    selectedElective?.id === e.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{e.name}</span>
                    <div className="flex items-center gap-1">
                      <Badge variant={e.is_active ? "default" : "secondary"}>
                        {e.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(ev) => { ev.stopPropagation(); openEditDialog(e); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Class {e.grade} · {e.day_of_week}, Period {e.period_number} · {e.chosen_count}/{e.capacity} filled
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Elective detail */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedElective && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Select an elective to view details and enrolled students.
                </CardContent>
              </Card>
            )}
            {selectedElective && (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{selectedElective.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{selectedElective.subject}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Active</span>
                        <Switch
                          checked={selectedElective.is_active}
                          onCheckedChange={() => toggleActive(selectedElective)}
                        />
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => openEditDialog(selectedElective)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(selectedElective)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Grade</p>
                      <p className="font-medium">Class {selectedElective.grade}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Teacher</p>
                      <p className="font-medium">{selectedElective.teacher_name}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Slot</p>
                      <p className="font-medium">
                        {selectedElective.day_of_week}, Period {selectedElective.period_number}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Room</p>
                      <p className="font-medium">{selectedElective.room}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Capacity</p>
                      <p className="font-medium">
                        {selectedElective.chosen_count}/{selectedElective.capacity} filled
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" /> Enrolled Students
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loadingEnrolled && <p className="text-sm text-muted-foreground">Loading...</p>}
                    {!loadingEnrolled && enrolledStudents.length === 0 && (
                      <p className="text-sm text-muted-foreground">No students have chosen this elective yet.</p>
                    )}
                    {!loadingEnrolled && enrolledStudents.length > 0 && (
                      <div className="space-y-2">
                        {enrolledStudents.map((s) => (
                          <div
                            key={s.student_profile_id}
                            className="flex items-center justify-between p-2 rounded border border-border"
                          >
                            <span className="text-sm">{s.full_name}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(s.chosen_at).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
