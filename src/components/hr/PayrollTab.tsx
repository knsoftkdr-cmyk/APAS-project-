// Payroll (ERP > People > Payroll): generate a month from attendance + salary structures, review, finalize, track payment.
// Calculation happens on the server (edge function); this screen reads the result.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileText, Gift, Loader2, Lock, LockOpen, RefreshCw, Settings2, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { StatutorySettings } from "@/components/hr/StatutorySettings";
import { cn } from "@/lib/utils";
import {
  addAdjustment, deleteAdjustment, deletePayrollRun, downloadAllSalarySlips, downloadSalarySlip, finalizePayroll, generatePayroll, inr, listAdjustments,
  listRunItems, listRuns, markSalaryPaid, monthLabel, reopenPayroll, type Employee, type PayrollItem, type PayrollRun,
} from "@/lib/hr";

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";
const err = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);

interface Props { orgId: string; userId: string | null; orgName: string; employees: Employee[] }

export function PayrollTab({ orgId, userId, orgName, employees }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [slip, setSlip] = useState<PayrollItem | null>(null);
  const [payFor, setPayFor] = useState<PayrollItem[] | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "regenerate" | "finalize" | "reopen">(null);

  const runs = useQuery({ queryKey: ["hr-runs", orgId], queryFn: () => listRuns(orgId), staleTime: 15_000 });
  const run: PayrollRun | undefined = runs.data?.find((r) => r.year === ym.year && r.month === ym.month);
  const items = useQuery({ queryKey: ["hr-run-items", run?.id], queryFn: () => listRunItems(run!.id), enabled: !!run });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["hr-runs", orgId] }); qc.invalidateQueries({ queryKey: ["hr-run-items"] }); };

  const gen = useMutation({
    mutationFn: () => generatePayroll(orgId, ym.year, ym.month),
    onSuccess: (r) => { refresh(); toast({ title: `Payroll generated for ${r.employees} employee${r.employees === 1 ? "" : "s"}`, description: r.skipped.length ? `${r.skipped.length} skipped: ${r.skipped.slice(0, 2).map((s) => `${s.employee} (${s.reason})`).join(", ")}` : undefined }); },
    onError: (e) => toast({ title: err(e, "Couldn't generate payroll"), variant: "destructive" }),
  });
  const act = useMutation({
    mutationFn: async (a: "finalize" | "reopen" | "delete") => (a === "finalize" ? finalizePayroll(orgId, run!.id) : a === "reopen" ? reopenPayroll(orgId, run!.id) : deletePayrollRun(orgId, run!.id)),
    onSuccess: (_r, a) => { refresh(); toast({ title: a === "finalize" ? "Payroll finalized" : a === "reopen" ? "Payroll reopened" : "Draft deleted" }); },
    onError: (e) => toast({ title: err(e, "That didn't work"), variant: "destructive" }),
  });

  const shift = (d: number) => setYm((v) => { const m = v.month + d; return m < 1 ? { year: v.year - 1, month: 12 } : m > 12 ? { year: v.year + 1, month: 1 } : { year: v.year, month: m }; });
  const t = run?.totals ?? {};
  const list = items.data ?? [];
  const paidCount = list.filter((i) => i.payment_status === "paid").length;
  const finalized = run?.status === "finalized";
  const busy = gen.isPending || act.isPending;

  const onConfirm = () => { const c = confirm; setConfirm(null); if (c === "regenerate") gen.mutate(); else if (c) act.mutate(c); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1"><Button size="icon" variant="outline" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[9rem] text-center font-semibold text-blue-950">{monthLabel(ym.year, ym.month)}</span>
          <Button size="icon" variant="outline" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button></div>
        {run && <Badge className={cn("rounded-full", finalized ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100")}>{finalized ? "Finalized" : "Draft"}</Badge>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => setSettingsOpen(true)}><Settings2 className="me-1.5 h-4 w-4" />Statutory settings</Button>
          <Button variant="outline" className="rounded-full" onClick={() => setAdjOpen(true)}><Gift className="me-1.5 h-4 w-4" />Bonus & deductions</Button>
        </div>
      </div>

      {runs.isLoading ? <Skeleton className="h-40 w-full" /> : runs.isError ? <p className="text-sm text-red-600">{err(runs.error, "Couldn't load payroll")}</p> : !run ? (
        <div className="rounded-2xl border-2 border-dashed border-blue-200 bg-white p-8 text-center">
          <Wallet className="mx-auto mb-3 h-10 w-10 text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-900">No payroll for {monthLabel(ym.year, ym.month)} yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Payroll is calculated from each employee's salary structure and this month's attendance, with EPF, ESI and TDS applied from your statutory settings.</p>
          <Button className="mt-4 rounded-full bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 px-6 text-white" disabled={busy} onClick={() => gen.mutate()}>
            {gen.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="me-1.5 h-4 w-4" />}Generate payroll</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {!finalized && <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => setConfirm("regenerate")}>{gen.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="me-1.5 h-4 w-4" />}Regenerate</Button>}
            {!finalized && <Button className="rounded-full bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => setConfirm("finalize")}><Lock className="me-1.5 h-4 w-4" />Finalize month</Button>}
            {finalized && <Button variant="outline" className="rounded-full" disabled={busy || paidCount > 0} title={paidCount > 0 ? "Mark salaries unpaid before reopening" : undefined} onClick={() => setConfirm("reopen")}><LockOpen className="me-1.5 h-4 w-4" />Reopen</Button>}
            {!finalized && <Button variant="ghost" className="rounded-full text-red-600" disabled={busy} onClick={() => setConfirm("delete")}><Trash2 className="me-1.5 h-4 w-4" />Delete draft</Button>}
            <Button variant="outline" className="rounded-full" disabled={!list.length} onClick={() => downloadAllSalarySlips(list, run, orgName)}><Download className="me-1.5 h-4 w-4" />All salary slips (PDF)</Button>
            {finalized && <Button variant="outline" className="rounded-full" disabled={!list.length || paidCount === list.length} onClick={() => setPayFor(list.filter((i) => i.payment_status !== "paid"))}><Wallet className="me-1.5 h-4 w-4" />Mark all as paid</Button>}
          </div>

          {run.warnings?.length > 0 && (
            <details className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <summary className="flex cursor-pointer items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{run.warnings.length} thing{run.warnings.length === 1 ? "" : "s"} to check</summary>
              <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs">{run.warnings.slice(0, 40).map((w, i) => <li key={i}><b>{w.employee}</b>: {w.message}</li>)}</ul>
            </details>
          )}

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[["Employees", String(t.employees ?? 0)], ["Gross pay", inr(t.gross ?? 0)], ["Deductions", inr(t.total_deductions ?? 0)], ["Net payable", inr(t.net_pay ?? 0)], ["Cost to school", inr(t.cost_to_school ?? 0)]].map(([l, v], i) => (
              <div key={l} className={cn("rounded-xl border bg-white p-3", i === 3 && "border-emerald-300 bg-emerald-50/50")}><p className="text-[11px] text-muted-foreground">{l}</p><p className="text-lg font-semibold text-blue-950">{v}</p></div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-slate-50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start font-medium">Statutory contributions</th><th className="px-3 py-2 text-end font-medium">Employee pays</th><th className="px-3 py-2 text-end font-medium">Employer pays</th></tr></thead>
              <tbody>
                <tr className="border-t"><td className="px-3 py-1.5">Provident fund (EPF)</td><td className="px-3 py-1.5 text-end">{inr(t.epf_employee ?? 0)}</td><td className="px-3 py-1.5 text-end">{inr((t.employer?.epf ?? 0) + (t.employer?.eps ?? 0))} <span className="text-[11px] text-muted-foreground">(EPF {inr(t.employer?.epf ?? 0)} + EPS {inr(t.employer?.eps ?? 0)})</span></td></tr>
                <tr className="border-t"><td className="px-3 py-1.5">EDLI & EPF admin charges</td><td className="px-3 py-1.5 text-end text-muted-foreground">—</td><td className="px-3 py-1.5 text-end">{inr((t.employer?.edli ?? 0) + (t.employer?.admin ?? 0))}{t.epf_admin_minimum_topup > 0 && <span className="text-[11px] text-muted-foreground"> (admin minimum applied)</span>}</td></tr>
                <tr className="border-t"><td className="px-3 py-1.5">Employee State Insurance (ESI)</td><td className="px-3 py-1.5 text-end">{inr(t.esi_employee ?? 0)}</td><td className="px-3 py-1.5 text-end">{inr(t.employer?.esi ?? 0)}</td></tr>
                <tr className="border-t"><td className="px-3 py-1.5">Income tax (TDS)</td><td className="px-3 py-1.5 text-end">{inr(t.tds ?? 0)}</td><td className="px-3 py-1.5 text-end text-muted-foreground">—</td></tr>
              </tbody>
            </table>
          </div>

          {items.isLoading ? <Skeleton className="h-40 w-full" /> : (
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>
                  <th className="px-3 py-2 text-start font-medium">Employee</th><th className="px-3 py-2 text-end font-medium">Paid days</th><th className="px-3 py-2 text-end font-medium">Gross</th>
                  <th className="px-3 py-2 text-end font-medium">Deductions</th><th className="px-3 py-2 text-end font-medium">Net pay</th><th className="px-3 py-2 text-center font-medium">Payment</th><th className="w-20" /></tr></thead>
                <tbody>{list.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="px-3 py-2"><button type="button" className="text-start" onClick={() => setSlip(i)}><span className="font-medium hover:underline">{i.employee_name}</span><span className="block text-[11px] text-muted-foreground">{i.employee_code ?? ""}{i.department ? ` · ${i.department}` : ""}</span></button></td>
                    <td className="px-3 py-2 text-end">{i.attendance.paid_days ?? "-"}<span className="text-muted-foreground">/{i.attendance.working_days ?? "-"}</span></td>
                    <td className="px-3 py-2 text-end">{inr(i.gross)}</td><td className="px-3 py-2 text-end">{inr(i.total_deductions)}</td><td className="px-3 py-2 text-end font-semibold">{inr(i.net_pay)}</td>
                    <td className="px-3 py-2 text-center"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", i.payment_status === "paid" ? "bg-emerald-100 text-emerald-800" : i.payment_status === "on_hold" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")}>{i.payment_status === "on_hold" ? "on hold" : i.payment_status}</span></td>
                    <td className="px-2"><div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Salary slip of ${i.employee_name}`} onClick={() => setSlip(i)}><FileText className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Download slip of ${i.employee_name}`} onClick={() => downloadSalarySlip(i, run, orgName)}><Download className="h-3.5 w-3.5" /></Button></div></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {!finalized && <p className="text-[11px] text-muted-foreground">This is a draft. Check attendance, bonuses and deductions, then Regenerate if you change anything. Finalize to lock the month and record payments.</p>}
        </>
      )}

      {slip && run && <SlipDialog item={slip} run={run} orgName={orgName} finalized={finalized} onClose={() => setSlip(null)} onPay={() => { setPayFor([slip]); setSlip(null); }} />}
      {payFor && run && <PayDialog orgId={orgId} run={run} items={payFor} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); refresh(); }} />}
      {adjOpen && <AdjustmentsDialog orgId={orgId} userId={userId} year={ym.year} month={ym.month} employees={employees} locked={finalized} onClose={() => setAdjOpen(false)} />}
      <StatutorySettings open={settingsOpen} onOpenChange={setSettingsOpen} orgId={orgId} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "finalize" ? "Finalize this month?" : confirm === "reopen" ? "Reopen this month?" : confirm === "delete" ? "Delete this draft?" : "Regenerate payroll?"}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "finalize" ? "Salary slips become final and you can record payments. TDS for later months builds on these figures." : confirm === "reopen" ? "The month goes back to draft so it can be changed. Slips will change if you regenerate." : confirm === "delete" ? "The draft and its salary slips are removed. You can generate it again." : "Salary slips are recalculated from the latest attendance, salary structures, adjustments and statutory settings."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>Continue</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SlipDialog({ item, run, orgName, finalized, onClose, onPay }: { item: PayrollItem; run: PayrollRun; orgName: string; finalized: boolean; onClose: () => void; onPay: () => void }) {
  const a = item.attendance, d = item.details ?? {};
  const Row = ({ l, v, b }: { l: string; v: number; b?: boolean }) => <div className={cn("flex justify-between gap-3 py-0.5", b && "border-t pt-1.5 font-semibold")}><span>{l}</span><span>{inr(v)}</span></div>;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>{item.employee_name} · {monthLabel(run.year, run.month)}</DialogTitle><DialogDescription>{[item.employee_code, item.designation, item.department].filter(Boolean).join(" · ")}</DialogDescription></DialogHeader>
        <p className="text-xs text-muted-foreground">Working days {a.working_days} · Paid days {a.paid_days} · Loss of pay {a.lop_days} (absent {a.absent}, half-day {a.half_day}, leave {a.leave}{a.unmarked ? `, not marked ${a.unmarked}` : ""})</p>
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div><h4 className="mb-1 font-semibold text-blue-950">Earnings</h4>{item.earnings.map((e, i) => <Row key={i} l={e.name} v={e.amount} />)}<Row l="Gross" v={item.gross} b /></div>
          <div><h4 className="mb-1 font-semibold text-blue-950">Deductions</h4>
            {item.epf_employee > 0 && <Row l="EPF (employee)" v={item.epf_employee} />}{item.esi_employee > 0 && <Row l="ESI (employee)" v={item.esi_employee} />}{item.tds > 0 && <Row l="Income tax (TDS)" v={item.tds} />}
            {item.deduction_lines.map((e, i) => <Row key={i} l={e.name} v={e.amount} />)}<Row l="Total deductions" v={item.total_deductions} b /></div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-sm"><div className="flex justify-between font-semibold text-emerald-900"><span>Net salary</span><span>{inr(item.net_pay)}</span></div></div>
        <div className="rounded-xl border p-3 text-sm">
          <h4 className="mb-1 font-semibold text-blue-950">How the statutory amounts were worked out</h4>
          <ul className="list-disc space-y-0.5 ps-5 text-xs text-slate-600">
            <li>Wages (labour-code definition): <b>{inr(item.wages)}</b>{d.wages_uplifted ? " (raised to the minimum share of total pay)" : ""}</li>
            <li>EPF: {d.pf_wage ? <>on {inr(d.pf_wage)}. Employee {inr(item.epf_employee)}; employer {inr(item.employer.epf)} to EPF + {inr(item.employer.eps)} to pension (EPS); EDLI {inr(item.employer.edli)}, admin {inr(item.employer.admin)}.</> : "not applicable"}{d.epf_note ? ` ${d.epf_note}` : ""}</li>
            <li>ESI: {d.esi_wage ? <>on {inr(d.esi_wage)}. Employee {inr(item.esi_employee)}; employer {inr(item.employer.esi)}.</> : "not applicable"}{d.esi_note ? ` ${d.esi_note}` : ""}</li>
            <li>TDS: {d.tds ? <>projected taxable income {inr(d.tds.projected_taxable)} → yearly tax {inr(d.tds.annual_tax)}; this month {inr(item.tds)}.</> : "not applicable"}</li>
          </ul>
        </div>
        {item.payment_status === "paid" && <p className="text-xs text-emerald-700">Paid on {item.paid_on}{item.payment_mode ? ` by ${item.payment_mode.replace("_", " ")}` : ""}{item.payment_reference ? ` · ref ${item.payment_reference}` : ""}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {finalized && <Button variant="outline" className="rounded-full" onClick={onPay}><Wallet className="me-1.5 h-4 w-4" />{item.payment_status === "paid" ? "Edit payment" : "Record payment"}</Button>}
          <Button className="rounded-full bg-blue-600 hover:bg-blue-700" onClick={() => downloadSalarySlip(item, run, orgName)}><Download className="me-1.5 h-4 w-4" />Download slip</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ orgId, run, items, onClose, onDone }: { orgId: string; run: PayrollRun; items: PayrollItem[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"paid" | "unpaid" | "on_hold">("paid");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  const total = items.reduce((s, i) => s + i.net_pay, 0);
  const submit = async () => {
    setSaving(true);
    try { await markSalaryPaid(orgId, run.id, { itemIds: items.map((i) => i.id), status, paidOn: date, mode, reference: ref }); toast({ title: status === "paid" ? "Payment recorded" : "Payment status updated" }); onDone(); }
    catch (e) { toast({ title: err(e, "Couldn't update payment"), variant: "destructive" }); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw] max-w-md">
        <DialogHeader><DialogTitle>Record salary payment</DialogTitle><DialogDescription>{items.length === 1 ? items[0].employee_name : `${items.length} employees`} · {inr(total)}. This only records the payment; no money is transferred from here.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1 font-medium text-slate-700">Status<select className={cn(SELECT, "w-full")} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="paid">Paid</option><option value="on_hold">On hold</option><option value="unpaid">Unpaid</option></select></label>
          {status === "paid" && <>
            <label className="block space-y-1 font-medium text-slate-700">Paid on<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="block space-y-1 font-medium text-slate-700">Mode<select className={cn(SELECT, "w-full")} value={mode} onChange={(e) => setMode(e.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
            <label className="block space-y-1 font-medium text-slate-700">Reference (optional)<Input value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} placeholder="UTR / cheque number" /></label></>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={submit} className="bg-blue-600 hover:bg-blue-700">{saving && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function AdjustmentsDialog({ orgId, userId, year, month, employees, locked, onClose }: { orgId: string; userId: string | null; year: number; month: number; employees: Employee[]; locked: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["hr-adjustments", orgId, year, month];
  const q = useQuery({ queryKey: key, queryFn: () => listAdjustments(orgId, year, month) });
  const staff = employees.filter((e) => e.status === "active");
  const [emp, setEmp] = useState("");
  const [kind, setKind] = useState<"bonus" | "earning" | "deduction">("bonus");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [taxable, setTaxable] = useState(true);
  const add = useMutation({
    mutationFn: () => {
      if (!emp) throw new Error("Choose an employee");
      if (!name.trim()) throw new Error("Give it a name, e.g. Diwali bonus");
      if (!(Number(amount) > 0)) throw new Error("Enter an amount above zero");
      return addAdjustment(orgId, userId, { employee_id: emp, year, month, kind, name: name.trim(), amount: Number(amount), taxable: kind === "deduction" ? false : taxable, note: null });
    },
    onSuccess: () => { setName(""); setAmount(""); qc.invalidateQueries({ queryKey: key }); toast({ title: "Added. Regenerate the payroll to apply it." }); },
    onError: (e) => toast({ title: err(e, "Couldn't add"), variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: (id: string) => deleteAdjustment(id), onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError: (e) => toast({ title: err(e, "Couldn't remove"), variant: "destructive" }) });
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "Employee";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Bonus & deductions · {monthLabel(year, month)}</DialogTitle><DialogDescription>One-off amounts for this month only. Regenerate the payroll after changing them.</DialogDescription></DialogHeader>
        {locked && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">This month is finalized. Reopen it to change adjustments.</p>}
        {!locked && (
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={SELECT} value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Employee"><option value="">Choose employee</option>{staff.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select>
            <select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Type"><option value="bonus">Bonus</option><option value="earning">Other earning / arrears</option><option value="deduction">Deduction (advance, fine...)</option></select>
            <Input placeholder="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Amount (₹)" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            {kind !== "deduction" && <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />Taxable (included in TDS)</label>}
            <Button className="rounded-full bg-blue-600 hover:bg-blue-700 sm:col-span-2" disabled={add.isPending} onClick={() => add.mutate()}>{add.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}Add</Button>
          </div>
        )}
        <div className="space-y-1.5">
          {q.isLoading ? <Skeleton className="h-10 w-full" /> : (q.data ?? []).length === 0 ? <p className="text-center text-xs text-muted-foreground">Nothing added for this month.</p> : q.data!.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><b>{nameOf(a.employee_id)}</b> · {a.name} <span className="text-xs text-muted-foreground">({a.kind})</span></span>
              <span className="flex items-center gap-1"><span className={a.kind === "deduction" ? "text-red-600" : "text-emerald-700"}>{a.kind === "deduction" ? "−" : "+"}{inr(a.amount)}</span>
                {!locked && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" aria-label="Remove" onClick={() => del.mutate(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}</span>
            </div>))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
