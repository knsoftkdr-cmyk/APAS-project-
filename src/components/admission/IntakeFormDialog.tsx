import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import type { IntakeFormInput } from "@/hooks/useAdmissionIntakes";

interface IntakeFormDialogProps {
  onCreate: (input: IntakeFormInput) => Promise<{ error: string | null }>;
}

const EMPTY_FORM: IntakeFormInput = {
  academic_year: "",
  grade: "",
  total_seats: 30,
  min_percentage_required: null,
  criteria_notes: "",
  opens_on: "",
  closes_on: "",
};

export function IntakeFormDialog({ onCreate }: IntakeFormDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<IntakeFormInput>(EMPTY_FORM);

  const handleSubmit = async () => {
    if (!form.academic_year.trim() || !form.grade.trim()) {
      toast({ title: "Missing info", description: "Academic year and grade are required.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await onCreate({
      ...form,
      min_percentage_required: form.min_percentage_required || null,
      opens_on: form.opens_on || null,
      closes_on: form.closes_on || null,
      criteria_notes: form.criteria_notes || null,
    });
    setSubmitting(false);

    if (error) {
      toast({ title: "Could not create intake", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Admission intake created" });
    setForm(EMPTY_FORM);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700">
          <Plus className="h-4 w-4 mr-1.5" />
          New Intake
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col">
  <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 shrink-0">
    <DialogHeader>
      <DialogTitle className="text-white text-base flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
          <Plus className="h-4 w-4 text-white" />
        </div>
        New Admission Intake
      </DialogTitle>
    </DialogHeader>
  </div>

  <div className="grid gap-4 px-5 py-4 overflow-y-auto flex-1">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="academic_year" className="text-xs font-semibold text-slate-600">Academic Year</Label>
        <Input
          id="academic_year"
          placeholder="2027-2028"
          value={form.academic_year}
          onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))}
          className="border-slate-200 focus-visible:ring-indigo-400"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="grade" className="text-xs font-semibold text-slate-600">Grade</Label>
        <Input
          id="grade"
          placeholder="Grade 5"
          value={form.grade}
          onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
          className="border-slate-200 focus-visible:ring-indigo-400"
        />
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="total_seats" className="text-xs font-semibold text-slate-600">Total Seats</Label>
        <Input
          id="total_seats"
          type="number"
          min={0}
          value={form.total_seats}
          onChange={(e) => setForm((f) => ({ ...f, total_seats: Number(e.target.value) }))}
          className="border-slate-200 focus-visible:ring-indigo-400"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="min_percentage" className="text-xs font-semibold text-slate-600">Min. Previous % (optional)</Label>
        <Input
          id="min_percentage"
          type="number"
          min={0}
          max={100}
          step="0.1"
          placeholder="e.g. 60"
          value={form.min_percentage_required ?? ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, min_percentage_required: e.target.value ? Number(e.target.value) : null }))
          }
          className="border-slate-200 focus-visible:ring-indigo-400"
        />
      </div>
    </div>

    <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3.5">
      <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide mb-3">Application Window</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="opens_on" className="text-xs font-semibold text-slate-600">Opens On</Label>
          <Input
            id="opens_on"
            type="date"
            value={form.opens_on ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, opens_on: e.target.value }))}
            className="bg-white border-slate-200 focus-visible:ring-indigo-400"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="closes_on" className="text-xs font-semibold text-slate-600">Closes On</Label>
          <Input
            id="closes_on"
            type="date"
            value={form.closes_on ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, closes_on: e.target.value }))}
            className="bg-white border-slate-200 focus-visible:ring-indigo-400"
          />
        </div>
      </div>
    </div>

    <div className="space-y-1.5">
      <Label htmlFor="criteria_notes" className="text-xs font-semibold text-slate-600">Other Selection Criteria (optional)</Label>
      <Textarea
        id="criteria_notes"
        placeholder="e.g. Preference to siblings of current students; local residents within 5km prioritized"
        value={form.criteria_notes ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, criteria_notes: e.target.value }))}
        rows={3}
        className="border-slate-200 focus-visible:ring-indigo-400"
      />
    </div>
  </div>

  <DialogFooter className="px-5 py-4 border-t border-slate-100 shrink-0">
    <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setOpen(false)} disabled={submitting}>
      Cancel
    </Button>
    <Button
      onClick={handleSubmit}
      disabled={submitting}
      className="flex-1 sm:flex-none bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700"
    >
      {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
      Create Intake
    </Button>
  </DialogFooter>
</DialogContent>
    </Dialog>
  );
}
