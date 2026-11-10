import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META, TXN_LABEL, type DisplayStatus, type RequestStatus, type TxnStatus } from "@/lib/instalments";

// Status is always shown as icon + text (never colour alone) so it stays readable for colour-blind users.
const TONE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  muted: "bg-slate-100 text-slate-600 border-slate-200",
  gold: "bg-amber-50 text-amber-800 border-amber-300",
  danger: "bg-red-50 text-red-700 border-red-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
};
const ICON: Record<DisplayStatus, React.ElementType> = {
  paid: CheckCircle2, pending: Clock, upcoming: CalendarClock, overdue: AlertTriangle, failed: XCircle, partially_paid: CircleDashed, cancelled: XCircle,
};

const Pill = ({ tone, icon: Icon, label, title, className }: { tone: string; icon: React.ElementType; label: string; title?: string; className?: string }) => (
  <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
  </span>
);

export const StatusPill = ({ status, className }: { status: DisplayStatus; className?: string }) => {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return <Pill tone={m.tone} icon={ICON[status] ?? Clock} label={m.label} title={m.hint} className={className} />;
};

export const RequestPill = ({ status }: { status: RequestStatus }) => {
  const map = { pending: ["gold", Clock, "Pending"], approved: ["success", CheckCircle2, "Approved"], rejected: ["danger", XCircle, "Rejected"] } as const;
  const [tone, icon, label] = map[status] ?? map.pending;
  return <Pill tone={tone} icon={icon} label={label} />;
};

export const TxnPill = ({ status }: { status: TxnStatus }) => {
  const map: Record<TxnStatus, [string, React.ElementType]> = {
    success: ["success", CheckCircle2], pending: ["gold", Loader2], created: ["muted", Clock], failed: ["danger", XCircle],
    cancelled: ["muted", XCircle], refunded: ["info", CircleDashed], partially_refunded: ["info", CircleDashed],
  };
  const [tone, icon] = map[status] ?? map.created;
  return <Pill tone={tone} icon={icon} label={TXN_LABEL[status] ?? status} />;
};
