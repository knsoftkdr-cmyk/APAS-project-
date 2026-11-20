import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarClock, ClipboardList, Eye, Phone, Repeat, UserPlus } from "lucide-react";
import { CategoryChip } from "./LeadScoreBadge";
import { SlaBadge, SlaStateChip } from "./SlaBadge";
import { AssignLeadDialog, LeadDetailsDialog, RecordInteractionDialog, ScheduleFollowUpDialog, UpdateStatusDialog } from "./WorkbenchDialogs";
import { worstState, type WorkbenchLead } from "@/lib/admissionAssignment";
import { APPLICANT_STATUS_LABELS, type ApplicantStatus } from "@/types/admission";

type Dlg = { kind: "record" | "schedule" | "status" | "details" | "assign"; lead: WorkbenchLead } | null;

interface Props {
  leads: WorkbenchLead[];
  nowMs: number;
  onChanged: () => void;
  /** Admin queues: allow assigning / reassigning from the list. */
  counsellors?: { profile_id: string; name: string; accepting: boolean }[];
  emptyText?: string;
  showOwner?: boolean;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null);

/** Lead cards with SLA clocks and quick actions. Cards (not a wide table) so it works the same on a phone. */
export function WorkbenchLeadList({ leads, nowMs, onChanged, counsellors, emptyText = "No leads here.", showOwner = false }: Props) {
  const [dlg, setDlg] = useState<Dlg>(null);
  const close = () => setDlg(null);
  const pick = (kind: NonNullable<Dlg>["kind"], lead: WorkbenchLead) => setDlg({ kind, lead });
  const lead = dlg?.lead ?? null;

  if (leads.length === 0) return <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">{emptyText}</div>;

  return (
    <>
      <ul className="space-y-3" aria-label="Leads">
        {leads.map((l) => {
          const state = worstState(l, nowMs);
          return (
            <li key={l.applicant_id} data-testid="wb-lead"
              className={`rounded-xl border bg-white p-3 md:p-4 shadow-sm ${state === "overdue" ? "border-red-300" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-800 truncate max-w-[16rem]">{l.full_name ?? "Lead"}</h3>
                    {l.is_new && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">New</span>}
                    {state && <SlaStateChip state={state} />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {l.grade ? `${l.grade} · ` : ""}{APPLICANT_STATUS_LABELS[l.status as ApplicantStatus] ?? l.status}
                    {l.parent_name ? ` · ${l.parent_name}` : ""}
                    {showOwner && <> · <span className="font-medium text-slate-700">{l.assigned_to_name ?? "Unassigned"}</span></>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {l.score != null && l.category && <><span className="text-lg font-bold tabular-nums text-slate-700" aria-label={`Lead score ${l.score}`}>{l.score}</span><CategoryChip category={l.category} /></>}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                <SlaBadge kind="first_response" clock={l.first_response} nowMs={nowMs} />
                <SlaBadge kind="follow_up" clock={l.follow_up} nowMs={nowMs} />
                <div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Next follow-up</div>
                  <div className="text-slate-700">{fmt(l.next_follow_up_at) ?? "Not scheduled"}</div></div>
                <div><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Last contact</div>
                  <div className="text-slate-700">{fmt(l.last_contact_at) ?? "None yet"}{l.contact_count > 0 && <span className="text-muted-foreground"> · {l.contact_count} contact{l.contact_count === 1 ? "" : "s"}</span>}</div></div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {l.parent_phone && (
                  <Button asChild size="sm" variant="outline"><a href={`tel:${l.parent_phone}`} aria-label={`Call ${l.full_name ?? "parent"}`}><Phone className="h-3.5 w-3.5 me-1.5" />Call</a></Button>)}
                <Button size="sm" variant="outline" onClick={() => pick("record", l)}><ClipboardList className="h-3.5 w-3.5 me-1.5" />Record interaction</Button>
                <Button size="sm" variant="outline" onClick={() => pick("schedule", l)}><CalendarClock className="h-3.5 w-3.5 me-1.5" />Schedule follow-up</Button>
                <Button size="sm" variant="outline" onClick={() => pick("status", l)}><Repeat className="h-3.5 w-3.5 me-1.5" />Update status</Button>
                <Button size="sm" variant="ghost" onClick={() => pick("details", l)}><Eye className="h-3.5 w-3.5 me-1.5" />Details</Button>
                {counsellors && <Button size="sm" variant="secondary" onClick={() => pick("assign", l)}><UserPlus className="h-3.5 w-3.5 me-1.5" />{l.assigned_to ? "Reassign" : "Assign"}</Button>}
              </div>
            </li>
          );
        })}
      </ul>

      <RecordInteractionDialog lead={dlg?.kind === "record" ? lead : null} onClose={close} onDone={onChanged} />
      <ScheduleFollowUpDialog lead={dlg?.kind === "schedule" ? lead : null} onClose={close} onDone={onChanged} />
      <UpdateStatusDialog lead={dlg?.kind === "status" ? lead : null} onClose={close} onDone={onChanged} />
      <LeadDetailsDialog lead={dlg?.kind === "details" ? lead : null} onClose={close} />
      {counsellors && <AssignLeadDialog lead={dlg?.kind === "assign" ? lead : null} counsellors={counsellors} onClose={close} onDone={onChanged} />}
    </>
  );
}
