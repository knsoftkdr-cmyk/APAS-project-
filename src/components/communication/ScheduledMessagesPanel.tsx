/**
 * ScheduledMessagesPanel.tsx
 * The "Scheduled" view inside each Communication Center (shown in the chat pane, no new menu or route).
 * Lists scheduled / sent / cancelled (and failed) messages with edit + cancel while still scheduled, and reuses the
 * existing delivery report for messages that have gone out.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, CheckCircle2, ChevronLeft, Clock, Pencil, Paperclip, Users, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { useSentMessageDelivery } from "@/hooks/useMessageDelivery";
import { DeliveryReportDialog, DeliverySummaryChip } from "@/components/communication/MessageDeliveryReport";
import { ScheduleMessageDialog, type ScheduleCandidate } from "@/components/communication/ScheduleMessageDialog";
import type { ScheduledMessagesApi } from "@/hooks/useScheduledMessages";
import {
  STATUS_HELP, STATUS_LABEL, SCHEDULED_FILTERS, canCancel, canEdit, countByStatus, deliveryReportKey, filterByStatus,
  isDueSoon, recipientSummary, sortForDisplay, timeUntil,
  type ScheduledFilter, type ScheduledMessage,
} from "@/lib/scheduledMessagesModel";

const BADGE: Record<ScheduledFilter, string> = {
  scheduled: "bg-amber-50 text-amber-700 border-amber-200",
  sent: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-slate-100 text-slate-600 border-slate-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

const StatusIcon = ({ status }: { status: ScheduledFilter }) =>
  status === "sent" ? <CheckCircle2 className="h-3 w-3" />
  : status === "cancelled" ? <XCircle className="h-3 w-3" />
  : status === "failed" ? <AlertTriangle className="h-3 w-3" />
  : <Clock className="h-3 w-3" />;

interface Props {
  api: ScheduledMessagesApi;
  userId: string | undefined;
  role: string | null | undefined;
  /** Display name for a recipient id (from the page's already-loaded contacts). */
  nameFor: (id: string) => string;
  onBack?: () => void;
}

export function ScheduledMessagesPanel({ api, userId, role, nameFor, onBack }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ScheduledFilter>("scheduled");
  const [now, setNow] = useState(() => new Date());
  const [confirmCancel, setConfirmCancel] = useState<ScheduledMessage | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState<{ m: ScheduledMessage; candidates: ScheduleCandidate[]; selected: string[] } | null>(null);
  const [reportOf, setReportOf] = useState<ScheduledMessage | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  const counts = useMemo(() => countByStatus(api.items), [api.items]);
  const visibleTabs = SCHEDULED_FILTERS.filter((s) => s !== "failed" || counts.failed > 0);
  const shown = useMemo(() => sortForDisplay(filterByStatus(api.items, tab), tab), [api.items, tab]);

  const keyOf = (m: ScheduledMessage) => deliveryReportKey(m, api.singleMessageIds.get(m.id));
  const sentKeys = useMemo(
    () => api.items.filter((m) => m.sender_id === userId).map((m) => deliveryReportKey(m, api.singleMessageIds.get(m.id))).filter(Boolean) as string[],
    [api.items, api.singleMessageIds, userId],
  );
  const delivery = useSentMessageDelivery(userId, sentKeys, reportOf ? keyOf(reportOf) : null);

  const openEdit = async (m: ScheduledMessage) => {
    try {
      const recs = await api.fetchRecipients(m.id);
      const candidates = recs.map((r) => ({ id: r.id, role: r.role, name: nameFor(r.id) }));
      setEditing({ m, candidates, selected: candidates.map((c) => c.id) });
    } catch (e: any) {
      toast({ title: "Could not open the message", description: e?.message, variant: "destructive" });
    }
  };

  const doCancel = async () => {
    if (!confirmCancel) return;
    setCancelling(true);
    const res = await api.cancel(confirmCancel.id);
    setCancelling(false);
    if (res.ok) toast({ title: "Scheduled message cancelled", description: "Nothing was sent." });
    else toast({ title: "Could not cancel", description: res.error, variant: "destructive" });
    setConfirmCancel(null);
    void api.refresh();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-r from-green-600 to-green-500">
        {onBack && (
          <button className="md:hidden p-1 text-white" onClick={onBack} aria-label="Back"><ChevronLeft className="h-5 w-5" /></button>
        )}
        <div className="h-10 w-10 rounded-full flex items-center justify-center bg-white/20 text-white"><CalendarClock className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Scheduled messages</p>
          <p className="text-xs text-white/75">{counts.scheduled} waiting to be sent</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ScheduledFilter)} className="px-3 pt-3">
        <TabsList className="w-full h-9 bg-slate-100 rounded-full p-1 flex">
          {visibleTabs.map((s) => (
            <TabsTrigger key={s} value={s} className="flex-1 text-xs rounded-full data-[state=active]:bg-green-600 data-[state=active]:text-white">
              {STATUS_LABEL[s]} ({counts[s]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        <p className="text-xs text-muted-foreground">{STATUS_HELP[tab]}</p>

        {api.loading ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : !api.available ? (
          <p className="text-sm text-center py-8 text-muted-foreground">
            Scheduled messages are not set up on the server yet. Ask an administrator to apply the latest database update.
          </p>
        ) : api.error ? (
          <p className="text-sm text-center py-8 text-destructive">{api.error}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-center py-8 text-muted-foreground">
            {tab === "scheduled" ? "Nothing scheduled. Write a message and use the clock button to schedule it." : `No ${STATUS_LABEL[tab].toLowerCase()} messages.`}
          </p>
        ) : (
          shown.map((m) => {
            const mine = m.sender_id === userId;
            const key = keyOf(m);
            return (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="outline" className={`gap-1 ${BADGE[m.status]}`}><StatusIcon status={m.status} />{STATUS_LABEL[m.status]}</Badge>
                  <span className="text-xs text-muted-foreground text-end">
                    {format(new Date(m.status === "sent" && m.sent_at ? m.sent_at : m.scheduled_for), "EEE d MMM yyyy, h:mm a")}
                    {m.status === "scheduled" && (
                      <span className="block text-green-700 font-medium">
                        {isDueSoon(m, now) ? "sending now…" : timeUntil(m.scheduled_for, now)}
                      </span>
                    )}
                  </span>
                </div>

                <p className="text-sm mt-2 whitespace-pre-line line-clamp-4">{m.message}</p>
                {m.attachment_name && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Paperclip className="h-3 w-3" />{m.attachment_name}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {recipientSummary(m)}
                  {!mine && <span> · by {api.senderNames.get(m.sender_id) || "a colleague"}</span>}
                </p>
                {m.status === "failed" && m.last_error && <p className="text-xs text-red-600 mt-1">Reason: {m.last_error}</p>}
                {m.status === "cancelled" && m.cancelled_at && (
                  <p className="text-xs text-muted-foreground mt-1">Cancelled {format(new Date(m.cancelled_at), "d MMM yyyy, h:mm a")}</p>
                )}

                {m.status === "sent" && mine && key && (
                  <DeliverySummaryChip summary={delivery.summaries.get(key)} onOpen={() => setReportOf(m)} />
                )}

                {(canEdit(m, userId) || canCancel(m, userId, role)) && (
                  <div className="flex gap-2 mt-3">
                    {canEdit(m, userId) && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    )}
                    {canCancel(m, userId, role) && (
                      <Button size="sm" variant="outline" className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setConfirmCancel(m)}>
                        <XCircle className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => { if (!o && !cancelling) setConfirmCancel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this scheduled message?</AlertDialogTitle>
            <AlertDialogDescription>It will not be sent to anyone. This cannot be undone, but you can schedule a new message.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={cancelling} onClick={(e) => { e.preventDefault(); void doCancel(); }} className="bg-red-600 hover:bg-red-700">
              {cancelling ? "Cancelling…" : "Cancel message"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <ScheduleMessageDialog
          open
          mode="edit"
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          candidates={editing.candidates}
          initialSelectedIds={editing.selected}
          initialMessage={editing.m.message === "📎 Attachment" ? "" : editing.m.message}
          initialWhen={new Date(editing.m.scheduled_for)}
          attachmentName={editing.m.attachment_name}
          audienceLabel={editing.m.audience_label}
          onSubmit={async (v) => {
            const removed = editing.candidates.length !== v.recipients.length;
            const res = await api.update(editing.m.id, {
              message: v.message,
              scheduledFor: v.when,
              recipients: removed ? v.recipients : undefined,
              clearAttachment: v.removeAttachment,
            });
            if (!res.ok) return res.error;
            toast({ title: "Scheduled message updated" });
            setEditing(null);
            return null;
          }}
        />
      )}

      <DeliveryReportDialog
        open={!!reportOf}
        onOpenChange={(o) => { if (!o) setReportOf(null); }}
        title={reportOf?.audience_label || "Scheduled message"}
        preview={reportOf?.message?.slice(0, 120)}
        sentAt={reportOf?.sent_at ?? null}
        rows={delivery.report}
        loading={delivery.reportLoading}
        error={delivery.reportError}
        available={delivery.available}
        nameFor={nameFor}
      />
    </div>
  );
}
