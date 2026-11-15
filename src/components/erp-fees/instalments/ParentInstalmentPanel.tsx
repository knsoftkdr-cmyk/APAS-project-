import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Download, Info, Loader2, Receipt, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { GatewayPicker } from "@/components/erp-fees/payments/GatewayPicker";
import type { GatewayId } from "@/lib/paymentGateways";
import { downloadReceipt, fetchParentOverview, fetchStudentInstalmentData, payInstalment, recheckPayment } from "@/lib/instalmentApi";
import {
  canPay, formatDate, formatINR, planProgress, toCents, fromCents, type InstalmentItem, type InstalmentPlan, type InstalmentRequest, type InstalmentTxn, type ParentFee, type ParentOverview,
} from "@/lib/instalments";
import { RequestPill, StatusPill, TxnPill } from "./StatusPill";
import { RequestInstalmentDialog } from "./RequestInstalmentDialog";

interface Props {
  studentId: string;
  studentName: string;
  businessName: string;
  prefill: { name?: string; email?: string | null; contact?: string | null };
  /** the school, so the parent can pick among its enabled payment gateways */
  schoolId?: string | null;
}

const CATEGORY_LABELS: [keyof ParentFee, string][] = [["course_amount", "Course"], ["transport_amount", "Transport"], ["other_amount", "Other"], ["uniform_amount", "Uniform"], ["material_amount", "Material"], ["exam_amount", "Exam"]];

const Progress = ({ percent, label }: { percent: number; label: string }) => (
  <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2.5 w-full rounded-full bg-white/15 overflow-hidden">
    <div className="h-full rounded-full bg-gradient-to-r from-[#c9a227] to-[#f0d060] transition-all" style={{ width: `${percent}%` }} />
  </div>
);

export function ParentInstalmentPanel({ studentId, studentName, businessName, prefill, schoolId }: Props) {
  const [gateway, setGateway] = useState<GatewayId | null>(null);
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ParentOverview | null>(null);
  const [data, setData] = useState<{ requests: InstalmentRequest[]; plans: InstalmentPlan[]; items: InstalmentItem[]; txns: InstalmentTxn[] } | null>(null);
  const [requestFee, setRequestFee] = useState<ParentFee | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [busyTxn, setBusyTxn] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [o, d] = await Promise.all([fetchParentOverview(studentId), fetchStudentInstalmentData(studentId)]);
      setOverview(o); setData(d); setLoadError(null);
    } catch (e) { setLoadError((e as Error).message); }
    finally { setLoading(false); }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);

  const itemsByPlan = useMemo(() => {
    const m = new Map<string, InstalmentItem[]>();
    (data?.items ?? []).forEach((i) => m.set(i.plan_id, [...(m.get(i.plan_id) ?? []), i]));
    return m;
  }, [data]);
  const receiptTxnByItem = useMemo(() => {
    const m = new Map<string, InstalmentTxn>();
    (data?.txns ?? []).forEach((t) => { if ((t.status === "success" || t.status === "partially_refunded") && t.receipt_no && !m.has(t.item_id)) m.set(t.item_id, t); });
    return m;
  }, [data]);
  const lastTxnByItem = useMemo(() => {
    const m = new Map<string, InstalmentTxn>();
    (data?.txns ?? []).forEach((t) => { if (!m.has(t.item_id)) m.set(t.item_id, t); });
    return m;
  }, [data]);

  const summary = useMemo(() => {
    const fees = overview?.fees ?? [];
    const activePlanIds = new Set((data?.plans ?? []).filter((p) => p.status === "active").map((p) => p.id));
    let overdueC = 0;
    fees.forEach((f) => {
      if (f.plan_id && activePlanIds.has(f.plan_id)) (itemsByPlan.get(f.plan_id) ?? []).filter((i) => i.display_status === "overdue").forEach((i) => { overdueC += toCents(i.balance); });
      else if (f.overdue) overdueC += toCents(f.balance);
    });
    const total = fees.reduce((s, f) => s + toCents(f.amount_due), 0);
    const paid = fees.reduce((s, f) => s + toCents(f.amount_paid), 0);
    const next = [...(data?.items ?? [])].filter((i) => activePlanIds.has(i.plan_id) && i.status !== "paid" && i.status !== "cancelled").sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
    return { total: fromCents(total), paid: fromCents(paid), remaining: fromCents(Math.max(total - paid, 0)), overdue: fromCents(overdueC), percent: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0, next };
  }, [overview, data, itemsByPlan]);

  const pay = async (item: InstalmentItem, count: number) => {
    setPayingId(item.id);
    try {
      const out = await payInstalment(item.id, { businessName, description: `Instalment ${item.seq} of ${count} - ${studentName}`, name: prefill.name, email: prefill.email ?? undefined, contact: prefill.contact ?? undefined, gateway: gateway ?? "razorpay" });
      if (out.status === "redirecting") return;   // on its way to the gateway; settled when the parent returns
      if (out.status === "success") toast({ title: "Payment successful", description: out.receiptNo ? `Receipt ${out.receiptNo} is ready to download.` : "Your instalment has been recorded." });
      else if (out.status === "pending") toast({ title: "Payment is being confirmed", description: "Your bank is still processing it. This page updates automatically once it's confirmed." });
      else if (out.status === "failed") toast({ title: "Payment failed", description: `${out.message}. No money was recorded - you can try again.`, variant: "destructive" });
      else if (out.status === "cancelled") toast({ title: "Payment not completed", description: "Nothing was charged. You can pay whenever you're ready." });
      else toast({ title: "Couldn't start the payment", description: out.message, variant: "destructive" });
    } finally { setPayingId(null); await load(true); }
  };

  const recheck = async (t: InstalmentTxn) => {
    setBusyTxn(t.id);
    try {
      const { data: row } = await (supabase as any).from("instalment_transactions").select("razorpay_order_id, gateway").eq("id", t.id).maybeSingle();
      if (!row?.razorpay_order_id) throw new Error("Payment not found");
      const r = await recheckPayment(row.razorpay_order_id, (row.gateway ?? "razorpay") as GatewayId);
      toast({ title: r.status === "success" ? "Payment confirmed" : r.status === "failed" ? "Payment failed" : "Still processing", description: r.status === "success" ? "Thank you - your receipt is ready." : r.status === "failed" ? "No money was recorded." : "We'll update this automatically." });
    } catch (e) { toast({ title: "Couldn't check the payment", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusyTxn(null); await load(true); }
  };

  const receipt = async (t: InstalmentTxn) => {
    setBusyTxn(t.id);
    try { await downloadReceipt(t.id); } catch (e) { toast({ title: "Couldn't download the receipt", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusyTxn(null); }
  };

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><LoadingSpinner size="lg" /></div>;
  if (loadError || !overview || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center" role="alert">
        <AlertTriangle className="h-8 w-8 mx-auto text-red-500 mb-2" />
        <p className="text-sm text-red-800 mb-3">{loadError ?? "Couldn't load the fee details."}</p>
        <Button variant="outline" onClick={() => load()}><RefreshCw className="h-4 w-4 me-1.5" /> Try again</Button>
      </div>
    );
  }

  const { settings, fees } = overview;
  const visiblePlans = data.plans.filter((p) => p.status !== "cancelled");
  const openFees = fees.filter((f) => f.balance > 0 || f.plan_id);

  return (
    <div className="space-y-6">
      {/* ── hero ── */}
      <section className="rounded-2xl bg-gradient-to-br from-[#0e1a31] via-[#12203a] to-[#1b3363] p-5 sm:p-6 text-white shadow-lg" aria-label="Fee summary">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#f0d060]">Fee overview</p>
            <h2 className="text-lg sm:text-xl font-bold">{studentName}</h2>
          </div>
          {summary.next && (
            <div className="rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[#f0d060]" aria-hidden />
              <span>Next due <strong>{formatDate(summary.next.due_date)}</strong> · {formatINR(summary.next.balance)}</span>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[["Total fee", formatINR(summary.total), ""], ["Paid", formatINR(summary.paid), "text-emerald-300"], ["Remaining", formatINR(summary.remaining), "text-[#f0d060]"], ["Overdue", formatINR(summary.overdue), summary.overdue > 0 ? "text-red-300" : ""]].map(([l, v, c]) => (
            <div key={l} className="rounded-xl bg-white/10 border border-white/10 p-3">
              <dt className="text-xs text-white/70">{l}</dt>
              <dd className={`text-lg sm:text-xl font-bold ${c}`}>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs text-white/80"><span>Paid so far</span><span>{summary.percent}%</span></div>
          <Progress percent={summary.percent} label="Fees paid" />
        </div>
      </section>

      {!settings.enabled && (
        <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"><Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> Your school hasn't turned on instalment plans. You can still pay your fees in full from the Payment Gateway option.</div>
      )}

      {/* ── fee records ── */}
      <section aria-label="Fee records" className="space-y-3">
        <h3 className="text-base font-semibold text-[#12203a]">Fee records</h3>
        {openFees.length === 0 && <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-300 p-6 text-center">There are no outstanding fees for {studentName}.</p>}
        {openFees.map((f) => {
          const req = data.requests.find((r) => r.id === f.pending_request_id);
          return (
            <div key={f.fee_payment_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm text-slate-500">Due {formatDate(f.due_date)}</p>
                  <p className="text-xl font-bold text-[#12203a]">{formatINR(f.balance)} <span className="text-sm font-normal text-slate-500">remaining of {formatINR(f.amount_due)}</span></p>
                  <div className="flex flex-wrap gap-1.5">{CATEGORY_LABELS.filter(([k]) => Number(f[k]) > 0).map(([k, l]) => <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{l} {formatINR(Number(f[k]))}</span>)}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {f.overdue && !f.plan_id && <StatusPill status="overdue" />}
                  {f.plan_id && <span className="text-xs rounded-full bg-[#12203a] text-white px-2.5 py-0.5">On instalment plan</span>}
                  {req && <RequestPill status="pending" />}
                  {f.eligible && <Button size="sm" onClick={() => setRequestFee(f)} className="bg-[#12203a] hover:bg-[#1b2f55] text-white"><Wallet className="h-4 w-4 me-1.5" /> Request instalments</Button>}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* ── requests ── */}
      {data.requests.length > 0 && (
        <section aria-label="Instalment requests" className="space-y-3">
          <h3 className="text-base font-semibold text-[#12203a]">Your requests</h3>
          {data.requests.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{r.requested_count} instalments for {formatINR(r.requested_amount)}</p>
                <RequestPill status={r.status} />
              </div>
              <p className="text-xs text-slate-500 mt-1">Sent {formatDate(r.created_at)} · “{r.reason}”</p>
              {r.status === "rejected" && <p className="mt-2 text-sm rounded-md bg-red-50 border border-red-200 text-red-800 p-2"><strong>Reason from the school:</strong> {r.rejection_reason}</p>}
              {r.status === "approved" && <p className="mt-2 text-sm text-emerald-800">Approved{r.reviewed_at ? ` on ${formatDate(r.reviewed_at)}` : ""} - your schedule is below.</p>}
            </div>
          ))}
        </section>
      )}

      {/* ── payment method (only when there is something to pay) ── */}
      {schoolId && visiblePlans.some((p) => p.status === "active") && (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Payment method">
          <GatewayPicker schoolId={schoolId} value={gateway} onChange={setGateway} disabled={!!payingId} compact />
        </section>
      )}

      {/* ── schedules ── */}
      {visiblePlans.map((plan) => {
        const items = itemsByPlan.get(plan.id) ?? [];
        const pr = planProgress(items);
        const live = items.filter((i) => i.status !== "cancelled");
        return (
          <section key={plan.id} aria-label="Payment schedule" className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="bg-[#12203a] text-white p-4 sm:p-5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Payment schedule · {formatINR(pr.total)}</h3>
                <span className={`text-xs rounded-full px-2.5 py-0.5 ${plan.status === "completed" ? "bg-emerald-400/20 text-emerald-200" : "bg-[#c9a227]/25 text-[#f0d060]"}`}>{plan.status === "completed" ? "Completed" : `${pr.paidCount} of ${pr.count} paid`}</span>
              </div>
              <Progress percent={pr.percent} label="Plan progress" />
              <div className="flex justify-between text-xs text-white/75"><span>Paid {formatINR(pr.paid)}</span><span>Balance {formatINR(pr.balance)}</span></div>
            </div>
            <div className="p-4 sm:p-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {live.map((i, idx) => {
                const isNext = pr.next?.id === i.id && canPay(i);
                const rc = receiptTxnByItem.get(i.id);
                const last = lastTxnByItem.get(i.id);
                return (
                  <div key={i.id} className={`rounded-xl border p-4 flex flex-col gap-2 ${isNext ? "border-[#c9a227] bg-amber-50/50 ring-1 ring-[#c9a227]" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">Instalment {idx + 1} of {live.length}</span><StatusPill status={i.display_status} /></div>
                    <p className="text-2xl font-bold text-[#12203a]">{formatINR(i.amount)}</p>
                    {i.status === "partially_paid" && <p className="text-xs text-slate-600">{formatINR(i.amount_paid)} paid · {formatINR(i.balance)} left</p>}
                    <p className="text-sm text-slate-600 flex items-center gap-1.5"><CalendarClock className="h-4 w-4" aria-hidden /> Due {formatDate(i.due_date)}</p>
                    {last?.status === "failed" && i.status !== "paid" && <p className="text-xs text-red-700">Last attempt failed{last.failure_reason ? `: ${last.failure_reason}` : ""}. No money was recorded.</p>}
                    {last?.status === "pending" && <p className="text-xs text-amber-800">A payment is being confirmed…</p>}
                    <div className="mt-auto pt-1 flex flex-wrap gap-2">
                      {plan.status === "active" && canPay(i) && (
                        <Button size="sm" disabled={payingId !== null || last?.status === "pending"} onClick={() => pay(i, live.length)} className="bg-[#c9a227] hover:bg-[#b3901f] text-[#12203a] font-semibold flex-1">
                          {payingId === i.id ? <><Loader2 className="h-4 w-4 me-1.5 animate-spin" /> Opening…</> : <>Pay Now {formatINR(i.balance)}</>}
                        </Button>
                      )}
                      {rc && <Button size="sm" variant="outline" disabled={busyTxn === rc.id} onClick={() => receipt(rc)}><Receipt className="h-4 w-4 me-1.5" /> Receipt</Button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="px-5 pb-4 text-xs text-slate-500 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Payments are processed by Razorpay. An instalment is marked paid only after the payment is confirmed.</p>
          </section>
        );
      })}

      {/* ── history ── */}
      <section aria-label="Payment history" className="space-y-3">
        <h3 className="text-base font-semibold text-[#12203a]">Payment history</h3>
        {data.txns.filter((t) => t.status !== "created" && t.status !== "cancelled").length === 0 ? (
          <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-300 p-6 text-center">No instalment payments yet.</p>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="text-start p-3">Date</th><th className="text-start p-3">Instalment</th><th className="text-end p-3">Amount</th><th className="text-start p-3">Status</th><th className="text-start p-3 hidden sm:table-cell">Receipt no.</th><th className="p-3" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.txns.filter((t) => t.status !== "created" && t.status !== "cancelled").map((t) => {
                  const it = data.items.find((i) => i.id === t.item_id);
                  const live = it ? (itemsByPlan.get(it.plan_id) ?? []).filter((x) => x.status !== "cancelled") : [];
                  const n = it ? live.findIndex((x) => x.id === it.id) + 1 : 0;
                  return (
                    <tr key={t.id}>
                      <td className="p-3 whitespace-nowrap">{formatDate(t.paid_at ?? t.created_at)}</td>
                      <td className="p-3 whitespace-nowrap">{it ? `${n > 0 ? n : it.seq} of ${live.length}` : "—"}</td>
                      <td className="p-3 text-end font-medium whitespace-nowrap">{formatINR(t.amount)}{t.refunded_amount > 0 && <span className="block text-xs text-blue-700">{formatINR(t.refunded_amount)} refunded</span>}</td>
                      <td className="p-3"><TxnPill status={t.status} />{t.status === "failed" && t.failure_reason && <span className="block text-xs text-slate-500 mt-0.5">{t.failure_reason}</span>}</td>
                      <td className="p-3 hidden sm:table-cell text-slate-500 whitespace-nowrap">{t.receipt_no ?? "—"}</td>
                      <td className="p-3 text-end whitespace-nowrap">
                        {t.receipt_no && (t.status === "success" || t.status === "partially_refunded" || t.status === "refunded") && <Button size="sm" variant="ghost" disabled={busyTxn === t.id} onClick={() => receipt(t)} aria-label={`Download receipt ${t.receipt_no}`}><Download className="h-4 w-4" /></Button>}
                        {t.status === "pending" && <Button size="sm" variant="ghost" disabled={busyTxn === t.id} onClick={() => recheck(t)}><RefreshCw className="h-4 w-4 me-1" /> Check</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RequestInstalmentDialog open={!!requestFee} onOpenChange={(v) => !v && setRequestFee(null)} studentId={studentId} fee={requestFee} settings={settings} onDone={() => load(true)} />
    </div>
  );
}
