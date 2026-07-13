import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client"; // adjust path if your client lives elsewhere
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Pencil, RotateCw, Users, Layers, Clock3 } from "lucide-react";

// ---------- Types ----------
interface RotationCycle {
  id: string;
  school_id: string;
  name: string;
  cadence_type: "weekly" | "termly" | "custom";
  cycle_length_days: number;
  split_mode: "whole_class" | "sub_group";
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

interface RotationBlock {
  id: string;
  rotation_cycle_id: string;
  block_name: string;
  subject: string;
  teacher_id: string | null;
  room: string | null;
  sequence_order: number;
}

interface RotationGroup {
  id: string;
  rotation_cycle_id: string;
  class_grade: string;
  section: string;
  group_name: string;
  group_sequence_order: number;
}

interface RotationSlot {
  id: string;
  rotation_cycle_id: string;
  day_of_week: string;
  period_number: number;
}

interface Teacher {
  id: string;
  full_name: string;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const emptyCycleForm = {
  name: "",
  cadence_type: "weekly" as RotationCycle["cadence_type"],
  cycle_length_days: 7,
  split_mode: "whole_class" as RotationCycle["split_mode"],
  start_date: new Date().toISOString().slice(0, 10),
};
const emptyBlockForm = { block_name: "", subject: "", teacher_id: "", room: "" };
const emptyGroupForm = { class_grade: "", section: "", group_name: "" };
const emptySlotForm = { day_of_week: "monday", period_number: 1 };

export default function RotationScheduleManagement() {
  const { profile } = useAuth(); // expects { school_id, role, id }
  const schoolId = profile?.school_id;

  const [cycles, setCycles] = useState<RotationCycle[]>([]);
  const [selectedCycle, setSelectedCycle] = useState<RotationCycle | null>(null);
  const [blocks, setBlocks] = useState<RotationBlock[]>([]);
  const [groups, setGroups] = useState<RotationGroup[]>([]);
  const [slots, setSlots] = useState<RotationSlot[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------- Fetch cycles ----------
  const fetchCycles = useCallback(async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from("rotation_cycles")
      .select("*")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load rotation cycles");
      return;
    }
    setCycles(data ?? []);
    setLoading(false);
    // Keep selectedCycle in sync with fresh data (e.g. after an edit)
    setSelectedCycle((prev) => (prev ? data?.find((c) => c.id === prev.id) ?? prev : prev));
  }, [schoolId]);

  // ---------- Fetch teachers (for block assignment) ----------
  const fetchTeachers = useCallback(async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("school_id", schoolId)
      .eq("role", "teacher");
    if (!error) setTeachers(data ?? []);
  }, [schoolId]);

  useEffect(() => {
    fetchCycles();
    fetchTeachers();
  }, [fetchCycles, fetchTeachers]);

  // ---------- Fetch children of a selected cycle ----------
  const fetchCycleDetails = useCallback(async (cycleId: string) => {
    const [blocksRes, groupsRes, slotsRes] = await Promise.all([
      supabase.from("rotation_blocks").select("*").eq("rotation_cycle_id", cycleId).order("sequence_order"),
      supabase.from("rotation_groups").select("*").eq("rotation_cycle_id", cycleId).order("group_sequence_order"),
      supabase.from("rotation_slots").select("*").eq("rotation_cycle_id", cycleId),
    ]);
    if (blocksRes.error || groupsRes.error || slotsRes.error) {
      toast.error("Failed to load cycle details");
      return;
    }
    setBlocks(blocksRes.data ?? []);
    setGroups(groupsRes.data ?? []);
    setSlots(slotsRes.data ?? []);
  }, []);

  useEffect(() => {
    if (selectedCycle) fetchCycleDetails(selectedCycle.id);
  }, [selectedCycle?.id, fetchCycleDetails]);

  // ---------- Cycle create/edit ----------
  const [cycleForm, setCycleForm] = useState(emptyCycleForm);
  const [cycleDialogOpen, setCycleDialogOpen] = useState(false);
  const [editingCycleId, setEditingCycleId] = useState<string | null>(null);

  const openCreateCycleDialog = () => {
    setEditingCycleId(null);
    setCycleForm(emptyCycleForm);
    setCycleDialogOpen(true);
  };

  const openEditCycleDialog = (cycle: RotationCycle) => {
    setEditingCycleId(cycle.id);
    setCycleForm({
      name: cycle.name,
      cadence_type: cycle.cadence_type,
      cycle_length_days: cycle.cycle_length_days,
      split_mode: cycle.split_mode,
      start_date: cycle.start_date,
    });
    setCycleDialogOpen(true);
  };

  const saveCycle = async () => {
    if (!schoolId || !cycleForm.name.trim()) {
      toast.error("Cycle name is required");
      return;
    }
    if (editingCycleId) {
      const { error } = await supabase
        .from("rotation_cycles")
        .update(cycleForm)
        .eq("id", editingCycleId);
      if (error) {
        toast.error("Failed to update cycle: " + error.message);
        return;
      }
      toast.success("Cycle updated");
    } else {
      const { data, error } = await supabase
        .from("rotation_cycles")
        .insert({ ...cycleForm, school_id: schoolId, is_active: true })
        .select()
        .single();
      if (error) {
        toast.error("Failed to create cycle: " + error.message);
        return;
      }
      toast.success("Rotation cycle created");
      setSelectedCycle(data);
    }
    setCycleDialogOpen(false);
    setEditingCycleId(null);
    setCycleForm(emptyCycleForm);
    await fetchCycles();
  };

  const toggleCycleActive = async (cycle: RotationCycle) => {
    const { error } = await supabase
      .from("rotation_cycles")
      .update({ is_active: !cycle.is_active })
      .eq("id", cycle.id);
    if (error) {
      toast.error("Failed to update cycle");
      return;
    }
    fetchCycles();
  };

  const deleteCycle = async (cycleId: string) => {
    const { error } = await supabase.from("rotation_cycles").delete().eq("id", cycleId);
    if (error) {
      toast.error("Failed to delete cycle");
      return;
    }
    toast.success("Cycle deleted");
    if (selectedCycle?.id === cycleId) setSelectedCycle(null);
    fetchCycles();
  };

  // ---------- Blocks create/edit ----------
  const [blockForm, setBlockForm] = useState(emptyBlockForm);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const openCreateBlockDialog = () => {
    setEditingBlockId(null);
    setBlockForm(emptyBlockForm);
    setBlockDialogOpen(true);
  };

  const openEditBlockDialog = (block: RotationBlock) => {
    setEditingBlockId(block.id);
    setBlockForm({
      block_name: block.block_name,
      subject: block.subject,
      teacher_id: block.teacher_id ?? "",
      room: block.room ?? "",
    });
    setBlockDialogOpen(true);
  };

  const saveBlock = async () => {
    if (!selectedCycle || !blockForm.block_name.trim() || !blockForm.subject.trim()) {
      toast.error("Block name and subject are required");
      return;
    }
    if (editingBlockId) {
      const { error } = await supabase
        .from("rotation_blocks")
        .update({
          block_name: blockForm.block_name,
          subject: blockForm.subject,
          teacher_id: blockForm.teacher_id || null,
          room: blockForm.room || null,
        })
        .eq("id", editingBlockId);
      if (error) {
        toast.error("Failed to update block: " + error.message);
        return;
      }
      toast.success("Block updated");
    } else {
      const { error } = await supabase.from("rotation_blocks").insert({
        rotation_cycle_id: selectedCycle.id,
        block_name: blockForm.block_name,
        subject: blockForm.subject,
        teacher_id: blockForm.teacher_id || null,
        room: blockForm.room || null,
        sequence_order: blocks.length,
      });
      if (error) {
        toast.error("Failed to add block: " + error.message);
        return;
      }
      toast.success("Block added");
    }
    setBlockDialogOpen(false);
    setEditingBlockId(null);
    setBlockForm(emptyBlockForm);
    fetchCycleDetails(selectedCycle.id);
  };

  const deleteBlock = async (blockId: string) => {
    if (!selectedCycle) return;
    await supabase.from("rotation_blocks").delete().eq("id", blockId);
    toast.success("Block removed");
    fetchCycleDetails(selectedCycle.id);
  };

  // ---------- Groups create/edit ----------
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const openCreateGroupDialog = () => {
    setEditingGroupId(null);
    setGroupForm(emptyGroupForm);
    setGroupDialogOpen(true);
  };

  const openEditGroupDialog = (group: RotationGroup) => {
    setEditingGroupId(group.id);
    setGroupForm({
      class_grade: group.class_grade,
      section: group.section,
      group_name: group.group_name,
    });
    setGroupDialogOpen(true);
  };

  const saveGroup = async () => {
    if (!selectedCycle || !groupForm.class_grade.trim() || !groupForm.section.trim() || !groupForm.group_name.trim()) {
      toast.error("Class, section, and group name are required");
      return;
    }
    if (editingGroupId) {
      const { error } = await supabase
        .from("rotation_groups")
        .update({
          class_grade: groupForm.class_grade,
          section: groupForm.section,
          group_name: groupForm.group_name,
        })
        .eq("id", editingGroupId);
      if (error) {
        toast.error("Failed to update group: " + error.message);
        return;
      }
      toast.success("Group updated");
    } else {
      const { error } = await supabase.from("rotation_groups").insert({
        rotation_cycle_id: selectedCycle.id,
        class_grade: groupForm.class_grade,
        section: groupForm.section,
        group_name: groupForm.group_name,
        group_sequence_order: groups.length,
      });
      if (error) {
        toast.error("Failed to add group: " + error.message);
        return;
      }
      toast.success("Group added");
    }
    setGroupDialogOpen(false);
    setEditingGroupId(null);
    setGroupForm(emptyGroupForm);
    fetchCycleDetails(selectedCycle.id);
  };

  const deleteGroup = async (groupId: string) => {
    if (!selectedCycle) return;
    await supabase.from("rotation_groups").delete().eq("id", groupId);
    toast.success("Group removed");
    fetchCycleDetails(selectedCycle.id);
  };

  // ---------- Slots create/edit ----------
  const [slotForm, setSlotForm] = useState(emptySlotForm);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  const openCreateSlotDialog = () => {
    setEditingSlotId(null);
    setSlotForm(emptySlotForm);
    setSlotDialogOpen(true);
  };

  const openEditSlotDialog = (slot: RotationSlot) => {
    setEditingSlotId(slot.id);
    setSlotForm({ day_of_week: slot.day_of_week, period_number: slot.period_number });
    setSlotDialogOpen(true);
  };

  const saveSlot = async () => {
    if (!selectedCycle) return;
    if (editingSlotId) {
      const { error } = await supabase
        .from("rotation_slots")
        .update({ day_of_week: slotForm.day_of_week, period_number: slotForm.period_number })
        .eq("id", editingSlotId);
      if (error) {
        toast.error("Failed to update slot: " + error.message);
        return;
      }
      toast.success("Slot updated");
    } else {
      const { error } = await supabase.from("rotation_slots").insert({
        rotation_cycle_id: selectedCycle.id,
        day_of_week: slotForm.day_of_week,
        period_number: slotForm.period_number,
      });
      if (error) {
        toast.error("Failed to add slot (maybe it already exists): " + error.message);
        return;
      }
      toast.success("Slot added");
    }
    setSlotDialogOpen(false);
    setEditingSlotId(null);
    setSlotForm(emptySlotForm);
    fetchCycleDetails(selectedCycle.id);
  };

  const deleteSlot = async (slotId: string) => {
    if (!selectedCycle) return;
    await supabase.from("rotation_slots").delete().eq("id", slotId);
    fetchCycleDetails(selectedCycle.id);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <RotateCw className="h-6 w-6" /> Rotation Schedules
            </h1>
            <p className="text-muted-foreground text-sm">
              Configure teacher/subject/class rotations for specials, elective-in-blocks, and circuits.
            </p>
          </div>
          <Dialog open={cycleDialogOpen} onOpenChange={(open) => { setCycleDialogOpen(open); if (!open) setEditingCycleId(null); }}>
            <DialogTrigger asChild>
              <Button onClick={openCreateCycleDialog}>
                <Plus className="h-4 w-4 mr-1" /> New Cycle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingCycleId ? "Edit Rotation Cycle" : "Create Rotation Cycle"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={cycleForm.name}
                    onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })}
                    placeholder="e.g. Specials Rotation - Term 1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Cadence</Label>
                    <Select
                      value={cycleForm.cadence_type}
                      onValueChange={(v) => setCycleForm({ ...cycleForm, cadence_type: v as RotationCycle["cadence_type"] })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="termly">Termly</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Cycle length (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={cycleForm.cycle_length_days}
                      onChange={(e) => setCycleForm({ ...cycleForm, cycle_length_days: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Split mode</Label>
                  <Select
                    value={cycleForm.split_mode}
                    onValueChange={(v) => setCycleForm({ ...cycleForm, split_mode: v as RotationCycle["split_mode"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whole_class">Whole class moves together</SelectItem>
                      <SelectItem value="sub_group">Class splits into sub-groups</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Start date</Label>
                  <Input
                    type="date"
                    value={cycleForm.start_date}
                    onChange={(e) => setCycleForm({ ...cycleForm, start_date: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={saveCycle}>{editingCycleId ? "Save" : "Create"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Cycle list */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Cycles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
              {!loading && cycles.length === 0 && (
                <p className="text-sm text-muted-foreground">No rotation cycles yet. Create one to get started.</p>
              )}
              {cycles.map((cycle) => (
                <div
                  key={cycle.id}
                  onClick={() => setSelectedCycle(cycle)}
                  className={`p-3 rounded-lg border cursor-pointer transition ${
                    selectedCycle?.id === cycle.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{cycle.name}</span>
                    <div className="flex items-center gap-1">
                      <Badge variant={cycle.is_active ? "default" : "secondary"}>
                        {cycle.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => { e.stopPropagation(); openEditCycleDialog(cycle); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {cycle.cadence_type} · every {cycle.cycle_length_days}d · {cycle.split_mode.replace("_", " ")}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Cycle detail */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedCycle && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Select a cycle to configure blocks, groups, and slots.
                </CardContent>
              </Card>
            )}

            {selectedCycle && (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">{selectedCycle.name}</CardTitle>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={selectedCycle.is_active}
                          onCheckedChange={() => toggleCycleActive(selectedCycle)}
                        />
                        <span className="text-sm">Active</span>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openEditCycleDialog(selectedCycle)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => deleteCycle(selectedCycle.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                </Card>

                {/* Blocks */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="h-4 w-4" /> Blocks (the stations in the circuit)
                    </CardTitle>
                    <Dialog open={blockDialogOpen} onOpenChange={(open) => { setBlockDialogOpen(open); if (!open) setEditingBlockId(null); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={openCreateBlockDialog}><Plus className="h-4 w-4 mr-1" /> Add Block</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{editingBlockId ? "Edit Block" : "Add Block"}</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div>
                            <Label>Block name</Label>
                            <Input value={blockForm.block_name} onChange={(e) => setBlockForm({ ...blockForm, block_name: e.target.value })} placeholder="e.g. PE" />
                          </div>
                          <div>
                            <Label>Subject</Label>
                            <Input value={blockForm.subject} onChange={(e) => setBlockForm({ ...blockForm, subject: e.target.value })} placeholder="e.g. Physical Education" />
                          </div>
                          <div>
                            <Label>Teacher</Label>
                            <Select value={blockForm.teacher_id} onValueChange={(v) => setBlockForm({ ...blockForm, teacher_id: v })}>
                              <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
                              <SelectContent>
                                {teachers.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Room (optional)</Label>
                            <Input value={blockForm.room} onChange={(e) => setBlockForm({ ...blockForm, room: e.target.value })} placeholder="e.g. Ground" />
                          </div>
                        </div>
                        <DialogFooter><Button onClick={saveBlock}>{editingBlockId ? "Save" : "Add"}</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead>Block</TableHead>
                          <TableHead>Subject</TableHead>
                          <TableHead>Teacher</TableHead>
                          <TableHead>Room</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {blocks.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell>{b.sequence_order}</TableCell>
                            <TableCell>{b.block_name}</TableCell>
                            <TableCell>{b.subject}</TableCell>
                            <TableCell>{teachers.find((t) => t.id === b.teacher_id)?.full_name ?? "—"}</TableCell>
                            <TableCell>{b.room ?? "—"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openEditBlockDialog(b)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteBlock(b.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {blocks.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No blocks yet</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Groups */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" /> Groups (who rotates through the circuit)
                    </CardTitle>
                    <Dialog open={groupDialogOpen} onOpenChange={(open) => { setGroupDialogOpen(open); if (!open) setEditingGroupId(null); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={openCreateGroupDialog}><Plus className="h-4 w-4 mr-1" /> Add Group</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{editingGroupId ? "Edit Group" : "Add Group"}</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label>Class</Label>
                              <Input value={groupForm.class_grade} onChange={(e) => setGroupForm({ ...groupForm, class_grade: e.target.value })} placeholder="e.g. 5" />
                            </div>
                            <div>
                              <Label>Section</Label>
                              <Input value={groupForm.section} onChange={(e) => setGroupForm({ ...groupForm, section: e.target.value })} placeholder="e.g. A" />
                            </div>
                          </div>
                          <div>
                            <Label>Group name</Label>
                            <Input value={groupForm.group_name} onChange={(e) => setGroupForm({ ...groupForm, group_name: e.target.value })} placeholder="e.g. 5A Group 1 (or just 5A for whole-class mode)" />
                          </div>
                        </div>
                        <DialogFooter><Button onClick={saveGroup}>{editingGroupId ? "Save" : "Add"}</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Group</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groups.map((g) => (
                          <TableRow key={g.id}>
                            <TableCell>{g.group_sequence_order}</TableCell>
                            <TableCell>{g.class_grade}{g.section}</TableCell>
                            <TableCell>{g.group_name}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openEditGroupDialog(g)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteGroup(g.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {groups.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No groups yet</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                    {selectedCycle.split_mode === "sub_group" && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Sub-group mode: assign individual students to each group via the group's student roster (separate step — ask me to build this once base groups exist).
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Slots */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock3 className="h-4 w-4" /> Slots (when this rotation occupies the timetable)
                    </CardTitle>
                    <Dialog open={slotDialogOpen} onOpenChange={(open) => { setSlotDialogOpen(open); if (!open) setEditingSlotId(null); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={openCreateSlotDialog}><Plus className="h-4 w-4 mr-1" /> Add Slot</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{editingSlotId ? "Edit Slot" : "Add Slot"}</DialogTitle></DialogHeader>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Day</Label>
                            <Select value={slotForm.day_of_week} onValueChange={(v) => setSlotForm({ ...slotForm, day_of_week: v })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {DAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Period</Label>
                            <Input type="number" min={1} value={slotForm.period_number} onChange={(e) => setSlotForm({ ...slotForm, period_number: Number(e.target.value) })} />
                          </div>
                        </div>
                        <DialogFooter><Button onClick={saveSlot}>{editingSlotId ? "Save" : "Add"}</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {slots.map((s) => (
                        <Badge key={s.id} variant="outline" className="flex items-center gap-2 py-1.5 px-3">
                          <button onClick={() => openEditSlotDialog(s)} className="hover:underline">
                            {s.day_of_week} · Period {s.period_number}
                          </button>
                          <button onClick={() => deleteSlot(s.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      {slots.length === 0 && <p className="text-sm text-muted-foreground">No slots yet</p>}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
