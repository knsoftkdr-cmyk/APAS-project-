/**
 * MessageDeliveryReport.tsx
 * Shared delivery UI for the Communication Centers: status badge / tick, a compact per-message summary chip,
 * and the recipient-wise report dialog (totals, Pending / Delivered / Read counts, All / Pending / Delivered /
 * Read filter, per-person status). Presentation only: data comes from useSentMessageDelivery.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CheckCheck, Clock, Eye, Inbox, Info, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  DELIVERY_FILTERS, STATUS_HELP, STATUS_LABEL, countFor, filterRows, normalizeStatus, overallStatus, percent,
  searchRows, sortRecipients, summarize,
  type DeliveryFilter, type DeliveryRow, type DeliveryStatus, type DeliverySummary,
} from "@/lib/messageDeliveryModel";

const STATUS_STYLE: Record<DeliveryStatus, { chip: string; dot: string; bar: string; card: string }> = {
  pending: {
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "text-amber-500",
    bar: "bg-amber-400",
    card: "bg-amber-50/70 border-amber-200 text-amber-800",
  },
  delivered: {
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "text-sky-500",
    bar: "bg-sky-400",
    card: "bg-sky-50/70 border-sky-200 text-sky-800",
  },
  read: {
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "text-emerald-500",
    bar: "bg-emerald-500",
    card: "bg-emerald-50/70 border-emerald-200 text-emerald-800",
  },
};

const roleBadgeColor: Record<string, string> = {
  teacher: "bg-amber-100 text-amber-700 border-amber-200",
  parent: "bg-blue-100 text-blue-700 border-blue-200",
  student: "bg-green-100 text-green-700 border-green-200",
  driver: "bg-purple-100 text-purple-700 border-purple-200",
};

export function StatusIcon({ status, className = "h-3.5 w-3.5" }: { status: DeliveryStatus; className?: string }) {
  if (status === "read") return <Eye className={className} />;
  if (status === "delivered") return <Inbox className={className} />;
  return <Clock className={className} />;
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const s = normalizeStatus(status);
  return (
    <span
      title={STATUS_HELP[s]}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s].chip}`}
    >
      <StatusIcon status={s} className="h-3 w-3" />
      {STATUS_LABEL[s]}
    </span>
  );
}

/** Tick shown next to the time on the sender's own message bubble (on a coloured bubble). */
export function DeliveryTick({ status }: { status: DeliveryStatus }) {
  const label = `${STATUS_LABEL[status]}: ${STATUS_HELP[status]}`;
  const icon =
    status === "read" ? <CheckCheck className="h-3 w-3 text-sky-300" />
    : status === "delivered" ? <CheckCheck className="h-3 w-3 text-green-100" />
    : <Clock className="h-3 w-3 text-green-100/80" />;
  return <span title={label} aria-label={label} className="inline-flex">{icon}</span>;
}

/** Compact "who has it" strip under a sent message. Opens the full report when clicked. */
export function DeliverySummaryChip({
  summary,
  onOpen,
}: {
  summary: DeliverySummary | undefined;
  onOpen: () => void;
}) {
  const s = summary;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 w-full rounded-xl bg-black/10 hover:bg-black/15 transition-colors px-2.5 py-1.5 text-start"
      aria-label="Open delivery report"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-green-50">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" />
          {s ? `${s.total} recipient${s.total === 1 ? "" : "s"}` : "Delivery report"}
        </span>
        <span className="opacity-80">View report</span>
      </div>
      {s && s.total > 0 && (
        <>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/25">
            <div className="bg-emerald-300" style={{ width: `${percent(s.read, s.total)}%` }} />
            <div className="bg-sky-200" style={{ width: `${percent(s.delivered, s.total)}%` }} />
            <div className="bg-amber-200" style={{ width: `${percent(s.pending, s.total)}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-green-50">
            <span>{s.pending} pending</span>
            <span>{s.delivered} delivered</span>
            <span>{s.read} read</span>
          </div>
        </>
      )}
    </button>
  );
}

const fmt = (iso: string | null) => (iso ? format(new Date(iso), "d MMM, h:mm a") : null);

function timeLine(r: DeliveryRow): string {
  const s = normalizeStatus(r.delivery_status);
  if (s === "read") return r.read_at ? `Read ${fmt(r.read_at)}` : "Read (time not recorded)";
  if (s === "delivered") return r.delivered_at ? `Delivered ${fmt(r.delivered_at)}` : "Delivered";
  return "Waiting for the recipient's app";
}

export interface DeliveryReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading context, e.g. the broadcast label or contact name. */
  title: string;
  /** First line(s) of the message and when it was sent. */
  preview?: string;
  sentAt?: string | null;
  rows: DeliveryRow[];
  loading: boolean;
  error: string | null;
  /** False when the tracking migration has not been applied. */
  available: boolean;
  nameFor: (recipientId: string) => string;
}

export function DeliveryReportDialog({
  open, onOpenChange, title, preview, sentAt, rows, loading, error, available, nameFor,
}: DeliveryReportDialogProps) {
  const [filter, setFilter] = useState<DeliveryFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) { setFilter("all"); setQuery(""); }
  }, [open]);

  const summary = useMemo(() => summarize(rows), [rows]);
  const shown = useMemo(
    () => sortRecipients(searchRows(filterRows(rows, filter), query, nameFor), nameFor),
    [rows, filter, query, nameFor],
  );
  const overall = overallStatus(summary);

  const stat = (status: DeliveryStatus) => (
    <div key={status} className={`rounded-xl border px-2.5 py-2 ${STATUS_STYLE[status].card}`}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
        <StatusIcon status={status} className="h-3 w-3" />
        {STATUS_LABEL[status]}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-xl font-bold leading-none">{summary[status]}</span>
        <span className="text-[10px] opacity-70">{percent(summary[status], summary.total)}%</span>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg max-h-[90vh] overflow-hidden flex flex-col gap-3 p-4 sm:p-5">
        <DialogHeader className="space-y-1 text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="h-8 w-8 rounded-full bg-gradient-to-br from-green-600 to-emerald-500 flex items-center justify-center text-white shrink-0">
              <StatusIcon status={overall} className="h-4 w-4" />
            </span>
            <span className="truncate">Delivery report · {title}</span>
          </DialogTitle>
          <DialogDescription className="text-xs line-clamp-2">
            {preview ? `“${preview}”` : "Per-recipient delivery status"}
            {sentAt ? ` · sent ${fmt(sentAt)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {!available ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            Delivery tracking is not enabled on this database yet. Apply the delivery tracking migration to see reports.
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : error && rows.length === 0 ? (
          <p className="text-xs text-destructive text-center py-8">{error}</p>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Users className="h-3.5 w-3.5" /> {summary.total} recipient{summary.total === 1 ? "" : "s"}
                </span>
                <span>{percent(summary.read, summary.total)}% read</span>
              </div>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-200">
                <div className={STATUS_STYLE.read.bar} style={{ width: `${percent(summary.read, summary.total)}%` }} />
                <div className={STATUS_STYLE.delivered.bar} style={{ width: `${percent(summary.delivered, summary.total)}%` }} />
                <div className={STATUS_STYLE.pending.bar} style={{ width: `${percent(summary.pending, summary.total)}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">{(["pending", "delivered", "read"] as DeliveryStatus[]).map(stat)}</div>

            <Tabs value={filter} onValueChange={(v) => setFilter(v as DeliveryFilter)}>
              <TabsList className="grid w-full grid-cols-4 h-auto">
                {DELIVERY_FILTERS.map((f) => (
                  <TabsTrigger key={f} value={f} className="text-[11px] px-1 py-1.5 gap-1 flex-col sm:flex-row">
                    <span className="capitalize">{f}</span>
                    <span className="rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums">{countFor(summary, f)}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search recipient"
                className="ps-8 h-9 text-sm"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-100 max-h-[38vh]">
              {shown.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  {rows.length === 0 ? "No recipient records for this message." : "No recipients match this filter."}
                </p>
              ) : (
                shown.map((r) => {
                  const name = nameFor(r.recipient_id);
                  return (
                    <div key={r.message_id} className="flex items-center gap-3 px-3 py-2">
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center shrink-0 text-xs font-bold text-white">
                        {name[0] || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                          {r.recipient_role && (
                            <span className={`hidden sm:inline rounded-full border px-1.5 text-[9px] font-semibold capitalize ${roleBadgeColor[r.recipient_role] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                              {r.recipient_role}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{timeLine(r)}</p>
                      </div>
                      <DeliveryStatusBadge status={r.delivery_status} />
                    </div>
                  );
                })
              )}
            </div>

            <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground leading-snug">
              <Info className="h-3 w-3 shrink-0 mt-px" />
              Delivered means the message reached the recipient’s APAS inbox. A push notification being accepted
              by the provider is not counted as delivery. Statuses update automatically.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
