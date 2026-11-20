import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/hooks/useAdmissionAssignment";
import { WorkbenchLeadList } from "./WorkbenchLeadList";
import { WORKBENCH_VIEWS, countViews, inView, type WorkbenchView } from "@/lib/admissionAssignment";

const EMPTY: Record<WorkbenchView, string> = {
  assigned: "No leads are assigned to you right now.", new: "No new leads waiting for a first response.",
  hot: "No hot leads assigned to you.", warm: "No warm leads assigned to you.", cold: "No cold leads assigned to you.",
  today: "No follow-ups due today.", pending: "No upcoming follow-ups scheduled.", overdue: "Nothing overdue. Nice work.",
};

/** The counsellor's own working view, inside the existing Admissions page. The database only returns the caller's leads. */
export function CounsellorWorkbench() {
  const { leads, loading, error, skewMs, refetch } = useWorkbench({ scope: "mine" });
  const [view, setView] = useState<WorkbenchView>("assigned");
  const [, setTick] = useState(0);   // re-render every 30s so badges move On Track -> Due Soon -> Overdue without a request
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  // "now" on the server's clock, so a wrong device time cannot make a lead look on-time or late
  const nowMs = Date.now() + skewMs;
  const counts = useMemo(() => countViews(leads, nowMs), [leads, nowMs]);
  const visible = useMemo(() => leads.filter((l) => inView(l, view, nowMs)), [leads, view, nowMs]);

  if (error === "not_installed") return <div className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">The counsellor workbench needs the latest database update (assignment &amp; SLA migration). Ask your administrator to apply it.</div>;
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load your leads: {error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2.5"><div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />My Workbench</h2>
        <Button size="sm" variant="outline" onClick={() => void refetch()} aria-label="Refresh leads"><RefreshCw className="h-3.5 w-3.5 me-1.5" />Refresh</Button>
      </div>

      <div role="tablist" aria-label="Workbench views" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {WORKBENCH_VIEWS.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={view === v.value} onClick={() => setView(v.value)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${view === v.value ? "bg-indigo-600 text-white shadow" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}>
            {v.label}
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${view === v.value ? "bg-white/20" : v.value === "overdue" && counts.overdue > 0 ? "bg-red-100 text-red-700" : "bg-indigo-100 text-indigo-700"}`}>{counts[v.value]}</span>
          </button>))}
      </div>

      {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-label="Loading" /></div>
        : <WorkbenchLeadList leads={visible} nowMs={nowMs} onChanged={() => void refetch()} emptyText={EMPTY[view]} />}
    </div>
  );
}
