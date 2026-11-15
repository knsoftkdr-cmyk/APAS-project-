import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { History, Loader2 } from "lucide-react";
import { addFollowUpNote, useLeadTimeline } from "@/hooks/useAdmissionIntegrations";
import type { LeadEvent, LeadMeta } from "@/lib/admissionIntegrations";
import { APPLICANT_STATUS_LABELS, LEAD_SOURCE_LABELS, type AdmissionApplicant, type ApplicantStatus } from "@/types/admission";

function describe(e: LeadEvent): string {
  const d = e.detail ?? {};
  switch (e.event_type) {
    case "lead_created": return `Enquiry received via ${d.integration ?? LEAD_SOURCE_LABELS[d.provider] ?? "an integration"}`;
    case "repeat_enquiry": return `Enquired again via ${d.integration ?? "an integration"} — merged into this applicant${d.message ? `: “${d.message}”` : ""}`;
    case "status_changed": return `Status: ${APPLICANT_STATUS_LABELS[d.from as ApplicantStatus] ?? d.from} → ${APPLICANT_STATUS_LABELS[d.to as ApplicantStatus] ?? d.to}`;
    case "follow_up_note": return d.note ?? "Follow-up note";
    case "follow_up_scheduled": return `Next follow-up set for ${d.due ? new Date(d.due).toLocaleString() : "—"}`;
    case "assigned": return "Assigned";
  }
}

interface Props { applicant: AdmissionApplicant; meta: LeadMeta; onChanged: () => void }

/** Timeline + follow-up for an applicant who came in through an integration. */
export function LeadActivityDialog({ applicant, meta, onChanged }: Props) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const { events, loading, refetch } = useLeadTimeline(applicant.id, open);
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!profile?.school_id || (!note.trim() && !due)) return;
    setSaving(true);
    const { error } = await addFollowUpNote({ schoolId: profile.school_id, applicantId: applicant.id, note, nextFollowUpAt: due ? new Date(due).toISOString() : undefined, userId: profile.id });
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error, variant: "destructive" }); return; }
    setNote(""); setDue("");
    await refetch(); onChanged();
    toast({ title: "Follow-up saved" });
  };

  const overdue = meta.next_follow_up_at && Date.parse(meta.next_follow_up_at) < Date.now() && applicant.status === "under_review";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className={overdue ? "text-red-600" : ""} aria-label={`Lead activity for ${applicant.full_name}`}>
          <History className="h-4 w-4 me-1" />{overdue ? "Follow up" : "Activity"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{applicant.full_name}</DialogTitle>
          <DialogDescription>
            {LEAD_SOURCE_LABELS[meta.lead_source] ?? meta.lead_source} lead · {meta.enquiry_count} enquir{meta.enquiry_count === 1 ? "y" : "ies"}
            {meta.next_follow_up_at && <> · next follow-up {new Date(meta.next_follow_up_at).toLocaleString()}</>}
          </DialogDescription>
        </DialogHeader>

        {Object.keys(meta.campaign ?? {}).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(meta.campaign).map(([k, v]) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{k.replace(/_/g, " ")}: {v}</span>)}
          </div>
        )}

        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="fu-note">Log a follow-up</Label>
          <Textarea id="fu-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called parent, campus visit booked for Saturday" />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="fu-due" className="text-xs">Next follow-up</Label>
              <Input id="fu-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <Button onClick={save} disabled={saving || (!note.trim() && !due)}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Save</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Change the applicant’s status from the table as usual — it is recorded here automatically.</p>
        </div>

        {loading ? <LoadingSpinner /> : (
          <ol className="space-y-3 border-s ps-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-indigo-500" />
                <div className="text-sm text-slate-800 break-words">{describe(e)}</div>
                <div className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
              </li>
            ))}
            {events.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
