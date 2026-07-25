import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, Plus, Pencil, Users, Search, ArrowRightLeft, Sparkles } from "lucide-react";

interface Branch {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
  student_count?: number;
}

interface SchoolOption {
  id: string;
  name: string;
}

interface PersonRow {
  id: string;
  full_name: string;
  branch_id: string | null;
  class_grade?: string;
  section?: string;
  role?: string;
}

export default function BranchManagementPage() {
  const { profile } = useAuth();
  const isKnsoft = profile?.role === "knsoft_admin";

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>(profile?.school_id ?? "");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);

  const [students, setStudents] = useState<PersonRow[]>([]);
  const [staff, setStaff] = useState<PersonRow[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const [studentSearch, setStudentSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [moveTargetStudents, setMoveTargetStudents] = useState("");
  const [moveTargetStaff, setMoveTargetStaff] = useState("");

  useEffect(() => {
    if (!isKnsoft) return;
    supabase
      .from("schools")
      .select("id, name")
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          toast.error("Failed to load schools: " + error.message);
          return;
        }
        setSchools(data ?? []);
        if (data && data.length > 0 && !selectedSchoolId) {
          setSelectedSchoolId(data[0].id);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKnsoft]);

  const fetchBranches = useCallback(async () => {
    if (!selectedSchoolId) return;
    setLoadingBranches(true);
    const { data, error } = await supabase
      .from("branches")
      .select("*")
      .eq("school_id", selectedSchoolId)
      .order("name");
    if (error) {
      toast.error("Failed to load branches: " + error.message);
      setLoadingBranches(false);
      return;
    }
    const { data: studentRows } = await supabase
      .from("students")
      .select("branch_id")
      .eq("school_id", selectedSchoolId);
    const counts: Record<string, number> = {};
    (studentRows ?? []).forEach((r) => {
      if (r.branch_id) counts[r.branch_id] = (counts[r.branch_id] ?? 0) + 1;
    });
    setBranches((data ?? []).map((b) => ({ ...b, student_count: counts[b.id] ?? 0 })));
    setLoadingBranches(false);
  }, [selectedSchoolId]);

  const fetchPeople = useCallback(async () => {
    if (!selectedSchoolId) return;
    setLoadingPeople(true);
    const [studentsRes, staffRes] = await Promise.all([
      supabase
        .from("students")
        .select("id, full_name, branch_id, class, section")
        .eq("school_id", selectedSchoolId)
        .order("full_name"),
      supabase
        .from("profiles")
        .select("id, full_name, branch_id, role")
        .eq("school_id", selectedSchoolId)
        .not("role", "in", "(student,parent)")
        .order("full_name"),
    ]);
    if (studentsRes.error) toast.error("Failed to load students: " + studentsRes.error.message);
    if (staffRes.error) toast.error("Failed to load staff: " + staffRes.error.message);
    setStudents(
      (studentsRes.data ?? []).map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        branch_id: s.branch_id,
        class_grade: [s.class, s.section].filter(Boolean).join(" "),
      }))
    );
    setStaff(
      (staffRes.data ?? []).map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        branch_id: s.branch_id,
        role: s.role,
      }))
    );
    setLoadingPeople(false);
  }, [selectedSchoolId]);

  useEffect(() => {
    fetchBranches();
    fetchPeople();
    setSelectedStudentIds(new Set());
    setSelectedStaffIds(new Set());
  }, [fetchBranches, fetchPeople]);

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "Unassigned";

  const resetForm = () => {
    setName("");
    setCode("");
    setAddress("");
  };

  const openCreateDialog = () => {
    setEditingId(null);
    resetForm();
    setFormOpen(true);
  };

  const openEditDialog = (b: Branch) => {
    setEditingId(b.id);
    setName(b.name);
    setCode(b.code ?? "");
    setAddress(b.address ?? "");
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!selectedSchoolId || !name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    setSaving(true);
    if (editingId) {
      const { error } = await supabase
        .from("branches")
        .update({ name: name.trim(), code: code.trim() || null, address: address.trim() || null })
        .eq("id", editingId);
      setSaving(false);
      if (error) {
        toast.error("Failed to update branch: " + error.message);
        return;
      }
      toast.success("Branch updated");
    } else {
      const { error } = await supabase.from("branches").insert({
        school_id: selectedSchoolId,
        name: name.trim(),
        code: code.trim() || null,
        address: address.trim() || null,
        is_active: true,
      });
      setSaving(false);
      if (error) {
        toast.error("Failed to create branch: " + error.message);
        return;
      }
      toast.success("Branch created");
    }
    resetForm();
    setEditingId(null);
    setFormOpen(false);
    fetchBranches();
  };

  const toggleActive = async (b: Branch) => {
    const { error } = await supabase.from("branches").update({ is_active: !b.is_active }).eq("id", b.id);
    if (error) {
      toast.error("Failed to update: " + error.message);
      return;
    }
    setBranches((prev) => prev.map((x) => (x.id === b.id ? { ...x, is_active: !x.is_active } : x)));
  };

  const filteredStudents = useMemo(
    () =>
      students.filter((s) =>
        [s.full_name, s.class_grade].join(" ").toLowerCase().includes(studentSearch.toLowerCase())
      ),
    [students, studentSearch]
  );
  const filteredStaff = useMemo(
    () => staff.filter((s) => [s.full_name, s.role].join(" ").toLowerCase().includes(staffSearch.toLowerCase())),
    [staff, staffSearch]
  );

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleStaff = (id: string) => {
    setSelectedStaffIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveStudents = async () => {
    if (!moveTargetStudents || selectedStudentIds.size === 0) return;
    const { error } = await supabase
      .from("students")
      .update({ branch_id: moveTargetStudents })
      .in("id", Array.from(selectedStudentIds));
    if (error) {
      toast.error("Failed to move students: " + error.message);
      return;
    }
    toast.success(`Moved ${selectedStudentIds.size} student(s)`);
    setSelectedStudentIds(new Set());
    setMoveTargetStudents("");
    fetchPeople();
    fetchBranches();
  };

  const moveStaff = async () => {
    if (!moveTargetStaff || selectedStaffIds.size === 0) return;
    const { error } = await supabase
      .from("profiles")
      .update({ branch_id: moveTargetStaff })
      .in("id", Array.from(selectedStaffIds));
    if (error) {
      toast.error("Failed to move staff: " + error.message);
      return;
    }
    toast.success(`Moved ${selectedStaffIds.size} staff member(s)`);
    setSelectedStaffIds(new Set());
    setMoveTargetStaff("");
    fetchPeople();
  };

  return (
    <AppLayout>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-blue-300 opacity-[0.12] blur-3xl" />
        <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-sky-300 opacity-[0.10] blur-3xl" />
        <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-blue-200 opacity-[0.10] blur-3xl" />

        <div className="relative z-10 space-y-5 p-4 md:p-6 max-w-7xl mx-auto">
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-blue-600 to-sky-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <Building2 className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-white">Branch Management</h1>
                  <p className="text-blue-100 text-xs md:text-sm mt-0.5">Manage campus branches and reassign students & staff</p>
                </div>
              </div>
              {isKnsoft && (
                <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                  <SelectTrigger className="w-56 bg-white/20 border-white/30 text-white">
                    <SelectValue placeholder="Select school" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Tabs defaultValue="branches">
            <TabsList>
              <TabsTrigger value="branches">Branches</TabsTrigger>
              <TabsTrigger value="students">Reassign Students</TabsTrigger>
              <TabsTrigger value="staff">Reassign Staff</TabsTrigger>
            </TabsList>

            <TabsContent value="branches" className="space-y-4 pt-4">
              <div className="flex justify-end">
                <Dialog
                  open={formOpen}
                  onOpenChange={(open) => {
                    setFormOpen(open);
                    if (!open) { resetForm(); setEditingId(null); }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button onClick={openCreateDialog} className="bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700">
                      <Plus className="h-4 w-4 mr-1" /> Add Branch
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingId ? "Edit Branch" : "Add New Branch"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Campus" />
                      </div>
                      <div>
                        <Label>Code</Label>
                        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NORTH" />
                      </div>
                      <div>
                        <Label>Address</Label>
                        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
                      </div>
                      <Button className="w-full bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700" onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : editingId ? "Save Changes" : "Create Branch"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loadingBranches ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading branches...</p>
              ) : branches.length === 0 ? (
                <Card className="border-2 border-dashed border-blue-200 bg-gradient-to-b from-blue-50/50 to-white rounded-2xl">
                  <CardContent className="py-16 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-sky-500 flex items-center justify-center mx-auto mb-4 shadow-md shadow-blue-200">
                      <Building2 className="h-7 w-7 text-white" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-800 mb-1">No branches yet</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">Click "Add Branch" above to create your first one.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {branches.map((b) => (
                    <Card key={b.id} className="overflow-hidden border-t-4 border-t-sky-300 border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                              <Building2 className="h-4 w-4 text-blue-600" />
                            </div>
                            <CardTitle className="text-base truncate">{b.name}</CardTitle>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-blue-50 hover:text-blue-700 rounded-full"
                            onClick={() => openEditDialog(b)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {b.code && <p className="text-xs text-muted-foreground pl-11.5 mt-1">{b.code}</p>}
                      </CardHeader>
                      <CardContent className="pt-1">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-2">
                          <Users className="h-3.5 w-3.5 text-blue-500" /> {b.student_count} student{b.student_count === 1 ? "" : "s"}
                        </div>
                        {b.address && <p className="text-xs text-muted-foreground mb-3">{b.address}</p>}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Active</span>
                            <Switch checked={b.is_active} onCheckedChange={() => toggleActive(b)} />
                          </div>
                          <Badge className={b.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>
                            {b.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="students" className="space-y-4 pt-4">
              <Card className="rounded-2xl border-blue-100">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" placeholder="Search students..." value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
                    </div>
                    <Select value={moveTargetStudents} onValueChange={setMoveTargetStudents}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Move to branch..." />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={moveStudents}
                      disabled={selectedStudentIds.size === 0 || !moveTargetStudents}
                      className="bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700"
                    >
                      <ArrowRightLeft className="h-4 w-4 mr-1" /> Move ({selectedStudentIds.size})
                    </Button>
                  </div>

                  {loadingPeople ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">Loading students...</p>
                  ) : (
                    <div className="border border-slate-100 rounded-xl max-h-[500px] overflow-y-auto divide-y divide-slate-50">
                      {filteredStudents.map((s) => (
                        <label key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 cursor-pointer">
                          <Checkbox checked={selectedStudentIds.has(s.id)} onCheckedChange={() => toggleStudent(s.id)} />
                          <span className="text-sm text-slate-700 flex-1 truncate">{s.full_name}</span>
                          <span className="text-xs text-muted-foreground">{s.class_grade}</span>
                          <Badge variant="outline" className="text-xs">{branchName(s.branch_id)}</Badge>
                        </label>
                      ))}
                      {filteredStudents.length === 0 && (
                        <p className="text-sm text-muted-foreground italic text-center py-8">No students found.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="staff" className="space-y-4 pt-4">
              <Card className="rounded-2xl border-blue-100">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" placeholder="Search staff..." value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} />
                    </div>
                    <Select value={moveTargetStaff} onValueChange={setMoveTargetStaff}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Move to branch..." />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={moveStaff}
                      disabled={selectedStaffIds.size === 0 || !moveTargetStaff}
                      className="bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700"
                    >
                      <ArrowRightLeft className="h-4 w-4 mr-1" /> Move ({selectedStaffIds.size})
                    </Button>
                  </div>

                  {loadingPeople ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">Loading staff...</p>
                  ) : (
                    <div className="border border-slate-100 rounded-xl max-h-[500px] overflow-y-auto divide-y divide-slate-50">
                      {filteredStaff.map((s) => (
                        <label key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/50 cursor-pointer">
                          <Checkbox checked={selectedStaffIds.has(s.id)} onCheckedChange={() => toggleStaff(s.id)} />
                          <span className="text-sm text-slate-700 flex-1 truncate">{s.full_name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{s.role}</span>
                          <Badge variant="outline" className="text-xs">{branchName(s.branch_id)}</Badge>
                        </label>
                      ))}
                      {filteredStaff.length === 0 && (
                        <p className="text-sm text-muted-foreground italic text-center py-8">No staff found.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
