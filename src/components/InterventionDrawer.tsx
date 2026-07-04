/**
 * InterventionDrawer.tsx
 * A student can have MANY interventions over the school year (one per issue:
 * homework, attendance, behaviour, etc). This drawer shows the full
 * Intervention History for a student and lets the teacher:
 * - Create a new intervention
 * - View / edit an existing one
 * - Mark the active intervention as completed
 *
 * Rules:
 * - Active intervention  -> [Edit] [Mark Completed]
 * - Completed/cancelled  -> [View] [+ New Intervention]
 * - No interventions yet -> opens straight into the create form
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Pencil, Plus, ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export interface Intervention {
  id: string;
  student_id: string;
  reason: string;
  priority: "low" | "medium" | "high";
  action_plan: string[];
  expected_outcome: string | null;
  outcome: string | null;
  review_date: string | null;
  status: "active" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: { id: string; full_name: string; class: string; section: string } | null;
  riskLevel?: string;
  contributingFactors?: string[];
  interventions: Intervention[]; // FULL history for this student, newest first
  onSaved: () => void;
}

const PRESET_ACTIONS = [
  "Meet Student", "Call Parents", "Provide Remedial Worksheets",
  "One-to-One Support", "Weekly Monitoring", "Extra Practice", "Counselling",
];

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-600",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-blue-500",
  completed: "bg-green-500",
  cancelled: "bg-gray-400",
};

// Turn AI-generated contributing factors (e.g. "Homework completion is low (28%)")
// into a readable, pre-filled Reason paragraph the teacher can edit before saving.
function buildReasonFromFactors(factors?: string[]): string {
  if (!factors || factors.length === 0) return "";
  return factors
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (/[.!?]$/.test(f) ? f : `${f}.`))
    .map((f) => f.charAt(0).toUpperCase() + f.slice(1))
    .join("\n");
}

type View = "list" | "form";
type FormMode = "view" | "edit";

export function InterventionDrawer({ open, onOpenChange, student, riskLevel, contributingFactors, interventions, onSaved }: Props) {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const activeIntervention = interventions.find((i) => i.status === "active") || null;

  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Intervention | null>(null); // null while creating
  const [formMode, setFormMode] = useState<FormMode>("view");
  const [saving, setSaving] = useState(false);

  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [actionPlan, setActionPlan] = useState<string[]>([]);
  const [customAction, setCustomAction] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [status, setStatus] = useState<"active" | "completed" | "cancelled">("active");
  const [outcome, setOutcome] = useState("");

  const resetFormFields = (iv: Intervention | null) => {
    setReason(iv?.reason ?? buildReasonFromFactors(contributingFactors));
    setPriority(iv?.priority || "medium");
    setActionPlan(iv?.action_plan || []);
    setCustomAction("");
    setExpectedOutcome(iv?.expected_outcome || "");
    setReviewDate(iv?.review_date || "");
    setStatus(iv?.status || "active");
    setOutcome(iv?.outcome || "");
  };

  const openCreateForm = () => {
    setSelected(null);
    setFormMode("edit");
    resetFormFields(null);
    setView("form");
  };

  const openDetail = (iv: Intervention, mode: FormMode) => {
    setSelected(iv);
    setFormMode(mode);
    resetFormFields(iv);
    setView("form");
  };

  const backToList = () => setView("list");

  // Decide what to show whenever the drawer opens (or the student changes)
  useEffect(() => {
    if (!open) return;
    if (interventions.length === 0) {
      openCreateForm();
    } else if (activeIntervention) {
      openDetail(activeIntervention, "view");
    } else {
      setView("list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  const toggleAction = (action: string) => {
    setActionPlan((prev) => prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]);
  };

  const addCustomAction = () => {
    const trimmed = customAction.trim();
    if (trimmed && !actionPlan.includes(trimmed)) {
      setActionPlan((prev) => [...prev, trimmed]);
    }
    setCustomAction("");
  };

  const removeAction = (action: string) => {
    setActionPlan((prev) => prev.filter((a) => a !== action));
  };

  const handleSave = async () => {
    if (!student || !user?.id || !reason.trim()) {
      toast({ title: "Missing info", description: "A reason is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        school_id: profile?.school_id,
        student_id: student.id,
        teacher_id: user.id,
        reason: reason.trim(),
        priority,
        action_plan: actionPlan,
        expected_outcome: expectedOutcome.trim() || null,
        review_date: reviewDate || null,
        status,
      };

      if (selected) {
        const { error } = await supabase.from("student_interventions").update(payload).eq("id", selected.id);
        if (error) throw error;
        toast({ title: "Intervention updated" });
      } else {
        const { error } = await supabase.from("student_interventions").insert(payload);
        if (error) throw error;
        toast({ title: "Intervention created" });
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkCompleted = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("student_interventions")
        .update({ outcome: outcome.trim() || null, status: "completed" })
        .eq("id", selected.id);
      if (error) throw error;
      toast({ title: "Intervention marked as completed" });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <div className="mx-auto w-full max-w-2xl overflow-y-auto px-4 pb-4">
          <DrawerHeader>
            <DrawerTitle>
              {view === "list"
                ? "Intervention History"
                : selected
                  ? (formMode === "edit" ? "Edit Intervention" : "Intervention Details")
                  : "Create Intervention"}
            </DrawerTitle>
          </DrawerHeader>

          <div className="space-y-4 px-2">
            {/* Student — always read-only */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Student</label>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm font-semibold">{student.full_name}</p>
                <span className="text-xs text-muted-foreground">{student.class} - {student.section}</span>
                {riskLevel && (
                  <Badge className={PRIORITY_STYLES[riskLevel] || ""}>{riskLevel} risk</Badge>
                )}
              </div>
            </div>

            {/* ─── HISTORY LIST ─── */}
            {view === "list" && (
              <div className="space-y-3">
                {interventions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No interventions recorded yet.</p>
                ) : (
                  interventions.map((iv) => (
                    <div key={iv.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[iv.status])} />
                          <Badge className={STATUS_STYLES[iv.status]}>{iv.status}</Badge>
                          <Badge variant="outline" className={PRIORITY_STYLES[iv.priority]}>{iv.priority}</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {iv.status === "completed"
                            ? `Completed: ${format(new Date(iv.updated_at), "d MMM yyyy")}`
                            : `Created: ${format(new Date(iv.created_at), "d MMM yyyy")}`}
                        </span>
                      </div>
                      <p className="text-sm mt-2 line-clamp-2 whitespace-pre-line">{iv.reason}</p>
                      <div className="flex gap-2 mt-3">
                        {iv.status === "active" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openDetail(iv, "edit")}>
                              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                            </Button>
                            <Button size="sm" onClick={() => openDetail(iv, "view")}>
                              Mark Completed
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openDetail(iv, "view")}>
                              View
                            </Button>
                            <Button size="sm" variant="outline" onClick={openCreateForm}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> New Intervention
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {/* Only offer a fresh intervention if none is currently active */}
                {!activeIntervention && (
                  <Button className="w-full bg-blue-600" onClick={openCreateForm}>
                    <Plus className="h-4 w-4 mr-1.5" /> Create New Intervention
                  </Button>
                )}
              </div>
            )}

            {/* ─── FORM (create / view / edit a single intervention) ─── */}
            {view === "form" && (
              <>
                {interventions.length > 0 && (
                  <Button variant="ghost" size="sm" className="-ml-2 -mt-1" onClick={backToList}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Back to History
                  </Button>
                )}

                {formMode === "view" && selected ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Priority</label>
                        <div className="mt-1"><Badge className={PRIORITY_STYLES[selected.priority]}>{selected.priority}</Badge></div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <div className="mt-1"><Badge className={STATUS_STYLES[selected.status]}>{selected.status}</Badge></div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Reason</label>
                      <p className="text-sm mt-1 whitespace-pre-line">{selected.reason}</p>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Action Plan</label>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {selected.action_plan.map((a) => <Badge key={a} variant="secondary">{a}</Badge>)}
                      </div>
                    </div>

                    {selected.review_date && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Review Date</label>
                        <p className="text-sm mt-1">{format(new Date(selected.review_date), "d MMM yyyy")}</p>
                      </div>
                    )}

                    {selected.expected_outcome && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Expected Outcome</label>
                        <p className="text-sm mt-1">{selected.expected_outcome}</p>
                      </div>
                    )}

                    {selected.outcome && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Outcome</label>
                        <p className="text-sm mt-1">{selected.outcome}</p>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Created {format(new Date(selected.created_at), "d MMM yyyy")}
                    </p>

                    {selected.status === "active" && (
                      <div className="border-t pt-3 space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Enter Outcome to Complete</label>
                        <Textarea
                          placeholder="e.g. Homework completion improved from 30% to 90%."
                          value={outcome}
                          onChange={(e) => setOutcome(e.target.value)}
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button onClick={handleMarkCompleted} disabled={saving}>
                            {saving ? "Saving..." : "Mark as Completed"}
                          </Button>
                          <Button variant="outline" onClick={() => setFormMode("edit")}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                          </Button>
                        </div>
                      </div>
                    )}
                    {selected.status !== "active" && (
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setFormMode("edit")}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                        <Button onClick={openCreateForm}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Intervention
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Reason</label>
                      <Textarea
                        placeholder="e.g. Poor attendance, low homework completion, behaviour concerns..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        className="mt-1"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
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
                      <div data-vaul-no-drag>
                        <label className="text-xs font-medium text-muted-foreground">Review Date</label>
                        <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="mt-1" />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Action Plan</label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {PRESET_ACTIONS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => toggleAction(a)}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              actionPlan.includes(a)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background border-border hover:bg-muted"
                            }`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Input
                          placeholder="Add a custom action..."
                          value={customAction}
                          onChange={(e) => setCustomAction(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomAction(); } }}
                        />
                        <Button type="button" variant="outline" onClick={addCustomAction}>Add</Button>
                      </div>
                      {actionPlan.filter((a) => !PRESET_ACTIONS.includes(a)).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {actionPlan.filter((a) => !PRESET_ACTIONS.includes(a)).map((a) => (
                            <Badge key={a} variant="secondary" className="gap-1">
                              {a}
                              <button onClick={() => removeAction(a)}><X className="h-3 w-3" /></button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Expected Outcome</label>
                      <Textarea
                        placeholder="e.g. Improve homework completion, increase attendance..."
                        value={expectedOutcome}
                        onChange={(e) => setExpectedOutcome(e.target.value)}
                        rows={2}
                        className="mt-1"
                      />
                    </div>

                    {selected && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {view === "form" && formMode === "edit" && (
            <DrawerFooter className="px-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              {interventions.length > 0 ? (
                <Button variant="outline" onClick={() => (selected ? openDetail(selected, "view") : backToList())}>
                  Cancel
                </Button>
              ) : (
                <DrawerClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DrawerClose>
              )}
            </DrawerFooter>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}