import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Loader2, UserMinus, UserPlus, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { assignUnassigned, useAssignmentDashboard, useEligibleStaff, useMonitorStatus, useSlaConfig, useWorkbench } from "@/hooks/useAdmissionAssignment";
import { WorkbenchLeadList } from "./WorkbenchLeadList";
import { CounsellorDialog, SlaSettingsCard } from "./AssignmentSettings";
import { ASSIGNMENT_METHOD_LABELS, formatMinutes, pct, type EligibleStaff } from "@/lib/admissionAssignment";

type Queue = "unassigned" | "overdue" | "all";
const QUEUES: { value: Queue; label: string }[] = [{ value: "unassigned", label: "Unassigned" }, { value: "overdue", label: "Overdue" }, { value: "all", label: "All open leads" }];

function Stat({ label, value, tone = "slate", icon: Icon }: { label: string; value: string | number; tone?: "slate" | "red" | "amber" | "emerald"; icon?: React.ElementType }) {
  const c = { slate: "text-slate-800", red: "text-red-700", amber: "text-amber-700", emerald: "text-emerald-700" }[tone];
  return (
    <Card className="border-slate-200 shadow-sm"><CardContent className="p-3 md:p-4">
      <div className="flex items-center gap-1.5 text-[11px] md:text-xs font-medium text-muted-foreground">{Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}{label}</div>
      <p className={`mt-1 text-xl md:text-2xl font-extrabold tracking-tight tabular-nums ${c}`}>{value}</p>
    </CardContent></Card>
  );
}

/** Admin view of assignment + SLA, inside the existing Admissions page. Every number is read from real rows. */
export function AssignmentAdminPanel() {
  const { profile } = useAuth(); const { toast } = useToast();
  const schoolId = profile?.school_id ?? null;
  const dash = useAssignmentDashboard(true);
  const staff = useEligibleStaff(true);
  const cfg = useSlaConfig(true);
  const monitor = useMonitorStatus(true);
  const [queue, setQueue] = useState<Queue>("unassigned");
  const q = useWorkbench({ scope: queue, enabled: true });
  const [editing, setEditing] = useState<{ person: EligibleStaff | null } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const nowMs = Date.now() + q.skewMs;

  const d = dash.data;
  const refreshAll = () => { void dash.refetch(); void staff.refetch(); void q.refetch(); };
  const counsellorOptions = (d?.counsellors ?? []).filter((c) => c.is_active).map((c) => ({ profile_id: c.profile_id, name: c.name, accepting: c.accepting }));
  const maxOpen = Math.max(1, ...(d?.counsellors ?? []).map((c) => c.open_leads));

  if (dash.error === "not_installed") return <div className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">Counsellor assignment needs the latest database update (assignment &amp; SLA migration). Apply it, then reload.</div>;
  if (dash.error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load the dashboard: {dash.error}</div>;
  if (dash.loading && !d) return <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-label="Loading" /></div>;
  if (!d) return null;

  const runBulk = async () => {
    if (!schoolId) return;
    setBulk(true);
    const { error, assigned } = await assignUnassigned(schoolId);
    setBulk(false);
    if (error) { toast({ title: "Could not assign", description: error, variant: "destructive" }); return; }
    toast({ title: assigned ? `${assigned} lead${assigned === 1 ? "" : "s"} assigned` : "Nothing to assign", description: assigned ? "Handed out in rotation." : "No leads are waiting, or no counsellor is available." });
    refreshAll();
  };

  return (
    <div className="space-y-6">
      {monitor && !monitor.scheduled && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>SLA monitoring is not running.</strong> Overdue alerts and automatic hand-out of waiting leads need the scheduled database job
          (<code>admission-sla-monitor</code>, every {monitor.interval_minutes} minutes). Ask your administrator to enable <code>pg_cron</code> and apply the latest migration.
          Deadlines and clocks are still recorded.
        </div>)}
      {monitor?.scheduled && monitor.last_run_ok === false && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The last SLA monitor run failed{monitor.last_run_at ? ` (${new Date(monitor.last_run_at).toLocaleString()})` : ""}. Alerts may be delayed; check the database job logs.</div>)}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Unassigned" value={d.unassigned} tone={d.unassigned > 0 ? "amber" : "slate"} icon={UserMinus} />
        <Stat label="Open leads" value={d.open_leads} icon={Users} />
        <Stat label="First response overdue" value={d.overdue_first_response} tone={d.overdue_first_response > 0 ? "red" : "slate"} icon={AlertTriangle} />
        <Stat label="Follow-up overdue" value={d.overdue_follow_up} tone={d.overdue_follow_up > 0 ? "red" : "slate"} icon={AlertTriangle} />
        <Stat label="First response on time (30d)" value={pct(d.sla.fr_met, d.sla.fr_total)} tone="emerald" icon={Clock} />
        <Stat label="Follow-ups on time (30d)" value={pct(d.sla.fu_met, d.sla.fu_total)} tone="emerald" icon={Clock} />
      </div>
      {(d.due_soon_first_response + d.due_soon_follow_up) > 0 && <p className="text-xs text-amber-700">{d.due_soon_first_response + d.due_soon_follow_up} deadline(s) are due soon.</p>}

      <section className="space-y-3" aria-labelledby="cs-h">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 id="cs-h" className="text-lg font-semibold text-slate-800 flex items-center gap-2.5"><div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />Counsellors</h2>
          <Button size="sm" onClick={() => setEditing({ person: null })}><UserPlus className="h-3.5 w-3.5 me-1.5" />Add counsellor</Button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-start text-[11px] uppercase tracking-wide text-slate-500 border-b">
              {["Counsellor", "Status", "Open leads", "Conversion", "Overdue now", "First response", "Follow-up", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {d.counsellors.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No counsellors yet. Add staff to start automatic round-robin assignment.</td></tr>}
              {d.counsellors.map((c) => {
                const person = staff.staff.find((s) => s.profile_id === c.profile_id) ?? null;
                return (
                  <tr key={c.profile_id} className="border-b last:border-0">
                    <th scope="row" className="px-3 py-2 text-start font-medium text-slate-800">{c.name}</th>
                    <td className="px-3 py-2">{!c.is_active ? <span className="text-slate-500">Inactive</span> : c.accepting ? <span className="text-emerald-700">Receiving leads</span> : <span className="text-amber-700">Away{c.unavailable_until ? ` until ${new Date(c.unavailable_until).toLocaleDateString()}` : ""}</span>}</td>
                    <td className="px-3 py-2"><div className="flex items-center gap-2"><span className="w-6 tabular-nums">{c.open_leads}</span>
                      <div className="h-1.5 w-20 rounded bg-slate-100" aria-hidden="true"><div className="h-1.5 rounded bg-indigo-500" style={{ width: `${(100 * c.open_leads) / maxOpen}%` }} /></div>
                      {c.max_open_leads && <span className="text-[11px] text-muted-foreground">/ {c.max_open_leads}</span>}</div></td>
                    <td className="px-3 py-2 tabular-nums">{c.conversion_pct != null ? `${c.conversion_pct}%` : "—"} <span className="text-[11px] text-muted-foreground">({c.converted}/{c.total_leads})</span></td>
                    <td className={`px-3 py-2 tabular-nums ${c.overdue_now > 0 ? "text-red-700 font-semibold" : ""}`}>{c.overdue_now}</td>
                    <td className="px-3 py-2 tabular-nums">{pct(c.fr_met, c.fr_total)} <span className="text-[11px] text-muted-foreground">avg {formatMinutes(c.fr_avg_minutes)}</span></td>
                    <td className="px-3 py-2 tabular-nums">{pct(c.fu_met, c.fu_total)}</td>
                    <td className="px-3 py-2 text-end"><Button size="sm" variant="ghost" disabled={!person} onClick={() => person && setEditing({ person })} aria-label={`Manage ${c.name}`}>Manage</Button></td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="q-h">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 id="q-h" className="text-lg font-semibold text-slate-800 flex items-center gap-2.5"><div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />Lead queues</h2>
          {queue === "unassigned" && d.unassigned > 0 && <Button size="sm" variant="secondary" onClick={runBulk} disabled={bulk}>{bulk && <Loader2 className="h-3.5 w-3.5 animate-spin me-1.5" />}Assign all unassigned in rotation</Button>}
        </div>
        <div role="tablist" aria-label="Lead queues" className="flex gap-2 overflow-x-auto pb-1">
          {QUEUES.map((x) => (
            <button key={x.value} type="button" role="tab" aria-selected={queue === x.value} onClick={() => setQueue(x.value)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium ${queue === x.value ? "bg-indigo-600 text-white shadow" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}>{x.label}</button>))}
        </div>
        {q.loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-label="Loading" /></div>
          : <WorkbenchLeadList leads={q.leads} nowMs={nowMs} onChanged={refreshAll} counsellors={counsellorOptions} showOwner
              emptyText={queue === "unassigned" ? "Every open lead has a counsellor." : queue === "overdue" ? "No overdue leads." : "No open leads."} />}
        {q.data && q.data.total > q.leads.length && <p className="text-xs text-muted-foreground">Showing the {q.leads.length} most urgent of {q.data.total}.</p>}
      </section>

      {cfg.config && schoolId && <SlaSettingsCard schoolId={schoolId} config={cfg.config} onSaved={() => { void cfg.refetch(); void dash.refetch(); }} />}

      <section className="space-y-2" aria-labelledby="ra-h">
        <h2 id="ra-h" className="text-lg font-semibold text-slate-800">Recent assignments</h2>
        <ul className="rounded-xl border border-slate-200 bg-white divide-y text-sm">
          {d.recent_assignments.length === 0 && <li className="p-4 text-muted-foreground">Nothing assigned yet.</li>}
          {d.recent_assignments.map((r, i) => (
            <li key={`${r.applicant_id}-${r.at}-${i}`} className="p-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <span><span className="font-medium">{r.lead ?? "Lead"}</span> → {r.to ?? "Unassigned"}{r.from ? <span className="text-muted-foreground"> (from {r.from})</span> : null}</span>
              <span className="text-xs text-muted-foreground">{ASSIGNMENT_METHOD_LABELS[r.method] ?? r.method}{r.by ? ` by ${r.by}` : ""} · {new Date(r.at).toLocaleString()}{r.reason ? ` · ${r.reason}` : ""}</span>
            </li>))}
        </ul>
      </section>

      {editing && schoolId && <CounsellorDialog schoolId={schoolId} person={editing.person} staff={staff.staff} onClose={() => setEditing(null)} onSaved={refreshAll} />}
    </div>
  );
}
