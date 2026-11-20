import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, Link2, Loader2, Pencil, RefreshCw, Search, CalendarClock, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatInr, previewInstalments, type FeeAssignmentView, type FeeStructure } from "@/lib/feePlan";
import {
  cancelFeePlan, createInstalmentsFromPlan, linkFeePlanStudent, listFeeAssignments, listFeeStructures, listStudentsForLinking,
  listUnassignedAdmitted, resolveUnmatchedPlans, type LinkableStudent, type UnassignedApplicant,
} from "@/lib/feePlanApi";
import { FeeBreakdown, PaymentPill, PlanStatusPill } from "./FeePlanParts";
import { FeePlanEditorDialog, type PlanApplicant } from "./FeePlanEditorDialog";
import { FeePlanHistoryDialog } from "./FeePlanHistoryDialog";

type StatusFilter = "all" | "active" | "unmatched";

const SummaryCard = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
    <p className="text-xs text-slate-500">{label}</p>
    <p className={`text-lg font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{value}</p>
  </div>
);

/** "Admission Fee Plans" tab of the existing ERP Fees page: every admitted student's assigned plan, with admin controls. */
export function FeePlansTab({ schoolId }: { schoolId: string }) {
  const { toast } = useToast();
  const [plans, setPlans] = useState<FeeAssignmentView[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedApplicant[]>([]);
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [students, setStudents] = useState<LinkableStudent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busy, setBusy] = useState(false);

  const [editor, setEditor] = useState<{ applicant: PlanApplicant; existing: FeeAssignmentView | null } | null>(null);
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);
  const [detail, setDetail] = useState<FeeAssignmentView | null>(null);
  const [linking, setLinking] = useState<FeeAssignmentView | null>(null);
  const [linkStudentId, setLinkStudentId] = useState("");
  const [cancelling, setCancelling] = useState<FeeAssignmentView | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [p, u, s] = await Promise.all([listFeeAssignments(schoolId), listUnassignedAdmitted(schoolId), listFeeStructures(schoolId)]);
      setPlans(p); setUnassigned(u); setStructures(s);
    } catch (e) { setPlans([]); setLoadError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);

  const unmatched = (plans ?? []).filter((p) => p.status === "unmatched");
  const active = (plans ?? []).filter((p) => p.status === "active");
  const totals = useMemo(() => ({
    net: active.reduce((s, p) => s + p.net_total, 0), paid: active.reduce((s, p) => s + p.paid, 0), out: active.reduce((s, p) => s + p.outstanding, 0),
  }), [active]);

  const visible = (plans ?? []).filter((p) =>
    (filter === "all" || p.status === filter) &&
    (!search.trim() || `${p.applicant_name} ${p.class_grade} ${p.category ?? ""} ${p.structure_name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));

  const asApplicant = (p: FeeAssignmentView): PlanApplicant => ({ id: p.applicant_id, name: p.applicant_name, grade: p.class_grade, academicYear: p.academic_year, category: p.category });

  const recheck = async (includeUnassigned: boolean) => {
    setBusy(true);
    try {
      const r = await resolveUnmatchedPlans(schoolId, includeUnassigned);
      toast({
        title: r.assigned > 0 ? `${r.assigned} fee plan${r.assigned > 1 ? "s" : ""} assigned` : "No new fee plans assigned",
        description: r.still_unmatched > 0 ? `${r.still_unmatched} still have no matching fee structure - add one in Fee Structures or assign manually.` : r.failed > 0 ? `${r.failed} could not be processed.` : undefined,
      });
      await load();
    } catch (e) { toast({ title: "Re-check failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const openLink = async (p: FeeAssignmentView) => {
    setLinking(p); setLinkStudentId("");
    if (students.length === 0) { try { setStudents(await listStudentsForLinking(schoolId)); } catch { /* shown empty */ } }
  };
  const doLink = async () => {
    if (!linking || !linkStudentId) return;
    setBusy(true);
    try { await linkFeePlanStudent(linking.id, linkStudentId); toast({ title: "Student linked", description: "The fee now shows under this student in ERP Fees and their profile." }); setLinking(null); await load(); }
    catch (e) { toast({ title: "Couldn't link the student", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const doCancel = async () => {
    if (!cancelling || !cancelReason.trim()) return;
    setBusy(true);
    try { await cancelFeePlan(cancelling.id, cancelReason.trim()); toast({ title: "Fee plan cancelled" }); setCancelling(null); setCancelReason(""); await load(); }
    catch (e) { toast({ title: "Couldn't cancel", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const doInstalments = async (p: FeeAssignmentView) => {
    setBusy(true);
    try { await createInstalmentsFromPlan(p.id); toast({ title: "Instalment plan created", description: "Parents can see and pay it from the fee page. Manage it in the Instalments tab." }); await load(); }
    catch (e) { toast({ title: "Couldn't create the instalment plan", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  if (plans === null) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>;
  if (loadError) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">Couldn't load fee plans: {loadError}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Plans assigned" value={active.length} />
        <SummaryCard label="Net payable" value={formatInr(totals.net)} />
        <SummaryCard label="Collected" value={formatInr(totals.paid)} tone="text-emerald-700" />
        <SummaryCard label="Outstanding" value={formatInr(totals.out)} tone="text-red-600" />
      </div>

      {unmatched.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4" role="alert">
          <div className="flex gap-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <span><strong>{unmatched.length} admitted student{unmatched.length > 1 ? "s have" : " has"} no matching fee structure.</strong> Add a structure for their class, category and academic year then re-check, or assign a plan manually below.</span>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => recheck(false)} className="bg-white"><RefreshCw className="h-3.5 w-3.5 me-1" aria-hidden /> Re-check now</Button>
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700"><strong>{unassigned.length} admitted applicant{unassigned.length > 1 ? "s" : ""}</strong> without a fee plan (admitted before automatic assignment, or cancelled).</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => recheck(true)}>Assign automatically</Button>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {unassigned.slice(0, 8).map((u) => (
              <li key={u.applicant_id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate"><span className="font-medium text-slate-900">{u.full_name}</span> <span className="text-slate-500">· {u.grade} · {u.academic_year}{u.category ? ` · ${u.category}` : ""}</span></span>
                <Button size="sm" variant="ghost" onClick={() => setEditor({ applicant: { id: u.applicant_id, name: u.full_name, grade: u.grade, academicYear: u.academic_year, category: u.category }, existing: null })}>Assign…</Button>
              </li>
            ))}
          </ul>
          {unassigned.length > 8 && <p className="text-xs text-slate-500">+ {unassigned.length - 8} more. “Assign automatically” covers all of them.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <Input aria-label="Search fee plans" className="ps-8" placeholder="Search student, class or structure…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[190px]" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All fee plans</SelectItem>
            <SelectItem value="active">Assigned</SelectItem>
            <SelectItem value="unmatched">No fee structure</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-medium text-slate-800">{plans.length === 0 ? "No fee plans yet" : "No fee plans match your filters"}</p>
          {plans.length === 0 && <p className="text-sm text-slate-500 mt-1">A fee plan is assigned automatically when an applicant's status is set to Admitted in Admissions.</p>}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Student</TableHead>
                <TableHead className="hidden sm:table-cell">Class · Year</TableHead>
                <TableHead className="hidden lg:table-cell">Structure</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-end">Net payable</TableHead>
                <TableHead className="hidden md:table-cell text-end">Outstanding</TableHead>
                <TableHead className="hidden md:table-cell">Payment</TableHead>
                <TableHead className="text-end">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetail(p)}>
                  <TableCell className="font-medium text-slate-900">
                    {p.applicant_name}
                    {p.status === "active" && !p.student_id && <span className="block text-xs font-normal text-amber-700">Not yet linked to an enrolled student</span>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-slate-600">{p.class_grade} · {p.academic_year}{p.category && <span className="block text-xs text-slate-500">{p.category}</span>}</TableCell>
                  <TableCell className="hidden lg:table-cell text-slate-600">
                    {p.structure_name ?? (p.status === "unmatched" ? "—" : "Custom amounts")}
                    {p.match_basis === "default" && <span className="block text-xs text-slate-500" title="No structure for this category, so the all-categories structure was used">All-categories structure</span>}
                  </TableCell>
                  <TableCell><PlanStatusPill status={p.status} /></TableCell>
                  <TableCell className="text-end tabular-nums font-semibold">{p.status === "active" ? formatInr(p.net_total) : "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-end tabular-nums text-red-600">{p.status === "active" ? formatInr(p.outstanding) : "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{p.status === "active" ? <PaymentPill plan={p} /> : "—"}</TableCell>
                  <TableCell className="text-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => setEditor({ applicant: asApplicant(p), existing: p })}>
                      <Pencil className="h-3.5 w-3.5 me-1" aria-hidden /> {p.status === "unmatched" ? "Assign" : "Correct"}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`History for ${p.applicant_name}`} onClick={() => setHistory({ id: p.applicant_id, name: p.applicant_name })}><History className="h-4 w-4 text-slate-500" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.applicant_name}</DialogTitle>
                <DialogDescription>{detail.class_grade} · {detail.academic_year}{detail.category ? ` · ${detail.category}` : ""}{detail.structure_name ? ` · ${detail.structure_name}` : ""}</DialogDescription>
              </DialogHeader>
              {detail.status === "active" ? (
                <div className="space-y-3">
                  <FeeBreakdown plan={detail} />
                  {detail.due_date && <p className="text-sm text-slate-600">Due {new Date(detail.due_date).toLocaleDateString()}</p>}
                  {detail.instalment_schedule && (
                    <div className="rounded-lg border border-slate-200 p-3 text-sm">
                      <p className="font-medium text-slate-800 flex items-center gap-1.5"><CalendarClock className="h-4 w-4" aria-hidden /> Instalment template</p>
                      <ul className="mt-1 space-y-0.5 text-slate-600">
                        {previewInstalments(detail.instalment_schedule, detail.outstanding).map((r, i) => <li key={i} className="flex justify-between"><span>{r.label} · {new Date(r.due_date).toLocaleDateString()}</span><span className="tabular-nums">{formatInr(r.amount)}</span></li>)}
                      </ul>
                      {detail.has_instalment_plan ? <p className="mt-2 text-xs text-emerald-700">An instalment plan is already active for this fee.</p>
                        : detail.student_id ? <Button size="sm" className="mt-2" disabled={busy} onClick={() => doInstalments(detail)}>Create instalment plan</Button>
                        : <p className="mt-2 text-xs text-slate-500">Link the enrolled student to create the instalment plan.</p>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!detail.student_id && <Button size="sm" variant="outline" onClick={() => { const d = detail; setDetail(null); void openLink(d); }}><Link2 className="h-3.5 w-3.5 me-1" aria-hidden /> Link to enrolled student</Button>}
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => { const d = detail; setDetail(null); setCancelling(d); }}><Ban className="h-3.5 w-3.5 me-1" aria-hidden /> Cancel plan</Button>
                  </div>
                </div>
              ) : <p className="text-sm text-slate-600">No fee structure matched this applicant. Use <strong>Assign</strong> to pick a structure or enter amounts.</p>}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Link student */}
      <Dialog open={!!linking} onOpenChange={(o) => !o && setLinking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link to enrolled student</DialogTitle>
            <DialogDescription>Choose the student record for {linking?.applicant_name}. The fee will then appear under that student in ERP Fees, their profile and the parent fee page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Student</Label>
            <Select value={linkStudentId} onValueChange={setLinkStudentId}>
              <SelectTrigger><SelectValue placeholder="Select a student" /></SelectTrigger>
              <SelectContent>
                {students.length === 0 ? <div className="px-2 py-1.5 text-sm text-slate-500">No students found</div>
                  : students.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}{s.class ? ` · ${s.class}${s.section ? `-${s.section}` : ""}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setLinking(null)} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !linkStudentId} onClick={doLink} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">Link student</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={!!cancelling} onOpenChange={(o) => { if (!o) { setCancelling(null); setCancelReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel fee plan</DialogTitle>
            <DialogDescription>This removes the fee record for {cancelling?.applicant_name}. It is only possible while no payment has been recorded; otherwise correct the plan instead. The change is saved in the history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason (required)</Label>
            <Textarea id="cancel-reason" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={busy}>Keep plan</Button>
            <Button disabled={busy || !cancelReason.trim()} onClick={doCancel} className="bg-red-600 hover:bg-red-700 text-white">Cancel plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FeePlanEditorDialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)} applicant={editor?.applicant ?? null} existing={editor?.existing ?? null}
        structures={structures} schoolId={schoolId} onSaved={load} />
      <FeePlanHistoryDialog open={!!history} onOpenChange={(o) => !o && setHistory(null)} applicantId={history?.id ?? null} applicantName={history?.name ?? ""} />
    </div>
  );
}
