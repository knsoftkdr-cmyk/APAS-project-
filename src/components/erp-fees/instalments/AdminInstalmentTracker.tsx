import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  createPlanForStudent, fetchAdminItems, fetchAdminPlans, fetchAdminSummary, fetchPlannableFees, fetchSettings, updateInstalmentSchedule,
} from "@/lib/instalmentApi";
import {
  addDays, addMonths, buildSchedule, formatDate, formatINR, fromCents, studentReport, toCsv, todayIST, toCents,
  type AdminSummary, type InstalmentItem, type InstalmentPlan, type InstalmentSettingsRow, type DisplayStatus,
} from "@/lib/instalments";
import { StatusPill } from "./StatusPill";
import { ScheduleEditorDialog, rowsFromSchedule, type EditorRow, type LockedRow, newKey } from "./ScheduleEditorDialog";

type Plannable = Awaited<ReturnType<typeof fetchPlannableFees>>[number];
const ALL = "__all";
const STATUS_FILTERS: [string, string][] = [[ALL, "All statuses"], ["paid", "Paid"], ["pending", "Pending"], ["upcoming", "Upcoming"], ["overdue", "Overdue"], ["failed", "Failed"], ["partially_paid", "Partially paid"]];

const Kpi = ({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) => (
  <div className="rounded-xl bg-gradient-to-br from-[#0e1a31] to-[#1b3363] p-4 text-white shadow">
    <dt className="text-xs text-white/70">{label}</dt>
    <dd className={`text-xl font-bold ${tone}`}>{value}</dd>
  </div>
);

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function AdminInstalmentTracker({ schoolId, refreshKey, onChanged }: { schoolId: string; refreshKey: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [items, setItems] = useState<InstalmentItem[]>([]);
  const [plans, setPlans] = useState<InstalmentPlan[]>([]);
  const [settings, setSettings] = useState<InstalmentSettingsRow | null>(null);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState(ALL);
  const [section, setSection] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [view, setView] = useState<"instalments" | "students" | "classes">("instalments");
  const [edit, setEdit] = useState<{ plan: InstalmentPlan; rows: EditorRow[]; locked: LockedRow[]; total: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, i, p, st] = await Promise.all([fetchAdminSummary(schoolId), fetchAdminItems(schoolId), fetchAdminPlans(schoolId), fetchSettings(schoolId)]);
      setSummary(s); setItems(i); setPlans(p); setSettings(st);
    } catch (e) { toast({ title: "Couldn't load instalment data", description: (e as Error).message, variant: "destructive" }); }
    finally { setLoading(false); }
  }, [schoolId, toast]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const live = useMemo(() => items.filter((i) => i.status !== "cancelled"), [items]);
  const classes = useMemo(() => [...new Set(live.map((i) => i.class_grade ?? "-"))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [live]);
  const sections = useMemo(() => [...new Set(live.map((i) => i.section ?? "-"))].sort(), [live]);
  const filtered = useMemo(() => live.filter((i) =>
    (!q.trim() || (i.student_name ?? "").toLowerCase().includes(q.trim().toLowerCase())) &&
    (cls === ALL || (i.class_grade ?? "-") === cls) && (section === ALL || (i.section ?? "-") === section) && (status === ALL || i.display_status === status),
  ), [live, q, cls, section, status]);
  const students = useMemo(() => studentReport(filtered), [filtered]);
  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const openEdit = (planId: string) => {
    const plan = planById.get(planId); if (!plan) return;
    const all = live.filter((i) => i.plan_id === planId).sort((a, b) => a.seq - b.seq);
    const paid = all.filter((i) => i.status === "paid");
    const open = all.filter((i) => i.status !== "paid");
    const lockedTotal = paid.reduce((s, i) => s + toCents(i.amount), 0);
    setEdit({
      plan, total: fromCents(toCents(plan.total_amount) - lockedTotal),
      locked: paid.map((i) => ({ seq: i.seq, amount: i.amount, due_date: i.due_date, paid: i.amount_paid })),
      rows: open.map((i) => ({ key: newKey(), id: i.id, amount: String(i.amount), due_date: i.due_date, removable: toCents(i.amount_paid) === 0, minAmount: i.amount_paid })),
    });
  };

  const exportCsv = () => {
    if (view === "students") download("instalments-by-student.csv", toCsv([["Student", "Class", "Section", "Instalments", "Scheduled", "Paid", "Pending", "Overdue", "Next due"], ...students.map((s) => [s.student_name, s.class_grade, s.section, s.instalments, s.scheduled, s.paid, s.pending, s.overdue, s.nextDue ?? ""])]));
    else if (view === "classes") download("instalments-by-class.csv", toCsv([["Class", "Section", "Students", "Scheduled", "Collected", "Pending", "Overdue instalments", "Overdue amount"], ...(summary?.by_class ?? []).map((c) => [c.class_grade, c.section, c.students, c.scheduled, c.collected, c.pending, c.overdue_count, c.overdue_amount])]));
    else download("instalments.csv", toCsv([["Student", "Class", "Section", "Instalment", "Amount", "Paid", "Balance", "Due date", "Status"], ...filtered.map((i) => [i.student_name, i.class_grade, i.section, i.seq, i.amount, i.amount_paid, i.balance, i.due_date, i.display_status])]));
  };

  if (loading && !summary) return <p className="text-sm text-slate-500 p-6">Loading…</p>;

  return (
    <div className="space-y-5">
      {summary && (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Instalment summary">
          <Kpi label="Students on plans" value={summary.students} />
          <Kpi label="Total scheduled" value={formatINR(summary.total_scheduled)} />
          <Kpi label="Collected" value={formatINR(summary.collected)} tone="text-emerald-300" />
          <Kpi label="Pending" value={formatINR(summary.pending)} tone="text-[#f0d060]" />
          <Kpi label="Overdue instalments" value={summary.overdue_count} tone={summary.overdue_count > 0 ? "text-red-300" : ""} />
          <Kpi label="Overdue amount" value={formatINR(summary.overdue_amount)} tone={summary.overdue_amount > 0 ? "text-red-300" : ""} />
          <Kpi label="Partially paid" value={summary.partially_paid_count} />
          <Kpi label="Requests awaiting review" value={summary.pending_requests} />
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="tablist" aria-label="Report view">
          {([["instalments", "Instalments"], ["students", "By student"], ["classes", "By class"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`px-3 py-1.5 text-sm ${view === k ? "bg-[#12203a] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 me-1.5" /> Export CSV</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-[#12203a] hover:bg-[#1b2f55] text-white"><Plus className="h-4 w-4 me-1.5" /> Create plan</Button>
        </div>
      </div>

      {view !== "classes" && (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Search student…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by student" />
          <Select value={cls} onValueChange={setCls}><SelectTrigger className="w-36" aria-label="Class"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All classes</SelectItem>{classes.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent></Select>
          <Select value={section} onValueChange={setSection}><SelectTrigger className="w-36" aria-label="Section"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All sections</SelectItem>{sections.map((c) => <SelectItem key={c} value={c}>Section {c}</SelectItem>)}</SelectContent></Select>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-40" aria-label="Payment status"><SelectValue /></SelectTrigger><SelectContent>{STATUS_FILTERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        {view === "instalments" && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-start p-3">Student</th><th className="text-start p-3 hidden sm:table-cell">Class</th><th className="text-start p-3">#</th><th className="text-end p-3">Amount</th><th className="text-end p-3 hidden md:table-cell">Paid</th><th className="text-start p-3">Due</th><th className="text-start p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No instalments match.</td></tr>}
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="p-3 font-medium text-slate-900">{i.student_name}</td>
                  <td className="p-3 hidden sm:table-cell text-slate-600">{[i.class_grade, i.section].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="p-3">{i.seq}</td>
                  <td className="p-3 text-end">{formatINR(i.amount)}</td>
                  <td className="p-3 text-end hidden md:table-cell text-emerald-700">{formatINR(i.amount_paid)}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(i.due_date)}</td>
                  <td className="p-3"><StatusPill status={i.display_status as DisplayStatus} /></td>
                  <td className="p-3 text-end">{planById.get(i.plan_id)?.status === "active" && <Button size="sm" variant="ghost" onClick={() => openEdit(i.plan_id)} aria-label={`Edit schedule for ${i.student_name}`}><Pencil className="h-4 w-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view === "students" && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-start p-3">Student</th><th className="text-start p-3 hidden sm:table-cell">Class</th><th className="text-end p-3">Scheduled</th><th className="text-end p-3">Paid</th><th className="text-end p-3">Pending</th><th className="text-end p-3">Overdue</th><th className="text-start p-3 hidden md:table-cell">Next due</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {students.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No students match.</td></tr>}
              {students.map((s) => (
                <tr key={s.student_id}>
                  <td className="p-3 font-medium text-slate-900">{s.student_name}</td><td className="p-3 hidden sm:table-cell text-slate-600">{s.class_grade} / {s.section}</td>
                  <td className="p-3 text-end">{formatINR(s.scheduled)}</td><td className="p-3 text-end text-emerald-700">{formatINR(s.paid)}</td><td className="p-3 text-end">{formatINR(s.pending)}</td>
                  <td className={`p-3 text-end ${s.overdue > 0 ? "text-red-700 font-semibold" : ""}`}>{formatINR(s.overdue)}</td><td className="p-3 hidden md:table-cell">{formatDate(s.nextDue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view === "classes" && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-start p-3">Class / Section</th><th className="text-end p-3">Students</th><th className="text-end p-3">Scheduled</th><th className="text-end p-3">Collected</th><th className="text-end p-3">Pending</th><th className="text-end p-3">Overdue</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(summary?.by_class ?? []).length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No instalment plans yet.</td></tr>}
              {(summary?.by_class ?? []).map((c) => (
                <tr key={`${c.class_grade}-${c.section}`}>
                  <td className="p-3 font-medium text-slate-900">{c.class_grade} / {c.section}</td><td className="p-3 text-end">{c.students}</td>
                  <td className="p-3 text-end">{formatINR(c.scheduled)}</td><td className="p-3 text-end text-emerald-700">{formatINR(c.collected)}</td><td className="p-3 text-end">{formatINR(c.pending)}</td>
                  <td className={`p-3 text-end ${c.overdue_count > 0 ? "text-red-700 font-semibold" : ""}`}>{c.overdue_count > 0 ? `${c.overdue_count} · ${formatINR(c.overdue_amount)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <ScheduleEditorDialog
          open onOpenChange={(v) => !v && setEdit(null)} title={`Edit schedule - ${edit.plan.student_name}`}
          description="Paid instalments are locked. Change the remaining amounts or dates; the plan total cannot change."
          total={edit.total} initialRows={edit.rows} lockedRows={edit.locked} minAmount={settings?.min_instalment_amount} maxAmount={settings?.max_instalment_amount}
          submitLabel="Save schedule"
          onSubmit={async (rows) => { await updateInstalmentSchedule(edit.plan.id, rows); toast({ title: "Schedule updated", description: "The parent has been notified." }); await load(); onChanged(); }}
        />
      )}
      <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} schoolId={schoolId} settings={settings} onDone={async () => { await load(); onChanged(); }} />
    </div>
  );
}

function CreatePlanDialog({ open, onOpenChange, schoolId, settings, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; schoolId: string; settings: InstalmentSettingsRow | null; onDone: () => Promise<void> }) {
  const { toast } = useToast();
  const [fees, setFees] = useState<Plannable[]>([]);
  const [feeId, setFeeId] = useState("");
  const [count, setCount] = useState("4");
  const [rows, setRows] = useState<EditorRow[] | null>(null);
  const fee = fees.find((f) => f.id === feeId);

  useEffect(() => {
    if (!open) { setRows(null); setFeeId(""); return; }
    fetchPlannableFees(schoolId).then(setFees).catch((e) => toast({ title: "Couldn't load fees", description: (e as Error).message, variant: "destructive" }));
    setCount(String(settings?.default_count ?? 4));
  }, [open, schoolId, settings, toast]);

  const next = () => {
    if (!fee) return;
    const n = Math.max(2, Math.min(24, parseInt(count, 10) || 2));
    const interval = settings?.default_interval_days ?? 30;
    const first = addDays(todayIST(), interval);
    setRows(rowsFromSchedule(interval % 30 === 0 ? buildSchedule(fee.balance, n, first, interval).map((r, i) => ({ ...r, due_date: addMonths(first, i * (interval / 30)) })) : buildSchedule(fee.balance, n, first, interval)));
  };

  if (rows && fee) {
    return (
      <ScheduleEditorDialog
        open onOpenChange={(v) => { if (!v) setRows(null); onOpenChange(v); }} title={`New plan - ${fee.student_name}`}
        description={`Balance ${formatINR(fee.balance)}. The instalments must add up to exactly this amount.`}
        total={fee.balance} initialRows={rows} minCount={2} minAmount={settings?.min_instalment_amount} maxAmount={settings?.max_instalment_amount} submitLabel="Create plan"
        onSubmit={async (sched) => { await createPlanForStudent(fee.student_id, fee.id, sched); toast({ title: "Plan created", description: "The parent has been notified." }); await onDone(); }}
      />
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-[#12203a]">Create an instalment plan</DialogTitle><DialogDescription>Pick an unpaid fee record and the number of instalments. You can adjust every amount and date next.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Fee record</Label>
            <Select value={feeId} onValueChange={setFeeId}><SelectTrigger aria-label="Fee record"><SelectValue placeholder={fees.length ? "Select student fee" : "No unpaid fees without a plan"} /></SelectTrigger>
              <SelectContent>{fees.map((f) => <SelectItem key={f.id} value={f.id}>{f.student_name} · {f.class_grade ?? "-"}/{f.section ?? "-"} · {formatINR(f.balance)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="cnt">Number of instalments</Label><Input id="cnt" type="number" min={2} max={24} value={count} onChange={(e) => setCount(e.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!fee} onClick={next} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">Next</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
