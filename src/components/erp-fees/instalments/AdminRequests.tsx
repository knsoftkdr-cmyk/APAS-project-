import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fetchAdminRequests, fetchFeeBalance, fetchSettings, fetchStudentNamesForRequests, reviewInstalmentRequest } from "@/lib/instalmentApi";
import { addDays, buildSchedule, formatDate, formatINR, todayIST, type InstalmentRequest, type InstalmentSettingsRow } from "@/lib/instalments";
import { RequestPill } from "./StatusPill";
import { ScheduleEditorDialog, rowsFromSchedule, type EditorRow } from "./ScheduleEditorDialog";

type Row = InstalmentRequest & { student?: { name: string; class: string | null; section: string | null } };

export function AdminRequests({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [settings, setSettings] = useState<InstalmentSettingsRow | null>(null);
  const [approve, setApprove] = useState<{ req: Row; balance: number; rows: EditorRow[] } | null>(null);
  const [reject, setReject] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, s] = await Promise.all([fetchAdminRequests(schoolId), fetchSettings(schoolId)]);
      const names = await fetchStudentNamesForRequests(reqs.map((r) => r.student_id));
      setRows(reqs.map((r) => ({ ...r, student: names[r.student_id] }))); setSettings(s);
    } catch (e) { toast({ title: "Couldn't load requests", description: (e as Error).message, variant: "destructive" }); }
    finally { setLoading(false); }
  }, [schoolId, toast]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) => (status === "all" || r.status === status) && (!q.trim() || (r.student?.name ?? "").toLowerCase().includes(q.trim().toLowerCase()))), [rows, status, q]);

  const openApprove = async (r: Row) => {
    if (!r.fee_payment_id) { toast({ title: "The fee record for this request no longer exists", variant: "destructive" }); return; }
    try {
      const fee = await fetchFeeBalance(r.fee_payment_id);
      if (!fee || fee.balance <= 0) { toast({ title: "This fee has no outstanding balance", variant: "destructive" }); return; }
      const interval = settings?.default_interval_days ?? 30;
      setApprove({ req: r, balance: fee.balance, rows: rowsFromSchedule(buildSchedule(fee.balance, r.requested_count, addDays(todayIST(), interval), interval)) });
    } catch (e) { toast({ title: "Couldn't open the schedule", description: (e as Error).message, variant: "destructive" }); }
  };

  const doReject = async () => {
    if (!reject) return;
    setBusy(true);
    try { await reviewInstalmentRequest(reject.id, "reject", { reason }); toast({ title: "Request rejected", description: "The parent has been notified with your reason." }); setReject(null); setReason(""); await load(); onChanged(); }
    catch (e) { toast({ title: "Couldn't reject", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search student…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests by student" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>{[["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {loading ? <p className="text-sm text-slate-500 p-6">Loading…</p> : shown.length === 0 ? (
        <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-300 p-8 text-center">No {status === "all" ? "" : status} requests.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="font-semibold text-[#12203a]">{r.student?.name ?? "Student"} <span className="font-normal text-sm text-slate-500">· Class {[r.student?.class, r.student?.section].filter(Boolean).join(" / ") || "—"}</span></p>
                  <p className="text-sm text-slate-700">{r.requested_count} instalments for <strong>{formatINR(r.requested_amount)}</strong> · sent {formatDate(r.created_at)}</p>
                  <p className="text-sm text-slate-600">“{r.reason}”</p>
                  {r.status === "rejected" && <p className="text-xs text-red-700 mt-1">Rejected: {r.rejection_reason}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <RequestPill status={r.status} />
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => openApprove(r)} className="bg-emerald-700 hover:bg-emerald-800 text-white"><Check className="h-4 w-4 me-1" /> Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => { setReject(r); setReason(""); }} className="text-red-700 border-red-200"><X className="h-4 w-4 me-1" /> Reject</Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {approve && (
        <ScheduleEditorDialog
          open onOpenChange={(v) => !v && setApprove(null)} title={`Approve - ${approve.req.student?.name ?? "student"}`}
          description={`Check the automatic schedule below. You can change any amount or date before approving; the total must stay ${formatINR(approve.balance)}.`}
          total={approve.balance} initialRows={approve.rows} minCount={2} minAmount={settings?.min_instalment_amount} maxAmount={settings?.max_instalment_amount}
          submitLabel="Approve and create schedule"
          onSubmit={async (sched) => { await reviewInstalmentRequest(approve.req.id, "approve", { items: sched }); toast({ title: "Request approved", description: "The schedule was created and the parent has been notified." }); await load(); onChanged(); }}
        />
      )}

      <Dialog open={!!reject} onOpenChange={(v) => !v && setReject(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-[#12203a]">Reject request</DialogTitle><DialogDescription>The parent sees this reason, so please be specific.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="rej">Reason (required)</Label><Textarea id="rej" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
          <DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setReject(null)} disabled={busy}>Cancel</Button><Button onClick={doReject} disabled={busy || reason.trim().length === 0} variant="destructive">{busy ? "Rejecting…" : "Reject request"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
