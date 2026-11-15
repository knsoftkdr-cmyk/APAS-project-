// Salary structure of one employee: basic, HRA, DA, extra allowances / deductions, versioned by effective date,
// with a live monthly estimate (gross, EPF, ESI, TDS, net, employer cost) calculated by the same engine the payroll uses.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  deleteStructure, getEmployeePrivate, inr, listStatutory, listStructures, saveStructure, type Component, type Employee, type SalaryStructure,
} from "@/lib/hr";
import {
  computePayrollItem, DEFAULT_PRIVATE, lastDayOfMonth, resolveConfig, validateStructure, type PrivateInput,
} from "../../../supabase/functions/_shared/payrollModel";

const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);

interface Props { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; userId: string | null; employee: Employee | null; onSaved: () => void }

export function SalaryStructureDialog({ open, onOpenChange, orgId, userId, employee, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [eff, setEff] = useState(today());
  const [basic, setBasic] = useState(0);
  const [hra, setHra] = useState(0);
  const [da, setDa] = useState(0);
  const [rows, setRows] = useState<Component[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const hist = useQuery({ queryKey: ["hr-structures", employee?.id], queryFn: () => listStructures(employee!.id), enabled: open && !!employee });
  const priv = useQuery({ queryKey: ["hr-private", employee?.id], queryFn: () => getEmployeePrivate(employee!.id), enabled: open && !!employee });
  const stat = useQuery({ queryKey: ["hr-statutory", orgId], queryFn: () => listStatutory(orgId), enabled: open, staleTime: 60_000 });

  const load = (s: SalaryStructure | undefined) => {
    setBasic(s?.basic ?? 0); setHra(s?.hra ?? 0); setDa(s?.da ?? 0); setRows(s?.components ?? []); setNotes(s?.notes ?? "");
  };
  useEffect(() => { if (open) { setEff(today()); load(undefined); } }, [open, employee?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && hist.data?.length) load(hist.data.find((s) => s.effective_from <= today()) ?? hist.data[0]); }, [open, hist.data]);   // start from the current structure

  const structure = { basic, hra, da, components: rows };
  const errors = validateStructure(structure);

  const estimate = useMemo(() => {
    if (errors.length || !stat.data) return null;
    try {
      const d = new Date();
      const fy = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
      // Full-year view for TDS: pretend it is April of the current financial year, full attendance.
      const cfg = resolveConfig(stat.data as any, orgId, lastDayOfMonth(d.getFullYear(), d.getMonth() + 1));
      const pv: PrivateInput = priv.data ? { ...DEFAULT_PRIVATE, ...priv.data, pan: priv.data.pan, uan: priv.data.uan, bank_account_number: null } as PrivateInput : DEFAULT_PRIVATE;
      return computePayrollItem({
        employee: { id: "x", name: "", code: null, designation: null, department: null, joining_date: null, last_working_date: null },
        priv: pv, structure, attendance: [], adjustments: [], prior: { ytd_taxable: 0, ytd_tds: 0, esi_covered_this_period: false }, year: fy, month: 4, cfg,
      });
    } catch (e) { return { error: e instanceof Error ? e.message : "Cannot calculate" }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basic, hra, da, rows, stat.data, priv.data, orgId, errors.length]);

  const setRow = (i: number, patch: Partial<Component>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    if (!employee) return;
    if (errors.length) { toast({ title: errors[0], variant: "destructive" }); return; }
    if (!eff) { toast({ title: "Choose the date this salary starts from", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await saveStructure(orgId, userId, employee.id, { effective_from: eff, basic, hra, da, components: rows.map((r) => ({ ...r, name: r.name.trim() })), notes });
      toast({ title: "Salary structure saved" });
      qc.invalidateQueries({ queryKey: ["hr-structures"] });
      onSaved();
    } catch (e) { toast({ title: e instanceof Error ? e.message : "Couldn't save", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const remove = async (s: SalaryStructure) => {
    try { await deleteStructure(s.id); qc.invalidateQueries({ queryKey: ["hr-structures"] }); onSaved(); toast({ title: "Version removed" }); }
    catch (e) { toast({ title: e instanceof Error ? e.message : "Couldn't remove", variant: "destructive" }); }
  };

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const est = estimate && "gross" in estimate ? estimate : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Salary structure · {employee?.full_name}</DialogTitle>
          <DialogDescription>Monthly amounts at full attendance. A revision takes effect from its date; earlier months keep the older structure.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm font-medium text-slate-700">Effective from<Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Basic (₹) *<Input type="number" min={0} value={basic || ""} onChange={(e) => setBasic(num(e.target.value))} /></label>
          <label className="space-y-1 text-sm font-medium text-slate-700">HRA (₹)<Input type="number" min={0} value={hra || ""} onChange={(e) => setHra(num(e.target.value))} /></label>
          <label className="space-y-1 text-sm font-medium text-slate-700">DA (₹)<Input type="number" min={0} value={da || ""} onChange={(e) => setDa(num(e.target.value))} /></label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-blue-950">Allowances & deductions</h3>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => setRows((r) => [...r, { name: "", kind: "earning", type: "fixed", value: 0, counts_as_wages: false, taxable: true }])}><Plus className="me-1 h-3.5 w-3.5" />Add row</Button></div>
          {rows.length === 0 && <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">Transport, special allowance, professional tax, loan recovery... add what applies. Bonuses are added per month under Payroll.</p>}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg border bg-white p-2 sm:grid-cols-[1fr_7rem_8rem_6rem_auto]">
              <Input className="col-span-2 h-9 sm:col-span-1" placeholder="Name" value={r.name} maxLength={60} onChange={(e) => setRow(i, { name: e.target.value })} />
              <select className={SELECT} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Component["kind"] })}><option value="earning">Earning</option><option value="deduction">Deduction</option></select>
              <select className={SELECT} value={r.type} onChange={(e) => setRow(i, { type: e.target.value as Component["type"] })}><option value="fixed">Fixed ₹</option><option value="percent_basic">% of basic</option></select>
              <Input className="h-9" type="number" min={0} value={r.value || ""} onChange={(e) => setRow(i, { value: num(e.target.value) })} />
              <Button size="icon" variant="ghost" className="h-9 w-9 justify-self-end text-red-500" aria-label="Remove row" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              {r.kind === "earning" && (
                <div className="col-span-2 flex flex-wrap gap-4 text-xs text-slate-600 sm:col-span-5">
                  <label className="flex items-center gap-1.5"><Switch checked={r.counts_as_wages === true} onCheckedChange={(v) => setRow(i, { counts_as_wages: v })} />Counts as wages (PF / ESI)</label>
                  <label className="flex items-center gap-1.5"><Switch checked={r.taxable !== false} onCheckedChange={(v) => setRow(i, { taxable: v })} />Taxable</label>
                </div>
              )}
            </div>
          ))}
        </div>

        {errors.length > 0 && basic > 0 && <p className="text-xs text-red-600">{errors[0]}</p>}

        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 sm:p-4">
          <h3 className="mb-2 text-sm font-semibold text-blue-950">Estimated month (full attendance)</h3>
          {stat.isLoading || priv.isLoading ? <p className="text-xs text-muted-foreground">Calculating...</p>
            : estimate && "error" in estimate ? <p className="text-xs text-red-600">{estimate.error}</p>
            : !est ? <p className="text-xs text-muted-foreground">Enter the basic salary to see the calculation.</p> : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                <Row label="Gross salary" v={est.gross} bold /><Row label="EPF (employee)" v={est.epf_employee} /><Row label="ESI (employee)" v={est.esi_employee} />
                <Row label="TDS (estimate)" v={est.tds} /><Row label="Other deductions" v={est.other_deductions} /><Row label="Net salary" v={est.net_pay} bold />
                <Row label="EPF + EPS (employer)" v={est.employer.epf + est.employer.eps} /><Row label="EDLI + admin" v={est.employer.edli + est.employer.admin} /><Row label="ESI (employer)" v={est.employer.esi} />
                <div className="col-span-2 mt-1 border-t pt-1.5 sm:col-span-3"><Row label="Cost to school per month" v={est.gross + est.employer_total} bold /></div>
              </div>
            )}
          {est?.details.epf_note && <p className="mt-2 text-[11px] text-amber-700">{est.details.epf_note}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">Uses the statutory settings in force today. TDS is an estimate for salary income only.</p>
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving} className="bg-gradient-to-r from-blue-600 via-blue-800 to-green-500 text-white hover:opacity-90">{saving && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}Save structure</Button>
        </div>

        {(hist.data?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-blue-950">Revision history</h3>
            {hist.data!.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-xs">
                <button type="button" className="min-w-0 flex-1 truncate text-start hover:underline" onClick={() => { load(s); setEff(s.effective_from); }} title="Load into the form">
                  From <b>{s.effective_from}</b> · basic {inr(s.basic)} · HRA {inr(s.hra)}{s.da ? ` · DA ${inr(s.da)}` : ""}{s.components.length ? ` · +${s.components.length} rows` : ""}
                </button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" aria-label="Delete this version" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return <div className={`flex items-center justify-between gap-2 ${bold ? "font-semibold text-blue-950" : "text-slate-700"}`}><span className="text-xs">{label}</span><span>{inr(v)}</span></div>;
}
