import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { downloadReceipt, fetchPaymentHistory, gatewayLabel, GATEWAY_ORDER, type HistoryRow } from "@/lib/paymentGateways";
import { formatDate, formatINR, toCsv } from "@/lib/instalments";

const STATUS: Record<string, { label: string; cls: string }> = {
  success: { label: "Paid", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  pending: { label: "Processing", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-800 border-red-200" },
  refunded: { label: "Refunded", cls: "bg-slate-200 text-slate-700 border-slate-300" },
  partially_refunded: { label: "Part refunded", cls: "bg-sky-100 text-sky-800 border-sky-200" },
};
export const TxnPill = ({ status }: { status: string }) => {
  const s = STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}>{s.label}</span>;
};

interface Props { studentId?: string; schoolId?: string; admin?: boolean; refreshKey?: number }

/** Unified transaction history: one-shot fees + instalments. Parents see their child; finance staff see the school. */
export function PaymentHistoryList({ studentId, schoolId, admin, refreshKey }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState(""); const [gw, setGw] = useState("all"); const [st, setSt] = useState("all");

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await fetchPaymentHistory({ studentId, schoolId })); } catch (e) { setError((e as Error).message); setRows([]); }
  }, [studentId, schoolId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (gw === "all" || r.gateway === gw) && (st === "all" || r.status === st) &&
    (!q.trim() || [r.student_name, r.receipt_no, r.payment_id, r.order_id].some((v) => (v ?? "").toLowerCase().includes(q.trim().toLowerCase())))), [rows, q, gw, st]);

  const receipt = async (r: HistoryRow) => {
    setBusy(r.id);
    try { await downloadReceipt(r.id); } catch (e) { toast({ title: "Couldn't download the receipt", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const exportCsv = () => {
    const csv = toCsv([["Date", "Student", "For", "Gateway", "Amount", "Refunded", "Status", "Receipt", "Gateway payment id", "Method"],
      ...shown.map((r) => [r.paid_at ?? r.created_at, r.student_name ?? "", r.label, gatewayLabel(r.gateway), r.amount, r.refunded_amount, r.status, r.receipt_no ?? "", r.payment_id ?? "", r.method ?? ""])]);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "payment-transactions.csv"; a.click(); URL.revokeObjectURL(url);
  };

  if (!rows) return <div className="h-24 rounded-xl bg-slate-100 animate-pulse" aria-label="Loading payment history" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {admin && <Input className="max-w-xs" placeholder="Search student, receipt or payment id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />}
        {admin && (
          <>
            <Select value={gw} onValueChange={setGw}><SelectTrigger className="w-36" aria-label="Gateway"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All gateways</SelectItem>{GATEWAY_ORDER.map((g) => <SelectItem key={g} value={g}>{gatewayLabel(g)}</SelectItem>)}</SelectContent></Select>
            <Select value={st} onValueChange={setSt}><SelectTrigger className="w-40" aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
          </>
        )}
        <div className="ms-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          {admin && <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 me-1.5" /> Export CSV</Button>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>
            <th className="text-start p-3">Date</th>{admin && <th className="text-start p-3">Student</th>}<th className="text-start p-3">For</th><th className="text-start p-3 hidden sm:table-cell">Gateway</th>
            <th className="text-end p-3">Amount</th><th className="text-start p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={admin ? 7 : 6} className="p-8 text-center text-slate-500">No payments yet.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="p-3 whitespace-nowrap">{formatDate((r.paid_at ?? r.created_at).slice(0, 10))}</td>
                {admin && <td className="p-3 font-medium text-slate-900">{r.student_name ?? "—"}</td>}
                <td className="p-3">{r.label}{r.needs_review && <span className="ms-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">REVIEW</span>}</td>
                <td className="p-3 hidden sm:table-cell text-slate-600">{gatewayLabel(r.gateway)}</td>
                <td className="p-3 text-end whitespace-nowrap">{formatINR(r.amount)}{r.refunded_amount > 0 && <span className="block text-xs text-slate-500">− {formatINR(r.refunded_amount)} refunded</span>}</td>
                <td className="p-3"><TxnPill status={r.status} />{r.status === "failed" && r.failure_reason && <span className="block text-xs text-slate-500 max-w-[14rem] truncate" title={r.failure_reason}>{r.failure_reason}</span>}</td>
                <td className="p-3 text-end">{r.receipt_no && ["success", "partially_refunded", "refunded"].includes(r.status) && (
                  <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void receipt(r)} aria-label={`Download receipt ${r.receipt_no}`}><Download className="h-4 w-4" /></Button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
