import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { INTERACTION_TYPES, type InteractionType } from "@/lib/leadScoring";
import { logInteraction } from "@/hooks/useLeadScores";
import { useLeadTimeline } from "@/hooks/useAdmissionIntegrations";
import { assignLead, scheduleFollowUp, useAssignmentHistory } from "@/hooks/useAdmissionAssignment";
import { ASSIGNMENT_METHOD_LABELS, type WorkbenchLead } from "@/lib/admissionAssignment";
import { APPLICANT_STATUS_LABELS, LEAD_SOURCE_LABELS, type ApplicantStatus } from "@/types/admission";
import type { LeadEvent } from "@/lib/admissionIntegrations";

// admission_applicants updates go through the untyped client like the rest of the Admissions hooks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Common { lead: WorkbenchLead | null; onClose: () => void; onDone: () => void }

/** datetime-local value for "now + minutes" in the browser's zone, used as the earliest selectable follow-up time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Shell({ open, title, description, onClose, children, footer }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        {children}
        <DialogFooter className="gap-2 sm:gap-0">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Record a call / message / visit. The database stamps the time itself, and it moves the SLA clocks. */
export function RecordInteractionDialog({ lead, onClose, onDone }: Common & { defaultType?: InteractionType }) {
  const { toast } = useToast(); const { profile } = useAuth();
  const [type, setType] = useState<InteractionType>("call_answered");
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!lead || !profile?.school_id) return;
    setSaving(true);
    const { error } = await logInteraction({ schoolId: profile.school_id, applicantId: lead.applicant_id, type, note, userId: profile.id });
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error, variant: "destructive" }); return; }
    toast({ title: "Interaction recorded" }); setNote(""); onDone(); onClose();
  };
  return (
    <Shell open={!!lead} onClose={onClose} title="Record interaction" description={lead?.full_name ?? ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Save</Button></>}>
      <div className="space-y-3">
        <div><Label htmlFor="wb-type">What happened?</Label>
          <Select value={type} onValueChange={(v) => setType(v as InteractionType)}>
            <SelectTrigger id="wb-type"><SelectValue /></SelectTrigger>
            <SelectContent>{INTERACTION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label htmlFor="wb-note">Notes (optional)</Label>
          <Textarea id="wb-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Parent wants a campus visit on Saturday" /></div>
        <p className="text-xs text-muted-foreground">A missed call does not count as a first response. The time is recorded automatically.</p>
      </div>
    </Shell>
  );
}

/** Schedule the next follow-up; restarts the follow-up SLA clock from that time. */
export function ScheduleFollowUpDialog({ lead, onClose, onDone }: Common) {
  const { toast } = useToast(); const { profile } = useAuth();
  const [due, setDue] = useState(""); const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  const valid = !!due && Date.parse(due) > Date.now();
  const save = async () => {
    if (!lead || !profile?.school_id || !valid) return;
    setSaving(true);
    const { error } = await scheduleFollowUp({ schoolId: profile.school_id, applicantId: lead.applicant_id, dueAtIso: new Date(due).toISOString(), userId: profile.id, note });
    setSaving(false);
    if (error) { toast({ title: "Could not schedule", description: error, variant: "destructive" }); return; }
    toast({ title: "Follow-up scheduled" }); setDue(""); setNote(""); onDone(); onClose();
  };
  return (
    <Shell open={!!lead} onClose={onClose} title="Schedule follow-up" description={lead?.full_name ?? ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || !valid}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Schedule</Button></>}>
      <div className="space-y-3">
        <div><Label htmlFor="wb-due">Next follow-up</Label>
          <Input id="wb-due" type="datetime-local" min={localInput(new Date())} value={due} onChange={(e) => setDue(e.target.value)} />
          {due && !valid && <p className="text-xs text-red-600 mt-1">Choose a time in the future.</p>}</div>
        <div><Label htmlFor="wb-fnote">Note (optional)</Label>
          <Textarea id="wb-fnote" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">The follow-up deadline restarts from this time (working hours and school holidays are applied).</p>
      </div>
    </Shell>
  );
}

/** Update the lead's status the same way the Applicants table does. */
export function UpdateStatusDialog({ lead, onClose, onDone }: Common) {
  const { toast } = useToast(); const { profile } = useAuth();
  const [status, setStatus] = useState<ApplicantStatus | "">(""); const [notes, setNotes] = useState(""); const [saving, setSaving] = useState(false);
  const current = (status || lead?.status || "under_review") as ApplicantStatus;
  const save = async () => {
    if (!lead || !profile?.id || !status || status === lead.status) return;
    setSaving(true);
    const { error } = await db.from("admission_applicants").update({ status, decision_notes: notes.trim() || null, decided_by: profile.id, decided_at: new Date().toISOString() }).eq("id", lead.applicant_id);
    setSaving(false);
    if (error) { toast({ title: "Could not update status", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Status: ${APPLICANT_STATUS_LABELS[status]}` }); setStatus(""); setNotes(""); onDone(); onClose();
  };
  return (
    <Shell open={!!lead} onClose={onClose} title="Update lead status" description={lead?.full_name ?? ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || !status || status === lead?.status}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Update</Button></>}>
      <div className="space-y-3">
        <div><Label htmlFor="wb-status">Status</Label>
          <Select value={current} onValueChange={(v) => setStatus(v as ApplicantStatus)}>
            <SelectTrigger id="wb-status"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(APPLICANT_STATUS_LABELS) as ApplicantStatus[]).map((s) => <SelectItem key={s} value={s}>{APPLICANT_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label htmlFor="wb-dnotes">Notes (optional)</Label><Textarea id="wb-dnotes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {(status === "admitted" || status === "rejected" || status === "withdrawn") && <p className="text-xs text-amber-700">Closing a lead stops its SLA clocks.</p>}
      </div>
    </Shell>
  );
}

function describeEvent(e: LeadEvent): string {
  const d = e.detail ?? {};
  switch (e.event_type) {
    case "lead_created": return `Enquiry received${d.integration ? ` via ${d.integration}` : ""}`;
    case "repeat_enquiry": return `Enquired again${d.integration ? ` via ${d.integration}` : ""}${d.message ? `: “${d.message}”` : ""}`;
    case "status_changed": return `Status: ${APPLICANT_STATUS_LABELS[d.from as ApplicantStatus] ?? d.from} → ${APPLICANT_STATUS_LABELS[d.to as ApplicantStatus] ?? d.to}`;
    case "follow_up_note": return d.note ?? "Follow-up note";
    case "follow_up_scheduled": return `Next follow-up set for ${d.due ? new Date(d.due).toLocaleString() : "—"}`;
    case "assigned": return d.method === "auto" ? "Assigned automatically (round-robin)" : `Assigned (${ASSIGNMENT_METHOD_LABELS[d.method] ?? d.method})${d.reason ? `: ${d.reason}` : ""}`;
    default: { const t = INTERACTION_TYPES.find((x) => x.value === e.event_type); return `${t?.label ?? e.event_type}${d.note ? ` — ${d.note}` : ""}`; }
  }
}

/** Everything about one lead: contact details, notes, full contact history and assignment history. */
export function LeadDetailsDialog({ lead, onClose }: Pick<Common, "lead" | "onClose">) {
  const open = !!lead;
  const { events, loading } = useLeadTimeline(lead?.applicant_id ?? null, open);
  const hist = useAssignmentHistory(lead?.applicant_id ?? null, open);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead?.full_name ?? "Lead"}</DialogTitle>
          <DialogDescription>
            {lead && <>{APPLICANT_STATUS_LABELS[lead.status as ApplicantStatus] ?? lead.status}{lead.grade ? ` · ${lead.grade}` : ""} · {LEAD_SOURCE_LABELS[lead.source] ?? lead.source.replace(/_/g, " ")}</>}
          </DialogDescription>
        </DialogHeader>
        {lead && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Parent</dt><dd>{lead.parent_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd>{lead.parent_phone ? <a className="text-indigo-700 underline" href={`tel:${lead.parent_phone}`}>{lead.parent_phone}</a> : "—"}</dd>
              <dt className="text-muted-foreground">Email</dt><dd className="break-all">{lead.parent_email ?? "—"}</dd>
              <dt className="text-muted-foreground">Next follow-up</dt><dd>{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleString() : "Not scheduled"}</dd>
              <dt className="text-muted-foreground">Last contact</dt><dd>{lead.last_contact_at ? new Date(lead.last_contact_at).toLocaleString() : "No contact yet"}</dd>
              <dt className="text-muted-foreground">Owner</dt><dd>{lead.assigned_to_name ?? "Unassigned"}</dd>
            </dl>
            {lead.meeting_notes && <div><div className="text-xs font-semibold text-slate-600 mb-1">Notes from enquiry</div><p className="rounded bg-slate-50 p-2 whitespace-pre-wrap break-words">{lead.meeting_notes}</p></div>}
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Contact history</div>
              {loading ? <LoadingSpinner /> : (
                <ol className="space-y-2.5 border-s ps-4">
                  {events.filter((e) => e.event_type !== "assigned").map((e) => (
                    <li key={e.id} className="relative"><span className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-500" />
                      <div className="text-slate-800 break-words">{describeEvent(e)}</div>
                      <div className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div></li>
                  ))}
                  {events.filter((e) => e.event_type !== "assigned").length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
                </ol>)}
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Assignment history</div>
              {hist.loading ? <LoadingSpinner /> : (
                <ul className="space-y-1.5">
                  {hist.rows.map((r) => (
                    <li key={r.id} className="rounded border p-2">
                      <div>{r.from ? `${r.from} → ` : ""}<span className="font-medium">{r.to ?? "Unassigned"}</span></div>
                      <div className="text-[11px] text-muted-foreground">{ASSIGNMENT_METHOD_LABELS[r.method] ?? r.method}{r.by ? ` by ${r.by}` : ""} · {new Date(r.created_at).toLocaleString()}{r.reason ? ` · ${r.reason}` : ""}</div>
                    </li>))}
                  {hist.rows.length === 0 && <li className="text-muted-foreground">Not assigned yet.</li>}
                </ul>)}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Admin: assign or reassign a lead. The reason is kept in the assignment history. */
export function AssignLeadDialog({ lead, counsellors, onClose, onDone }: Common & { counsellors: { profile_id: string; name: string; accepting: boolean }[] }) {
  const { toast } = useToast();
  const [to, setTo] = useState(""); const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!lead || !to) return;
    setSaving(true);
    const { error, changed } = await assignLead(lead.applicant_id, to, reason);
    setSaving(false);
    if (error) { toast({ title: "Could not assign", description: error, variant: "destructive" }); return; }
    toast({ title: changed ? "Lead assigned" : "Already assigned to that counsellor" }); setTo(""); setReason(""); onDone(); onClose();
  };
  return (
    <Shell open={!!lead} onClose={onClose} title={lead?.assigned_to ? "Reassign lead" : "Assign lead"} description={lead ? `${lead.full_name ?? "Lead"}${lead.assigned_to_name ? ` · currently ${lead.assigned_to_name}` : " · currently unassigned"}` : ""}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving || !to}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Assign</Button></>}>
      <div className="space-y-3">
        <div><Label htmlFor="as-to">Counsellor</Label>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger id="as-to"><SelectValue placeholder="Choose a counsellor" /></SelectTrigger>
            <SelectContent>{counsellors.map((c) => <SelectItem key={c.profile_id} value={c.profile_id}>{c.name}{c.accepting ? "" : " (away)"}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label htmlFor="as-reason">Reason (optional)</Label><Input id="as-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sibling already known to this counsellor" /></div>
        <p className="text-xs text-muted-foreground">The first-response clock restarts for the new counsellor if the lead has not been contacted yet.</p>
      </div>
    </Shell>
  );
}
