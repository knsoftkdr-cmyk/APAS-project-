/**
 * InterventionDrawer.tsx
 * A student can have MANY interventions over the school year (one per issue:
 * homework, attendance, behaviour, etc). This drawer shows the full
 * Intervention History for a student and lets the teacher:
 * - Create a new intervention
 * - View / edit an existing one
 * - Mark the active intervention as completed
 *
 * PBIS tier: every intervention is classified Tier 2 (targeted) or Tier 3
 * (intensive) — this drawer is only ever opened for individualized support,
 * so Tier 1 (universal, whole-class) isn't an option here. When opened from
 * a flagged Behaviour Analytics row, `suggestedTier` pre-selects a sensible
 * default (Watch -> Tier 2, High -> Tier 3) which the teacher can override.
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
  tier: 2 | 3;
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
  suggestedTier?: 2 | 3; // pre-selects tier on a NEW intervention only; ignored when editing an existing one
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

const TIER_STYLES: Record<number, string> = {
  2: "bg-sky-100 text-sky-700",
  3: "bg-purple-100 text-purple-700",
};

const TIER_LABEL: Record<number, string> = {
  2: "Tier 2 — Targeted",
  3: "Tier 3 — Intensive",
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

export function InterventionDrawer({ open, onOpenChange, student, riskLevel, contributingFactors, suggestedTier, interventions, onSaved }: Props) {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const activeIntervention = interventions.find((i) => i.status === "active") || null;

  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<Intervention | null>(null); // null while creating
  const [formMode, setFormMode] = useState<FormMode>("view");
  const [saving, setSaving] = useState(false);

  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [tier, setTier] = useState<2 | 3>(2);
  const [actionPlan, setActionPlan] = useState<string[]>([]);
  const [customAction, setCustomAction] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [status, setStatus] = useState<"active" | "completed" | "cancelled">("active");
  const [outcome, setOutcome] = useState("");

  const resetFormFields = (iv: Intervention | null) => {
    setReason(iv?.reason ?? buildReasonFromFactors(contributingFactors));
    setPriority(iv?.priority || "medium");
    // Only apply the Analytics-suggested tier on a brand-new intervention;
    // an existing one keeps whatever tier it was already saved with.
    setTier(iv?.tier ?? suggestedTier ?? 2);
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
        tier,
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
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
  <DrawerContent className="h-full w-full sm:max-w-lg ml-auto rounded-none sm:rounded-l-2xl p-0 flex flex-col">
    <div className="w-full flex-1 overflow-y-auto pb-4">
    <div className="bg-gradient-to-r from-cyan-600 to-blue-600 px-4 md:px-6 pt-5 pb-4 sticky top-0 z-10 sm:rounded-tl-2xl">
      <DrawerHeader className="p-0">
        <DrawerTitle className="text-white text-lg md:text-xl">
          {view === "list"
            ? "Intervention History"
            : selected
              ? (formMode === "edit" ? "Edit Intervention" : "Intervention Details")
              : "Create Intervention"}
        </DrawerTitle>
      </DrawerHeader>

      {/* Student — always read-only, now inside the colored header */}
      <div className="mt-3 flex items-center gap-2 flex-wrap bg-white/10 rounded-xl px-3 py-2.5">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0 text-white text-xs font-bold">
          {student.full_name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{student.full_name}</p>
          <span className="text-xs text-white/70">{student.class} - {student.section}</span>
        </div>
        {riskLevel && (
          <Badge className={`ml-auto ${riskLevel === "high" ? "bg-red-500" : riskLevel === "medium" ? "bg-amber-500" : "bg-green-500"} text-white hover:opacity-90 shrink-0`}>
            {riskLevel} risk
          </Badge>
        )}
      </div>
    </div>

    <div className="space-y-4 px-4 md:px-6 pt-4">

            {/* ─── HISTORY LIST ─── */}
            {view === "list" && (
  <div className="space-y-3">
    {interventions.length === 0 ? (
      <p className="text-sm text-muted-foreground">No interventions recorded yet.</p>
    ) : (
      interventions.map((iv) => {
        const statusBadgeClass =
          iv.status === "active"
            ? "bg-blue-500 text-white hover:bg-blue-500"
            : iv.status === "completed"
            ? "bg-green-500 text-white hover:bg-green-500"
            : "bg-gray-400 text-white hover:bg-gray-400";

        const priorityBadgeClass =
          iv.priority === "high"
            ? "bg-red-100 text-red-700 hover:bg-red-100"
            : iv.priority === "medium"
            ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
            : "bg-green-100 text-green-700 hover:bg-green-100";

        const rowClass =
          iv.status === "active"
            ? "border-l-blue-500 bg-blue-50/30"
            : iv.status === "completed"
            ? "border-l-green-500 bg-green-50/30"
            : "border-l-gray-400 bg-gray-50/30";

        return (
          <div
            key={iv.id}
            className={"rounded-xl border-l-4 border border-slate-200 p-3.5 shadow-sm " + rowClass}
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge className={statusBadgeClass}>{iv.status}</Badge>
                <Badge className={priorityBadgeClass}>{iv.priority}</Badge>
                {iv.tier && (
                  <Badge className={TIER_STYLES[iv.tier] + " hover:opacity-90"}>
                    Tier {iv.tier}
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {iv.status === "completed"
                  ? format(new Date(iv.updated_at), "d MMM yyyy")
                  : format(new Date(iv.created_at), "d MMM yyyy")}
              </span>
            </div>

            <p className="text-sm mt-2 line-clamp-2 whitespace-pre-line text-slate-700">
              {iv.reason}
            </p>

            <div className="flex gap-2 mt-3 flex-wrap">
              {iv.status === "active" ? (
                <>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => openDetail(iv, "edit")}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button size="sm" className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700" onClick={() => openDetail(iv, "view")}>
                    Mark Completed
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => openDetail(iv, "view")}>
                    View
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={openCreateForm}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> New Intervention
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })
    )}

    {!activeIntervention && (
      <Button
        className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700"
        onClick={openCreateForm}
      >
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
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Tier</label>
          <div className="mt-1.5"><Badge className={`${TIER_STYLES[selected.tier]} hover:opacity-90`}>{TIER_LABEL[selected.tier]}</Badge></div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Priority</label>
          <div className="mt-1.5">
            <Badge className={
              selected.priority === "high" ? "bg-red-500 text-white hover:bg-red-500" :
              selected.priority === "medium" ? "bg-amber-500 text-white hover:bg-amber-500" :
              "bg-green-500 text-white hover:bg-green-500"
            }>{selected.priority}</Badge>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
          <div className="mt-1.5">
            <Badge className={
              selected.status === "active" ? "bg-blue-500 text-white hover:bg-blue-500" :
              selected.status === "completed" ? "bg-green-500 text-white hover:bg-green-500" :
              "bg-gray-400 text-white hover:bg-gray-400"
            }>{selected.status}</Badge>
          </div>
        </div>
      </div>
    </div>

    <div className="rounded-xl border border-cyan-100 bg-cyan-50/30 p-3.5">
      <label className="text-[10px] font-semibold text-cyan-700 uppercase tracking-wide">Reason</label>
      <p className="text-sm mt-1.5 whitespace-pre-line text-slate-700">{selected.reason}</p>
    </div>

    <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3.5">
      <label className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide">Action Plan</label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {selected.action_plan.map((a) => <Badge key={a} className="bg-violet-100 text-violet-700 hover:bg-violet-100">{a}</Badge>)}
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {selected.review_date && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-3.5">
          <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Review Date</label>
          <p className="text-sm mt-1.5 text-slate-700">{format(new Date(selected.review_date), "d MMM yyyy")}</p>
        </div>
      )}

      {selected.expected_outcome && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-3.5">
          <label className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Expected Outcome</label>
          <p className="text-sm mt-1.5 text-slate-700">{selected.expected_outcome}</p>
        </div>
      )}
    </div>

    {selected.outcome && (
      <div className="rounded-xl border border-green-100 bg-green-50/30 p-3.5">
        <label className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">Outcome</label>
        <p className="text-sm mt-1.5 text-slate-700">{selected.outcome}</p>
      </div>
    )}

    <p className="text-xs text-muted-foreground">
      Created {format(new Date(selected.created_at), "d MMM yyyy")}
    </p>

    {selected.status === "active" && (
      <div className="border-t border-slate-200 pt-4 space-y-2">
        <label className="text-xs font-semibold text-slate-700">Enter Outcome to Complete</label>
        <Textarea
          placeholder="e.g. Homework completion improved from 30% to 90%."
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          rows={2}
          className="border-slate-200 focus-visible:ring-green-400"
        />
        <div className="flex gap-2 flex-wrap">
          <Button onClick={handleMarkCompleted} disabled={saving} className="flex-1 sm:flex-none bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700">
            {saving ? "Saving..." : "Mark as Completed"}
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setFormMode("edit")}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
          </Button>
        </div>
      </div>
    )}
    {selected.status !== "active" && (
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setFormMode("edit")}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
        </Button>
        <Button className="flex-1 sm:flex-none bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700" onClick={openCreateForm}>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">
                          Tier
                          {suggestedTier && !selected && (
                            <span className="ml-1 text-[10px] text-cyan-600 font-semibold">(suggested from Analytics)</span>
                          )}
                        </label>
                        <Select value={String(tier)} onValueChange={(v) => setTier(Number(v) as 2 | 3)}>
                          <SelectTrigger className="mt-1 border-slate-200 focus:ring-cyan-400"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">Tier 2 — Targeted</SelectItem>
                            <SelectItem value="3">Tier 3 — Intensive</SelectItem>
                          </SelectContent>
                        </Select>
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
                    </div>

                    <div data-vaul-no-drag>
                      <label className="text-xs font-medium text-muted-foreground">Review Date</label>
                      <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="mt-1" />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Action Plan</label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {PRESET_ACTIONS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => toggleAction(a)}
                            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            actionPlan.includes(a)
                              ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white border-transparent shadow-sm"
                              : "bg-white border-slate-200 text-slate-600 hover:border-violet-300 hover:bg-violet-50"
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
  <DrawerFooter className="px-4 md:px-6 sticky bottom-0 bg-white border-t border-slate-100 pt-3 pb-4 sm:rounded-bl-2xl">
    <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700">
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
