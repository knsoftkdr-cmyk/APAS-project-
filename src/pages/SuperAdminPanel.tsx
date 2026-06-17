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
import schoolBanner from "@/assets/school-banner.png";
import {
  Users, GraduationCap, BookOpen, School, BarChart3,
  Plus, Trash2, ShieldCheck, TrendingUp, UserCheck, Lock,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const PERMISSION_MODULES = [
  "Home",
  "Reports",
  "Alerts",
  "Admin Panel",
  "AI Tutor",
  "School Intelligence",
  "Security Center",
  "Billing",
  "Settings",
  "Student Profile",
  "Teacher Profile",
  "Attendance",
  "Homework",
  "Lesson Plans",
  "Assessments",
  "Analytics",
  "Gamification",
  "Leaderboard",
  "Predictions",
  "Parent Communication",
  "Risk Prediction",
  "Academic Tests",
  "Requests",
];
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin:   ["Home", "Reports", "Alerts", "Admin Panel", "AI Tutor", "School Intelligence", "Security Center", "Billing"],
  hod:     ["Home", "Reports", "Assessments", "Analytics"],
  teacher: ["Home", "Reports", "Lesson Plans", "Analytics", "Requests"],
  student: ["Home", "Assessments", "Academic Tests", "Homework", "Gamification", "Leaderboard", "Predictions", "AI Tutor"],
  parent:  ["Home"],
};

const PERMISSION_ROLES = ["admin", "hod", "teacher", "student", "parent"];

const ROLE_LABELS: Record<string, string> = {
  principal: "Principal",
  admin: "Admin / Principal",
  school_admin: "School Admin",
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
  academic_year: string | null;
  branch_sections: string | null;
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
  const [newStudentClass, setNewStudentClass] = useState("");
  const [newStudentSection, setNewStudentSection] = useState("");
  const [newStudentRollNo, setNewStudentRollNo] = useState("");
  const [newStudentDOB, setNewStudentDOB] = useState("");
  const [newStudentParentPhone, setNewStudentParentPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [linkParentId, setLinkParentId] = useState<string | null>(null);
  const [linkStudentId, setLinkStudentId] = useState("");
  const [linking, setLinking] = useState(false);
  const [parentLinks, setParentLinks] = useState<Record<string, {id: string, name: string}[]>>({});

  // ── School edit ────────────────────────────────────────────────────────────
  const [editSchool, setEditSchool] = useState<SchoolInfo | null>(null);
  const [savingSchool, setSavingSchool] = useState(false);

  // ── Fetch parent-student links ─────────────────────────────────────────────
  const fetchParentLinks = useCallback(async (schoolId: string) => {
    const { data } = await supabase
      .from("parent_students")
      .select("id, parent_id, student_id, profiles:student_id(full_name)")
      .in("parent_id", (await supabase.from("profiles").select("id").eq("school_id", schoolId).eq("role", "parent")).data?.map((p: any) => p.id) ?? []);
    
    const links: Record<string, {id: string, name: string}[]> = {};
    for (const row of (data ?? []) as any[]) {
      if (!links[row.parent_id]) links[row.parent_id] = [];
      links[row.parent_id].push({ id: row.id, name: row.profiles?.full_name ?? "Unknown" });
    }
    setParentLinks(links);
  }, []);

  // ── Fetch school id ────────────────────────────────────────────────────────
  const fetchSchoolId = useCallback(async () => {
    if (!user) return null;
    const { data } = await supabase
      .from("school_admin_schools")
      .select("school_id")
      .eq("school_admin_id", user.id)
      .single();
    if (data?.school_id) return data.school_id;
    // Fallback: use school_id from profile directly
    const { data: profileData } = await supabase
      .from("profiles")
      .select("school_id")
      .eq("id", user.id)
      .single();
    return profileData?.school_id ?? null;
  }, [user]);

  // ── Fetch permissions ──────────────────────────────────────────────────────
  const fetchPermissions = useCallback(async (sid: string) => {
    setPermLoading(true);
    const { data } = await supabase
      .from("role_permissions")
      .select("role, module_name, allowed")
      .eq("school_id", sid);
    const matrix: PermMatrix = {};
    const saved = data ?? [];
    const upserts: any[] = [];
    for (const role of PERMISSION_ROLES) {
      const roleSaved = saved.filter((r: any) => r.role === role);
      const hasAnyTrue = roleSaved.some((r: any) => r.allowed);
      const roleHasAllRows = roleSaved.length >= PERMISSION_MODULES.length;
      for (const module of PERMISSION_MODULES) {
        const row = roleSaved.find((r: any) => r.module_name === module);
        const def = (DEFAULT_PERMISSIONS[role] ?? []).includes(module);
        if (roleHasAllRows && hasAnyTrue) {
          matrix[`${role}-${module}`] = row ? row.allowed : def;
        } else {
          matrix[`${role}-${module}`] = def;
          upserts.push({ school_id: sid, role, module_name: module, allowed: def, updated_at: new Date().toISOString() });
        }
      }
    }
    if (upserts.length > 0) await supabase.from("role_permissions").upsert(upserts, { onConflict: "school_id,role,module_name" });
    setPermMatrix(matrix);
    setPermLoading(false);
  }, []);
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const sid = await fetchSchoolId();
      console.log("School ID fetched:", sid, "user:", user?.id);
      if (!sid) {
        toast({ title: "No school linked to this account", variant: "destructive" });
        setLoading(false);
        return;
      }
      setSchoolId(sid);

      const { data: schoolData } = await supabase
        .from("schools")
        .select("id, name, address, phone, email, curriculum, subscription_plan, academic_year, branch_sections")
        .eq("id", sid)
        .single();
      setSchool(schoolData);
      setEditSchool(schoolData);

      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, role, school_id")
        .eq("school_id", sid);
      setUsers(profilesData ?? []);
      await fetchParentLinks(sid);
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
      await supabase.from("role_permissions").delete().eq("school_id", schoolId);
      const { error } = await supabase.from("role_permissions").insert(upserts);
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
    const studentFieldsMissing = newRole === 'student' && (!newStudentRollNo.trim() || !newStudentClass.trim());
    if ((!newEmail.trim() && newRole !== 'student') || !newPassword.trim() || !newFullName.trim() || studentFieldsMissing) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (!schoolId) return;
    setCreating(true);
    try {
      // Students use register-student (Student ID → fake email), others use create-admin-user
      const isStudent = newRole === "student";
      const emailOrId = (newRole === 'student' ? newStudentRollNo : newEmail).trim().toLowerCase();
      const fakeEmail = isStudent ? `${emailOrId}@student.apas.local` : emailOrId;

      const { data, error } = await supabase.functions.invoke(
        "create-admin-user",
        {
          body: {
            email: fakeEmail,
            password: newPassword,
            full_name: newFullName.trim(),
            role: newRole,
            school_id: schoolId,
            ...(newRole === 'student' && {
              class: newStudentClass,
              section: newStudentSection,
              roll_number: newStudentRollNo,
              date_of_birth: newStudentDOB,
              parent_phone: newStudentParentPhone,
            }),
          },
        }
      );
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: `${newRole} account created`, description: newEmail });
      setCreateOpen(false);
      setNewEmail(""); setNewPassword(""); setNewFullName(""); setNewRole("teacher");
      setNewStudentClass(""); setNewStudentSection(""); setNewStudentRollNo(""); setNewStudentDOB(""); setNewStudentParentPhone("");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error creating account", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ── Unlink student from parent ──────────────────────────────────────────────
  const handleUnlinkChild = async (linkId: string) => {
    if (!confirm("Remove this child link?")) return;
    const { error } = await supabase.from("parent_students").delete().eq("id", linkId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Child unlinked" }); if (schoolId) fetchParentLinks(schoolId); }
  };

  // ── Link student to parent ──────────────────────────────────────────────────
  const handleLinkChild = async () => {
    if (!linkParentId || !linkStudentId) {
      toast({ title: "Please select a student", variant: "destructive" });
      return;
    }
    setLinking(true);
    const { error } = await supabase.from("parent_students").insert({
      parent_id: linkParentId,
      student_id: linkStudentId,
    });
    setLinking(false);
    if (error) {
      toast({ title: "Error linking child", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Child linked to parent ✅" });
      setLinkParentId(null);
      setLinkStudentId("");
    }
  };

  // ── Delete user permanently ─────────────────────────────────────────────────
  const handleDeleteUser = async (profileId: string) => {
    if (!confirm("Permanently delete this user from the school and app? This cannot be undone.")) return;
    const { error } = await supabase.rpc("delete_user_permanently", { p_user_id: profileId });
    if (error) toast({ title: "Error deleting user", description: error.message, variant: "destructive" });
    else { toast({ title: "User permanently deleted ✅" }); fetchAll(); }
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
      academic_year: editSchool.academic_year,
      branch_sections: editSchool.branch_sections,
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
<div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-500 to-blue-300 p-8 text-white mb-6">

  {/* Decorations */}
  <div className="hidden md:block absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>

  <div className="hidden md:block absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/60"></div>

  <div className="hidden md:block absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/60"></div>

  <div className="hidden md:block absolute top-12 left-[45%] text-white/80 text-xl">✦</div>

  <div className="hidden md:block absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>

  <div className="hidden md:block absolute top-24 right-[35%] text-white/80 text-lg">✦</div>

  <div className="hidden md:block absolute top-6 left-1/4 text-white/50 text-xl">✦</div>

  <div className="hidden md:block absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

  {/* Content */}
  <div className="relative z-10">

    <div className="flex items-center gap-3 mb-3">

      <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center">
        <ShieldCheck className="h-6 w-6 text-white" />
      </div>

      <div>
        <h1 className="text-3xl md:text-4xl font-bold">
          School Admin Panel
        </h1>

        <p className="text-blue-100 mt-1">
          {school?.name ?? "Loading..."} — Full School Management
        </p>
          <img
            src={schoolBanner}
            alt="School Banner"
            className="hidden md:block absolute right-5 -bottom-10 w-32"
          />        
      </div>

    </div>

  </div>

</div>
{/*         
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
        </div> */}

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview" className="gap-1.5  data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg"><BarChart3 className="h-5 w-5" />Overview</TabsTrigger>
            <TabsTrigger value="accounts" className="gap-1.5  data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg"><Users className="h-5 w-5" />Accounts</TabsTrigger>
            <TabsTrigger value="performance" className="gap-1.5  data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg"><TrendingUp className="h-5 w-5" />Performance</TabsTrigger>
            <TabsTrigger value="permissions" className="gap-1.5  data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg"><Lock className="h-5 w-5" />Permissions</TabsTrigger>
            <TabsTrigger value="school" className="gap-1.5  data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg"><School className="h-5 w-5" />School Info</TabsTrigger>
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
                <Card key={label}
  className={`group relative overflow-hidden border transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl
    ${label === "Teachers" ? "bg-blue-200 hover:border-blue-500" : ""}
    ${label === "Students" ? "bg-green-200 hover:border-green-500" : ""}
    ${label === "Principals" ? "bg-purple-200 hover:border-purple-500" : ""}
    ${label === "HODs" ? "bg-orange-200 hover:border-orange-500" : ""}
  `}>
                  <CardContent className="pt-6 pb-4 flex items-center gap-4">
                    <div className={`rounded-lg bg-muted p-2 ${color}`}>
                      <Icon className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="border-2 border-slate-200 hover:border-emerald-400 hover:shadow-xl transition-all duration-500 overflow-hidden">
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
                  <Button className="gap-1.5 bg-blue-600"><Plus className="h-4 w-4" />Create Account</Button>
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
                    {newRole === "student" ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Class</Label>
                            <Input placeholder="e.g. 10" value={newStudentClass} onChange={(e) => setNewStudentClass(e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Section</Label>
                            <Input placeholder="e.g. A" value={newStudentSection} onChange={(e) => setNewStudentSection(e.target.value)} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Roll Number / Student ID</Label>
                          <Input placeholder="e.g. STU2024001" value={newStudentRollNo} onChange={(e) => setNewStudentRollNo(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Date of Birth</Label>
                          <Input type="date" value={newStudentDOB} onChange={(e) => setNewStudentDOB(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Parent Phone Number</Label>
                          <Input placeholder="e.g. 9876543210" value={newStudentParentPhone} onChange={(e) => setNewStudentParentPhone(e.target.value)} />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label>Email</Label>
                        <Input type="email" placeholder="jane@school.edu" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                      </div>
                    )}
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

            {(["admin", "principal", "hod", "teacher", "student", "parent"] as const).map((role) => {
              const roleUsers = users.filter((u) => u.role === role);
              if (!roleUsers.length) return null;
              return (
                <Card key={role} className="border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all duration-500 overflow-hidden">
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
                          <TableRow key={u.id} className="group cursor-pointer transition-all duration-300 hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 hover:border-l-4 hover:border-l-blue-500">
                            <TableCell className="font-medium group-hover:text-blue-600 transition-colors duration-300">
                              {u.full_name ?? <span className="italic text-muted-foreground">Unnamed</span>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono group-hover:text-blue-500 transition-colors duration-300">{u.id.slice(0, 8)}…</TableCell>
                            <TableCell>
                              {role === "parent" && (
                                <div className="flex flex-col gap-1">
                                  {(parentLinks[u.id] ?? []).map(link => (
                                    <div key={link.id} className="flex items-center gap-1">
                                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{link.name}</span>
                                      <button onClick={() => handleUnlinkChild(link.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                                    </div>
                                  ))}
                                  <Button variant="outline" size="sm" className="mt-1 w-fit" onClick={() => { setLinkParentId(u.id); setLinkStudentId(""); }}>
                                    + Link Child
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="flex items-center gap-1">
                              {role === "parent" && (<span></span>)}
                              <Button variant="ghost" size="icon" className="hover:bg-red-100 hover:scale-110 transition-all duration-300" onClick={() => handleDeleteUser(u.id)}>
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

            {/* Link Child Dialog */}
            <Dialog open={!!linkParentId} onOpenChange={(o) => { if (!o) { setLinkParentId(null); setLinkStudentId(""); } }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Link Child to Parent</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <Label>Select Student</Label>
                    <Select value={linkStudentId} onValueChange={setLinkStudentId}>
                      <SelectTrigger><SelectValue placeholder="Choose a student" /></SelectTrigger>
                      <SelectContent>
                        {users.filter(u => u.role === "student").map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full" onClick={handleLinkChild} disabled={linking}>
                    {linking ? <LoadingSpinner size="sm" /> : "Link Child"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ══════════════════════════════════════════ PERFORMANCE */}
          <TabsContent value="performance" className="space-y-4">
            <Card className="border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all duration-500 overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><GraduationCap className="h-7 w-7 text-cyan-600" />Student Performance</CardTitle>
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
                          <TableRow key={s.student_id} className="group cursor-pointer transition-all duration-300 hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 hover:border-l-4 hover:border-l-blue-500">
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

            <Card className="border-2 border-slate-200 hover:border-green-400 hover:shadow-xl transition-all duration-500 overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-7 w-7 text-green-600" />Teacher Overview</CardTitle>
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
                          <TableRow key={t.teacher_id} className="group cursor-pointer transition-all duration-300 hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50 hover:border-l-4 hover:border-l-blue-500">
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
            <Card className="border-2 border-slate-200 hover:border-yellow-600 hover:shadow-xl transition-all duration-500 overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-7 w-7 text-yellow-600" />Role Permission Matrix
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
                  <Button onClick={savePermissions} disabled={permSaving} className="min-w-[140px] bg-blue-600">
                    {permSaving ? <LoadingSpinner size="sm" /> : "Save Permissions"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══════════════════════════════════════════ SCHOOL INFO */}
          <TabsContent value="school">
            <Card className="border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all duration-500 overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><School className="h-7 w-7 text-blue-600" />School Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-w-md">
                {editSchool && (
                  <>
                    {[
                      { label: "School Name", key: "name", type: "text" },
                      { label: "Address", key: "address", type: "text" },
                      { label: "Phone", key: "phone", type: "text" },
                      { label: "Email", key: "email", type: "email" },
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
                      <Label>Curriculum</Label>
                      <Select
                        value={editSchool.curriculum ?? ""}
                        onValueChange={(v) => setEditSchool({ ...editSchool, curriculum: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Select curriculum" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cbse">CBSE</SelectItem>
                          <SelectItem value="ib">IB</SelectItem>
                          <SelectItem value="cambridge">Cambridge</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Academic Year</Label>
                      <Select
                        value={editSchool.academic_year ?? ""}
                        onValueChange={(v) => setEditSchool({ ...editSchool, academic_year: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Select academic year" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2023-24">2023-24</SelectItem>
                          <SelectItem value="2024-25">2024-25</SelectItem>
                          <SelectItem value="2025-26">2025-26</SelectItem>
                          <SelectItem value="2026-27">2026-27</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Branch / Sections</Label>
                      <Select
                        value={editSchool.branch_sections ?? ""}
                        onValueChange={(v) => setEditSchool({ ...editSchool, branch_sections: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Main Campus">Main Campus</SelectItem>
                          <SelectItem value="North Branch">North Branch</SelectItem>
                          <SelectItem value="South Branch">South Branch</SelectItem>
                          <SelectItem value="East Branch">East Branch</SelectItem>
                          <SelectItem value="West Branch">West Branch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
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
                    <Button onClick={handleSaveSchool} disabled={savingSchool} className="bg-blue-600">
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
