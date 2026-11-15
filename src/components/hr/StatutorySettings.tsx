// Statutory settings: EPF, ESI, TDS, wage definition and attendance rules, as EFFECTIVE-DATED versions.
// Nothing here is hard-coded in the calculation: when a rate or ceiling changes, add a new version with its effective date.
// A payroll month uses the version in force on the month's last day. Platform defaults can be overridden for the school.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { listStatutory, saveStatutory, type StatutoryRow } from "@/lib/hr";
import { validateConfigParams } from "../../../supabase/functions/_shared/payrollModel";

type Scheme = StatutoryRow["scheme"];
const TABS: { v: Scheme; label: string; help: string }[] = [
  { v: "epf", label: "EPF", help: "Provident fund: employee and employer shares, pension (EPS) split, EDLI and admin charges." },
  { v: "esi", label: "ESI", help: "Employee State Insurance: rates, wage ceiling and how wages are measured." },
  { v: "tds", label: "TDS", help: "Income-tax slabs for the new and old regimes, standard deduction, rebate and cess." },
  { v: "wages", label: "Wage definition", help: "Labour-code wages used for PF and ESI." },
  { v: "attendance", label: "Attendance rules", help: "Weekly off, paid leave and what to do with unmarked days." },
];
const FIELDS: Partial<Record<Scheme, { k: string; label: string; unit: string }[]>> = {
  epf: [
    { k: "wage_ceiling", label: "PF wage ceiling", unit: "₹ / month" }, { k: "employee_rate", label: "Employee contribution", unit: "%" }, { k: "employer_rate", label: "Employer contribution", unit: "%" },
    { k: "eps_rate", label: "Of which pension (EPS)", unit: "%" }, { k: "eps_wage_cap", label: "EPS wage cap", unit: "₹ / month" }, { k: "edli_rate", label: "EDLI (employer)", unit: "%" },
    { k: "edli_wage_cap", label: "EDLI wage cap", unit: "₹ / month" }, { k: "admin_rate", label: "Admin charges (employer)", unit: "%" }, { k: "admin_min_per_establishment", label: "Admin charges minimum", unit: "₹ / month, whole school" },
  ],
  esi: [
    { k: "wage_ceiling", label: "ESI wage ceiling", unit: "₹ / month" }, { k: "wage_ceiling_disabled", label: "Ceiling, person with disability", unit: "₹ / month" },
    { k: "employee_rate", label: "Employee contribution", unit: "%" }, { k: "employer_rate", label: "Employer contribution", unit: "%" }, { k: "employee_exempt_daily_wage", label: "No employee share up to daily wage of", unit: "₹ / day" },
  ],
  wages: [{ k: "minimum_wage_share_pct", label: "Wages at least this share of total pay", unit: "%" }],
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);

/** Version of a scheme in force on `date`: latest effective date wins, the school's own row beats the default on a tie. */
function inForce(rows: StatutoryRow[], scheme: Scheme, date: string) {
  return rows.filter((r) => r.scheme === scheme && r.effective_from <= date)
    .sort((a, b) => (a.effective_from === b.effective_from ? Number(b.organization_id !== null) - Number(a.organization_id !== null) : b.effective_from.localeCompare(a.effective_from)))[0];
}

export function StatutorySettings({ open, onOpenChange, orgId }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [scheme, setScheme] = useState<Scheme>("epf");
  const q = useQuery({ queryKey: ["hr-statutory", orgId], queryFn: () => listStatutory(orgId), enabled: open, staleTime: 30_000 });
  const rows = q.data ?? [];
  const current = useMemo(() => inForce(rows, scheme, today()), [rows, scheme]);

  const [params, setParams] = useState<Record<string, any>>({});
  const [eff, setEff] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (current) { setParams(JSON.parse(JSON.stringify(current.params))); setEff(today()); setNote(""); } }, [current?.id, scheme]);   // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => validateConfigParams(scheme, params), [scheme, params]);
  const set = (k: string, v: any) => setParams((p) => ({ ...p, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  const save = async () => {
    if (errors.length) { toast({ title: errors[0], variant: "destructive" }); return; }
    setSaving(true);
    try {
      await saveStatutory(orgId, scheme, eff, params, note);
      toast({ title: "Settings saved", description: `New version effective from ${eff}.` });
      qc.invalidateQueries({ queryKey: ["hr-statutory", orgId] });
    } catch (e) { toast({ title: e instanceof Error ? e.message : "Couldn't save", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const regime = (r: "new" | "old") => {
    const o = params[r] ?? { standard_deduction: 0, rebate_limit: 0, rebate_max: 0, marginal_relief: false, slabs: [] };
    const setO = (patch: any) => set(r, { ...o, ...patch });
    const slabs: { upto: number | null; rate: number }[] = o.slabs ?? [];
    const setSlab = (i: number, patch: any) => setO({ slabs: slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
    return (
      <div className="space-y-2 rounded-xl border bg-white p-3" key={r}>
        <h4 className="text-sm font-semibold text-blue-950">{r === "new" ? "New regime" : "Old regime"}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-slate-600">Standard deduction (₹)<Input type="number" min={0} value={o.standard_deduction} onChange={(e) => setO({ standard_deduction: num(e.target.value) })} /></label>
          <label className="text-xs text-slate-600">Rebate up to income of (₹)<Input type="number" min={0} value={o.rebate_limit} onChange={(e) => setO({ rebate_limit: num(e.target.value) })} /></label>
          <label className="text-xs text-slate-600">Maximum rebate (₹)<Input type="number" min={0} value={o.rebate_max} onChange={(e) => setO({ rebate_max: num(e.target.value) })} /></label>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600"><Switch checked={o.marginal_relief === true} onCheckedChange={(v) => setO({ marginal_relief: v })} />Marginal relief just above the rebate limit</label>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-600">Tax slabs (income up to → rate)</p>
          {slabs.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-9" type="number" min={0} disabled={i === slabs.length - 1} placeholder={i === slabs.length - 1 ? "and above" : "up to ₹"} value={s.upto ?? ""} onChange={(e) => setSlab(i, { upto: num(e.target.value) })} />
              <Input className="h-9 w-24" type="number" min={0} max={100} value={s.rate} onChange={(e) => setSlab(i, { rate: num(e.target.value) })} /><span className="text-xs text-slate-500">%</span>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" disabled={slabs.length <= 2} aria-label="Remove slab" onClick={() => setO({ slabs: slabs.filter((_, j) => j !== i).map((x, j, a) => (j === a.length - 1 ? { ...x, upto: null } : x)) })}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setO({ slabs: [...slabs.slice(0, -1), { upto: (slabs[slabs.length - 2]?.upto ?? 0) + 100000, rate: slabs[slabs.length - 1]?.rate ?? 30 }, { upto: null, rate: slabs[slabs.length - 1]?.rate ?? 30 }] })}><Plus className="me-1 h-3.5 w-3.5" />Add slab</Button>
        </div>
      </div>
    );
  };

  const tab = TABS.find((t) => t.v === scheme)!;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Statutory settings</DialogTitle>
          <DialogDescription>Rates, ceilings and rules used to calculate EPF, ESI and TDS. Each change is a new version with an effective date.</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The starting values were taken from public sources and may change. Please confirm them with the official notifications or your accountant before you finalize payroll, and add a new version whenever a rule changes.</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => <button key={t.v} type="button" onClick={() => setScheme(t.v)} className={cn("rounded-full border px-3 py-1.5 text-sm", scheme === t.v ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-600")}>{t.label}</button>)}
        </div>
        <p className="text-xs text-muted-foreground">{tab.help}</p>

        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : !current ? <p className="text-sm text-red-600">No settings found for this group.</p> : (
          <div className="space-y-4">
            {scheme !== "wages" && scheme !== "attendance" && (
              <label className="flex items-center gap-2 text-sm"><Switch checked={params.enabled !== false} onCheckedChange={(v) => set("enabled", v)} />{scheme.toUpperCase()} is applied in payroll</label>
            )}
            {scheme === "wages" && <label className="flex items-center gap-2 text-sm"><Switch checked={params.apply_fifty_percent_rule === true} onCheckedChange={(v) => set("apply_fifty_percent_rule", v)} />Apply the minimum wage-share rule</label>}

            {FIELDS[scheme] && <div className="grid gap-3 sm:grid-cols-2">{FIELDS[scheme]!.map((f) => (
              <label key={f.k} className="space-y-1 text-sm font-medium text-slate-700">{f.label} <span className="text-[11px] font-normal text-muted-foreground">({f.unit})</span>
                <Input type="number" min={0} step="any" value={params[f.k] ?? 0} onChange={(e) => set(f.k, num(e.target.value))} /></label>
            ))}</div>}

            {scheme === "esi" && <label className="space-y-1 text-sm font-medium text-slate-700">ESI wages are measured on<select className={cn(SELECT, "block w-full")} value={params.wage_basis ?? "code_wages"} onChange={(e) => set("wage_basis", e.target.value)}><option value="code_wages">Labour-code wages (recommended)</option><option value="gross">Gross pay</option></select></label>}

            {scheme === "tds" && <>
              <label className="space-y-1 text-sm font-medium text-slate-700">Health & education cess (%)<Input className="w-32" type="number" min={0} max={100} step="any" value={params.cess_rate ?? 0} onChange={(e) => set("cess_rate", num(e.target.value))} /></label>
              {regime("new")}{regime("old")}
              <p className="text-[11px] text-muted-foreground">TDS is estimated for salary income of a resident individual below 60. Surcharge, other income and exemptions are not calculated.</p>
            </>}

            {scheme === "attendance" && <div className="space-y-3 text-sm">
              <div><p className="mb-1.5 font-medium text-slate-700">Weekly off</p><div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => {
                const on = (params.weekly_off_days ?? []).includes(i);
                return <button key={d} type="button" onClick={() => set("weekly_off_days", on ? params.weekly_off_days.filter((x: number) => x !== i) : [...(params.weekly_off_days ?? []), i].sort())} className={cn("h-9 w-12 rounded-full border text-xs", on ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-600")}>{d}</button>;
              })}</div></div>
              <label className="flex items-center gap-2"><Switch checked={params.leave_is_paid !== false} onCheckedChange={(v) => set("leave_is_paid", v)} />Leave is paid (otherwise it is loss of pay)</label>
              <label className="space-y-1 font-medium text-slate-700">Working days with no attendance entry count as<select className={cn(SELECT, "block w-full")} value={params.unmarked_days ?? "present"} onChange={(e) => set("unmarked_days", e.target.value)}><option value="present">Present</option><option value="absent">Absent (loss of pay)</option></select></label>
            </div>}

            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
              <p className="mb-2 text-sm font-semibold text-blue-950">Save as a new version</p>
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                <label className="text-xs text-slate-600">Effective from<Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></label>
                <label className="text-xs text-slate-600">Source / note<Textarea rows={1} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Notification number or accountant's advice" /></label>
              </div>
              {errors.length > 0 && <p className="mt-2 text-xs text-red-600">{errors[0]}</p>}
              <div className="mt-2 flex justify-end"><Button onClick={save} disabled={saving || errors.length > 0} className="rounded-full bg-blue-600 hover:bg-blue-700">{saving && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}Save version</Button></div>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold text-blue-950">Versions</h4>
              {rows.filter((r) => r.scheme === scheme).sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map((r) => (
                <div key={r.id} className={cn("rounded-lg border px-3 py-2 text-xs", r.id === current.id ? "border-emerald-300 bg-emerald-50/50" : "bg-white")}>
                  <b>From {r.effective_from}</b> · {r.organization_id ? "Your school" : "Platform default"}{r.id === current.id ? " · in force today" : ""}
                  {r.source_note && <p className="mt-0.5 text-muted-foreground">{r.source_note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
