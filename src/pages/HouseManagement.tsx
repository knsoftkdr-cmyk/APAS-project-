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
  school_id: string;
  name: string;
  code: string | null;
  color: string;
  description: string | null;
  house_captain: string | null;
  vice_captain: string | null;
  teacher_incharge: string | null;
  total_points: number;
  status: string;
}

interface LeaderboardRow {
  house_id: string;
  name: string;
  color: string;
  code: string | null;
  total_points: number;
  student_count: number;
}

interface ProfileOption {
  id: string;
  full_name: string | null;
  class_grade?: string | null; // for students: maps to students.class
  section?: string | null;
  house_id?: string | null;
}

const EMPTY_FORM = {
  name: "",
  code: "",
  color: "#6366F1",
  description: "",
  house_captain: "__none__",
  vice_captain: "__none__",
  teacher_incharge: "__none__",
};

const PRESET_COLORS = ["#EF4444", "#3B82F6", "#22C55E", "#EAB308", "#A855F7", "#F97316", "#14B8A6", "#EC4899"];

export default function HouseManagement() {
  const { profile } = useAuth();
  const isAdmin = ["admin", "principal", "school_admin"].includes(profile?.role ?? "");

  const [houses, setHouses] = useState<House[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [students, setStudents] = useState<ProfileOption[]>([]);
  const [teachers, setTeachers] = useState<ProfileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingHouse, setEditingHouse] = useState<House | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [captainClassFilter, setCaptainClassFilter] = useState("all");
  const [viceCaptainClassFilter, setViceCaptainClassFilter] = useState("all");
  const [pointsHouse, setPointsHouse] = useState<House | null>(null);
  const [pointsValue, setPointsValue] = useState("");
  const [pointsRemark, setPointsRemark] = useState("");
  const [savingPoints, setSavingPoints] = useState(false);
  const [viewHouse, setViewHouse] = useState<House | null>(null);
  const [assignHouse, setAssignHouse] = useState<House | null>(null);
  const [assignClassFilter, setAssignClassFilter] = useState("all");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [savingAssign, setSavingAssign] = useState(false);

  const fetchAll = async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    const [housesRes, leaderboardRes, studentsRes, teachersRes] = await Promise.all([
      supabase.from("houses").select("*").eq("school_id", profile.school_id).order("created_at"),
      supabase.from("house_leaderboard").select("*").eq("school_id", profile.school_id),
      supabase.from("students").select("id, full_name, class, section, house_id").eq("school_id", profile.school_id).order("full_name"),
      supabase.from("profiles").select("id, full_name").eq("school_id", profile.school_id).eq("role", "teacher").order("full_name"),
    ]);
    setHouses((housesRes.data as House[]) || []);
    setLeaderboard((leaderboardRes.data as LeaderboardRow[]) || []);
    setStudents(((studentsRes.data as any[]) || []).map(s => ({ id: s.id, full_name: s.full_name, class_grade: s.class, section: s.section, house_id: s.house_id })));
    setTeachers((teachersRes.data as ProfileOption[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [profile?.school_id]);

  const openAdd = () => {
    setEditingHouse(null);
    setForm({ ...EMPTY_FORM, color: PRESET_COLORS[houses.length % PRESET_COLORS.length] });
    setCaptainClassFilter("all");
    setViceCaptainClassFilter("all");
    setShowForm(true);
  };

  const openEdit = (h: House) => {
    setEditingHouse(h);
    setForm({
      name: h.name,
      code: h.code || "",
      color: h.color || "#6366F1",
      description: h.description || "",
      house_captain: h.house_captain || "__none__",
      vice_captain: h.vice_captain || "__none__",
      teacher_incharge: h.teacher_incharge || "__none__",
    });
    setCaptainClassFilter("all");
    setViceCaptainClassFilter("all");
    setShowForm(true);
  };

  const saveHouse = async () => {
    if (!form.name.trim()) { toast.error("House name is required"); return; }
    setSaving(true);
    const payload = {
      school_id: profile!.school_id,
      name: form.name.trim(),
      code: form.code.trim() || form.name.trim().slice(0, 4).toUpperCase(),
      color: form.color,
      description: form.description.trim() || null,
      house_captain: form.house_captain === "__none__" ? null : form.house_captain,
      vice_captain: form.vice_captain === "__none__" ? null : form.vice_captain,
      teacher_incharge: form.teacher_incharge === "__none__" ? null : form.teacher_incharge,
    };
    const { error } = editingHouse
      ? await supabase.from("houses").update(payload).eq("id", editingHouse.id)
      : await supabase.from("houses").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editingHouse ? "House updated" : "House created");
    setShowForm(false);
    fetchAll();
  };

  const deleteHouse = async (h: House) => {
    if (!confirm(`Delete "${h.name}"? Students assigned to this house will become unassigned. This cannot be undone.`)) return;
    const { error } = await supabase.from("houses").delete().eq("id", h.id);
    if (error) { toast.error(error.message); return; }
    toast.success("House deleted");
    fetchAll();
  };

  const classSectionLabel = (s: ProfileOption) => {
    const cls = s.class_grade ? (/^\d+$/.test(s.class_grade) ? `Class ${s.class_grade}` : s.class_grade.charAt(0).toUpperCase() + s.class_grade.slice(1)) : "";
    return s.section ? `${cls} - ${s.section}` : cls;
  };
  const classSectionKey = (s: ProfileOption) => `${(s.class_grade ?? "").toLowerCase()}__${(s.section ?? "").toLowerCase()}`;

  const canAwardPoints = (h: House) => isAdmin || (profile?.role === "teacher" && h.teacher_incharge === profile?.id);
  const canManageHouse = (h: House) => isAdmin || (profile?.role === "teacher" && h.teacher_incharge === profile?.id);

  const openAssign = (h: House) => {
    setAssignHouse(h);
    setAssignClassFilter("all");
    setSelectedStudentIds(new Set());
  };

  const toggleStudent = (id: string) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveAssignment = async () => {
    if (!assignHouse || selectedStudentIds.size === 0) { toast.error("Select at least one student"); return; }
    setSavingAssign(true);
    const { error } = await supabase
      .from("students")
      .update({ house_id: assignHouse.id })
      .in("id", Array.from(selectedStudentIds));
    setSavingAssign(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${selectedStudentIds.size} student(s) assigned to ${assignHouse.name}`);
    setAssignHouse(null);
    setSelectedStudentIds(new Set());
    fetchAll();
  };

  const savePoints = async () => {
    if (!pointsHouse) return;
    const pts = parseInt(pointsValue, 10);
    if (isNaN(pts) || pts === 0) { toast.error("Enter a valid non-zero point value"); return; }
    setSavingPoints(true);
    const { error } = await supabase.from("house_points").insert({
      house_id: pointsHouse.id,
      points: pts,
      remarks: pointsRemark.trim() || null,
      awarded_by: profile!.id,
    });
    setSavingPoints(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${pts > 0 ? "+" : ""}${pts} points awarded to ${pointsHouse.name}`);
    setPointsHouse(null);
    setPointsValue("");
    setPointsRemark("");
    fetchAll();
  };

  const getName = (id: string | null, list: ProfileOption[]) => {
    if (!id) return null;
    return list.find(p => p.id === id)?.full_name ?? "Unknown";
  };

  const maxPoints = Math.max(1, ...leaderboard.map(l => l.total_points));

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">House Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage houses, captains, and points for your school</p>
          </div>
          {isAdmin && (
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" /> Add House
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
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
            {/* Leaderboard */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-5 w-5 text-amber-500" /> House Leaderboard
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[...leaderboard].sort((a, b) => b.total_points - a.total_points).map((row, idx) => (
                  <div key={row.house_id} className="flex items-center gap-3">
                    <span className="text-sm font-semibold w-6 text-muted-foreground">#{idx + 1}</span>
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                    <span className="text-sm font-medium w-28 truncate">{row.name}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(row.total_points / maxPoints) * 100}%`, backgroundColor: row.color }}
                      />
                    </div>
                    <span className="text-sm font-semibold w-16 text-right">{row.total_points} pts</span>
                    <span className="text-xs text-muted-foreground w-20 text-right">{row.student_count} students</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* House Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {houses.map(h => (
                <Card
                  key={h.id}
                  className={cn("overflow-hidden", canManageHouse(h) && "cursor-pointer hover:shadow-md transition-shadow")}
                  onClick={() => { if (canManageHouse(h)) setViewHouse(h); }}
                >
                  <div className="h-1.5" style={{ backgroundColor: h.color }} />
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: h.color }} />
                          {h.name}
                          {h.code && <Badge variant="outline" className="text-[10px]">{h.code}</Badge>}
                        </CardTitle>
                        {h.description && <p className="text-xs text-muted-foreground mt-1">{h.description}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        {canManageHouse(h) && (
                          <button onClick={() => openAssign(h)} className="p-1.5 rounded hover:bg-muted transition-colors text-blue-600" title="Assign students">
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canAwardPoints(h) && (
                          <button onClick={() => setPointsHouse(h)} className="p-1.5 rounded hover:bg-muted transition-colors text-amber-600" title="Award points">
                            <Award className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button onClick={() => openEdit(h)} className="p-1.5 rounded hover:bg-muted transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => deleteHouse(h)} className="p-1.5 rounded hover:bg-muted transition-colors text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Crown className="h-3.5 w-3.5" />
                      <span>Captain: {getName(h.house_captain, students) ?? <span className="italic">Not assigned</span>}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Shield className="h-3.5 w-3.5" />
                      <span>Vice Captain: {getName(h.vice_captain, students) ?? <span className="italic">Not assigned</span>}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>Teacher In-charge: {getName(h.teacher_incharge, teachers) ?? <span className="italic">Not assigned</span>}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* View Students Dialog */}
      <Dialog open={!!viewHouse} onOpenChange={(open) => !open && setViewHouse(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: viewHouse?.color }} />
              {viewHouse?.name} — Students
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {(() => {
              const houseStudents = students
                .filter(s => s.house_id === viewHouse?.id)
                .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
              if (houseStudents.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-8">No students assigned to this house yet.</p>;
              }
              return (
                <div className="border rounded-md divide-y">
                  {houseStudents.map(s => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>{s.full_name ?? "Unnamed"}</span>
                      <span className="text-xs text-muted-foreground">{classSectionLabel(s)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="text-xs text-muted-foreground mt-2">
              {students.filter(s => s.house_id === viewHouse?.id).length} student(s) total
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Students Dialog */}
      <Dialog open={!!assignHouse} onOpenChange={(open) => !open && setAssignHouse(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Students — {assignHouse?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label>Filter by Class</Label>
              <Select value={assignClassFilter} onValueChange={setAssignClassFilter}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {Array.from(new Map(
                    students.filter(s => s.class_grade).map(s => [classSectionKey(s), classSectionLabel(s)])
                  ).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
              {students
                .filter(s => assignClassFilter === "all" || classSectionKey(s) === assignClassFilter)
                .map(s => {
                  const currentHouseName = s.house_id ? houses.find(h => h.id === s.house_id)?.name : null;
                  return (
                    <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                      <Checkbox checked={selectedStudentIds.has(s.id)} onCheckedChange={() => toggleStudent(s.id)} />
                      <span className="flex-1">{s.full_name ?? "Unnamed"}</span>
                      {s.class_grade && <span className="text-xs text-muted-foreground">{classSectionLabel(s)}</span>}
                      {currentHouseName && (
                        <Badge variant="outline" className="text-[10px]">{currentHouseName}</Badge>
                      )}
                    </label>
                  );
                })}
              {students.filter(s => assignClassFilter === "all" || classSectionKey(s) === assignClassFilter).length === 0 && (
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

      {/* Award Points Dialog */}
      <Dialog open={!!pointsHouse} onOpenChange={(open) => !open && setPointsHouse(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Award Points — {pointsHouse?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Points (use negative to deduct)</Label>
              <Input className="mt-1" type="number" value={pointsValue} onChange={e => setPointsValue(e.target.value)} placeholder="e.g. 10 or -5" />
            </div>
            <div>
              <Label>Remarks (optional)</Label>
              <Textarea className="mt-1" rows={2} value={pointsRemark} onChange={e => setPointsRemark(e.target.value)} placeholder="e.g. Won inter-house quiz" />
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

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingHouse ? "Edit House" : "Add House"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>House Name *</Label>
              <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Phoenix House" />
            </div>
            <div>
              <Label>Code (optional)</Label>
              <Input className="mt-1" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="e.g. PHX" maxLength={6} />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`h-7 w-7 rounded-full border-2 transition-all ${form.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <Input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="h-7 w-10 p-0.5" />
              </div>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea className="mt-1" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Symbol of courage and resilience" />
            </div>
            <div>
              <Label>House Captain</Label>
              <Select value={captainClassFilter} onValueChange={setCaptainClassFilter}>
                <SelectTrigger className="mt-1 mb-2"><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {Array.from(new Map(
                    students.filter(s => s.class_grade).map(s => [classSectionKey(s), classSectionLabel(s)])
                  ).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.house_captain} onValueChange={v => setForm(f => ({ ...f, house_captain: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned</SelectItem>
                  {students
                    .filter(s => captainClassFilter === "all" || classSectionKey(s) === captainClassFilter)
                    .map(s => <SelectItem key={s.id} value={s.id}>{s.full_name ?? "Unnamed"} ({classSectionLabel(s)})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vice Captain</Label>
              <Select value={viceCaptainClassFilter} onValueChange={setViceCaptainClassFilter}>
                <SelectTrigger className="mt-1 mb-2"><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {Array.from(new Map(
                    students.filter(s => s.class_grade).map(s => [classSectionKey(s), classSectionLabel(s)])
                  ).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.vice_captain} onValueChange={v => setForm(f => ({ ...f, vice_captain: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned</SelectItem>
                  {students
                    .filter(s => viceCaptainClassFilter === "all" || classSectionKey(s) === viceCaptainClassFilter)
                    .map(s => <SelectItem key={s.id} value={s.id}>{s.full_name ?? "Unnamed"} ({classSectionLabel(s)})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Teacher In-charge</Label>
              <Select value={form.teacher_incharge} onValueChange={v => setForm(f => ({ ...f, teacher_incharge: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned</SelectItem>
                  {teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.full_name ?? "Unnamed"}</SelectItem>)}
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
