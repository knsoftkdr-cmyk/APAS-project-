import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Plus, Trash2, Users, GraduationCap, BookOpen, Settings2, School, FileSpreadsheet, ClipboardCheck, Bell, Pencil } from "lucide-react";
import { ExcelImportModal } from "@/components/ExcelImportModal";
import { DiagnosticApprovalPanel } from "@/components/DiagnosticApprovalPanel";
import { AdminLessonPlansView } from "@/components/AdminLessonPlansView";
import adminpanelBanner from "@/assets/adminpanel-banner.png";
interface ClassRecord {
  id: string;
  name: string;
  section: string;
  created_at: string;
}

interface StudentRecord {
  id: string;
  profile_id: string;
  grade: string | null;
  age: number | null;
  profiles: { full_name: string | null } | null;
}

interface TeacherProfile {
  id: string;
  full_name: string | null;
}

interface ClassStudent {
  id: string;
  class_id: string;
  student_id: string;
  students: {
    id: string;
    profiles: { full_name: string | null } | null;
    grade: string | null;
    age: number | null;
    roll_number: string | null;
    parent_phone: string | null;
    parent_email: string | null;
    date_of_birth: string | null;
  } | null;
}

interface ClassTeacher {
  id: string;
  class_id: string;
  teacher_id: string;
  teacher_role: string;
  subject: string | null;
  profiles: { full_name: string | null } | null;
}

const AdminPanel = () => {
  const { user, profile } = useAuth();
  const isPrincipalRole = ['admin', 'school_admin', 'principal'].includes(profile?.role?.toLowerCase() ?? '');
  const { toast } = useToast();
  const isMasterAdmin = profile?.role === "knsoft_admin" || profile?.role === "superadmin";
  const isSchoolAdmin = profile?.role === "school_admin";
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudent[]>([]);
  const [classTeachers, setClassTeachers] = useState<ClassTeacher[]>([]);

  // Form state
  const [newClassName, setNewClassName] = useState("");
  const [newClassSection, setNewClassSection] = useState("A");
  const [selectedClassForStudent, setSelectedClassForStudent] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedClassForTeacher, setSelectedClassForTeacher] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [selectedTeacherRole, setSelectedTeacherRole] = useState("primary");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [teacherViewMode, setTeacherViewMode] = useState<"assign" | "by-class" | "by-teacher">("assign");
  const [selectedTeacherForQuestions, setSelectedTeacherForQuestions] = useState("");
  const [selectedAgeGroup, setSelectedAgeGroup] = useState("");
  const [questionAssignments, setQuestionAssignments] = useState<any[]>([]);
  const [createClassOpen, setCreateClassOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedClassDetailsId, setSelectedClassDetailsId] = useState<string | null>(null);
  const [editingClass, setEditingClass] = useState(false);
  const [editClassName, setEditClassName] = useState("");
  const [editClassSection, setEditClassSection] = useState("");
  const [addStudentSearch, setAddStudentSearch] = useState("");
  const [savingClassEdit, setSavingClassEdit] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: "", student_id: "", date_of_birth: "", parent_phone: "" });
  const [addingNewStudent, setAddingNewStudent] = useState(false);
  const [editStudentOpen, setEditStudentOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<{ id: string; profile_id: string; full_name: string; roll_number: string; date_of_birth: string; parent_phone: string } | null>(null);
  const [savingStudentEdit, setSavingStudentEdit] = useState(false);

  const handleSaveClassEdit = async () => {
    if (!selectedClassDetailsId || !editClassName.trim()) return;
    setSavingClassEdit(true);
    const { error } = await supabase
      .from("classes")
      .update({ name: editClassName.trim(), section: (editClassSection.trim() || "A").toUpperCase() })
      .eq("id", selectedClassDetailsId);
    setSavingClassEdit(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Class updated" });
      setEditingClass(false);
      fetchAll();
    }
  };

  const handleAddStudentToSelectedClass = async (studentId: string) => {
    if (!selectedClassDetailsId || !studentId) return;
    const { error } = await supabase.from("class_students").insert({
      class_id: selectedClassDetailsId,
      student_id: studentId,
      assigned_by: user?.id,
    });
    if (error) {
      toast({
        title: "Error",
        description: error.code === "23505" ? "Student already in this class" : error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Student added" });
      setAddStudentSearch("");
      fetchAll();
    }
  };

  const handleAddNewStudentToClass = async () => {
    if (!selectedClassDetailsId) return;
    if (!newStudent.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const cls = classes.find((c) => c.id === selectedClassDetailsId);
    if (!cls) return;
    setAddingNewStudent(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-students-batch", {
        body: {
          mode: "import",
          students: [{
            rowNum: 1,
            student_name: newStudent.name.trim(),
            class: cls.name,
            section: cls.section,
            roll_number: newStudent.student_id.trim() || null,
            parent_phone: newStudent.parent_phone.trim() || null,
            parent_email: null,
            date_of_birth: newStudent.date_of_birth || null,
          }],
        },
      });
      if (error) throw error;
      const result = (data as any)?.results?.[0];
      if (!result?.success) throw new Error(result?.error || "Failed to create student");
      // Link to class
      await supabase.from("class_students").insert({
        class_id: selectedClassDetailsId,
        student_id: result.studentId,
        assigned_by: user?.id,
      });
      toast({ title: "Student added" });
      setNewStudent({ name: "", student_id: "", date_of_birth: "", parent_phone: "" });
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setAddingNewStudent(false);
    }
  };

  const openEditStudent = (member: ClassStudent) => {
    const stu = (students as any[]).find(s => s.id === member.student_id);
    if (!stu) return;
    setEditStudent({
      id: stu.id,
      profile_id: "",
      full_name: (students as any[]).find(s => s.id === member.student_id)?.profiles?.full_name || "",
      roll_number: stu.roll_number || "",
      date_of_birth: stu.date_of_birth || "",
      parent_phone: stu.parent_phone || "",
    });
    setEditStudentOpen(true);
  };

  const handleSaveStudentEdit = async () => {
    if (!editStudent) return;
    setSavingStudentEdit(true);
    try {
      // Update student row
      const { data: stu, error: stuErr } = await supabase
        .from("students")
        .update({
          roll_number: editStudent.roll_number || null,
          date_of_birth: editStudent.date_of_birth || null,
          parent_phone: editStudent.parent_phone || null,
        })
        .eq("id", editStudent.id)
        .select("profile_id")
        .single();
      if (stuErr) throw stuErr;
      // Update profile name
      if (stu?.profile_id && editStudent.full_name.trim()) {
        const { error: profErr } = await supabase
          .from("profiles")
          .update({ full_name: editStudent.full_name.trim() })
          .eq("id", stu.profile_id);
        if (profErr) throw profErr;
      }

      if (editStudent.roll_number.trim() && editStudent.date_of_birth) {
        const { data: resetData, error: resetError } = await supabase.functions.invoke("reset-student-passwords", {
          body: { roll_number: editStudent.roll_number.trim() },
        });

        if (resetError) throw resetError;

        const resetResult = (resetData as { results?: Array<{ success: boolean; error?: string }> } | null)?.results?.[0];
        if (resetResult && !resetResult.success) {
          throw new Error(resetResult.error || "Failed to sync student login credentials");
        }
      }

      toast({ title: "Student updated" });
      setEditStudentOpen(false);
      setEditStudent(null);
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingStudentEdit(false);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    const schoolId = profile?.school_id;

    const [classesRes, studentsRes, teachersRes] = await Promise.all([
      supabase.from("classes").select("*").eq("school_id", schoolId!).order("name"),
      supabase.from("students").select("id, profile_id, grade, class, section, roll_number, date_of_birth, parent_phone, profiles(full_name)").eq("school_id", schoolId!),
      supabase.from("profiles").select("id, full_name").eq("role", "teacher").eq("school_id", schoolId!),
    ]);

    const classIds = classesRes.data?.map(c => c.id) ?? [];
    const teacherIds = teachersRes.data?.map(t => t.id) ?? [];

    const [csRes, ctRes, qaRes] = await Promise.all([
      classIds.length > 0
        ? supabase.from("class_students").select("id, class_id, student_id").in("class_id", classIds)
        : Promise.resolve({ data: [] }),
      classIds.length > 0
        ? supabase.from("class_teachers").select("id, class_id, teacher_id, teacher_role, subject, profiles:teacher_id(full_name)").in("class_id", classIds)
        : Promise.resolve({ data: [] }),
      teacherIds.length > 0
        ? supabase.from("teacher_question_assignments").select("*").in("teacher_id", teacherIds)
        : Promise.resolve({ data: [] }),
    ]);

    console.log('csRes:', csRes, 'ctRes:', ctRes);
    if (classesRes.data) setClasses(classesRes.data);
    if (studentsRes.data) setStudents(studentsRes.data as any);
    if (teachersRes.data) setTeachers(teachersRes.data);
    if (csRes.data) setClassStudents(csRes.data as any);
    if (ctRes.data) setClassTeachers(ctRes.data as any);
    if (qaRes.data) setQuestionAssignments(qaRes.data);
    setLoading(false);
  };

  useEffect(() => { if (profile?.school_id) fetchAll(); }, [profile?.school_id]);

  const handleCreateClass = async () => {
    if (!newClassName.trim()) return;
    const { error } = await supabase.from("classes").insert({
      name: newClassName.trim(),
      section: newClassSection.trim() || "A",
      created_by: user?.id,
      school_id: profile?.school_id,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Class created" });
      setNewClassName("");
      setNewClassSection("A");
      setCreateClassOpen(false);
      fetchAll();
    }
  };

  const handleDeleteClass = async (id: string) => {
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else fetchAll();
  };

  const handleAssignStudent = async () => {
    if (!selectedClassForStudent || !selectedStudent) return;
    const { error } = await supabase.from("class_students").insert({
      class_id: selectedClassForStudent,
      student_id: selectedStudent,
      assigned_by: user?.id,
    });
    if (error) {
      toast({ title: "Error", description: error.code === "23505" ? "Student already in this class" : error.message, variant: "destructive" });
    } else {
      toast({ title: "Student assigned" });
      setSelectedStudent("");
      fetchAll();
    }
  };

  const handleRemoveStudent = async (id: string) => {
    await supabase.from("class_students").delete().eq("id", id);
    fetchAll();
  };

  const handleAssignTeacher = async () => {
    if (!selectedClassForTeacher || !selectedTeacher) return;
    if (selectedTeacherRole === "subject" && !selectedSubject.trim()) {
      toast({ title: "Error", description: "Subject is required for subject teachers", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("class_teachers").insert({
      class_id: selectedClassForTeacher,
      teacher_id: selectedTeacher,
      teacher_role: selectedTeacherRole,
      subject: selectedTeacherRole === "subject" ? selectedSubject.trim() : null,
      assigned_by: user?.id,
    });
    if (error) {
      const msg = error.code === "23505"
        ? selectedTeacherRole === "primary"
          ? "This class already has a primary teacher. Remove the existing one first."
          : "Teacher already assigned to this class"
        : error.message;
      toast({ title: "Error", description: msg, variant: "destructive" });
    } else {
      toast({ title: "Teacher assigned" });
      setSelectedTeacher("");
      setSelectedSubject("");
      setSelectedTeacherRole("primary");
      fetchAll();
    }
  };

  const handleRemoveTeacher = async (id: string) => {
    await supabase.from("class_teachers").delete().eq("id", id);
    fetchAll();
  };

  const handleAssignQuestions = async () => {
    if (!selectedTeacherForQuestions || !selectedAgeGroup) return;
    const { error } = await supabase.from("teacher_question_assignments").insert({
      teacher_id: selectedTeacherForQuestions,
      age_group: parseInt(selectedAgeGroup),
      assigned_by: user?.id,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Questions assigned" });
      setSelectedTeacherForQuestions("");
      setSelectedAgeGroup("");
      fetchAll();
    }
  };

  const handleRemoveQuestionAssignment = async (id: string) => {
    await supabase.from("teacher_question_assignments").delete().eq("id", id);
    fetchAll();
  };

  const getClassName = (classId: string) => {
    const c = classes.find(cl => cl.id === classId);
    return c ? `${c.name} - ${c.section}` : "Unknown";
  };

  const getTeacherName = (teacherId: string) => {
    const t = teachers.find(te => te.id === teacherId);
    return t?.full_name || "Unknown";
  };

  const selectedClass = classes.find((c) => c.id === selectedClassDetailsId) || null;
  const selectedClassMembers = classStudents.filter((cs) => cs.class_id === selectedClassDetailsId);
  const selectedClassTeachers = classTeachers.filter((ct) => ct.class_id === selectedClassDetailsId);

  // Sync edit form when opening a different class
  useEffect(() => {
    if (selectedClass) {
      setEditClassName(selectedClass.name);
      setEditClassSection(selectedClass.section);
      setEditingClass(false);
      setAddStudentSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassDetailsId]);

  const assignedStudentIds = new Set(selectedClassMembers.map((m) => m.student_id));
  const studentsAvailableToAdd = students.filter(
    (s) =>
      !assignedStudentIds.has(s.id) &&
      (s.profiles?.full_name || "").toLowerCase().includes(addStudentSearch.toLowerCase())
  );

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  return (
      <AppLayout>
      <div className="space-y-6">
<div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-600 p-8 relative min-h-[220px]">
          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
<div className="hidden md:block">
                    <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>

</div>
          <div className="max-w-xl">
            <h1 className="text-5xl font-bold text-slate-900">
              Master User Panel
            </h1>

            <p className="mt-3 text-slate-700 text-lg">
              Manage classes, allotments, and diagnostic configuration
            </p>
          </div>

          <img
            src={adminpanelBanner}
            alt="Admin Panel Banner"
            /* className="absolute right-10 bottom-8 h-[130px]" */
            className="hidden md:block absolute right-10 bottom-5 w-[140px] z-10"
          />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2"><School className="h-5 w-5 text-primary" /></div>
              <div><p className="text-2xl font-bold text-foreground">{classes.length}</p><p className="text-xs text-muted-foreground">Classes</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-accent/10 p-2"><GraduationCap className="h-5 w-5 text-accent" /></div>
              <div><p className="text-2xl font-bold text-foreground">{students.length}</p><p className="text-xs text-muted-foreground">Students</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-secondary/50 p-2"><Users className="h-5 w-5 text-secondary-foreground" /></div>
              <div><p className="text-2xl font-bold text-foreground">{teachers.length}</p><p className="text-xs text-muted-foreground">Teachers</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2"><BookOpen className="h-5 w-5 text-primary" /></div>
              <div><p className="text-2xl font-bold text-foreground">{questionAssignments.length}</p><p className="text-xs text-muted-foreground">Q Assignments</p></div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="classes" className="w-full">
          <TabsList className={cn("grid w-full lg:w-auto lg:inline-grid", isMasterAdmin ? "grid-cols-8" : isPrincipalRole ? "grid-cols-6" : isSchoolAdmin ? "grid-cols-3" : "grid-cols-1")}>
            <TabsTrigger value="classes">Classes</TabsTrigger>
            {(isMasterAdmin || isSchoolAdmin || isPrincipalRole) && <TabsTrigger value="notifications" className="gap-1"><Bell className="h-3.5 w-3.5" /> Notifications</TabsTrigger>}
            {(isMasterAdmin || isSchoolAdmin || isPrincipalRole) && <TabsTrigger value="lesson-plans" className="gap-1"><BookOpen className="h-3.5 w-3.5" /> Lesson Plans</TabsTrigger>}
            {(isMasterAdmin || isPrincipalRole) && <TabsTrigger value="students">Students</TabsTrigger>}
            {(isMasterAdmin || isPrincipalRole) && <TabsTrigger value="teachers">Teachers</TabsTrigger>}
            {(isMasterAdmin || isPrincipalRole) && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
            {isMasterAdmin && <TabsTrigger value="questions">Questions</TabsTrigger>}
            {isMasterAdmin && <TabsTrigger value="config">Config</TabsTrigger>}
          </TabsList>

          {/* ===== CLASSES TAB ===== */}
          <TabsContent value="classes">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Class Management</CardTitle>
                  <CardDescription>Create and manage classes with sections</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> Import Excel
                  </Button>
                  <Dialog open={createClassOpen} onOpenChange={setCreateClassOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Class</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Create New Class</DialogTitle></DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <Label>Class Name</Label>
                          <Input placeholder="e.g. Class 5, Nursery, LKG" value={newClassName} onChange={e => setNewClassName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Section</Label>
                          <Input placeholder="e.g. A, B, C" value={newClassSection} onChange={e => setNewClassSection(e.target.value)} />
                        </div>
                        <Button onClick={handleCreateClass} className="w-full">Create Class</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <ExcelImportModal open={importOpen} onOpenChange={setImportOpen} onImportComplete={fetchAll} />
              </CardHeader>
              <CardContent>
                {classes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No classes created yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Class</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Students</TableHead>
                        <TableHead>Teachers</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {classes.map(c => (
                        <TableRow
                          key={c.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedClassDetailsId(c.id)}
                        >
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell><Badge variant="secondary">{c.section}</Badge></TableCell>
                          <TableCell>{classStudents.filter(cs => cs.class_id === c.id).length}</TableCell>
                          <TableCell>{classTeachers.filter(ct => ct.class_id === c.id).length}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteClass(c.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Dialog open={Boolean(selectedClassDetailsId)} onOpenChange={(open) => !open && setSelectedClassDetailsId(null)}>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between gap-3">
                    <span>
                      {selectedClass ? `${selectedClass.name} - ${selectedClass.section}` : "Class details"}
                    </span>
                    {selectedClass && !editingClass && (
                      <Button size="sm" variant="outline" onClick={() => setEditingClass(true)}>
                        Edit Class
                      </Button>
                    )}
                  </DialogTitle>
                </DialogHeader>

                {selectedClass && (
                  <div className="space-y-5">
                    {editingClass && (
                      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Class Name</Label>
                            <Input value={editClassName} onChange={(e) => setEditClassName(e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Section</Label>
                            <Input value={editClassSection} onChange={(e) => setEditClassSection(e.target.value)} />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditingClass(false); setEditClassName(selectedClass.name); setEditClassSection(selectedClass.section); }}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={handleSaveClassEdit} disabled={savingClassEdit || !editClassName.trim()}>
                            {savingClassEdit ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-border bg-card p-4">
                        <p className="text-xs text-muted-foreground">Students</p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">{selectedClassMembers.length}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-4">
                        <p className="text-xs text-muted-foreground">Teachers</p>
                        <p className="mt-1 text-2xl font-semibold text-foreground">{selectedClassTeachers.length}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-4">
                        <p className="text-xs text-muted-foreground">Created</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{new Date(selectedClass.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Assigned Teachers</Label>
                      <div className="flex flex-wrap gap-2">
                        {selectedClassTeachers.length > 0 ? (
                          selectedClassTeachers.map((teacher) => (
                            <Badge key={teacher.id} variant={teacher.teacher_role === "primary" ? "default" : "secondary"}>
                              {(teacher.profiles as any)?.full_name || "Unnamed"}
                              {teacher.teacher_role === "primary" ? " • Primary" : ` • ${teacher.subject || "Subject"}`}
                            </Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No teachers assigned yet.</p>
                        )}
                      </div>
                    </div>

                    {/* Add New Student */}
                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                      <Label className="flex items-center gap-2">
                        <Plus className="h-4 w-4" /> Add New Student to Class
                      </Label>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                        <Input
                          placeholder="Student Name *"
                          value={newStudent.name}
                          onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                        />
                        <Input
                          placeholder="Student ID"
                          value={newStudent.student_id}
                          onChange={(e) => setNewStudent({ ...newStudent, student_id: e.target.value })}
                        />
                        <Input
                          type="date"
                          placeholder="Date of Birth"
                          value={newStudent.date_of_birth}
                          onChange={(e) => setNewStudent({ ...newStudent, date_of_birth: e.target.value })}
                        />
                        <Input
                          placeholder="Parent Phone"
                          value={newStudent.parent_phone}
                          onChange={(e) => setNewStudent({ ...newStudent, parent_phone: e.target.value })}
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button size="sm" onClick={handleAddNewStudentToClass} disabled={addingNewStudent || !newStudent.name.trim()}>
                          {addingNewStudent ? "Adding..." : "Add Student"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        For bulk additions, use <strong>Import Excel</strong> on the main Classes screen.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Class Members</Label>
                      <div className="max-h-[360px] overflow-auto rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Student Name</TableHead>
                              <TableHead>Class</TableHead>
                              <TableHead>Student ID</TableHead>
                              <TableHead>Date of Birth</TableHead>
                              <TableHead>Parent Phone</TableHead>
                              <TableHead className="w-24 text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedClassMembers.map((member) => (
                              <TableRow key={member.id}>
                                <TableCell className="font-medium">{(students as any[]).find(s => s.id === member.student_id)?.profiles?.full_name || "Unnamed"}</TableCell>
                                <TableCell>{(() => { const s = (students as any[]).find(s => s.id === member.student_id); const cls = s?.class || s?.grade; if (!cls) return "—"; return /^\d+$/.test(cls) ? `Class ${cls}` : cls; })()}</TableCell>
                                <TableCell>{(students as any[]).find(s => s.id === member.student_id)?.roll_number || "—"}</TableCell>
                                <TableCell>{(students as any[]).find(s => s.id === member.student_id)?.date_of_birth ? new Date((students as any[]).find(s => s.id === member.student_id).date_of_birth).toLocaleDateString() : "—"}</TableCell>
                                <TableCell>{(students as any[]).find(s => s.id === member.student_id)?.parent_phone || "—"}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => openEditStudent(member)}
                                    title="Edit student"
                                  >
                                    <Pencil className="h-4 w-4 text-primary" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRemoveStudent(member.id)}
                                    title="Remove from class"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {selectedClassMembers.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground">No students assigned yet.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Edit Student Dialog */}
            <Dialog open={editStudentOpen} onOpenChange={setEditStudentOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Student</DialogTitle>
                </DialogHeader>
                {editStudent && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Student Name</Label>
                      <Input value={editStudent.full_name} onChange={(e) => setEditStudent({ ...editStudent, full_name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Student ID</Label>
                      <Input value={editStudent.roll_number} onChange={(e) => setEditStudent({ ...editStudent, roll_number: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Date of Birth</Label>
                      <Input type="date" value={editStudent.date_of_birth} onChange={(e) => setEditStudent({ ...editStudent, date_of_birth: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Parent Phone</Label>
                      <Input value={editStudent.parent_phone} onChange={(e) => setEditStudent({ ...editStudent, parent_phone: e.target.value })} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEditStudentOpen(false)}>Cancel</Button>
                      <Button onClick={handleSaveStudentEdit} disabled={savingStudentEdit || !editStudent.full_name.trim()}>
                        {savingStudentEdit ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ===== NOTIFICATIONS TAB (School Admin + Master Admin) ===== */}
          {(isMasterAdmin || isSchoolAdmin || isPrincipalRole) && (<TabsContent value="notifications">
              <DiagnosticApprovalPanel />
            </TabsContent>
          )}

          {/* ===== LESSON PLANS TAB (School Admin + Master Admin) ===== */}
          {(isMasterAdmin || isSchoolAdmin || isPrincipalRole) && (<TabsContent value="lesson-plans">
              <AdminLessonPlansView />
            </TabsContent>
          )}

          {/* ===== STUDENT ALLOTMENT TAB (Master Admin only) ===== */}
          {(isMasterAdmin || isPrincipalRole) && <TabsContent value="students">
            <Card>
              <CardHeader>
                <CardTitle>Student Allotment</CardTitle>
                <CardDescription>Assign students to classes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1.5 min-w-[180px]">
                    <Label>Class</Label>
                    <Select value={selectedClassForStudent} onValueChange={setSelectedClassForStudent}>
                      <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                      <SelectContent>
                        {classes.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name} - {c.section}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 min-w-[200px]">
                    <Label>Student</Label>
                    <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                      <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                      <SelectContent>
                        {students.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            {(s.profiles as any)?.full_name || "Unnamed"} {s.grade ? `(${s.grade})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAssignStudent} disabled={!selectedClassForStudent || !selectedStudent}>
                    <Plus className="h-4 w-4 mr-1" /> Assign
                  </Button>
                </div>

                {selectedClassForStudent && (
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">
                      Students in {getClassName(selectedClassForStudent)}
                    </h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student Name</TableHead>
                          <TableHead>Grade</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {classStudents.filter(cs => cs.class_id === selectedClassForStudent).map(cs => (
                          <TableRow key={cs.id}>
                            <TableCell>{(students as any[]).find(s => s.id === cs.student_id)?.profiles?.full_name || "Unnamed"}</TableCell>
                            <TableCell>{(students as any[]).find(s => s.id === cs.student_id)?.grade || "—"}</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => handleRemoveStudent(cs.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {classStudents.filter(cs => cs.class_id === selectedClassForStudent).length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No students assigned</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>}

          {/* ===== TEACHER ALLOTMENT TAB (Master Admin only) ===== */}
          {(isMasterAdmin || isPrincipalRole) && <TabsContent value="teachers">
            <Card>
              <CardHeader>
                <CardTitle>Teacher-to-Class Assignment</CardTitle>
                <CardDescription>Assign primary and subject teachers to classes. One primary teacher per class, multiple subject teachers allowed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* View mode tabs */}
                <div className="flex gap-2 border-b border-border pb-3">
                  {[
                    { key: "assign" as const, label: "Assign Teacher" },
                    ...(!isPrincipalRole ? [{ key: "by-class" as const, label: "Class → Teachers" }, { key: "by-teacher" as const, label: "Teacher → Classes" }] : []),
                    
                  ].map(tab => (
                    <Button
                      key={tab.key}
                      variant={teacherViewMode === tab.key ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTeacherViewMode(tab.key)}
                    >
                      {tab.label}
                    </Button>
                  ))}
                </div>

                {/* === ASSIGN VIEW === */}
                {teacherViewMode === "assign" && (
                  <div className="space-y-6">
                    <div className="flex flex-wrap gap-3 items-end">
                      <div className="space-y-1.5 min-w-[180px]">
                        <Label>Class</Label>
                        <Select value={selectedClassForTeacher} onValueChange={setSelectedClassForTeacher}>
                          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                          <SelectContent>
                            {classes.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name} - {c.section}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 min-w-[200px]">
                        <Label>Teacher</Label>
                        <Select value={selectedTeacher} onValueChange={setSelectedTeacher}>
                          <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
                          <SelectContent>
                            {teachers.map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.full_name || "Unnamed"}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 min-w-[140px]">
                        <Label>Role</Label>
                        <Select value={selectedTeacherRole} onValueChange={setSelectedTeacherRole}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="primary">Primary Teacher</SelectItem>
                            <SelectItem value="subject">Subject Teacher</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {selectedTeacherRole === "subject" && (
                        <div className="space-y-1.5 min-w-[160px]">
                          <Label>Subject</Label>
                          <Input placeholder="e.g. Math, Science" value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} />
                        </div>
                      )}
                      <Button onClick={handleAssignTeacher} disabled={!selectedClassForTeacher || !selectedTeacher}>
                        <Plus className="h-4 w-4 mr-1" /> Assign
                      </Button>
                    </div>

                    {selectedClassForTeacher && (
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2">
                          Teachers in {getClassName(selectedClassForTeacher)}
                        </h4>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Teacher Name</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Subject</TableHead>
                              <TableHead className="w-12"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {classTeachers.filter(ct => ct.class_id === selectedClassForTeacher).map(ct => (
                              <TableRow key={ct.id}>
                                <TableCell className="font-medium">{(ct.profiles as any)?.full_name || "Unnamed"}</TableCell>
                                <TableCell>
                                  <Badge variant={ct.teacher_role === "primary" ? "default" : "secondary"}>
                                    {ct.teacher_role === "primary" ? "Primary" : "Subject"}
                                  </Badge>
                                </TableCell>
                                <TableCell>{ct.subject || "—"}</TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="icon" onClick={() => handleRemoveTeacher(ct.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {classTeachers.filter(ct => ct.class_id === selectedClassForTeacher).length === 0 && (
                              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No teachers assigned</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}

                {/* === CLASS → TEACHERS VIEW === */}
                {teacherViewMode === "by-class" && (
                  <div className="space-y-4">
                    {classes.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No classes created yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Class</TableHead>
                            <TableHead>Primary Teacher</TableHead>
                            <TableHead>Subject Teachers</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classes.map(c => {
                            const assigned = classTeachers.filter(ct => ct.class_id === c.id);
                            const primary = assigned.find(ct => ct.teacher_role === "primary");
                            const subjects = assigned.filter(ct => ct.teacher_role === "subject");
                            return (
                              <TableRow key={c.id}>
                                <TableCell className="font-medium">{c.name} - {c.section}</TableCell>
                                <TableCell>
                                  {primary ? (
                                    <Badge className="bg-primary/10 text-primary border-primary/20">{(primary.profiles as any)?.full_name || "Unnamed"}</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic">Not assigned</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {subjects.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {subjects.map(st => (
                                        <Badge key={st.id} variant="secondary" className="text-xs">
                                          {(st.profiles as any)?.full_name || "Unnamed"} ({st.subject})
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic">None</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}

                {/* === TEACHER → CLASSES VIEW === */}
                {teacherViewMode === "by-teacher" && (
                  <div className="space-y-4">
                    {teachers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No teachers found.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Teacher</TableHead>
                            <TableHead>Primary Class</TableHead>
                            <TableHead>Subject Classes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {teachers.map(t => {
                            const assigned = classTeachers.filter(ct => ct.teacher_id === t.id);
                            const primaryAssignments = assigned.filter(ct => ct.teacher_role === "primary");
                            const subjectAssignments = assigned.filter(ct => ct.teacher_role === "subject");
                            return (
                              <TableRow key={t.id}>
                                <TableCell className="font-medium">{t.full_name || "Unnamed"}</TableCell>
                                <TableCell>
                                  {primaryAssignments.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {primaryAssignments.map(pa => (
                                        <Badge key={pa.id} className="bg-primary/10 text-primary border-primary/20">
                                          {getClassName(pa.class_id)}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic">None</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {subjectAssignments.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {subjectAssignments.map(sa => (
                                        <Badge key={sa.id} variant="secondary" className="text-xs">
                                          {getClassName(sa.class_id)} ({sa.subject})
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic">None</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>}



          {/* ===== APPROVALS TAB ===== */}
          <TabsContent value="approvals">
            <DiagnosticApprovalPanel />
          </TabsContent>

          {/* ===== QUESTION ALLOTMENT TAB ===== */}
          <TabsContent value="questions">
            <Card>
              <CardHeader>
                <CardTitle>Diagnostic Question Allotment</CardTitle>
                <CardDescription>Assign diagnostic question sets (by age group) to teachers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1.5 min-w-[200px]">
                    <Label>Teacher</Label>
                    <Select value={selectedTeacherForQuestions} onValueChange={setSelectedTeacherForQuestions}>
                      <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
                      <SelectContent>
                        {teachers.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.full_name || "Unnamed"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 min-w-[180px]">
                    <Label>Age Group</Label>
                    <Select value={selectedAgeGroup} onValueChange={setSelectedAgeGroup}>
                      <SelectTrigger><SelectValue placeholder="Select age group" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Group 1 (5-7 yrs)</SelectItem>
                        <SelectItem value="2">Group 2 (8-10 yrs)</SelectItem>
                        <SelectItem value="3">Group 3 (11-14 yrs)</SelectItem>
                        <SelectItem value="4">Group 4 (15-18 yrs)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAssignQuestions} disabled={!selectedTeacherForQuestions || !selectedAgeGroup}>
                    <Plus className="h-4 w-4 mr-1" /> Assign
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Teacher</TableHead>
                      <TableHead>Age Group</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questionAssignments.map(qa => (
                      <TableRow key={qa.id}>
                        <TableCell>{getTeacherName(qa.teacher_id)}</TableCell>
                        <TableCell><Badge variant="outline">Group {qa.age_group}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(qa.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => handleRemoveQuestionAssignment(qa.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {questionAssignments.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No question assignments yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== CONFIG TAB ===== */}
          <TabsContent value="config">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" /> Diagnostic Configuration</CardTitle>
                <CardDescription>System-wide diagnostic settings and role hierarchy</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Role Hierarchy</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-primary/5">
                      <Badge className="bg-primary text-primary-foreground">Admin</Badge>
                      <span className="text-sm text-foreground">Full system control — manage classes, teachers, students, questions, diagnostics</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <Badge variant="secondary">Teacher</Badge>
                      <span className="text-sm text-foreground">Conduct assessments, generate lessons, view analytics, manage assigned students</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <Badge variant="outline">Student</Badge>
                      <span className="text-sm text-foreground">Take assessments, view lessons, play gamification, take academic tests</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Permissions Matrix</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Feature</TableHead>
                          <TableHead className="text-center">Admin</TableHead>
                          <TableHead className="text-center">Teacher</TableHead>
                          <TableHead className="text-center">Student</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          { feature: "Class Management", admin: "Full", teacher: "View", student: "—" },
                          { feature: "Student Allotment", admin: "Full", teacher: "View", student: "View Own" },
                          { feature: "Teacher Allotment", admin: "Full", teacher: "View Own", student: "—" },
                          { feature: "Question Allotment", admin: "Full", teacher: "View Own", student: "—" },
                          { feature: "Diagnostic Assessments", admin: "Full", teacher: "Conduct", student: "Take" },
                          { feature: "Lesson Plans", admin: "Full", teacher: "Create/View", student: "View Assigned" },
                          { feature: "Analytics", admin: "Full", teacher: "View", student: "—" },
                          { feature: "Alerts", admin: "Full", teacher: "—", student: "—" },
                          { feature: "Gamification", admin: "View", teacher: "—", student: "Play" },
                          { feature: "Academic Tests", admin: "View", teacher: "View", student: "Take" },
                          { feature: "Settings", admin: "Full", teacher: "Own", student: "Own" },
                        ].map(row => (
                          <TableRow key={row.feature}>
                            <TableCell className="font-medium text-foreground">{row.feature}</TableCell>
                            <TableCell className="text-center"><Badge variant="default" className="text-[10px]">{row.admin}</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="secondary" className="text-[10px]">{row.teacher}</Badge></TableCell>
                            <TableCell className="text-center"><Badge variant="outline" className="text-[10px]">{row.student}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default AdminPanel;
