import { AlertTriangle, CheckCircle2, CircleDashed, Clock, TriangleAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEE_LINES, formatInr, computeBreakdown, type FeeAssignmentView, type AssignmentStatus } from "@/lib/feePlan";

const TONE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  muted: "bg-slate-100 text-slate-600 border-slate-200",
  gold: "bg-amber-50 text-amber-800 border-amber-300",
  danger: "bg-red-50 text-red-700 border-red-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
};

export const Pill = ({ tone, icon: Icon, label, title, className }: { tone: keyof typeof TONE; icon: React.ElementType; label: string; title?: string; className?: string }) => (
  <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
  </span>
);

/** Plan state, always icon + text (never colour alone). */
export function PlanStatusPill({ status }: { status: AssignmentStatus }) {
  if (status === "active") return <Pill tone="success" icon={CheckCircle2} label="Fee plan assigned" />;
  if (status === "unmatched") return <Pill tone="gold" icon={TriangleAlert} label="No fee structure" title="No active fee structure matches this class, category and academic year. Assign a plan manually." />;
  return <Pill tone="muted" icon={XCircle} label="Cancelled" />;
}

export function PaymentPill({ plan }: { plan: FeeAssignmentView }) {
  const b = computeBreakdown(plan, plan.concession_amount, plan.paid, plan.due_date);
  if (b.status === "paid") return <Pill tone="success" icon={CheckCircle2} label="Paid" />;
  if (b.status === "overdue") return <Pill tone="danger" icon={AlertTriangle} label="Overdue" />;
  if (b.status === "partial") return <Pill tone="info" icon={CircleDashed} label="Part paid" />;
  return <Pill tone="gold" icon={Clock} label="Pending" />;
}

/** Fees -> concession -> net payable -> paid -> outstanding, for one assignment. */
export function FeeBreakdown({ plan, className }: { plan: FeeAssignmentView; className?: string }) {
  const lines = FEE_LINES.filter(({ key }) => plan[key] > 0);
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white text-sm", className)}>
      <dl className="divide-y divide-slate-100">
        {lines.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between px-3 py-2">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium text-slate-900 tabular-nums">{formatInr(plan[key])}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
          <dt className="font-medium text-slate-700">Total fee</dt>
          <dd className="font-semibold text-slate-900 tabular-nums">{formatInr(plan.gross_total)}</dd>
        </div>
        {plan.concession_amount > 0 && (
          <div className="flex items-start justify-between gap-3 px-3 py-2">
            <dt className="text-emerald-700">
              Concession / discount
              {plan.concession_reason && <span className="block text-xs text-slate-500">{plan.concession_reason}</span>}
            </dt>
            <dd className="font-medium text-emerald-700 tabular-nums">− {formatInr(plan.concession_amount)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-2 bg-[#12203a] text-white rounded-none">
          <dt className="font-medium">Net payable</dt>
          <dd className="font-semibold tabular-nums">{formatInr(plan.net_total)}</dd>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <dt className="text-slate-600">Paid so far</dt>
          <dd className="font-medium text-emerald-700 tabular-nums">{formatInr(plan.paid)}</dd>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <dt className="font-medium text-slate-700">Outstanding balance</dt>
          <dd className={cn("font-semibold tabular-nums", plan.outstanding > 0 ? "text-red-600" : "text-emerald-700")}>{formatInr(plan.outstanding)}</dd>
        </div>
      </dl>
    </div>
  );
}
