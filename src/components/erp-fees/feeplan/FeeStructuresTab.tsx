import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Loader2, Pencil, Plus, Power, Trash2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  FEE_LINES, emptyLines, formatInr, sumLines, validateInstalmentTemplate, validatePlanInput,
  type FeeLines, type FeeStructure, type InstalmentTemplateRow,
} from "@/lib/feePlan";
import { deleteFeeStructure, listFeeStructures, saveFeeStructure, setFeeStructureActive } from "@/lib/feePlanApi";
import { Pill } from "./FeePlanParts";

interface FormState extends FeeLines {
  id?: string; name: string; academic_year: string; class_grade: string; category: string; due_date: string;
  notes: string; is_active: boolean; schedule: InstalmentTemplateRow[];
}
const blank = (year = ""): FormState => ({ ...emptyLines(), name: "", academic_year: year, class_grade: "", category: "", due_date: "", notes: "", is_active: true, schedule: [] });
const fromStructure = (s: FeeStructure): FormState => ({
  id: s.id, name: s.name, academic_year: s.academic_year, class_grade: s.class_grade, category: s.category ?? "", due_date: s.due_date ?? "", notes: s.notes ?? "",
  is_active: s.is_active, schedule: s.instalment_schedule ?? [],
  admission_fee: s.admission_fee, tuition_fee: s.tuition_fee, transport_fee: s.transport_fee, uniform_fee: s.uniform_fee, material_fee: s.material_fee, exam_fee: s.exam_fee, other_fee: s.other_fee,
});

/** "Fee Structures" tab of the existing ERP Fees page: price lists per academic year, class and student category. */
export function FeeStructuresTab({ schoolId }: { schoolId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<FeeStructure[] | null>(null);
  const [year, setYear] = useState("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<FeeStructure | null>(null);
  const [suggest, setSuggest] = useState<{ grades: string[]; years: string[] }>({ grades: [], years: [] });

  const load = useCallback(async () => {
    try { setRows(await listFeeStructures(schoolId)); }
    catch (e) { setRows([]); toast({ title: "Couldn't load fee structures", description: (e as Error).message, variant: "destructive" }); }
  }, [schoolId, toast]);

  useEffect(() => { void load(); }, [load]);

  // Suggest the exact class / year labels already used by this school's admission intakes, so structures match applicants.
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("admission_intakes").select("grade, academic_year").eq("school_id", schoolId);
      const list = (data ?? []) as { grade: string; academic_year: string }[];
      setSuggest({ grades: [...new Set(list.map((i) => i.grade))], years: [...new Set(list.map((i) => i.academic_year))] });
    })();
  }, [schoolId]);

  const years = useMemo(() => [...new Set((rows ?? []).map((r) => r.academic_year))], [rows]);
  const visible = (rows ?? []).filter((r) => year === "all" || r.academic_year === year);

  const total = form ? sumLines(form) : 0;
  const formError = useMemo(() => {
    if (!form) return null;
    if (!form.name.trim()) return "Give the structure a name";
    if (!form.academic_year.trim()) return "Academic year is required";
    if (!form.class_grade.trim()) return "Class is required";
    return validatePlanInput(form, 0, "") ?? validateInstalmentTemplate(form.schedule);
  }, [form]);

  const save = async () => {
    if (!form || formError) return;
    setSaving(true);
    try {
      await saveFeeStructure({
        id: form.id, school_id: schoolId, name: form.name, academic_year: form.academic_year, class_grade: form.class_grade,
        category: form.category.trim() || null, due_date: form.due_date || null, notes: form.notes.trim() || null, is_active: form.is_active,
        instalment_schedule: form.schedule.length ? form.schedule : null,
        admission_fee: form.admission_fee, tuition_fee: form.tuition_fee, transport_fee: form.transport_fee, uniform_fee: form.uniform_fee,
        material_fee: form.material_fee, exam_fee: form.exam_fee, other_fee: form.other_fee,
      });
      toast({
        title: form.id ? "Fee structure updated" : "Fee structure created",
        description: form.id ? "Students who already have a fee plan keep it; correct those from the Admission Fee Plans tab."
          : "Admitted students waiting for a structure are assigned when you press Re-check on the Admission Fee Plans tab.",
      });
      setForm(null);
      await load();
    } catch (e) {
      toast({ title: "Couldn't save the fee structure", description: (e as Error).message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const toggleActive = async (s: FeeStructure) => {
    try { await setFeeStructureActive(s.id, !s.is_active); await load(); }
    catch (e) { toast({ title: "Couldn't change the status", description: (e as Error).message, variant: "destructive" }); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await deleteFeeStructure(toDelete.id); toast({ title: "Fee structure deleted" }); await load(); }
    catch (e) { toast({ title: "Couldn't delete", description: (e as Error).message, variant: "destructive" }); }
    setToDelete(null);
  };

  const setSched = (i: number, patch: Partial<InstalmentTemplateRow>) =>
    setForm((f) => f && { ...f, schedule: f.schedule.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Fee structures</h2>
          <p className="text-sm text-slate-500">The fee plan an admitted student gets is picked from here by class, student category and academic year.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[150px]" aria-label="Academic year"><SelectValue placeholder="Academic year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => setForm(blank(suggest.years[0] ?? ""))} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">
            <Plus className="h-4 w-4 me-1" aria-hidden /> New structure
          </Button>
        </div>
      </div>

      {rows === null ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
        : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="font-medium text-slate-800">No fee structures yet</p>
            <p className="text-sm text-slate-500 mt-1">Create one per class (and per student category if fees differ) so fee plans are assigned automatically when a student is admitted.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Name</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="hidden sm:table-cell">Year</TableHead>
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead className="text-end">Total</TableHead>
                  <TableHead className="hidden md:table-cell">Instalments</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((s) => (
                  <TableRow key={s.id} className={s.is_active ? "" : "opacity-60"}>
                    <TableCell className="font-medium text-slate-900">{s.name}</TableCell>
                    <TableCell>{s.class_grade}</TableCell>
                    <TableCell className="hidden sm:table-cell">{s.academic_year}</TableCell>
                    <TableCell className="hidden md:table-cell">{s.category ?? <span className="text-slate-500">All categories</span>}</TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">{formatInr(s.total_fee)}</TableCell>
                    <TableCell className="hidden md:table-cell text-slate-600">{s.instalment_schedule ? `${s.instalment_schedule.length} instalments` : "—"}</TableCell>
                    <TableCell>{s.is_active ? <Pill tone="success" icon={CheckCircle2} label="Active" /> : <Pill tone="muted" icon={XCircle} label="Inactive" />}</TableCell>
                    <TableCell className="text-end whitespace-nowrap">
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${s.name}`} onClick={() => setForm(fromStructure(s))}><Pencil className="h-4 w-4 text-slate-500" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Copy ${s.name} to a new structure`} onClick={() => setForm({ ...fromStructure(s), id: undefined, name: `${s.name} (copy)`, is_active: false })}><Copy className="h-4 w-4 text-slate-500" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={s.is_active ? `Deactivate ${s.name}` : `Activate ${s.name}`} onClick={() => toggleActive(s)}><Power className={`h-4 w-4 ${s.is_active ? "text-emerald-600" : "text-slate-400"}`} /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${s.name}`} onClick={() => setToDelete(s)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {form && (
            <>
              <DialogHeader>
                <DialogTitle>{form.id ? "Edit fee structure" : "New fee structure"}</DialogTitle>
                <DialogDescription>Only one active structure can exist per academic year, class and category. Leave category blank to apply to every category without its own structure.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1 sm:col-span-2"><Label htmlFor="fs-name">Name</Label>
                    <Input id="fs-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Grade 5 – Standard" /></div>
                  <div className="space-y-1"><Label htmlFor="fs-year">Academic year</Label>
                    <Input id="fs-year" list="fs-years" value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="e.g. 2026-27" />
                    <datalist id="fs-years">{suggest.years.map((y) => <option key={y} value={y} />)}</datalist></div>
                  <div className="space-y-1"><Label htmlFor="fs-class">Class / course</Label>
                    <Input id="fs-class" list="fs-grades" value={form.class_grade} onChange={(e) => setForm({ ...form, class_grade: e.target.value })} placeholder="e.g. Grade 5" />
                    <datalist id="fs-grades">{suggest.grades.map((g) => <option key={g} value={g} />)}</datalist></div>
                  <div className="space-y-1"><Label htmlFor="fs-cat">Student category (optional)</Label>
                    <Input id="fs-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="All categories" /></div>
                  <div className="space-y-1"><Label htmlFor="fs-due">Due date (optional)</Label>
                    <Input id="fs-due" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-slate-800">Fee components (₹)</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {FEE_LINES.map(({ key, label }) => (
                      <div key={key} className="space-y-1"><Label htmlFor={`fs-${key}`} className="text-xs text-slate-600">{label}</Label>
                        <Input id={`fs-${key}`} type="number" min={0} step="0.01" inputMode="decimal" value={form[key]}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
                    ))}
                  </div>
                  <p className="text-sm font-semibold text-slate-900">Total: {formatInr(total)}</p>
                </fieldset>

                <fieldset className="space-y-2">
                  <div className="flex items-center justify-between">
                    <legend className="text-sm font-medium text-slate-800">Instalment schedule (optional)</legend>
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, schedule: [...form.schedule, { label: `Instalment ${form.schedule.length + 1}`, percent: 0, due_date: "" }] })}>
                      <Plus className="h-3.5 w-3.5 me-1" aria-hidden /> Add instalment
                    </Button>
                  </div>
                  {form.schedule.length === 0 ? <p className="text-xs text-slate-500">No template: the student pays the full amount by the due date. A template is offered as an instalment plan once the student is enrolled.</p> : (
                    <div className="space-y-2">
                      {form.schedule.map((r, i) => (
                        <div key={i} className="grid grid-cols-[1fr_5.5rem_9rem_auto] gap-2 items-center">
                          <Input aria-label={`Instalment ${i + 1} name`} value={r.label} onChange={(e) => setSched(i, { label: e.target.value })} />
                          <Input aria-label={`Instalment ${i + 1} percent`} type="number" min={0} max={100} step="0.01" value={r.percent} onChange={(e) => setSched(i, { percent: Number(e.target.value) })} />
                          <Input aria-label={`Instalment ${i + 1} due date`} type="date" value={r.due_date} onChange={(e) => setSched(i, { due_date: e.target.value })} />
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove instalment ${i + 1}`} onClick={() => setForm({ ...form, schedule: form.schedule.filter((_, idx) => idx !== i) })}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                        </div>
                      ))}
                      <p className="text-xs text-slate-500">Percentages must add up to 100 (now {form.schedule.reduce((s, r) => s + (Number(r.percent) || 0), 0)}).</p>
                    </div>
                  )}
                </fieldset>

                <div className="space-y-1"><Label htmlFor="fs-notes">Notes (optional)</Label>
                  <Textarea id="fs-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <div className="flex items-center gap-2"><Switch id="fs-active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /><Label htmlFor="fs-active">Active (used for automatic assignment)</Label></div>
                {formError && form.name.trim() && <p className="text-sm text-red-600" role="alert">{formError}</p>}
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
                <Button onClick={save} disabled={saving || !!formError} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">
                  {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" aria-hidden />} Save structure
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this fee structure?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.name} will be removed. A structure already assigned to students cannot be deleted - deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
