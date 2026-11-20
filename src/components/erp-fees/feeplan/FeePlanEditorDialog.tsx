import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  FEE_LINES, computeBreakdown, emptyLines, formatInr, matchStructure, validatePlanInput,
  type FeeAssignmentView, type FeeLineKey, type FeeLines, type FeeStructure,
} from "@/lib/feePlan";
import { assignFeePlan } from "@/lib/feePlanApi";

export interface PlanApplicant { id: string; name: string; grade: string; academicYear: string; category: string | null }

const CUSTOM = "__custom__";
const linesOf = (s: Partial<FeeLines>): FeeLines => ({ ...emptyLines(), ...Object.fromEntries(FEE_LINES.map(({ key }) => [key, Number(s[key]) || 0])) });
const sameLines = (a: FeeLines, b: FeeLines) => FEE_LINES.every(({ key }) => a[key] === b[key]);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicant: PlanApplicant | null;
  /** The existing live plan when correcting; null/unmatched when assigning for the first time. */
  existing: FeeAssignmentView | null;
  structures: FeeStructure[];
  schoolId: string;
  onSaved: () => void;
}

/** Assign a plan manually (no structure matched / admitted before the feature) or correct an existing one. */
export function FeePlanEditorDialog({ open, onOpenChange, applicant, existing, structures, schoolId, onSaved }: Props) {
  const { toast } = useToast();
  const correcting = existing?.status === "active";
  const [structureId, setStructureId] = useState<string>(CUSTOM);
  const [lines, setLines] = useState<FeeLines>(emptyLines());
  const [concession, setConcession] = useState("0");
  const [concessionReason, setConcessionReason] = useState("");
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const schoolStructures = useMemo(() => structures.filter((s) => s.school_id === schoolId), [structures, schoolId]);
  // Structures for the applicant's own class/year come first; others stay selectable (e.g. a different category).
  const ordered = useMemo(() => {
    if (!applicant) return schoolStructures;
    const key = (s: FeeStructure) => (matchStructure([s], { academic_year: applicant.academicYear, class_grade: applicant.grade, category: s.category }) ? 0 : 1);
    return [...schoolStructures].filter((s) => s.is_active || s.id === existing?.structure_id).sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name));
  }, [schoolStructures, applicant, existing?.structure_id]);

  useEffect(() => {
    if (!open || !applicant) return;
    setReason("");
    if (existing && existing.status === "active") {
      setStructureId(existing.structure_id ?? CUSTOM);
      setLines(linesOf(existing));
      setConcession(String(existing.concession_amount ?? 0));
      setConcessionReason(existing.concession_reason ?? "");
      setDueDate(existing.due_date ? existing.due_date.slice(0, 10) : "");
    } else {
      const m = matchStructure(schoolStructures, { academic_year: applicant.academicYear, class_grade: applicant.grade, category: applicant.category });
      setStructureId(m?.structure.id ?? CUSTOM);
      setLines(m ? linesOf(m.structure) : emptyLines());
      setConcession("0");
      setConcessionReason("");
      setDueDate(m?.structure.due_date ?? "");
    }
  }, [open, applicant, existing, schoolStructures]);

  const pickStructure = (id: string) => {
    setStructureId(id);
    const s = schoolStructures.find((x) => x.id === id);
    if (s) { setLines(linesOf(s)); if (s.due_date) setDueDate(s.due_date); }
  };

  const conc = Number(concession) || 0;
  const paid = existing?.paid ?? 0;
  const selected = schoolStructures.find((s) => s.id === structureId) ?? null;
  const error = validatePlanInput(lines, conc, concessionReason, paid);
  const preview = computeBreakdown(lines, error ? 0 : conc, paid, dueDate || null);
  const needsReason = correcting && !reason.trim();
  const customised = selected ? !sameLines(lines, linesOf(selected)) : true;

  const save = async () => {
    if (!applicant || error || needsReason) return;
    setSaving(true);
    try {
      await assignFeePlan({
        applicantId: applicant.id,
        structureId: selected?.id ?? null,
        lines: customised ? lines : null,            // untouched structure amounts -> the server uses the structure (and keeps its instalment template)
        concession: conc, concessionReason, reason, dueDate: dueDate || null,
      });
      toast({ title: correcting ? "Fee plan corrected" : "Fee plan assigned", description: `${applicant.name}: net payable ${formatInr(preview.net)}` });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't save the fee plan", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!applicant) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{correcting ? "Review / correct fee plan" : "Assign fee plan"}</DialogTitle>
          <DialogDescription>
            {applicant.name} · {applicant.grade} · {applicant.academicYear}{applicant.category ? ` · ${applicant.category}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!correcting && existing?.status === "unmatched" && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <span>No fee structure matched this class, category and academic year. Pick one below or enter the amounts yourself.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Fee structure</Label>
            <Select value={structureId} onValueChange={pickStructure}>
              <SelectTrigger><SelectValue placeholder="Choose a fee structure" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM}>Custom amounts (no structure)</SelectItem>
                {ordered.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {s.class_grade} · {s.academic_year}{s.category ? ` · ${s.category}` : ""} · {formatInr(s.total_fee)}{s.is_active ? "" : " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && customised && <p className="text-xs text-slate-500">Amounts differ from the structure, so they are saved as custom amounts.</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEE_LINES.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`fp-${key}`} className="text-xs text-slate-600">{label} (₹)</Label>
                <Input id={`fp-${key}`} type="number" min={0} step="0.01" inputMode="decimal" value={lines[key]}
                  onChange={(e) => setLines((l) => ({ ...l, [key as FeeLineKey]: e.target.value === "" ? 0 : Number(e.target.value) }))} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fp-conc" className="text-xs text-slate-600">Concession / discount (₹)</Label>
              <Input id="fp-conc" type="number" min={0} step="0.01" inputMode="decimal" value={concession} onChange={(e) => setConcession(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fp-due" className="text-xs text-slate-600">Due date</Label>
              <Input id="fp-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {conc > 0 && (
            <div className="space-y-1">
              <Label htmlFor="fp-concr" className="text-xs text-slate-600">Reason for concession (required)</Label>
              <Input id="fp-concr" placeholder="e.g. Merit scholarship, sibling discount" value={concessionReason} onChange={(e) => setConcessionReason(e.target.value)} />
            </div>
          )}
          {correcting && (
            <div className="space-y-1">
              <Label htmlFor="fp-reason" className="text-xs text-slate-600">Reason for this correction (required, saved in the history)</Label>
              <Textarea id="fp-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1" aria-live="polite">
            <div className="flex justify-between"><span className="text-slate-600">Total fee</span><span className="tabular-nums">{formatInr(preview.gross)}</span></div>
            {preview.concession > 0 && <div className="flex justify-between text-emerald-700"><span>Concession</span><span className="tabular-nums">− {formatInr(preview.concession)}</span></div>}
            <div className="flex justify-between font-semibold text-slate-900"><span>Net payable</span><span className="tabular-nums">{formatInr(preview.net)}</span></div>
            {paid > 0 && <div className="flex justify-between"><span className="text-slate-600">Already paid</span><span className="tabular-nums text-emerald-700">{formatInr(paid)}</span></div>}
            <div className="flex justify-between"><span className="text-slate-600">Outstanding</span><span className="tabular-nums text-red-600">{formatInr(preview.outstanding)}</span></div>
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !!error || needsReason} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">
            {saving && <Loader2 className="h-4 w-4 me-1 animate-spin" aria-hidden />}
            {correcting ? "Save correction" : "Assign fee plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
