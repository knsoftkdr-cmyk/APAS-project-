/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, FileText, History, Phone, PhoneIncoming, PhoneOutgoing, Play, StickyNote } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fetchRecordingBlobUrl, useCallHistory, useCallMutations, useLeadTimeline, useTelephonySettings, usePendingFollowups, type CallHistoryFilters, type CallRow } from "@/hooks/useTelephony";
import { CALL_STATUS_LABEL, CALL_STATUSES_FOR_FILTER, formatDuration, formatInSchoolTz, schoolLocalToIso, type CallStatus } from "@/lib/telephony";

interface Props { applicantId: string | null; applicantName: string; onOpenChange: (o: boolean) => void }
const ANY = "any";

function RecordingPlayer({ callId }: { callId: string }) {
  const [url, setUrl] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const last = useRef<string | null>(null);
  useEffect(() => () => { if (last.current) URL.revokeObjectURL(last.current); }, []);
  if (url) return <audio controls autoPlay src={url} className="h-8 w-full" />;
  return <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={async () => {
    setBusy(true);
    try { const u = await fetchRecordingBlobUrl(callId); last.current = u; setUrl(u); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }}><Play className="h-3.5 w-3.5 me-1" />{busy ? "Loading…" : "Play recording"}</Button>;
}

export function LeadCallPanel({ applicantId, applicantName, onOpenChange }: Props) {
  const { data: cfg } = useTelephonySettings();
  const tz = cfg?.settings?.timezone ?? "Asia/Kolkata";
  const [filters, setFilters] = useState<CallHistoryFilters>({});
  const timeline = useLeadTimeline(applicantId);
  const history = useCallHistory(applicantId, filters);
  const m = useCallMutations(applicantId);
  const pending = usePendingFollowups(false, !!applicantId);
  const [note, setNote] = useState(""); const [noteCall, setNoteCall] = useState<string>("none");
  const [due, setDue] = useState(""); const [reason, setReason] = useState("");
  useEffect(() => { setFilters({}); setNote(""); setDue(""); setReason(""); setNoteCall("none"); }, [applicantId]);

  const staffOptions = useMemo(() => { const s = new Map<string, string>(); (history.data ?? []).forEach((c) => c.staff_id && s.set(c.staff_id, c.staff_name ?? "Staff")); return [...s]; }, [history.data]);
  const leadFollowups = (pending.data ?? []).filter((f) => f.applicant_id === applicantId);
  const recent = (history.data ?? []).slice(0, 20);
  const set = (k: keyof CallHistoryFilters, v: string) => setFilters((f) => ({ ...f, [k]: v === ANY ? undefined : v }));

  const saveNote = async () => {
    try { await m.addNote.mutateAsync({ note, callId: noteCall === "none" ? null : noteCall }); setNote(""); toast.success("Note saved"); } catch (e) { toast.error((e as Error).message); }
  };
  const saveFollowup = async () => {
    const iso = schoolLocalToIso(due, tz);
    if (!iso) return toast.error("Choose a date and time.");
    if (!reason.trim()) return toast.error("Say what the follow-up is for.");
    try { await m.schedule.mutateAsync({ dueIso: iso, reason: reason.trim() }); setDue(""); setReason(""); toast.success("Follow-up scheduled"); } catch (e) { toast.error((e as Error).message); }
  };

  const renderEvent = (e: any) => {
    const at = formatInSchoolTz(e.at, tz);
    const body = e.type === "enquiry" ? <>Admission enquiry received</>
      : e.type === "call" ? <>{e.direction === "inbound" ? "Incoming" : "Outgoing"} call · {CALL_STATUS_LABEL[e.status as CallStatus] ?? e.status}{e.duration_seconds ? ` · ${formatDuration(e.duration_seconds)}` : ""}{e.staff ? ` · ${e.staff}` : ""}</>
      : e.type === "note" ? <><b>Note</b> by {e.author ?? "staff"}: {e.note}</>
      : e.type === "followup_scheduled" ? <>Follow-up {e.status === "pending" ? "scheduled" : e.status} for {formatInSchoolTz(e.due_at, tz)} - {e.reason}</>
      : e.type === "followup_completed" ? <>Follow-up completed - {e.reason}</> : <>{e.type}</>;
    const Icon = e.type === "call" ? (e.direction === "inbound" ? PhoneIncoming : PhoneOutgoing) : e.type === "note" ? StickyNote : e.type.startsWith("followup") ? CalendarClock : FileText;
    return <li key={`${e.type}-${e.id ?? e.at}`} className="flex gap-2 text-sm"><Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" /><div><div>{body}</div><div className="text-xs text-muted-foreground">{at}</div></div></li>;
  };

  return (
    <Sheet open={!!applicantId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader><SheetTitle className="flex items-center gap-2"><Phone className="h-4 w-4" />{applicantName}</SheetTitle><SheetDescription>Calls, notes and follow-ups. Times shown in {tz}.</SheetDescription></SheetHeader>
        <Tabs defaultValue="timeline" className="mt-4">
          <TabsList className="grid grid-cols-4 w-full"><TabsTrigger value="timeline">Timeline</TabsTrigger><TabsTrigger value="calls">Calls</TabsTrigger><TabsTrigger value="notes">Notes</TabsTrigger><TabsTrigger value="follow">Follow-up</TabsTrigger></TabsList>

          <TabsContent value="timeline" className="pt-3">
            {timeline.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : timeline.error ? <p className="text-sm text-destructive">{(timeline.error as Error).message}</p>
              : (timeline.data?.length ? <ul className="space-y-3">{timeline.data.map(renderEvent)}</ul> : <p className="text-sm text-muted-foreground">No activity yet.</p>)}
          </TabsContent>

          <TabsContent value="calls" className="pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">From</Label><Input type="date" value={filters.from ?? ""} onChange={(e) => set("from", e.target.value || ANY)} /></div>
              <div><Label className="text-xs">To</Label><Input type="date" value={filters.to ?? ""} onChange={(e) => set("to", e.target.value || ANY)} /></div>
              <Select value={filters.status ?? ANY} onValueChange={(v) => set("status", v)}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value={ANY}>Any status</SelectItem>{CALL_STATUSES_FOR_FILTER.map((s) => <SelectItem key={s} value={s}>{CALL_STATUS_LABEL[s]}</SelectItem>)}</SelectContent></Select>
              <Select value={filters.direction ?? ANY} onValueChange={(v) => set("direction", v)}><SelectTrigger><SelectValue placeholder="Direction" /></SelectTrigger><SelectContent><SelectItem value={ANY}>Any direction</SelectItem><SelectItem value="outbound">Outgoing</SelectItem><SelectItem value="inbound">Incoming</SelectItem></SelectContent></Select>
              <Select value={filters.staff ?? ANY} onValueChange={(v) => set("staff", v)}><SelectTrigger><SelectValue placeholder="Staff" /></SelectTrigger><SelectContent><SelectItem value={ANY}>Any staff</SelectItem>{staffOptions.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}</SelectContent></Select>
              <Select value={filters.provider ?? ANY} onValueChange={(v) => set("provider", v)}><SelectTrigger><SelectValue placeholder="Provider" /></SelectTrigger><SelectContent><SelectItem value={ANY}>Any provider</SelectItem><SelectItem value="exotel">Exotel</SelectItem><SelectItem value="airtel_iq">Airtel IQ</SelectItem></SelectContent></Select>
            </div>
            {history.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !history.data?.length ? <p className="text-sm text-muted-foreground">No calls match.</p> : (
              <ul className="space-y-2">{history.data.map((c: CallRow) => (
                <li key={c.id} className="rounded-md border p-2.5 text-sm space-y-1">
                  <div className="flex justify-between gap-2"><span>{c.direction === "inbound" ? "Incoming" : "Outgoing"} · <b>{CALL_STATUS_LABEL[c.status as CallStatus] ?? c.status}</b></span><span className="text-muted-foreground">{formatDuration(c.duration_seconds)}</span></div>
                  <div className="text-xs text-muted-foreground">{formatInSchoolTz(c.started_at ?? c.created_at, tz)} · {c.staff_name ?? "—"} · {c.provider}{c.note_count ? ` · ${c.note_count} note(s)` : ""}</div>
                  {c.failure_reason && <div className="text-xs text-destructive">{c.failure_reason}</div>}
                  {c.recording_available && <RecordingPlayer callId={c.id} />}
                </li>))}</ul>)}
          </TabsContent>

          <TabsContent value="notes" className="pt-3 space-y-3">
            <Textarea rows={3} maxLength={4000} placeholder="What was discussed?" value={note} onChange={(e) => setNote(e.target.value)} />
            <Select value={noteCall} onValueChange={setNoteCall}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not linked to a call</SelectItem>{recent.map((c) => <SelectItem key={c.id} value={c.id}>{formatInSchoolTz(c.started_at ?? c.created_at, tz)} · {CALL_STATUS_LABEL[c.status as CallStatus] ?? c.status}</SelectItem>)}</SelectContent></Select>
            <Button onClick={saveNote} disabled={!note.trim() || m.addNote.isPending}>Save note</Button>
            <ul className="space-y-2">{(timeline.data ?? []).filter((e) => e.type === "note").map(renderEvent)}</ul>
          </TabsContent>

          <TabsContent value="follow" className="pt-3 space-y-3">
            <div className="space-y-2">
              <Label>Remind me on (school time, {tz})</Label>
              <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              <Input placeholder="Reason, e.g. Call back after fee discussion" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button onClick={saveFollowup} disabled={m.schedule.isPending}>Schedule follow-up</Button>
            </div>
            <ul className="space-y-2">{leadFollowups.map((f) => (
              <li key={f.id} className="rounded-md border p-2.5 text-sm">
                <div className={f.overdue ? "text-destructive font-medium" : ""}>{formatInSchoolTz(f.due_at, tz)}{f.overdue ? " · overdue" : ""}</div>
                <div className="text-muted-foreground">{f.reason}{f.assigned_name ? ` · ${f.assigned_name}` : ""}</div>
                <div className="mt-1.5 flex gap-2">
                  <Button size="sm" className="h-7" onClick={() => m.updateFollowup.mutate({ id: f.id, action: "complete" }, { onError: (e) => toast.error((e as Error).message) })}>Done</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => m.updateFollowup.mutate({ id: f.id, action: "cancel" }, { onError: (e) => toast.error((e as Error).message) })}>Cancel</Button>
                </div></li>))}</ul>
            {!leadFollowups.length && <p className="text-sm text-muted-foreground flex items-center gap-1"><History className="h-3.5 w-3.5" />No pending follow-ups for this lead.</p>}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
