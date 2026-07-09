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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, BookOpen } from "lucide-react";
import { normalizeSubject } from "@/lib/subjectUtils";

interface Competency {
  id: string;
  school_id: string;
  subject: string;
  name: string;
  description: string | null;
  grade_level: string | null;
  created_at: string;
}

const GRADE_LEVELS = [
  "All Grades",
  ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`),
];

export default function CompetencyDefinitions() {
  const { profile } = useAuth();
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Competency | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  // School-wide, deduplicated subject list for the Add/Edit dialog —
  // merged from class_teachers, teacher_subjects, and existing competencies
  // so it reflects every subject taught anywhere in the school, not just
  // ones with a teacher already assigned to a specific class.
  const [subjectMasterList, setSubjectMasterList] = useState<string[]>([]);
  const [loadingSubjectList, setLoadingSubjectList] = useState(true);

  const [form, setForm] = useState({
    subject: "",
    name: "",
    description: "",
    grade_level: "All Grades",
  });

  const schoolId = profile?.school_id;

  useEffect(() => {
    if (schoolId) {
      fetchCompetencies();
      fetchSubjectMasterList();
    }
  }, [schoolId]);

  const fetchCompetencies = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("competencies")
      .select("*")
      .eq("school_id", schoolId)
      .order("subject", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      toast.error("Couldn't load competencies");
      console.error(error);
    } else {
      setCompetencies(data || []);
    }
    setLoading(false);
  };

  const fetchSubjectMasterList = async () => {
    setLoadingSubjectList(true);
    const [classTeachersRes, teacherSubjectsRes, competenciesRes] =
      await Promise.all([
        supabase
          .from("class_teachers")
          .select("subject, classes!inner(school_id)")
          .eq("classes.school_id", schoolId),
        supabase.from("teacher_subjects").select("subject").eq("school_id", schoolId),
        supabase.from("competencies").select("subject").eq("school_id", schoolId),
      ]);

    const rawSubjects: string[] = [
      ...(classTeachersRes.data || []).map((r: any) => r.subject),
      ...(teacherSubjectsRes.data || []).map((r: any) => r.subject),
      ...(competenciesRes.data || []).map((r: any) => r.subject),
    ].filter(Boolean);

    const normalized = new Map<string, string>();
    for (const raw of rawSubjects) {
      const clean = normalizeSubject(raw);
      normalized.set(clean.toLowerCase(), clean);
    }

    setSubjectMasterList(Array.from(normalized.values()).sort());
    setLoadingSubjectList(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ subject: "", name: "", description: "", grade_level: "All Grades" });
    setDialogOpen(true);
  };

  const openEdit = (c: Competency) => {
    setEditing(c);
    setForm({
      subject: c.subject,
      name: c.name,
      description: c.description || "",
      grade_level: c.grade_level || "All Grades",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.subject.trim() || !form.name.trim()) {
      toast.error("Subject and name are required");
      return;
    }
    if (!schoolId) return;

    if (editing) {
      const { error } = await supabase
        .from("competencies")
        .update({
          subject: form.subject.trim(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          grade_level: form.grade_level,
        })
        .eq("id", editing.id);

      if (error) {
        toast.error("Update failed");
        console.error(error);
        return;
      }
      toast.success("Competency updated");
    } else {
      const { error } = await supabase.from("competencies").insert({
        school_id: schoolId,
        subject: form.subject.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        grade_level: form.grade_level,
      });

      if (error) {
        toast.error("Couldn't create competency");
        console.error(error);
        return;
      }
      toast.success("Competency added");
    }

    setDialogOpen(false);
    fetchCompetencies();
    fetchSubjectMasterList();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("competencies").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed — it may already be in use in assessments");
      console.error(error);
      return;
    }
    toast.success("Competency removed");
    fetchCompetencies();
  };

  const filtered = competencies.filter((c) => {
    const subjectOk = subjectFilter === "all" || c.subject === subjectFilter;
    const gradeOk = gradeFilter === "all" || c.grade_level === gradeFilter;
    return subjectOk && gradeOk;
  });

  // Always include the currently selected subject as an option, even if it
  // isn't in the master list yet (e.g. editing an older, unusual entry).
  const subjectOptions = Array.from(
    new Set([...subjectMasterList, ...(form.subject ? [form.subject] : [])])
  ).sort();

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              Competency & Outcomes Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Define the competencies teachers assess students against.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add competency
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit competency" : "Add competency"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Select
                    value={form.subject}
                    onValueChange={(v) => setForm({ ...form, subject: v })}
                    disabled={loadingSubjectList}
                  >
                    <SelectTrigger id="subject">
                      <SelectValue
                        placeholder={
                          loadingSubjectList
                            ? "Loading subjects..."
                            : "Select subject"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {subjectOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Any subject taught in the school — the teacher assigned
                    to that subject for a class will be able to assess it.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Competency name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Problem Solving"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="grade">Grade level</Label>
                  <Select
                    value={form.grade_level}
                    onValueChange={(v) => setForm({ ...form, grade_level: v })}
                  >
                    <SelectTrigger id="grade">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADE_LEVELS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="What does mastering this competency look like?"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>
                  {editing ? "Save changes" : "Add competency"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-3">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjectMasterList.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All grades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {GRADE_LEVELS.filter((g) => g !== "All Grades").map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {filtered.length} competenc{filtered.length === 1 ? "y" : "ies"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Loading...
              </p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <p className="text-muted-foreground">
                  {competencies.length === 0
                    ? "No competencies defined yet."
                    : "No competencies match this filter."}
                </p>
                {competencies.length === 0 && (
                  <Button variant="outline" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add your first competency
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Competency</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Badge variant="secondary">{c.subject}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.grade_level || "All Grades"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">
                        {c.description || "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(c.id)}
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
      </div>
    </AppLayout>
  );
}
