import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ClipboardCheck, TrendingUp, Clock, Target } from "lucide-react";
import { normalizeSubject } from "@/lib/subjectUtils";

interface ClassTeacherAssignment {
  class_id: string;
  subject: string;
  class_name: string;
  class_section: string;
}

interface Student {
  id: string;
  full_name: string;
  roll_number: string | null;
  grade: string | null;
}

interface Competency {
  id: string;
  subject: string;
  name: string;
  description: string | null;
  grade_level: string | null;
}

interface Assessment {
  id: string;
  competency_id: string;
  proficiency: "beginner" | "developing" | "proficient" | "advanced";
  assessed_date: string;
  notes: string | null;
}

const PROFICIENCY_OPTIONS = [
  { value: "beginner", label: "Beginner" },
  { value: "developing", label: "Developing" },
  { value: "proficient", label: "Proficient" },
  { value: "advanced", label: "Advanced" },
];

const PROFICIENCY_COLOR: Record<string, string> = {
  beginner: "bg-red-100 text-red-700 border-red-200",
  developing: "bg-amber-100 text-amber-700 border-amber-200",
  proficient: "bg-blue-100 text-blue-700 border-blue-200",
  advanced: "bg-green-100 text-green-700 border-green-200",
};

export default function CompetencyAssessment() {
  const { profile, user } = useAuth();

  const [assignments, setAssignments] = useState<ClassTeacherAssignment[]>([]);
  const [selectedClassKey, setSelectedClassKey] = useState<string>("");

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [assessmentsByCompetency, setAssessmentsByCompetency] = useState<
    Record<string, Assessment[]>
  >({});

  const [pendingRatings, setPendingRatings] = useState<Record<string, string>>({});
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [editingDate, setEditingDate] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loadingCompetencies, setLoadingCompetencies] = useState(false);

  const schoolId = profile?.school_id;
  const teacherId = user?.id;

  useEffect(() => {
    if (!teacherId) return;
    const fetchAssignments = async () => {
      setLoadingClasses(true);
      const { data, error } = await supabase
        .from("class_teachers")
        .select("class_id, subject, classes(name, section)")
        .eq("teacher_id", teacherId);

      if (error) {
        toast.error("Couldn't load your classes");
        console.error(error);
      } else {
        const mapped: ClassTeacherAssignment[] = (data || []).map((row: any) => ({
          class_id: row.class_id,
          subject: row.subject,
          class_name: row.classes?.name || "",
          class_section: row.classes?.section || "",
        }));
        setAssignments(mapped);
        if (mapped.length > 0) {
          setSelectedClassKey(`${mapped[0].class_id}::${mapped[0].subject}`);
        }
      }
      setLoadingClasses(false);
    };
    fetchAssignments();
  }, [teacherId]);

  const selectedAssignment = assignments.find(
    (a) => `${a.class_id}::${a.subject}` === selectedClassKey
  );

  useEffect(() => {
    if (!selectedAssignment || !schoolId) {
      setStudents([]);
      setSelectedStudentId("");
      return;
    }
    const fetchStudents = async () => {
      setLoadingStudents(true);
      const { data, error } = await supabase
        .from("students")
        .select("profile_id, full_name, roll_number, grade, class, section")
        .eq("school_id", schoolId)
        .ilike("class", selectedAssignment.class_name)
        .ilike("section", selectedAssignment.class_section);

      if (error) {
        toast.error("Couldn't load students for this class");
        console.error(error);
      } else {
        const mapped: Student[] = (data || []).map((s: any) => ({
          id: s.profile_id,
          full_name: s.full_name,
          roll_number: s.roll_number,
          grade: s.grade,
        }));
        mapped.sort((a, b) =>
          (a.roll_number || a.full_name).localeCompare(b.roll_number || b.full_name)
        );
        setStudents(mapped);
        setSelectedStudentId(mapped[0]?.id || "");
      }
      setLoadingStudents(false);
    };
    fetchStudents();
  }, [selectedAssignment, schoolId]);

  useEffect(() => {
    if (!selectedAssignment || !schoolId || !selectedStudentId) {
      setCompetencies([]);
      setAssessmentsByCompetency({});
      return;
    }
    const student = students.find((s) => s.id === selectedStudentId);

    const fetchCompetenciesAndHistory = async () => {
      setLoadingCompetencies(true);

      const canonicalSubject = normalizeSubject(selectedAssignment.subject);

      const { data: compData, error: compError } = await supabase
        .from("competencies")
        .select("id, subject, name, description, grade_level")
        .eq("school_id", schoolId)
        .eq("subject", canonicalSubject);

      if (compError) {
        toast.error("Couldn't load competencies");
        console.error(compError);
        setLoadingCompetencies(false);
        return;
      }

      const normalizedGrade = student?.grade?.replace(/\D/g, "");
      const relevant = (compData || []).filter((c) => {
        if (!c.grade_level || c.grade_level === "All Grades") return true;
        const compGrade = c.grade_level.replace(/\D/g, "");
        return compGrade === normalizedGrade;
      });
      setCompetencies(relevant);

      if (relevant.length > 0) {
        const { data: histData, error: histError } = await supabase
          .from("competency_assessments")
          .select("id, competency_id, proficiency, assessed_date, notes")
          .eq("student_id", selectedStudentId)
          .in(
            "competency_id",
            relevant.map((c) => c.id)
          )
          .order("assessed_date", { ascending: false });

        if (histError) {
          console.error(histError);
        } else {
          const grouped: Record<string, Assessment[]> = {};
          (histData || []).forEach((a: any) => {
            if (!grouped[a.competency_id]) grouped[a.competency_id] = [];
            grouped[a.competency_id].push(a);
          });
          setAssessmentsByCompetency(grouped);
        }
      } else {
        setAssessmentsByCompetency({});
      }

      setLoadingCompetencies(false);
    };
    fetchCompetenciesAndHistory();
  }, [selectedAssignment, schoolId, selectedStudentId, students]);

  const handleSaveAssessment = async (competencyId: string) => {
    const proficiency = pendingRatings[competencyId];
    if (!proficiency) {
      toast.error("Select a proficiency level first");
      return;
    }
    if (!selectedAssignment || !selectedStudentId || !teacherId) return;

    setSaving(competencyId);
    const dateToSave = editingDate[competencyId] || todayStr;
    const { error } = await supabase.from("competency_assessments").upsert(
      {
        student_id: selectedStudentId,
        competency_id: competencyId,
        teacher_id: teacherId,
        class_id: selectedAssignment.class_id,
        proficiency,
        notes: pendingNotes[competencyId]?.trim() || null,
        assessed_date: dateToSave,
      },
      { onConflict: "student_id,competency_id,assessed_date" }
    );

    if (error) {
      toast.error("Couldn't save assessment");
      console.error(error);
    } else {
      toast.success(
        dateToSave === todayStr ? "Assessment saved" : `Entry for ${dateToSave} updated`
      );
      setPendingRatings((prev) => ({ ...prev, [competencyId]: "" }));
      setPendingNotes((prev) => ({ ...prev, [competencyId]: "" }));
      setEditingDate((prev) => ({ ...prev, [competencyId]: "" }));
      const { data } = await supabase
        .from("competency_assessments")
        .select("id, competency_id, proficiency, assessed_date, notes")
        .eq("student_id", selectedStudentId)
        .eq("competency_id", competencyId)
        .order("assessed_date", { ascending: false });
      setAssessmentsByCompetency((prev) => ({
        ...prev,
        [competencyId]: data || [],
      }));
    }
    setSaving(null);
  };

  const handleDeleteAssessment = async (competencyId: string, assessmentId: string) => {
    const { error } = await supabase
      .from("competency_assessments")
      .delete()
      .eq("id", assessmentId);

    if (error) {
      toast.error("Couldn't delete entry");
      console.error(error);
      return;
    }
    toast.success("Entry deleted");
    setAssessmentsByCompetency((prev) => ({
      ...prev,
      [competencyId]: (prev[competencyId] || []).filter((a) => a.id !== assessmentId),
    }));
    setEditingDate((prev) => {
      if (prev[competencyId]) {
        return { ...prev, [competencyId]: "" };
      }
      return prev;
    });
  };

  const selectedStudent = students.find((s) => s.id === selectedStudentId);

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 md:p-8">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-14 -left-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <ClipboardCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">
                Competency Assessment
              </h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">
                Assess students on the competencies for your subject
              </p>
            </div>
          </div>
        </div>

        {loadingClasses ? (
          <p className="text-sm text-muted-foreground">Loading your classes...</p>
        ) : assignments.length === 0 ? (
          <Card className="border-2 border-indigo-200 rounded-2xl bg-gradient-to-br from-indigo-50/60 via-white to-white">
            <CardContent className="py-12 text-center text-muted-foreground">
              You aren't assigned to any classes yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex gap-3 flex-wrap">
              <Select value={selectedClassKey} onValueChange={setSelectedClassKey}>
                <SelectTrigger className="w-64 border-indigo-200 focus:ring-indigo-400">
                  <SelectValue placeholder="Select class & subject" />
                </SelectTrigger>
                <SelectContent>
                  {assignments.map((a) => (
                    <SelectItem
                      key={`${a.class_id}::${a.subject}`}
                      value={`${a.class_id}::${a.subject}`}
                    >
                      {a.class_name} {a.class_section} — {normalizeSubject(a.subject)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedStudentId}
                onValueChange={setSelectedStudentId}
                disabled={loadingStudents || students.length === 0}
              >
                <SelectTrigger className="w-64 border-indigo-200 focus:ring-indigo-400">
                  <SelectValue
                    placeholder={loadingStudents ? "Loading students..." : "Select student"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.roll_number ? `${s.roll_number} — ` : ""}
                      {s.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedStudent && (
              <div className="space-y-4">
                {loadingCompetencies ? (
                  <p className="text-sm text-muted-foreground">Loading competencies...</p>
                ) : competencies.length === 0 ? (
                  <Card className="border-2 border-indigo-200 rounded-2xl bg-gradient-to-br from-indigo-50/60 via-white to-white">
                    <CardContent className="py-12 text-center text-muted-foreground">
                      No competencies defined for{" "}
                      {normalizeSubject(selectedAssignment?.subject || "")} at{" "}
                      {selectedStudent.grade ? `Class ${selectedStudent.grade}` : "this grade"}{" "}
                      yet. Ask your admin to add some.
                    </CardContent>
                  </Card>
                ) : (
                  competencies.map((c) => {
                    const history = assessmentsByCompetency[c.id] || [];
                    const latest = history[0];
                    return (
                      <Card
                        key={c.id}
                        className="border-2 border-indigo-200 rounded-2xl bg-gradient-to-br from-indigo-50/60 via-white to-white hover:shadow-md hover:-translate-y-0.5 transition-all"
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-start gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm">
                                <Target className="h-4.5 w-4.5 text-white" />
                              </div>
                              <div>
                                <CardTitle className="text-base">{c.name}</CardTitle>
                                {c.description && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {c.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            {latest && (
                              <Badge
                                className={`border ${PROFICIENCY_COLOR[latest.proficiency]}`}
                                variant="outline"
                              >
                                Current: {latest.proficiency}
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {history.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" />
                                History
                              </p>
                              <div className="space-y-1.5">
                                {history.map((h) => (
                                  <div
                                    key={h.id}
                                    className="flex items-center gap-2 text-sm text-muted-foreground"
                                  >
                                    <Clock className="h-3 w-3" />
                                    <span>{h.assessed_date}</span>
                                    <Badge
                                      variant="outline"
                                      className={`text-xs ${PROFICIENCY_COLOR[h.proficiency]}`}
                                    >
                                      {h.proficiency}
                                    </Badge>
                                    {h.notes && (
                                      <span className="italic truncate max-w-xs">
                                        "{h.notes}"
                                      </span>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs ml-auto"
                                      onClick={() => {
                                        setPendingRatings((prev) => ({
                                          ...prev,
                                          [c.id]: h.proficiency,
                                        }));
                                        setPendingNotes((prev) => ({
                                          ...prev,
                                          [c.id]: h.notes || "",
                                        }));
                                        setEditingDate((prev) => ({
                                          ...prev,
                                          [c.id]: h.assessed_date,
                                        }));
                                      }}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            `Delete the ${h.proficiency} entry from ${h.assessed_date}?`
                                          )
                                        ) {
                                          handleDeleteAssessment(c.id, h.id);
                                        }
                                      }}
                                    >
                                      Delete
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-2 border-t border-indigo-100 space-y-2">
                            {editingDate[c.id] && (
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-muted-foreground">
                                  Editing entry from {editingDate[c.id]}
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => {
                                    setEditingDate((prev) => ({ ...prev, [c.id]: "" }));
                                    setPendingRatings((prev) => ({ ...prev, [c.id]: "" }));
                                    setPendingNotes((prev) => ({ ...prev, [c.id]: "" }));
                                  }}
                                >
                                  Cancel, rate today instead
                                </Button>
                              </div>
                            )}
                            <div className="flex gap-3 items-start">
                              <Select
                                value={pendingRatings[c.id] || ""}
                                onValueChange={(v) =>
                                  setPendingRatings((prev) => ({ ...prev, [c.id]: v }))
                                }
                              >
                                <SelectTrigger className="w-44 border-indigo-200 focus:ring-indigo-400">
                                  <SelectValue placeholder="Rate today" />
                                </SelectTrigger>
                                <SelectContent>
                                  {PROFICIENCY_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Textarea
                                placeholder="Notes (optional)"
                                className="flex-1 min-h-0 h-10 resize-none"
                                value={pendingNotes[c.id] || ""}
                                onChange={(e) =>
                                  setPendingNotes((prev) => ({
                                    ...prev,
                                    [c.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
                                onClick={() => handleSaveAssessment(c.id)}
                                disabled={saving === c.id}
                              >
                                {saving === c.id
                                  ? "Saving..."
                                  : editingDate[c.id]
                                  ? "Update entry"
                                  : "Save"}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
