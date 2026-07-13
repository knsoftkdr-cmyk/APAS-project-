import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Trophy, Crown, Users, Loader2, Shield, Award, UserPlus } from "lucide-react";

interface House {
  id: string;
  name: string;
  code?: string;
  color: string;
  description?: string;
  house_captain?: string;
  vice_captain?: string;
  teacher_incharge?: string;
  total_points: number;
}

export default function HouseManagement() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [houses, setHouses] = useState<House[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // Dialog States
  const [viewHouse, setViewHouse] = useState<House | null>(null);
  const [assignHouse, setAssignHouse] = useState<House | null>(null);
  const [pointsHouse, setPointsHouse] = useState<House | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingHouse, setEditingHouse] = useState<House | null>(null);

  // Form Fields
  const [form, setForm] = useState({
    name: "",
    code: "",
    color: "#3b82f6",
    description: "",
    house_captain: "__none__",
    vice_captain: "__none__",
    teacher_incharge: "__none__"
  });

  // Filter & Assignment States
  const [captainClassFilter, setCaptainClassFilter] = useState("all");
  const [viceCaptainClassFilter, setViceCaptainClassFilter] = useState("all");
  const [assignClassFilter, setAssignClassFilter] = useState("all");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  // Action Loading Indicators
  const [savingAssign, setSavingAssign] = useState(false);
  const [savingPoints, setSavingPoints] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pointsValue, setPointsValue] = useState("");
  const [pointsRemark, setPointsRemark] = useState("");

// Data Pipeline Link with Debug Logs
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);

        const { data: housesData, error: housesErr } = await supabase
          .from("houses")
          .select("*");
        if (housesErr) throw housesErr;

        const { data: profilesData, error: profilesErr } = await supabase
          .from("profiles")
          .select("*");
        if (profilesErr) throw profilesErr;

        // 🔍 DEBUG LOGS: Open your browser inspect console to see these!
        console.log("--- DEBUGGING SUPABASE REAL DATA ---");
        console.log("1. Raw House Row Example:", housesData?.[0]);
        console.log("2. Raw Profile Row Example:", profilesData?.find(p => p.role?.toLowerCase() === "student") || profilesData?.[0]);
        console.log("------------------------------------");

        const fetchedStudents = profilesData?.filter((p) => p.role?.toLowerCase() === "student") || [];
        const fetchedTeachers = profilesData?.filter((p) => 
          p.role?.toLowerCase() === "teacher" || 
          p.role?.toLowerCase() === "admin" || 
          p.role?.toLowerCase() === "staff"
        ) || [];
        
        const currentUserProfile = profilesData?.find((p) => p.id === user?.id);
        setIsAdmin(currentUserProfile?.role?.toLowerCase() === "admin");

        const mappedHouses = (housesData || []).map(house => {
          // Double check common naming variations for house relationships
          const houseIdKey = house.id;
          const studentCount = fetchedStudents.filter((s) => 
            String(s.house_id) === String(houseIdKey) || 
            String(s.house) === String(house.name)
          ).length;

          // Try standard total_points, fallback to points, fallback to 0
          const housePoints = house.total_points !== undefined ? house.total_points : (house.points || 0);
          
          return {
            ...house,
            total_points: housePoints,
            student_count: studentCount,
            house_captain: house.house_captain || house.captain_id || "__none__",
            vice_captain: house.vice_captain || house.vice_captain_id || "__none__",
            teacher_incharge: house.teacher_incharge || house.teacher_id || "__none__"
          };
        });

        const computedLeaderboard = mappedHouses.map((house) => ({
          house_id: house.id,
          name: house.name,
          color: house.color,
          total_points: house.total_points,
          student_count: house.student_count
        }));

        setHouses(mappedHouses);
        setStudents(fetchedStudents);
        setTeachers(fetchedTeachers);
        setLeaderboard(computedLeaderboard);
      } catch (err: any) {
        console.error("Fetch failure:", err);
        toast.error("Could not load latest platform data");
      } finally {
        setLoading(false);
      }
    }
    if (user) loadData();
  }, [user]);

  // Aggregate Computation Data
  const totalStudents = students.length;
  const totalPoints = houses.reduce((acc, h) => acc + (h.total_points || 0), 0);
  const maxPoints = Math.max(...houses.map((h) => h.total_points || 0), 1);
  const championHouse = houses.length > 0 
    ? [...houses].sort((a, b) => (b.total_points || 0) - (a.total_points || 0))[0] 
    : null;

  // Formatting & Validation Utilities
  const getName = (id: string | undefined, list: any[]) => {
    if (!id || id === "__none__") return "";
    return list.find((p) => p.id === id)?.full_name || "";
  };

  const classSectionLabel = (s: any) => (s.class_grade ? `${s.class_grade}-${s.section || ""}` : "");
  const classSectionKey = (s: any) => (s.class_grade ? `${s.class_grade}_${s.section || ""}` : "");
  const canManageHouse = (h: House) => isAdmin;
  const canAwardPoints = (h: House) => isAdmin;

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  // State Triggers
  const openAdd = () => {
    setEditingHouse(null);
    setForm({ name: "", code: "", color: "#3b82f6", description: "", house_captain: "__none__", vice_captain: "__none__", teacher_incharge: "__none__" });
    setShowForm(true);
  };

  const openEdit = (h: House) => {
    setEditingHouse(h);
    setForm({
      name: h.name,
      code: h.code || "",
      color: h.color,
      description: h.description || "",
      house_captain: h.house_captain || "__none__",
      vice_captain: h.vice_captain || "__none__",
      teacher_incharge: h.teacher_incharge || "__none__"
    });
    setShowForm(true);
  };

  const openAssign = (h: House) => {
    setAssignHouse(h);
    setSelectedStudentIds(new Set(students.filter((s) => s.house_id === h.id).map((s) => s.id)));
  };

  // Operation Actions
  const saveAssignment = async () => {};
  const savePoints = async () => {};
  const saveHouse = async () => {};
  const deleteHouse = async (h: House) => {};

  return (
    <AppLayout>
      <div
        className="min-h-screen"
        style={{
          background: `
            radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 35%),
            radial-gradient(circle at top right, rgba(168,85,247,0.12), transparent 35%),
            radial-gradient(circle at bottom left, rgba(34,197,94,0.08), transparent 35%),
            linear-gradient(180deg,#f8fbff 0%,#eef5ff 100%)
          `,
        }}
      >
        <div className="max-w-7xl mx-auto p-8 space-y-8">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">🏆 House Management</h1>
              <p className="text-gray-500 mt-2 text-lg">
                Manage school houses, captains, competitions and points.
              </p>
            </div>
            {isAdmin && (
              <Button onClick={openAdd} className="rounded-xl px-6 py-6 text-base shadow-lg">
                <Plus className="mr-2 h-5 w-5" />
                Add House
              </Button>
            )}
          </div>

          {/* Dashboard Statistics */}
          {!loading && houses.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <Card className="rounded-3xl border-0 bg-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <CardContent className="p-5 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Houses</p>
                    <h2 className="text-3xl font-bold mt-1">{houses.length}</h2>
                  </div>
                  <div className="bg-gradient-to-r from-blue-500 to-cyan-500 p-4 rounded-2xl text-white shadow-lg">
                    <Trophy className="h-6 w-6 text-blue-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 bg-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <CardContent className="p-5 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">Students</p>
                    <h2 className="text-3xl font-bold mt-1">{totalStudents}</h2>
                  </div>
                  <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-3 rounded-xl">
                    <Users className="h-6 w-6 text-green-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 bg-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <CardContent className="p-5 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Points</p>
                    <h2 className="text-3xl font-bold mt-1">{totalPoints}</h2>
                  </div>
                  <div className="bg-yellow-100 p-3 rounded-xl">
                    <Award className="h-6 w-6 text-yellow-600" />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 bg-white shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <CardContent className="p-5 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">Champion</p>
                    <h2 className="text-xl font-bold mt-1">{championHouse?.name ?? "-"}</h2>
                  </div>
                  <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-3 rounded-xl">
                    <Crown className="h-6 w-6 text-purple-600" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Main Visual Panels */}
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : houses.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Trophy className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium">No houses set up yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isAdmin ? "Create your school's first house to get started." : "Your school admin hasn't set up houses yet."}
                </p>
                {isAdmin && (
                  <Button className="mt-4" onClick={openAdd}>
                    <Plus className="h-4 w-4 mr-2" /> Add House
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Leaderboard Section */}
              <Card className="rounded-3xl border-0 bg-white shadow-xl hover:shadow-2xl transition-all duration-300">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-xl font-bold">🏆 House Rankings</CardTitle>
                  <p className="text-sm text-muted-foreground">Live standings based on total house points</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  {[...leaderboard]
                    .sort((a, b) => b.total_points - a.total_points)
                    .map((row, idx) => (
                      <div key={row.house_id} className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition">
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold"
                              style={{ backgroundColor: row.color }}
                            >
                              {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
                            </div>
                            <div>
                              <h3 className="font-semibold text-lg">{row.name}</h3>
                              <p className="text-sm text-muted-foreground">{row.student_count} Students</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <h2 className="text-2xl font-bold">{row.total_points}</h2>
                            <p className="text-xs text-muted-foreground">Points</p>
                          </div>
                        </div>
                        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${(row.total_points / maxPoints) * 100}%`,
                              backgroundColor: row.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>

              {/* Individual House Module Units */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {houses.map((h) => (
                  <Card
                    key={h.id}
                    className={cn(
                      "overflow-hidden rounded-3xl border-0 shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300",
                      canManageHouse(h) && "cursor-pointer"
                    )}
                    onClick={() => { if (canManageHouse(h)) setViewHouse(h); }}
                  >
                    <div className="p-5 text-white" style={{ background: `linear-gradient(135deg, ${h.color}, ${h.color}CC)` }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-2xl font-bold">{h.name}</h2>
                          {h.code && <p className="text-white/80 mt-1">{h.code}</p>}
                        </div>
                        <div className="bg-white/20 p-4 rounded-2xl">
                          <Trophy className="h-8 w-8" />
                        </div>
                      </div>
                    </div>
                    <CardHeader className="pb-0 pt-4">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {canManageHouse(h) && (
                          <Button size="icon" variant="outline" onClick={() => openAssign(h)}>
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        )}
                        {canAwardPoints(h) && (
                          <Button size="icon" variant="outline" onClick={() => setPointsHouse(h)}>
                            <Award className="h-4 w-4" />
                          </Button>
                        )}
                        {isAdmin && (
                          <>
                            <Button size="icon" variant="outline" onClick={() => openEdit(h)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="destructive" onClick={() => deleteHouse(h)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="space-y-5">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-xl bg-yellow-100 flex items-center justify-center">
                            <Crown className="h-6 w-6 text-yellow-600" />
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Captain</p>
                            <p className="font-semibold text-base">{getName(h.house_captain, students) || "Not Assigned"}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center">
                            <Shield className="h-6 w-6 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Vice Captain</p>
                            <p className="font-semibold text-base">{getName(h.vice_captain, students) || "Not Assigned"}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center">
                            <Users className="h-6 w-6 text-green-600" />
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Teacher In-charge</p>
                            <p className="font-semibold text-base">{getName(h.teacher_incharge, teachers) || "Not Assigned"}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-3">
                          <div className="rounded-2xl bg-slate-50 p-4 text-center">
                            <p className="text-xs text-muted-foreground">Students</p>
                            <h3 className="text-2xl font-bold mt-1">
                              {leaderboard.find((x) => x.house_id === h.id)?.student_count ?? 0}
                            </h3>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-4 text-center">
                            <p className="text-xs text-muted-foreground">Points</p>
                            <h3 className="text-2xl font-bold mt-1">{h.total_points}</h3>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* View Students Modal Dialog */}
      <Dialog open={!!viewHouse} onOpenChange={(open) => !open && setViewHouse(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: viewHouse?.color }} />
              {viewHouse?.name} Students
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {(() => {
              const houseStudents = students
                .filter((s) => s.house_id === viewHouse?.id)
                .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
              if (houseStudents.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-8">No students assigned to this house yet.</p>;
              }
              return (
                <div className="border rounded-md divide-y">
                  {houseStudents.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>{s.full_name ?? "Unnamed"}</span>
                      <span className="text-xs text-muted-foreground">{classSectionLabel(s)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="text-xs text-muted-foreground mt-2">
              {students.filter((s) => s.house_id === viewHouse?.id).length} student(s) total
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Student Registry Matrix */}
      <Dialog open={!!assignHouse} onOpenChange={(open) => !open && setAssignHouse(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Students {assignHouse?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label>Filter by Class</Label>
              <Select value={assignClassFilter} onValueChange={setAssignClassFilter}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {Array.from(new Map(
                    students.filter((s) => s.class_grade).map((s) => [classSectionKey(s), classSectionLabel(s)])
                  ).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
              {students
                .filter((s) => assignClassFilter === "all" || classSectionKey(s) === assignClassFilter)
                .map((s) => {
                  const currentHouseName = s.house_id ? houses.find((h) => h.id === s.house_id)?.name : null;
                  return (
                    <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                      <Checkbox checked={selectedStudentIds.has(s.id)} onCheckedChange={() => toggleStudent(s.id)} />
                      <span className="flex-1">{s.full_name ?? "Unnamed"}</span>
                      {s.class_grade && <span className="text-xs text-muted-foreground">{classSectionLabel(s)}</span>}
                      {currentHouseName && <Badge variant="outline" className="text-[10px]">{currentHouseName}</Badge>}
                    </label>
                  );
                })}
              {students.filter((s) => assignClassFilter === "all" || classSectionKey(s) === assignClassFilter).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No students found</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{selectedStudentIds.size} selected</p>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setAssignHouse(null)}>Cancel</Button>
              <Button onClick={saveAssignment} disabled={savingAssign || selectedStudentIds.size === 0}>
                {savingAssign && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Assign to {assignHouse?.name}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Award & Deduct Score Adjustments */}
      <Dialog open={!!pointsHouse} onOpenChange={(open) => !open && setPointsHouse(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Award Points {pointsHouse?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Points (use negative to deduct)</Label>
              <Input className="mt-1" type="number" value={pointsValue} onChange={(e) => setPointsValue(e.target.value)} placeholder="e.g. 10 or -5" />
            </div>
            <div>
              <Label>Remarks (optional)</Label>
              <Textarea className="mt-1" rows={2} value={pointsRemark} onChange={(e) => setPointsRemark(e.target.value)} placeholder="e.g. Won inter-house quiz" />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setPointsHouse(null)}>Cancel</Button>
              <Button onClick={savePoints} disabled={savingPoints}>
                {savingPoints && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Award Points
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Structural Master Creation & Editing Form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingHouse ? "Edit House" : "Add House"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>House Name *</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Phoenix House" />
            </div>
            <div>
              <Label>Code (optional)</Label>
              <Input className="mt-1" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="e.g. PHX" maxLength={6} />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="h-7 w-10 p-0.5" />
              </div>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea className="mt-1" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Symbol of courage and resilience" />
            </div>
            <div>
              <Label>House Captain</Label>
              <Select value={captainClassFilter} onValueChange={setCaptainClassFilter}>
                <SelectTrigger className="mt-1 mb-2"><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                </SelectContent>
              </Select>
              <Select value={form.house_captain} onValueChange={(v) => setForm((f) => ({ ...f, house_captain: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vice Captain</Label>
              <Select value={viceCaptainClassFilter} onValueChange={setViceCaptainClassFilter}>
                <SelectTrigger className="mt-1 mb-2"><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                </SelectContent>
              </Select>
              <Select value={form.vice_captain} onValueChange={(v) => setForm((f) => ({ ...f, vice_captain: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Teacher In-charge</Label>
              <Select value={form.teacher_incharge} onValueChange={(v) => setForm((f) => ({ ...f, teacher_incharge: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={saveHouse} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingHouse ? "Update House" : "Create House"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}