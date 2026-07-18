import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Users, Plus, Pencil, Trash2, Search } from "lucide-react";

interface Student {
  id: string;
  full_name: string | null;
  class: string | null;
  profile_id: string | null;
}

interface Alumni {
  id: string;
  student_id: string;
  graduated_class: string;
  batch_year: string;
  graduation_date: string;
  current_occupation: string | null;
  higher_education: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  full_name?: string | null;
}

const emptyForm = {
  student_id: "",
  graduated_class: "",
  batch_year: "",
  graduation_date: new Date().toISOString().slice(0, 10),
  current_occupation: "",
  higher_education: "",
  contact_phone: "",
  contact_email: "",
  notes: "",
};

export default function AlumniPage() {
  const { profile } = useAuth();
  const [alumni, setAlumni] = useState<Alumni[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [studentSearch, setStudentSearch] = useState("");

  const fetchAll = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const { data: alumniData } = await supabase
      .from("alumni_profiles")
      .select("*")
      .eq("school_id", profile.school_id)
      .order("graduation_date", { ascending: false });

    const { data: studentData } = await supabase
      .from("students")
      .select("id, full_name, class, profile_id")
      .eq("school_id", profile.school_id)
      .order("full_name");

    const studentMap = new Map((studentData ?? []).map((s: any) => [s.profile_id ?? s.id, s.full_name]));
    const enriched = (alumniData ?? []).map((a: any) => ({
      ...a,
      full_name: studentMap.get(a.student_id) ?? "Unknown",
    }));

    setAlumni(enriched);
    setStudents(studentData ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [profile?.school_id]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setStudentSearch("");
    setDialogOpen(true);
  };

  const openEdit = (a: Alumni) => {
    setEditingId(a.id);
    setForm({
      student_id: a.student_id,
      graduated_class: a.graduated_class,
      batch_year: a.batch_year,
      graduation_date: a.graduation_date,
      current_occupation: a.current_occupation ?? "",
      higher_education: a.higher_education ?? "",
      contact_phone: a.contact_phone ?? "",
      contact_email: a.contact_email ?? "",
      notes: a.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.school_id) return;
    if (!editingId && !form.student_id) {
      toast.error("Select a student");
      return;
    }
    if (!form.graduated_class || !form.batch_year || !form.graduation_date) {
      toast.error("Graduated class, batch year, and graduation date are required");
      return;
    }
    setSaving(true);

    if (editingId) {
      const { error } = await supabase.from("alumni_profiles").update({
        graduated_class: form.graduated_class,
        batch_year: form.batch_year,
        graduation_date: form.graduation_date,
        current_occupation: form.current_occupation || null,
        higher_education: form.higher_education || null,
        contact_phone: form.contact_phone || null,
        contact_email: form.contact_email || null,
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      }).eq("id", editingId);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Alumni record updated");
    } else {
      const chosen = students.find((s) => s.id === form.student_id);
      const { error } = await supabase.from("alumni_profiles").insert({
        student_id: chosen?.profile_id ?? form.student_id,
        school_id: profile.school_id,
        graduated_class: form.graduated_class,
        batch_year: form.batch_year,
        graduation_date: form.graduation_date,
        current_occupation: form.current_occupation || null,
        higher_education: form.higher_education || null,
        contact_phone: form.contact_phone || null,
        contact_email: form.contact_email || null,
        notes: form.notes || null,
      });
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Alumni added");
    }

    setSaving(false);
    setDialogOpen(false);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this alumni record? This cannot be undone.")) return;
    const { error } = await supabase.from("alumni_profiles").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Alumni record deleted");
    fetchAll();
  };

  const filteredAlumni = alumni.filter((a) =>
    (a.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    a.batch_year.toLowerCase().includes(search.toLowerCase()) ||
    a.graduated_class.toLowerCase().includes(search.toLowerCase())
  );

  const TERMINAL_CLASS_LABEL = "Class 10";
  const filteredStudents = students
    .filter((s) => (s.class ?? "").trim() === TERMINAL_CLASS_LABEL)
    .filter((s) => (s.full_name ?? "").toLowerCase().includes(studentSearch.toLowerCase()));

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg">
          <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-emerald-300 opacity-[0.15] blur-3xl" />
          <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-teal-200 opacity-[0.12] blur-3xl" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm text-white">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Alumni</h1>
                <p className="text-emerald-50 text-xs md:text-sm mt-0.5">
                  Track graduated students, their achievements, and contact details
                </p>
              </div>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openAdd} className="gap-1 bg-white text-emerald-700 hover:bg-emerald-50">
                  <Plus className="h-4 w-4" /> Add Alumni
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Alumni Record" : "Add Alumni"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {!editingId && (
                  <div className="space-y-1">
                    <Label>Student</Label>
                    <div className="relative">
                      <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                      <Input
                        className="pl-8 mb-2"
                        placeholder="Search student by name..."
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                      />
                    </div>
                    <Select value={form.student_id} onValueChange={(v) => setForm({ ...form, student_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                      <SelectContent>
                        {filteredStudents.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.full_name} {s.class ? `(${s.class})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Graduated Class</Label>
                    <Input value={form.graduated_class} onChange={(e) => setForm({ ...form, graduated_class: e.target.value })} placeholder="e.g. Class 10" />
                  </div>
                  <div className="space-y-1">
                    <Label>Batch Year</Label>
                    <Input value={form.batch_year} onChange={(e) => setForm({ ...form, batch_year: e.target.value })} placeholder="e.g. 2025-26" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Graduation Date</Label>
                  <Input type="date" value={form.graduation_date} onChange={(e) => setForm({ ...form, graduation_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Higher Education</Label>
                  <Input value={form.higher_education} onChange={(e) => setForm({ ...form, higher_education: e.target.value })} placeholder="e.g. Pursuing Intermediate at XYZ College" />
                </div>
                <div className="space-y-1">
                  <Label>Current Occupation</Label>
                  <Input value={form.current_occupation} onChange={(e) => setForm({ ...form, current_occupation: e.target.value })} placeholder="e.g. Student, Software Engineer" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Contact Phone</Label>
                    <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Contact Email</Label>
                    <Input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? "Save Changes" : "Add Alumni"}
                </Button>
              </DialogFooter>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="border-2 border-emerald-100 rounded-2xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">All Alumni ({filteredAlumni.length})</CardTitle>
              <div className="relative w-64">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search alumni..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : filteredAlumni.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No alumni records yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Graduated Class</TableHead>
                    <TableHead>Batch Year</TableHead>
                    <TableHead>Graduation Date</TableHead>
                    <TableHead>Higher Education / Occupation</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlumni.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.full_name}</TableCell>
                      <TableCell><Badge variant="outline">{a.graduated_class}</Badge></TableCell>
                      <TableCell>{a.batch_year}</TableCell>
                      <TableCell>{new Date(a.graduation_date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-sm">
                        {a.higher_education || a.current_occupation || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.contact_phone || a.contact_email || "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(a)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(a.id)}>
                          <Trash2 className="h-4 w-4 text-red-600" />
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
