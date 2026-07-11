/**
 * TeacherBehaviourDashboard.tsx
 * - Behaviour Alerts: scoped strictly to this teacher's assigned classes.
 * - Student Notes: teacher can log a confidential note for ANY student in
 *   their school (not just their own classes), with follow-up reminders.
 * - Behaviour Analytics surfaces flagged students and, when a teacher opens
 *   an intervention from a flagged row, pre-fills risk level + contributing
 *   factors instead of starting blank.
 * - Reviews Due tracks active interventions with an approaching/overdue
 *   review_date, the same way Follow-Ups Due tracks notes.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { format, isPast } from "date-fns";
import { MessageSquarePlus, Clock, Trash2, ClipboardList, CalendarClock } from "lucide-react";
import { InterventionDrawer, Intervention } from "@/components/InterventionDrawer";
import { BehaviourAnalytics, AnalyticsMeta } from "@/components/BehaviourAnalytics";
import { TierOnePositiveRecognition } from "@/components/TierOnePositiveRecognition.tsx";

interface Student {
  id: string;
  full_name: string;
  class: string;
  section: string;
}

interface Note {
  id: string;
  student_id: string;
  note_type: string;
  note: string;
  follow_up_date: string | null;
  follow_up_completed: boolean;
  created_at: string;
}

interface ReviewDueItem extends Intervention {
  student_name: string;
  student_class: string;
  student_section: string;
}

const NOTE_TYPE_STYLES: Record<string, string> = {
  observation: "bg-blue-100 text-blue-700",
  positive: "bg-green-100 text-green-700",
  concern: "bg-amber-100 text-amber-700",
  incident: "bg-red-100 text-red-700",
};

export default function TeacherBehaviourDashboard() {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [studentInterventions, setStudentInterventions] = useState<Intervention[]>([]);
  const activeIntervention = studentInterventions.find((i) => i.status === "active") || null;
  const [interventionDrawerOpen, setInterventionDrawerOpen] = useState(false);
  const [allFollowUps, setAllFollowUps] = useState<(Note & { student_name: string; student_class: string; student_section: string })[]>([]);

  // Set only when the current selection came from clicking a flagged row in
  // Behaviour Analytics. Cleared implicitly whenever selectedStudentId no
  // longer matches (see the studentId check where it's consumed below).
  const [analyticsRisk, setAnalyticsRisk] = useState<{
    studentId: string;
    riskLevel: "low" | "medium" | "high";
    contributingFactors: string[];
  } | null>(null);

  const [reviewsDue, setReviewsDue] = useState<ReviewDueItem[]>([]);

  const [noteType, setNoteType] = useState("observation");
  const [noteText, setNoteText] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);

  // ---- All students in the school (notes can be added for anyone) ----
  const fetchStudents = useCallback(async () => {
    if (!profile?.school_id) return;
    const { data } = await supabase
      .from("students")
      .select("id, full_name, class, section")
      .eq("school_id", profile.school_id)
      .order("full_name");
    setStudents((data || []) as Student[]);
  }, [profile?.school_id]);

  // ---- This teacher's own follow-up reminders, across all students ----
  const fetchFollowUps = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("teacher_notes")
      .select("id, student_id, note_type, note, follow_up_date, follow_up_completed, created_at, students(full_name, class, section)")
      .eq("teacher_id", user.id)
      .eq("follow_up_completed", false)
      .not("follow_up_date", "is", null)
      .order("follow_up_date", { ascending: true });

    setAllFollowUps(
      (data || []).map((n: any) => ({
        ...n,
        student_name: n.students?.full_name || "Unknown",
        student_class: n.students?.class || "",
        student_section: n.students?.section || "",
      }))
    );
  }, [user?.id]);

  // ---- This teacher's active interventions with a review date set ----
  const fetchReviewsDue = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("student_interventions")
      .select("*, students(full_name, class, section)")
      .eq("teacher_id", user.id)
      .eq("status", "active")
      .not("review_date", "is", null)
      .order("review_date", { ascending: true });

    setReviewsDue(
      (data || []).map((iv: any) => ({
        ...iv,
        student_name: iv.students?.full_name || "Unknown",
        student_class: iv.students?.class || "",
        student_section: iv.students?.section || "",
      }))
    );
  }, [user?.id]);

  const fetchNotesForStudent = useCallback(async (studentId: string) => {
    if (!user?.id) return;
    setNotesLoading(true);
    try {
      const { data } = await supabase
        .from("teacher_notes")
        .select("id, student_id, note_type, note, follow_up_date, follow_up_completed, created_at")
        .eq("teacher_id", user.id)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      setNotes((data || []) as Note[]);
    } finally {
      setNotesLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchStudents();
    fetchFollowUps();
    fetchReviewsDue();
  }, [fetchStudents, fetchFollowUps, fetchReviewsDue]);

  const fetchStudentInterventions = useCallback(async (studentId: string) => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("student_interventions")
      .select("*")
      .eq("teacher_id", user.id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    setStudentInterventions((data as Intervention[]) || []);
  }, [user?.id]);

  useEffect(() => {
    if (selectedStudent) {
      fetchNotesForStudent(selectedStudent.id);
      fetchStudentInterventions(selectedStudent.id);
    } else {
      setStudentInterventions([]);
    }
  }, [selectedStudent, fetchNotesForStudent, fetchStudentInterventions]);

  // Distinct classes and sections, derived from the school's student roster
  const classOptions = useMemo(
    () => [...new Set(students.map(s => s.class).filter(Boolean))].sort(),
    [students]
  );
  const sectionOptions = useMemo(
    () => [...new Set(students.filter(s => s.class === selectedClass).map(s => s.section).filter(Boolean))].sort(),
    [students, selectedClass]
  );
  const studentsInSection = useMemo(
    () => students.filter(s => s.class === selectedClass && s.section === selectedSection),
    [students, selectedClass, selectedSection]
  );

  useEffect(() => {
    const found = studentsInSection.find(s => s.id === selectedStudentId) || null;
    setSelectedStudent(found);
  }, [selectedStudentId, studentsInSection]);

  const handleSaveNote = async () => {
    if (!selectedStudent || !noteText.trim() || !user?.id) {
      toast({ title: "Missing info", description: "Select a student and write a note.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("teacher_notes").insert({
        school_id: profile?.school_id,
        student_id: selectedStudent.id,
        teacher_id: user.id,
        note_type: noteType,
        note: noteText.trim(),
        follow_up_date: followUpDate || null,
      });
      if (error) throw error;
      toast({ title: "Note saved" });
      setNoteText("");
      setFollowUpDate("");
      setNoteType("observation");
      if (selectedStudent) fetchNotesForStudent(selectedStudent.id);
      fetchFollowUps();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Clicking a flagged row in Behaviour Analytics: select the student AND
  // stash risk info so the InterventionDrawer can pre-fill instead of
  // starting from a blank reason field.
  const handleAnalyticsSelect = (student: Student, meta: AnalyticsMeta) => {
    setSelectedClass(student.class);
    setSelectedSection(student.section);
    setSelectedStudentId(student.id);

    const contributingFactors = Object.entries(meta.breakdown)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${count} ${type} note${count > 1 ? "s" : ""} logged in the last 30 days`);

    setAnalyticsRisk({
      studentId: student.id,
      riskLevel: meta.level === "high" ? "high" : meta.level === "watch" ? "medium" : "low",
      contributingFactors,
    });
  };

  // Clicking "Review" on a Reviews Due row: jump straight to that student
  // and open the drawer. This is a manual open, not from Analytics, so any
  // stale analyticsRisk for a different student is cleared.
  const handleOpenReview = (iv: ReviewDueItem) => {
    setAnalyticsRisk(null);
    setSelectedClass(iv.student_class);
    setSelectedSection(iv.student_section);
    setSelectedStudentId(iv.student_id);
    setInterventionDrawerOpen(true);
  };

  // Clicking "+ Recognize" in Tier 1 panel: select the student and pre-set
  // the note form to "positive" so the teacher just has to write the note.
  const handleGiveRecognition = (student: Student) => {
    setAnalyticsRisk(null);
    setSelectedClass(student.class);
    setSelectedSection(student.section);
    setSelectedStudentId(student.id);
    setNoteType("positive");
  };

  const markFollowUpDone = async (noteId: string) => {
    await supabase.from("teacher_notes").update({ follow_up_completed: true }).eq("id", noteId);
    fetchFollowUps();
    if (selectedStudent) fetchNotesForStudent(selectedStudent.id);
  };

  const deleteNote = async (noteId: string) => {
    await supabase.from("teacher_notes").delete().eq("id", noteId);
    if (selectedStudent) fetchNotesForStudent(selectedStudent.id);
    fetchFollowUps();
  };

  // Only pass risk data through if it actually belongs to the currently
  // selected student (guards against stale data after switching students).
  const activeRiskLevel = analyticsRisk?.studentId === selectedStudent?.id ? analyticsRisk?.riskLevel : undefined;
  const activeContributingFactors = analyticsRisk?.studentId === selectedStudent?.id ? analyticsRisk?.contributingFactors : undefined;
  // PBIS tier suggestion: High risk -> Tier 3 (intensive), Medium/Watch -> Tier 2 (targeted).
  // "low" risk students aren't flagged by Analytics in the first place, so this only
  // ever fires for students who were actually clicked from a flagged row.
  const suggestedTier: 2 | 3 | undefined =
    activeRiskLevel === "high" ? 3 : activeRiskLevel === "medium" ? 2 : undefined;

  return (
    <AppLayout>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-cyan-600 via-sky-500 to-blue-500 p-8 shadow-xl">
        {/* Decorative Circles */}
        <div className="absolute top-6 right-10 h-24 w-24 rounded-full bg-white/10"></div>
        <div className="absolute bottom-5 right-40 h-14 w-14 rounded-full bg-white/10"></div>
        <div className="absolute top-12 left-1/2 h-5 w-5 rounded-full bg-white/20"></div>
        {/* Hero Content */}
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Left */}
          <div className="flex items-center gap-5">
            <div className="h-16 w-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <ClipboardList className="h-9 w-9 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-white">
                Behaviour Dashboard
              </h1>
              <p className="mt-2 text-cyan-100 text-lg">
                Record confidential behaviour notes, monitor follow-ups, and support student wellbeing.
              </p>
            </div>
          </div>
        </div>
      </div>

        <div className="max-w-7xl mx-auto mt-6">
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
            <div className="xl:col-span-2 space-y-6">
            <BehaviourAnalytics
              teacherId={user?.id || ""}
              students={students}
              onSelectStudent={handleAnalyticsSelect}
            />
            
          <TierOnePositiveRecognition
            teacherId={user?.id || ""}
            students={students}
            onGiveRecognition={handleGiveRecognition}
          />

            {selectedStudent && activeIntervention && (
              <Card className="border border-blue-200 bg-blue-50/40">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <ClipboardList className="h-4 w-4 text-blue-600" />
                      <p className="text-sm font-semibold">Active Intervention</p>
                      <Badge className="bg-amber-100 text-amber-700">{activeIntervention.priority} priority</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {activeIntervention.review_date
                        ? `Review by ${format(new Date(activeIntervention.review_date), "d MMM yyyy")}`
                        : "No review date set"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setInterventionDrawerOpen(true)}>
                    View Details
                  </Button>
                </CardContent>
              </Card>
            )}
</div>
            <div className="xl:col-span-3 space-y-6">
            {/* Student Notes */}
            <Card className="overflow-hidden border border-orange-300 shadow-lg rounded-2xl">
                <CardHeader className="pb-3"><CardTitle className="text-base">Add a Confidential Note</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-3">
                    <Select
                      value={selectedClass}
                      onValueChange={(v) => { setSelectedClass(v); setSelectedSection(""); setSelectedStudentId(""); }}
                    >
                      <SelectTrigger className="w-40"><SelectValue placeholder="Class" /></SelectTrigger>
                      <SelectContent>
                        {classOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    <Select
                      value={selectedSection}
                      onValueChange={(v) => { setSelectedSection(v); setSelectedStudentId(""); }}
                      disabled={!selectedClass}
                    >
                      <SelectTrigger className="w-40"><SelectValue placeholder="Section" /></SelectTrigger>
                      <SelectContent>
                        {sectionOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    <Select
                      value={selectedStudentId}
                      onValueChange={setSelectedStudentId}
                      disabled={!selectedSection}
                    >
                      <SelectTrigger className="w-56"><SelectValue placeholder="Student" /></SelectTrigger>
                      <SelectContent>
                        {studentsInSection.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedStudent && (
                    <>
                      <div className="flex gap-3">
                        <Select value={noteType} onValueChange={setNoteType}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="observation">Observation</SelectItem>
                            <SelectItem value="positive">Positive</SelectItem>
                            <SelectItem value="concern">Concern</SelectItem>
                            <SelectItem value="incident">Incident</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          type="date"
                          value={followUpDate}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          className="w-48"
                          placeholder="Follow-up date (optional)"
                        />
                      </div>
                      <Textarea
                        placeholder="Write your note here — only you can see this."
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={3}
                      />
                      <Button onClick={handleSaveNote} disabled={saving}>
                        <MessageSquarePlus className="h-4 w-4 mr-2" />
                        {saving ? "Saving..." : "Save Note"}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
          

            {selectedStudent && (
              <Card className="border border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Timeline — {selectedStudent.full_name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {notesLoading ? (
                    <div className="flex justify-center py-6"><LoadingSpinner /></div>
                  ) : !notes.length ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No notes yet for this student.</p>
                  ) : (
                    <div className="space-y-3">
                      {notes.map((n) => (
                        <div key={n.id} className="border-l-2 border-muted pl-3 py-1 relative group">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={NOTE_TYPE_STYLES[n.note_type]}>{n.note_type}</Badge>
                            <span className="text-xs text-muted-foreground">{format(new Date(n.created_at), "d MMM yyyy, h:mm a")}</span>
                            {n.follow_up_date && (
                              <Badge variant={n.follow_up_completed ? "outline" : isPast(new Date(n.follow_up_date)) ? "destructive" : "secondary"}>
                                <Clock className="h-3 w-3 mr-1" />
                                {n.follow_up_completed ? "Followed up" : `Follow-up ${format(new Date(n.follow_up_date), "d MMM")}`}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm">{n.note}</p>
                          <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {n.follow_up_date && !n.follow_up_completed && (
                              <button onClick={() => markFollowUpDone(n.id)} className="text-xs text-green-600 hover:underline">Mark done</button>
                            )}
                            <button onClick={() => deleteNote(n.id)} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border border-border/60">
              <CardHeader className="pb-2"><CardTitle className="text-base">Follow-Ups Due</CardTitle></CardHeader>
              <CardContent>
                {!allFollowUps.length ? (
                  <p className="text-sm text-muted-foreground py-2 text-center">No pending follow-ups.</p>
                ) : (
                  <div className="space-y-2">
                    {allFollowUps.map((f) => (
                      <div key={f.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40">
                        <div>
                          <p className="text-sm font-medium">
                            {f.student_name}
                            {f.student_class && <span className="font-normal text-muted-foreground text-xs"> · {f.student_class}{f.student_section ? ` - ${f.student_section}` : ""}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{f.note}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={isPast(new Date(f.follow_up_date!)) ? "destructive" : "secondary"}>
                            {format(new Date(f.follow_up_date!), "d MMM")}
                          </Badge>
                          <button onClick={() => markFollowUpDone(f.id)} className="text-xs text-green-600 hover:underline">Done</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-blue-600" />
                  Reviews Due
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!reviewsDue.length ? (
                  <p className="text-sm text-muted-foreground py-2 text-center">No intervention reviews scheduled.</p>
                ) : (
                  <div className="space-y-2">
                    {reviewsDue.map((iv) => (
                      <div key={iv.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {iv.student_name}
                            {iv.student_class && <span className="font-normal text-muted-foreground text-xs"> · {iv.student_class}{iv.student_section ? ` - ${iv.student_section}` : ""}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{iv.reason}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={isPast(new Date(iv.review_date!)) ? "destructive" : "secondary"}>
                            {format(new Date(iv.review_date!), "d MMM")}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => handleOpenReview(iv)}>
                            Review
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
        </div>
        </div>
</div>
      {selectedStudent && (
        <InterventionDrawer
          open={interventionDrawerOpen}
          onOpenChange={setInterventionDrawerOpen}
          student={selectedStudent}
          riskLevel={activeRiskLevel}
          contributingFactors={activeContributingFactors}
          suggestedTier={suggestedTier}
          interventions={studentInterventions}
          onSaved={() => {
            fetchStudentInterventions(selectedStudent.id);
            fetchReviewsDue();
          }}
        />
      )}
    </AppLayout>
  );
}
