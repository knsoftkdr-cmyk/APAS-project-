/**
 * KNSoftAdminPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Platform owner dashboard (KNSOFT Super Admin).
 * Can: create schools, assign school admins, monitor all schools,
 *      view AI usage, billing, subscriptions.
 *
 * Tabs:
 *  1. Overview     – all schools stats
 *  2. Schools      – create / manage schools
 *  3. Admins       – assign school admins
 *  4. AI Usage     – token usage across schools
 *  5. Billing      – subscription plans
 * ─────────────────────────────────────────────────────────────────────────────
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Building2, Users, BarChart3, CreditCard, Plus,
  ShieldCheck, Globe, Zap, TrendingUp, School,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SchoolRow {
  id: string;
  name: string;
  email: string | null;
  curriculum: string | null;
  subscription_plan: string | null;
  is_active: boolean | null;
  created_at: string | null;
  admin_name?: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string;
  school_id: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

const KNSoftAdminPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [allProfiles, setAllProfiles] = useState<ProfileRow[]>([]);

  // Create school dialog
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");
  const [newSchoolEmail, setNewSchoolEmail] = useState("");
  const [newSchoolCurriculum, setNewSchoolCurriculum] = useState("");
  const [newSchoolPlan, setNewSchoolPlan] = useState("basic");
  const [creatingSchool, setCreatingSchool] = useState(false);

  // Assign admin dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSchoolId, setAssignSchoolId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminName, setAdminName] = useState("");
  const [assigningAdmin, setAssigningAdmin] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // All schools
      const { data: schoolsData } = await supabase
        .from("schools")
        .select("id, name, email, curriculum, subscription_plan, is_active, created_at")
        .order("created_at", { ascending: false });

      // All school admins
      const { data: sadmins } = await supabase
        .from("school_admin_schools")
        .select("school_id, school_admin_id, profiles:school_admin_id(full_name)");

      const adminMap = new Map<string, string | null>();
      for (const row of (sadmins ?? []) as any[]) {
        adminMap.set(row.school_id, row.profiles?.full_name ?? null);
      }

      setSchools(
        (schoolsData ?? []).map((s: any) => ({
          ...s,
          admin_name: adminMap.get(s.id) ?? null,
        }))
      );

      // All profiles
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, role, school_id");
      setAllProfiles(profilesData ?? []);
    } catch (e: any) {
      toast({ title: "Error loading data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Create school ──────────────────────────────────────────────────────────
  const handleCreateSchool = async () => {
    if (!newSchoolName.trim()) {
      toast({ title: "School name is required", variant: "destructive" });
      return;
    }
    setCreatingSchool(true);
    try {
      const { error } = await supabase.from("schools").insert({
        name: newSchoolName.trim(),
        email: newSchoolEmail.trim() || null,
        curriculum: newSchoolCurriculum.trim() || null,
        subscription_plan: newSchoolPlan,
        is_active: true,
      });
      if (error) throw error;
      toast({ title: "School created successfully ✅" });
      setSchoolOpen(false);
      setNewSchoolName(""); setNewSchoolEmail("");
      setNewSchoolCurriculum(""); setNewSchoolPlan("basic");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error creating school", description: e.message, variant: "destructive" });
    } finally {
      setCreatingSchool(false);
    }
  };

  // ── Assign school admin ────────────────────────────────────────────────────
  const handleAssignAdmin = async () => {
    if (!adminEmail.trim() || !adminPassword.trim() || !adminName.trim() || !assignSchoolId) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    setAssigningAdmin(true);
    try {
      // Create auth user via edge function
      const { data, error } = await supabase.functions.invoke("create-admin-user", {
        body: {
          email: adminEmail.trim().toLowerCase(),
          password: adminPassword,
          full_name: adminName.trim(),
          role: "school_admin",
          school_id: assignSchoolId,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const userId = (data as any)?.user?.id;
      if (!userId) throw new Error("User creation failed");

      // Link to school_admin_schools
      const { error: linkError } = await supabase.from("school_admin_schools").insert({
        school_admin_id: userId,
        school_id: assignSchoolId,
      });
      if (linkError) throw linkError;

      // Seed default permissions for this school
      const { error: seedError } = await supabase.rpc("seed_default_permissions", {
        p_school_id: assignSchoolId,
      });
      if (seedError) console.warn("Seeding permissions failed:", seedError.message);

      toast({ title: "School Admin assigned successfully ✅" });
      setAssignOpen(false);
      setAdminEmail(""); setAdminPassword(""); setAdminName(""); setAssignSchoolId("");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error assigning admin", description: e.message, variant: "destructive" });
    } finally {
      setAssigningAdmin(false);
    }
  };

  // ── Toggle school active ───────────────────────────────────────────────────
  const toggleSchoolActive = async (schoolId: string, current: boolean) => {
    const { error } = await supabase
      .from("schools")
      .update({ is_active: !current })
      .eq("id", schoolId);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `School ${!current ? "activated" : "deactivated"}` }); fetchAll(); }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalStudents = allProfiles.filter(p => p.role === "student").length;
  const totalTeachers = allProfiles.filter(p => p.role === "teacher").length;
  const activeSchools = schools.filter(s => s.is_active !== false).length;

  const planColor = (plan: string | null) => {
    if (plan === "premium") return "bg-yellow-100 text-yellow-800";
    if (plan === "standard") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-700";
  };

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
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">KNSOFT Super Admin</h1>
            <p className="text-sm text-muted-foreground">Platform owner — manage all schools & subscriptions</p>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-4 w-4" />Overview</TabsTrigger>
            <TabsTrigger value="schools" className="gap-1.5"><Building2 className="h-4 w-4" />Schools</TabsTrigger>
            <TabsTrigger value="admins" className="gap-1.5"><ShieldCheck className="h-4 w-4" />Assign Admins</TabsTrigger>
            <TabsTrigger value="billing" className="gap-1.5"><CreditCard className="h-4 w-4" />Billing</TabsTrigger>
          </TabsList>

          {/* ════════════════════════════════════ OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Schools",   value: schools.length,  icon: Building2,  color: "text-blue-600" },
                { label: "Active Schools",  value: activeSchools,   icon: Globe,      color: "text-green-600" },
                { label: "Total Students",  value: totalStudents,   icon: Users,      color: "text-purple-600" },
                { label: "Total Teachers",  value: totalTeachers,   icon: TrendingUp, color: "text-orange-600" },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="pt-6 pb-4 flex items-center gap-4">
                    <div className={`rounded-lg bg-muted p-2 ${color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{value}</p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Subscription breakdown */}
            <Card>
              <CardHeader><CardTitle>Subscription Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {["basic", "standard", "premium"].map((plan) => {
                  const count = schools.filter(s => (s.subscription_plan ?? "basic") === plan).length;
                  return (
                    <div key={plan} className="flex justify-between text-sm">
                      <span className="capitalize text-muted-foreground">{plan}</span>
                      <Badge className={planColor(plan)}>{count} school{count !== 1 ? "s" : ""}</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════════════════════════ SCHOOLS */}
          <TabsContent value="schools" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">All Schools</h2>
              <Dialog open={schoolOpen} onOpenChange={setSchoolOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-1.5"><Plus className="h-4 w-4" />Create School</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Create New School</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label>School Name *</Label>
                      <Input placeholder="e.g. Excellencia School" value={newSchoolName} onChange={(e) => setNewSchoolName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" placeholder="admin@school.edu" value={newSchoolEmail} onChange={(e) => setNewSchoolEmail(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Curriculum</Label>
                      <Input placeholder="e.g. CBSE, IB, Cambridge" value={newSchoolCurriculum} onChange={(e) => setNewSchoolCurriculum(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Subscription Plan</Label>
                      <Select value={newSchoolPlan} onValueChange={setNewSchoolPlan}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="premium">Premium</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full" onClick={handleCreateSchool} disabled={creatingSchool}>
                      {creatingSchool ? <LoadingSpinner size="sm" /> : "Create School"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="p-0">
                {schools.length === 0
                  ? <p className="p-6 text-center text-muted-foreground">No schools yet.</p>
                  : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>School</TableHead>
                          <TableHead>Admin</TableHead>
                          <TableHead>Curriculum</TableHead>
                          <TableHead>Plan</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schools.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{s.admin_name ?? "—"}</TableCell>
                            <TableCell className="text-sm">{s.curriculum ?? "—"}</TableCell>
                            <TableCell>
                              <Badge className={planColor(s.subscription_plan)}>
                                {s.subscription_plan ?? "basic"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {s.is_active !== false
                                ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                                : <Badge variant="outline">Inactive</Badge>}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleSchoolActive(s.id, s.is_active !== false)}
                              >
                                {s.is_active !== false ? "Deactivate" : "Activate"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════════════════════════ ASSIGN ADMINS */}
          <TabsContent value="admins" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Assign School Admins</h2>
                <p className="text-sm text-muted-foreground">Create a School Admin account and link them to a school</p>
              </div>
              <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-1.5"><Plus className="h-4 w-4" />Assign Admin</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader><DialogTitle>Assign School Admin</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label>School *</Label>
                      <Select value={assignSchoolId} onValueChange={setAssignSchoolId}>
                        <SelectTrigger><SelectValue placeholder="Select school" /></SelectTrigger>
                        <SelectContent>
                          {schools.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Admin Full Name *</Label>
                      <Input placeholder="e.g. John Smith" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Admin Email *</Label>
                      <Input type="email" placeholder="admin@school.edu" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password *</Label>
                      <Input type="password" placeholder="Min 8 characters" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                    </div>
                    <Button className="w-full" onClick={handleAssignAdmin} disabled={assigningAdmin}>
                      {assigningAdmin ? <LoadingSpinner size="sm" /> : "Create & Assign Admin"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardHeader><CardTitle>Current School Admins</CardTitle></CardHeader>
              <CardContent className="p-0">
                {schools.filter(s => s.admin_name).length === 0
                  ? <p className="p-6 text-center text-muted-foreground">No admins assigned yet.</p>
                  : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>School</TableHead>
                          <TableHead>Admin</TableHead>
                          <TableHead>Plan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schools.filter(s => s.admin_name).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{s.name}</TableCell>
                            <TableCell>{s.admin_name}</TableCell>
                            <TableCell>
                              <Badge className={planColor(s.subscription_plan)}>
                                {s.subscription_plan ?? "basic"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════════════════════════ BILLING */}
          <TabsContent value="billing" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />Subscription Overview
                </CardTitle>
                <CardDescription>All school subscription plans</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>School</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Since</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schools.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>
                          <Badge className={planColor(s.subscription_plan)}>
                            {s.subscription_plan ?? "basic"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {s.is_active !== false
                            ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                            : <Badge variant="outline">Inactive</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default KNSoftAdminPanel;
