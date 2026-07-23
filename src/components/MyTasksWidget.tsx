/**
 * MyTasksWidget.tsx (APAS-061)
 *
 * "My Tasks" = Automatic Tasks (generated live from existing modules) +
 * Manual Tasks (stored in teacher_tasks, full CRUD).
 *
 * Automatic tasks are NEVER stored — they're computed fresh on every load
 * from homework_submissions, student_interventions, and teacher_notes, so
 * there's nothing to keep in sync. Once the underlying condition clears
 * (e.g. homework gets graded), the task simply stops appearing.
 *
 * Deliberately excluded per product decision:
 * - Assessments (auto-evaluated, no teacher action needed)
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2,
  CheckCircle2, Circle, ListChecks,
} from "lucide-react";
import { format, isToday, isTomorrow, isPast, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ManualTask {
  id: string;
  teacher_id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed";
  due_date: string | null;
  reminder_date: string | null;
  created_at: string;
  updated_at: string;
}

interface AutoTask {
  id: string;
  title: string;
  subtitle: string;
  urgencyLabel: string;
  urgencyColor: "red" | "orange" | "yellow" | "green";
  link: string;
}

type Filter = "all" | "suggested" | "personal" | "completed";

const URGENCY_DOT: Record<string, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-amber-400",
  green: "bg-green-500",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

function dueDateLabel(dateStr: string | null): { label: string; overdue: boolean } {
  if (!dateStr) return { label: "", overdue: false };
  const d = parseISO(dateStr);
  if (isToday(d)) return { label: "Today", overdue: false };
  if (isTomorrow(d)) return { label: "Tomorrow", overdue: false };
  if (isPast(d)) return { label: `Overdue · ${format(d, "d MMM")}`, overdue: true };
  return { label: format(d, "d MMM yyyy"), overdue: false };
}

export function MyTasksWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ManualTask | null>(null);

  // Form state for Add/Edit Task dialog
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [reminder, setReminder] = useState<"today" | "tomorrow" | "custom" | "none">("none");
  const [customDate, setCustomDate] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Automatic: attendance not yet marked today, per class ───────────────
  const { data: attendanceTasks } = useQuery({
    queryKey: ["auto-task-attendance", user?.id],
    queryFn: async (): Promise<AutoTask[]> => {
      const { data: assigned } = await supabase
        .from("class_teachers")
        .select("class_id, classes(name, section)")
        .eq("teacher_id", user!.id);
      const classRows = (assigned || []).filter((r: any) => r.classes);
      if (classRows.length === 0) return [];

      const today = format(new Date(), "yyyy-MM-dd");
      const classIds = classRows.map((r: any) => r.class_id);
      const { data: marked } = await supabase
        .from("attendance_records")
        .select("class_id")
        .in("class_id", classIds)
        .eq("date", today);
      const markedIds = new Set((marked || []).map((r: any) => r.class_id));

      return classRows
        .filter((r: any) => !markedIds.has(r.class_id))
        .map((r: any) => ({
          id: `auto-attendance-${r.class_id}`,
          title: "Mark Attendance",
          subtitle: `${r.classes.name} - ${r.classes.section}`,
          urgencyLabel: "Due Today",
          urgencyColor: "red" as const,
          link: "/attendance",
        }));
    },
    enabled: !!user?.id,
  });

  // ── Automatic: homework pending evaluation ──────────────────────────────
  const { data: homeworkTask } = useQuery({
    queryKey: ["auto-task-homework", user?.id],
    queryFn: async (): Promise<AutoTask | null> => {
      const { data: assignments } = await supabase
        .from("homework_assignments")
        .select("id")
        .eq("assigned_by", user!.id);
      const assignmentIds = (assignments || []).map((a: any) => a.id);
      if (!assignmentIds.length) return null;

      const { count } = await supabase
        .from("homework_submissions")
        .select("id", { count: "exact", head: true })
        .in("assignment_id", assignmentIds)
        .is("teacher_score", null)
        .not("submitted_at", "is", null);

      if (!count) return null;
      return {
        id: "auto-homework",
        title: "Evaluate Homework",
        subtitle: `${count} submission${count === 1 ? "" : "s"} pending`,
        urgencyLabel: "Pending",
        urgencyColor: "orange",
        link: "/submissions",
      };
    },
    enabled: !!user?.id,
  });

  // ── Automatic: interventions due for review TODAY ───────────────────────
  const { data: interventionTasks } = useQuery({
    queryKey: ["auto-task-interventions", user?.id],
    queryFn: async (): Promise<AutoTask[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase
        .from("student_interventions")
        .select("id, review_date, students(full_name)")
        .eq("teacher_id", user!.id)
        .eq("status", "active")
        .eq("review_date", today);

      return (data || []).map((iv: any) => ({
        id: `auto-intervention-${iv.id}`,
        title: "Review Intervention",
        subtitle: iv.students?.full_name || "Student",
        urgencyLabel: "Due Today",
        urgencyColor: "green" as const,
        link: "/teacher-at-risk",
      }));
    },
    enabled: !!user?.id,
  });

  // ── Automatic: behaviour follow-ups due TODAY ────────────────────────────
  const { data: followUpTasks } = useQuery({
    queryKey: ["auto-task-followups", user?.id],
    queryFn: async (): Promise<AutoTask[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data } = await supabase
        .from("teacher_notes")
        .select("id, follow_up_date, students(full_name)")
        .eq("teacher_id", user!.id)
        .eq("follow_up_completed", false)
        .eq("follow_up_date", today);

      return (data || []).map((n: any) => ({
        id: `auto-followup-${n.id}`,
        title: "Behaviour Follow-up",
        subtitle: n.students?.full_name || "Student",
        urgencyLabel: "Due Today",
        urgencyColor: "yellow" as const,
        link: "/teacher-behaviour",
      }));
    },
    enabled: !!user?.id,
  });

  const automaticTasks: AutoTask[] = useMemo(() => [
    ...(attendanceTasks || []),
    ...(homeworkTask ? [homeworkTask] : []),
    ...(interventionTasks || []),
    ...(followUpTasks || []),
  ], [attendanceTasks, homeworkTask, interventionTasks, followUpTasks]);

  // ── Manual tasks ──────────────────────────────────────────────────────────
  const { data: manualTasks = [], refetch: refetchManual } = useQuery({
    queryKey: ["manual-tasks", user?.id],
    queryFn: async (): Promise<ManualTask[]> => {
      const { data, error } = await supabase
        .from("teacher_tasks")
        .select("*")
        .eq("teacher_id", user!.id)
        .order("status", { ascending: true })
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as ManualTask[];
    },
    enabled: !!user?.id,
  });

  const pendingManual = manualTasks.filter((t) => t.status !== "completed");
  const completedManual = manualTasks.filter((t) => t.status === "completed");

  const todayCount =
    automaticTasks.length +
    pendingManual.filter((t) => t.due_date && isToday(parseISO(t.due_date))).length;
  const pendingCount = automaticTasks.length + pendingManual.length;
  const completedCount = completedManual.length;

  // ── Add / Edit dialog ────────────────────────────────────────────────────
  const openAddDialog = () => {
    setEditingTask(null);
    setTitle("");
    setDescription("");
    setPriority("medium");
    setReminder("none");
    setCustomDate("");
    setDialogOpen(true);
  };

  const openEditDialog = (task: ManualTask) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description || "");
    setPriority(task.priority);
    if (task.reminder_date) {
      const d = parseISO(task.reminder_date);
      if (isToday(d)) setReminder("today");
      else if (isTomorrow(d)) setReminder("tomorrow");
      else { setReminder("custom"); setCustomDate(task.reminder_date); }
    } else {
      setReminder("none");
      setCustomDate("");
    }
    setDialogOpen(true);
  };

  const resolvedDueDate = (): string | null => {
    const today = new Date();
    if (reminder === "today") return format(today, "yyyy-MM-dd");
    if (reminder === "tomorrow") { const t = new Date(today); t.setDate(t.getDate() + 1); return format(t, "yyyy-MM-dd"); }
    if (reminder === "custom" && customDate) return customDate;
    return null;
  };

  const handleSaveTask = async () => {
    if (!user?.id || !title.trim()) {
      toast({ title: "Task name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const dueDate = resolvedDueDate();
      const payload = {
        teacher_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate,
        reminder_date: dueDate,
      };
      if (editingTask) {
        const { error } = await supabase.from("teacher_tasks").update(payload).eq("id", editingTask.id);
        if (error) throw error;
        toast({ title: "Task updated" });
      } else {
        const { error } = await supabase.from("teacher_tasks").insert({ ...payload, status: "pending" });
        if (error) throw error;
        toast({ title: "Task added" });
      }
      setDialogOpen(false);
      refetchManual();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleComplete = async (task: ManualTask) => {
    const newStatus = task.status === "completed" ? "pending" : "completed";
    const { error } = await supabase.from("teacher_tasks").update({ status: newStatus }).eq("id", task.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    refetchManual();
  };

  const deleteTask = async (task: ManualTask) => {
    const { error } = await supabase.from("teacher_tasks").delete().eq("id", task.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Task deleted" });
    refetchManual();
  };

  const showAutomatic = filter === "all" || filter === "suggested";
  const showManualPending = filter === "all" || filter === "personal";
  const showManualCompleted = filter === "all" || filter === "personal" || filter === "completed";

  return (
    <Card className="border border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" /> My Tasks
          </CardTitle>
          <div className="flex gap-1.5 flex-wrap">
            {(["all", "suggested", "personal", "completed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors capitalize",
                  filter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted text-muted-foreground"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-xl font-bold">{todayCount}</p>
            <p className="text-xs text-muted-foreground">Today's Tasks</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-xl font-bold text-amber-600">{pendingCount}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-xl font-bold text-green-600">{completedCount}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
        </div>

        {/* Automatic tasks */}
        {showAutomatic && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suggested Tasks</p>
            {automaticTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Nothing pending — you're all caught up.</p>
            ) : (
              automaticTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(t.link)}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", URGENCY_DOT[t.urgencyColor])} />
                    <div>
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.subtitle}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">{t.urgencyLabel}</Badge>
                </button>
              ))
            )}
          </div>
        )}

        {/* Manual tasks */}
        {(showManualPending || showManualCompleted) && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Personal Tasks</p>

            {showManualPending && pendingManual.map((t) => {
              const due = dueDateLabel(t.due_date);
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border p-3 group">
                  <button onClick={() => toggleComplete(t)} className="shrink-0">
                    <Circle className="h-4.5 w-4.5 text-muted-foreground hover:text-primary" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <Badge className={PRIORITY_STYLES[t.priority]}>{t.priority}</Badge>
                      {due.label && (
                        <Badge variant={due.overdue ? "destructive" : "outline"} className="text-xs">{due.label}</Badge>
                      )}
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground truncate">{t.description}</p>}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => openEditDialog(t)} className="p-1.5 rounded hover:bg-muted">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => deleteTask(t)} className="p-1.5 rounded hover:bg-muted">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}

            {showManualCompleted && completedManual.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border p-3 opacity-60 group">
                <button onClick={() => toggleComplete(t)} className="shrink-0">
                  <CheckCircle2 className="h-4.5 w-4.5 text-green-600" />
                </button>
                <p className="text-sm flex-1 line-through text-muted-foreground truncate">{t.title}</p>
                <button onClick={() => deleteTask(t)} className="p-1.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </button>
              </div>
            ))}

            {showManualPending && !showManualCompleted && pendingManual.length === 0 && (
              <p className="text-sm text-muted-foreground py-1">No personal tasks yet.</p>
            )}
          </div>
        )}

        <Button variant="outline" className="w-full" onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-1.5" /> Add Task
        </Button>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit Task" : "Add Task"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Task Name</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prepare Lesson Plan" className="mt-1" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Reminder</label>
              <Select value={reminder} onValueChange={(v: any) => setReminder(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="tomorrow">Tomorrow</SelectItem>
                  <SelectItem value="custom">Custom Date</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {reminder === "custom" && (
              <div data-vaul-no-drag>
                <label className="text-xs font-medium text-muted-foreground">Due Date</label>
                <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="mt-1" />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTask} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
