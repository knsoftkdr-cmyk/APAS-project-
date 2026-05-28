/**
 * SuperAdminPanel.tsx  (School Admin Panel)
 * Tabs:
 *  1. Overview       – school stats
 *  2. Accounts       – create/view users
 *  3. Performance    – student & teacher performance
 *  4. Permissions    – role permission matrix ← NEW
 *  5. School Info    – edit school details
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Users, GraduationCap, BookOpen, School, BarChart3,
  Plus, Trash2, ShieldCheck, TrendingUp, UserCheck, Lock,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const PERMISSION_MODULES = [
  "View School Dashboard",
  "User Creation",
  "Student Profile",
  "Teacher Profile",
  "Attendance",
  "Homework",
  "Lesson Plans",
  "Assessments",
  "AI Tutor",
  "Analytics",
  "Reports",
  "Gamification",
  "Parent Communication",
  "Risk Prediction",
  "ERP Integration",
  "Billing",
  "Settings",
];

const PERMISSION_ROLES = ["principal", "hod", "teacher", "student", "parent"];

const ROLE_LABELS: Record<string, string> = {
  principal: "Principal",
  hod: "HOD",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface SchoolInfo {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  curriculum: string | null;
  subscription_plan: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string;
  school_id: string | null;
}

interface StudentPerf {
  student_id: string;
  full_name: string | null;
  avg_score: number | null;
  tests_taken: number;
}

interface TeacherPerf {
  teacher_id: string;
  full_name: string | null;
  students_taught: number;
}

// key: "role-module" → allowed boolean
type PermMatrix = Record<string, boolean>;

// ─── Component ───────────────────────────────────────────────────────────────

const SuperAdminPanel = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  // ── Core state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [studentPerf, setStudentPerf] = useState<StudentPerf[]>([]);
  const [teacherPerf, setTeacherPerf] = useState<TeacherPerf[]>([]);

  // ── Permission matrix state ────────────────────────────────────────────────
  const [permMatrix, setPermMatrix] = useState<PermMatrix>({});
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);

  // ── Account creation ───────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newRole, setNewRole] = useState<"teacher" | "student" | "principal" | "hod" | "parent">("teacher");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [creating, setCreating] = useState(false);

  // ── School edit ────────────────────────────────────────────────────────────
  const [editSchool, setEditSchool] = useState<SchoolInfo | null>(null);
  const [savingSchool, setSavingSchool] = useState(false);

  // ── Fetch school id ────────────────────────────────────────────────────────
  const fetchSchoolId = useCallback(async () => {
    if (!user) return null;
    const { data } = await supabase
      .from("school_admin_schools")
      .select("school_id")
      .eq("school_admin_id", user.id)
      .single();
    return data?.school_id ?? null;
  }, [user]);

  // ── Fetch permissions ──────────────────────────────────────────────────────
  const fetchPermissions = useCallback(async (sid: string) => {
    setPermLoading(true);
    const { data } = await supabase
      .from("role_permissions")
      .select("role, module_name, allowed")
      .eq("school_id", sid);

    const matrix: PermMatrix = {};
    for (const row of (data ?? []) as any[]) {
      matrix[`${row.role}-${row.module_name}`] = row.allowed;
    }
    setPermMatrix(matrix);
    setPermLoading(false);
  }, []);

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const sid = await fetchSchoolId();
      if (!sid) {
        toast({ title: "No school linked to this account", variant: "destructive" });
        setLoading(false);
        return;
      }
      setSchoolId(sid);

      const { data: schoolData } = await supabase
        .from("schools")
        .select("id, name, address, phone, email, curriculum, subscription_plan")
        .eq("id", sid)
        .single();
      setSchool(schoolData);
      setEditSchool(schoolData);

      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, role, school_id")
        .eq("school_id", sid);
      setUsers(profilesData ?? []);

      await fetchPermissions(sid);

      // Student performance
      const { data: diagData } = await supabase
        .from("diagnostic_results")
        .select("student_id, score")
        .not("score", "is", null);

      if (diagData) {
        const map = new Map<string, { scores: number[] }>();
        for (const row of diagData as any[]) {
          if (!map.has(row.student_id)) map.set(row.student_id, { scores: [] });
          map.get(row.student_id)!.scores.push(Number(row.score));
        }
        const studentIds = Array.from(map.keys());
        const { data: studentProfiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", studentIds);
        const nameMap = new Map((studentProfiles ?? []).map((p: any) => [p.id, p.full_name]));
        const perf: StudentPerf[] = Array.from(map.entries()).map(([id, v]) => ({
          student_id: id,
          full_name: nameMap.get(id) ?? null,
          avg_score: v.scores.length
            ? Math.round(v.scores.reduce((a: number, b: number) => a + b, 0) / v.scores.length)
            : null,
          tests_taken: v.scores.length,
        }));
        setStudentPerf(perf.sort((a, b) => (b.avg_score ?? 0) - (a.avg_score ?? 0)));
      }

      // Teacher performance
      const { data: ctData } = await supabase
        .from("class_teachers")
        .select("teacher_id, class_id, class_students(student_id)");

      if (ctData) {
        const tMap = new Map<string, Set<string>>();
        for (const row of ctData as any[]) {
          if (!tMap.has(row.teacher_id)) tMap.set(row.teacher_id, new Set());
          for (const cs of (row.class_students ?? []) as any[])
            tMap.get(row.teacher_id)!.add(cs.student_id);
        }
        const teacherIds = Array.from(tMap.keys());
        const { data: teacherProfiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", teacherIds);
        const tNameMap = new Map((teacherProfiles ?? []).map((p: any) => [p.id, p.full_name]));
        setTeacherPerf(
          Array.from(tMap.entries()).map(([id, s]) => ({
            teacher_id: id,
            full_name: tNameMap.get(id) ?? null,
            students_taught: s.size,
          })).sort((a, b) => b.students_taught - a.students_taught)
        );
      }
    } catch (e: any) {
      toast({ title: "Error loading data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchSchoolId, fetchPermissions, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Permission toggle ──────────────────────────────────────────────────────
  const togglePermission = (role: string, module: string) => {
    const key = `${role}-${module}`;
    setPermMatrix((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Save permissions ───────────────────────────────────────────────────────
  const savePermissions = async () => {
    if (!schoolId) return;
    setPermSaving(true);
    try {
      const upserts = PERMISSION_ROLES.flatMap((role) =>
        PERMISSION_MODULES.map((module) => ({
          school_id: schoolId,
          role,
          module_name: module,
          allowed: !!permMatrix[`${role}-${module}`],
          updated_at: new Date().toISOString(),
        }))
      );

      const { error } = await supabase
        .from("role_permissions")
        .upsert(upserts, { onConflict: "school_id,role,module_name" });

      if (error) throw error;
      toast({ title: "Permissions saved successfully ✅" });
    } catch (e: any) {
      toast({ title: "Error saving permissions", description: e.message, variant: "destructive" });
    } finally {
      setPermSaving(false);
    }
  };

  // ── Create account ─────────────────────────────────────────────────────────
  const handleCreateAccount = async () => {
    if (!newEmail.trim() || !newPassword.trim() || !newFullName.trim()) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (!schoolId) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-admin-user", {
        body: {
          email: newEmail.trim().toLowerCase(),
          password: newPassword,
          full_name: newFullName.trim(),
          role: newRole,
          school_id: schoolId,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: `${newRole} account created`, description: newEmail });
      setCreateOpen(false);
      setNewEmail(""); setNewPassword(""); setNewFullName(""); setNewRole("teacher");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error creating account", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ── Delete user ────────────────────────────────────────────────────────────
  const handleDeleteUser = async (profileId: string) => {
    if (!confirm("Remove this user from the school?")) return;
    const { error } = await supabase.from("profiles").update({ school_id: null }).eq("id", profileId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "User removed" }); fetchAll(); }
  };

  // ── Save school info ───────────────────────────────────────────────────────
  const handleSaveSchool = async () => {
    if (!editSchool || !schoolId) return;
    setSavingSchool(true);
    const { error } = await supabase.from("schools").update({
      name: editSchool.name,
      address: editSchool.address,
      phone: editSchool.phone,
      email: editSchool.email,
      curriculum: editSchool.curriculum,
      subscription_plan: editSchool.subscription_plan,
    }).eq("id", schoolId);
    setSavingSchool(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "School info saved" }); fetchAll(); }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const countRole = (role: string) => users.filter((u) => u.role === role).length;

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-muted-foreground";
    if (score >= 75) return "text-green-600 font-semibold";
    if (score >= 50) return "text-yellow-600 font-semibold";
    return "text-red-600 font-semibold";
  };

  const roleBadgeVariant = (role: string) => {
    const map: Record<string, any> = {
      teacher: "secondary", student: "outline", principal: "default",
      hod: "default", parent: "outline", admin: "default",
    };
    return map[role] ?? "outline";
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">School Admin Panel</h1>
            <p className="text-sm text-muted-foreground">
              {school?.name ?? "Loading..."} — full school management
            </p>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-4 w-4" />Overview</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1.5"><Users className="h-4 w-4" />Accounts</TabsTrigger>
            <TabsTrigger value="performance" className="gap-1.5"><TrendingUp className="h-4 w-4" />Performance</TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1.5"><Lock className="h-4 w-4" />Permissions</TabsTrigger>
            <TabsTrigger value="school" className="gap-1.5"><School className="h-4 w-4" />School Info</TabsTrigger>
          </TabsList>

          {/* ══════════════════════════════════════════ OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Teachers",   count: countRole("teacher"),   icon: BookOpen,      color: "text-blue-600" },
                { label: "Students",   count: countRole("student"),   icon: GraduationCap, color: "text-green-600" },
                { label: "Principals", count: countRole("principal"), icon: UserCheck,     color: "text-purple-600" },
                { label: "HODs",       count: countRole("hod"),       icon: ShieldCheck,   color: "text-orange-600" },
              ].map(({ label, count, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="pt-6 pb-4 flex items-center gap-4">
                    <div className={`rounded-lg bg-muted p-2 ${color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader><CardTitle>Quick Stats</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Total users in school", users.length],
                  ["Parents", countRole("parent")],
                  ["Students with test data", studentPerf.length],
                  ["Avg student score", studentPerf.length
                    ? Math.round(studentPerf.reduce((a, s) => a + (s.avg_score ?? 0), 0) / studentPerf.length) + "%"
                    : "—"],
                  ["Active teachers (with classes)", teacherPerf.filter(t => t.students_taught > 0).length],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════ ACCOUNTS */}
          <TabsContent value="accounts" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">School Accounts</h2>
                <p className="text-sm text-muted-foreground">Manage all users for {school?.name}</p>
              </div>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-1.5"><Plus className="h-4 w-4" />Create Account</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Create New Account</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label>Role</Label>
                      <Select value={newRole} onValueChange={(v) => setNewRole(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="teacher">Teacher</SelectItem>
                          <SelectItem value="student">Student</SelectItem>
                          <SelectItem value="principal">Principal</SelectItem>
                          <SelectItem value="hod">HOD (Head of Department)</SelectItem>
                          <SelectItem value="parent">Parent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Full Name</Label>
                      <Input placeholder="e.g. Jane Smith" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" placeholder="jane@school.edu" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password</Label>
                      <Input type="password" placeholder="Min 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    </div>
                    <Button className="w-full" onClick={handleCreateAccount} disabled={creating}>
                      {creating ? <LoadingSpinner size="sm" /> : `Create ${newRole} account`}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {(["principal", "hod", "teacher", "student", "parent"] as const).map((role) => {
              const roleUsers = users.filter((u) => u.role === role);
              if (!roleUsers.length) return null;
              return (
                <Card key={role}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Badge variant={roleBadgeVariant(role)} className="capitalize">{role}s</Badge>
                      <span className="text-muted-foreground font-normal text-sm">({roleUsers.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>User ID</TableHead>
                          <TableHead className="w-16"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {roleUsers.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell className="font-medium">
                              {u.full_name ?? <span className="italic text-muted-foreground">Unnamed</span>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}…</TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteUser(u.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
            {users.length === 0 && (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No accounts yet.</CardContent></Card>
            )}
          </TabsContent>

          {/* ══════════════════════════════════════════ PERFORMANCE */}
          <TabsContent value="performance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><GraduationCap className="h-5 w-5" />Student Performance</CardTitle>
                <CardDescription>Average diagnostic scores</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {studentPerf.length === 0
                  ? <p className="p-6 text-center text-muted-foreground text-sm">No diagnostic data yet.</p>
                  : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead className="text-center">Tests</TableHead>
                          <TableHead className="text-center">Avg Score</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {studentPerf.map((s) => (
                          <TableRow key={s.student_id}>
                            <TableCell className="font-medium">{s.full_name ?? "Unknown"}</TableCell>
                            <TableCell className="text-center">{s.tests_taken}</TableCell>
                            <TableCell className={`text-center ${scoreColor(s.avg_score)}`}>
                              {s.avg_score !== null ? `${s.avg_score}%` : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {s.avg_score === null ? <Badge variant="outline">No data</Badge>
                                : s.avg_score >= 75 ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">On Track</Badge>
                                : s.avg_score >= 50 ? <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Attention</Badge>
                                : <Badge className="bg-red-100 text-red-800 hover:bg-red-100">At Risk</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Teacher Overview</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {teacherPerf.length === 0
                  ? <p className="p-6 text-center text-muted-foreground text-sm">No class data yet.</p>
                  : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Teacher</TableHead>
                          <TableHead className="text-center">Students</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teacherPerf.map((t) => (
                          <TableRow key={t.teacher_id}>
                            <TableCell className="font-medium">{t.full_name ?? "Unknown"}</TableCell>
                            <TableCell className="text-center">{t.students_taught}</TableCell>
                            <TableCell className="text-center">
                              {t.students_taught > 0
                                ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                                : <Badge variant="outline">No class</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════ PERMISSIONS */}
          <TabsContent value="permissions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />Role Permission Matrix
                </CardTitle>
                <CardDescription>
                  Control which modules each role can access in your school.
                  Changes take effect immediately after saving.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {permLoading ? (
                  <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 pr-6 font-semibold text-foreground min-w-[180px]">Module</th>
                          {PERMISSION_ROLES.map((role) => (
                            <th key={role} className="text-center py-3 px-4 font-semibold text-foreground min-w-[100px]">
                              {ROLE_LABELS[role]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERMISSION_MODULES.map((module, i) => (
                          <tr key={module} className={i % 2 === 0 ? "bg-muted/30" : ""}>
                            <td className="py-3 pr-6 font-medium text-foreground">{module}</td>
                            {PERMISSION_ROLES.map((role) => (
                              <td key={role} className="py-3 px-4 text-center">
                                <Checkbox
                                  checked={!!permMatrix[`${role}-${module}`]}
                                  onCheckedChange={() => togglePermission(role, module)}
                                  className="mx-auto"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-end mt-6">
                  <Button onClick={savePermissions} disabled={permSaving} className="min-w-[140px]">
                    {permSaving ? <LoadingSpinner size="sm" /> : "Save Permissions"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════ SCHOOL INFO */}
          <TabsContent value="school">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><School className="h-5 w-5" />School Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-w-md">
                {editSchool && (
                  <>
                    {[
                      { label: "School Name", key: "name", type: "text" },
                      { label: "Address", key: "address", type: "text" },
                      { label: "Phone", key: "phone", type: "text" },
                      { label: "Email", key: "email", type: "email" },
                      { label: "Curriculum", key: "curriculum", type: "text" },
                    ].map(({ label, key, type }) => (
                      <div key={key} className="space-y-1.5">
                        <Label>{label}</Label>
                        <Input
                          type={type}
                          value={(editSchool as any)[key] ?? ""}
                          onChange={(e) => setEditSchool({ ...editSchool, [key]: e.target.value })}
                        />
                      </div>
                    ))}
                    <div className="space-y-1.5">
                      <Label>Subscription Plan</Label>
                      <Select
                        value={editSchool.subscription_plan ?? "basic"}
                        onValueChange={(v) => setEditSchool({ ...editSchool, subscription_plan: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="premium">Premium</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleSaveSchool} disabled={savingSchool}>
                      {savingSchool ? <LoadingSpinner size="sm" /> : "Save Changes"}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default SuperAdminPanel;
