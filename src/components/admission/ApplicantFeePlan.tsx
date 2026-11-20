import { useCallback, useEffect, useState } from "react";
import { History, Pencil, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatInr, type FeeAssignmentView, type FeeStructure } from "@/lib/feePlan";
import { getApplicantFeePlan, listFeeAssignments, listFeeStructures, type ApplicantFeePlan as PlanData } from "@/lib/feePlanApi";
import { FeeBreakdown, PaymentPill, PlanStatusPill } from "@/components/erp-fees/feeplan/FeePlanParts";
import { FeePlanEditorDialog } from "@/components/erp-fees/feeplan/FeePlanEditorDialog";
import { FeePlanHistoryDialog } from "@/components/erp-fees/feeplan/FeePlanHistoryDialog";
import type { AdmissionApplicant } from "@/types/admission";

/**
 * applicant_id -> live fee assignment for the whole school, loaded once for the Applicants table (not one request per row).
 * Fails silently for users who may not view fees: the Applicants table then simply shows no fee column content.
 */
export function useFeePlanMap(schoolId: string | null | undefined) {
  const [map, setMap] = useState<Record<string, FeeAssignmentView>>({});
  const [allowed, setAllowed] = useState(false);
  const refetch = useCallback(async () => {
    if (!schoolId) return;
    try {
      const list = await listFeeAssignments(schoolId);
      const m: Record<string, FeeAssignmentView> = {};
      for (const a of list) if (a.status !== "cancelled") m[a.applicant_id] = a;
      setMap(m); setAllowed(true);
    } catch { setAllowed(false); }
  }, [schoolId]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { map, allowed, refetch };
}

interface CellProps { applicant: AdmissionApplicant; plan: FeeAssignmentView | undefined; schoolId: string; onChanged: () => void }

/** Shown under the status of an ADMITTED applicant: plan state + amount, and a button for the full breakdown and admin controls. */
export function ApplicantFeePlanCell({ applicant, plan, schoolId, onChanged }: CellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 space-y-1">
      {plan ? <PlanStatusPill status={plan.status} /> : <span className="text-xs text-amber-700">No fee plan yet</span>}
      {plan?.status === "active" && <div className="text-xs text-slate-600 tabular-nums">{formatInr(plan.net_total)} · due {formatInr(plan.outstanding)}</div>}
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        <Wallet className="h-3.5 w-3.5 me-1" aria-hidden /> Fee plan
      </Button>
      {open && <ApplicantFeePlanDialog open={open} onOpenChange={setOpen} applicant={applicant} schoolId={schoolId} onChanged={onChanged} />}
    </div>
  );
}

function ApplicantFeePlanDialog({ open, onOpenChange, applicant, schoolId, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; applicant: AdmissionApplicant; schoolId: string; onChanged: () => void }) {
  const [data, setData] = useState<PlanData | null>(null);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [d, s] = await Promise.all([getApplicantFeePlan(applicant.id), listFeeStructures(schoolId)]);
      setData(d); setStructures(s);
    } catch (e) { setError((e as Error).message); }
  }, [applicant.id, schoolId]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const plan = data?.assignment ?? null;
  const person = { id: applicant.id, name: applicant.full_name, grade: data?.class_grade ?? applicant.intake?.grade ?? "", academicYear: data?.academic_year ?? "", category: data?.category ?? applicant.category ?? null };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fee plan</DialogTitle>
            <DialogDescription>{applicant.full_name}{data ? ` · ${data.class_grade} · ${data.academic_year}` : ""}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p>
            : !data ? <p className="text-sm text-slate-500">Loading…</p>
            : data.applicant_status !== "admitted" ? <p className="text-sm text-slate-600">A fee plan is assigned automatically once the admission is confirmed (status Admitted).</p>
            : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {plan ? <PlanStatusPill status={plan.status} /> : null}
                  {plan?.status === "active" && <PaymentPill plan={plan} />}
                  {plan?.structure_name && <span className="text-xs text-slate-500">{plan.structure_name}</span>}
                </div>
                {plan?.status === "active" ? <FeeBreakdown plan={plan} /> : (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    {plan?.status === "unmatched"
                      ? "No fee structure matches this class, category and academic year."
                      : "This applicant has no fee plan."} Add a matching structure in ERP Fees, or assign a plan manually.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setEditing(true)} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">
                    <Pencil className="h-3.5 w-3.5 me-1" aria-hidden /> {plan?.status === "active" ? "Review / correct" : "Assign manually"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowHistory(true)}><History className="h-3.5 w-3.5 me-1" aria-hidden /> History</Button>
                </div>
              </div>
            )}
        </DialogContent>
      </Dialog>
      <FeePlanEditorDialog open={editing} onOpenChange={setEditing} applicant={person} existing={plan} structures={structures} schoolId={schoolId} onSaved={() => { void load(); onChanged(); }} />
      <FeePlanHistoryDialog open={showHistory} onOpenChange={setShowHistory} applicantId={applicant.id} applicantName={applicant.full_name} />
    </>
  );
}
