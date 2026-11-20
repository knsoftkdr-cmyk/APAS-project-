import { useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { Search, Users2, History as HistoryIcon } from "lucide-react";
import type { AdmissionApplicant, ApplicantStatus } from "@/types/admission";
import { APPLICANT_STATUS_LABELS, APPLICANT_STATUS_BADGE_VARIANT } from "@/types/admission";
import type { ApplicantFilters } from "@/hooks/useAdmissionApplicants";
import type { AdmissionIntake } from "@/types/admission";
import { ApplicantDocumentsDialog } from "./ApplicantDocumentsDialog";
import { LeadSourceBadge } from "./LeadSourceBadge";
import { LeadActivityDialog } from "./LeadActivityDialog";
import { useLeadMeta } from "@/hooks/useAdmissionIntegrations";
import { LEAD_PROVIDER_LABELS, type AdmissionIntegration } from "@/lib/admissionIntegrations";
import { APPLICANT_SOURCE_LABELS } from "@/types/admission";
import { CallButton } from "./calls/CallButton";
import { ActiveCallBanner } from "./calls/ActiveCallBanner";
import { LeadCallPanel } from "./calls/LeadCallPanel";
import { useCallSession } from "@/hooks/useTelephony";
import { useQueryClient } from "@tanstack/react-query";
import { ApplicantFeePlanCell, useFeePlanMap } from "./ApplicantFeePlan";
import { formatInr } from "@/lib/feePlan";
import { getApplicantFeePlan } from "@/lib/feePlanApi";

interface ApplicantsTableProps {
  applicants: AdmissionApplicant[];
  loading: boolean;
  intakes: AdmissionIntake[];
  filters: ApplicantFilters;
  onFiltersChange: (filters: ApplicantFilters) => void;
  onDecide: (id: string, status: ApplicantStatus) => Promise<{ error: string | null }>;
  onDocumentsChanged?: () => void;
  /** Connected lead integrations (for the source column / filter). Optional so the table works without them. */
  integrations?: AdmissionIntegration[];
  /** Optional row selection (used by Export Leads). Omit both to hide the checkboxes. */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Open the call panel (timeline / notes / follow-ups) for a lead - lets the dashboard open it from a follow-up reminder. */
  panelLead?: { id: string; name: string } | null;
  onPanelLeadChange?: (lead: { id: string; name: string } | null) => void;
}
const STATUS_OPTIONS: (ApplicantStatus | "all")[] = [
  "all",
  "under_review",
  "shortlisted",
  "selected",
  "waitlisted",
  "rejected",
  "admitted",
  "withdrawn",
];

export function ApplicantsTable({
  applicants,
  loading,
  intakes,
  filters,
  onFiltersChange,
  onDecide,
  onDocumentsChanged,
  integrations = [],
  selectedIds,
  onSelectionChange,
  panelLead: panelLeadProp,
  onPanelLeadChange,
}: ApplicantsTableProps) {
  const qc = useQueryClient();
  const [ownPanel, setOwnPanel] = useState<{ id: string; name: string } | null>(null);
  const panelLead = onPanelLeadChange ? (panelLeadProp ?? null) : ownPanel;
  const setPanelLead = onPanelLeadChange ?? setOwnPanel;
  const [callingFor, setCallingFor] = useState<{ id: string; name: string } | null>(null);
  const session = useCallSession(() => { qc.invalidateQueries({ queryKey: ["tel-history"] }); qc.invalidateQueries({ queryKey: ["tel-timeline"] }); });
  const selectable = !!onSelectionChange;
  const selected = new Set(selectedIds ?? []);
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const { meta, refetch: refetchMeta, integrationName } = useLeadMeta(applicants.map((a) => a.id), integrations);
  const feeSchoolId = applicants[0]?.school_id ?? intakes[0]?.school_id ?? null;
  const { map: feePlans, allowed: canSeeFees, refetch: refetchFeePlans } = useFeePlanMap(feeSchoolId);

  // "all" | "integration" (any connected source) | "manual" (walk-in / phone / referral) | a provider key
  const visible = applicants.filter((a) => {
    const m = meta[a.id];
    if (sourceFilter === "all") return true;
    if (sourceFilter === "integration") return !!m;
    if (sourceFilter === "manual") return !m;
    return m?.lead_source === sourceFilter;
  });

  const allTicked = visible.length > 0 && visible.every((a) => selected.has(a.id));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange?.(Array.from(next));
  };
  const toggleAll = () => onSelectionChange?.(allTicked ? [] : visible.map((a) => a.id));

  const handleSearchSubmit = () => onFiltersChange({ ...filters, search: searchInput });

  const handleStatusChange = async (applicant: AdmissionApplicant, status: ApplicantStatus) => {
    const { error } = await onDecide(applicant.id, status);
    if (error) {
      toast({ title: "Could not update status", description: error, variant: "destructive" });
      return;
    }
    toast({ title: `${applicant.full_name} marked as ${APPLICANT_STATUS_LABELS[status]}` });
    if (status === "admitted") {
      // The database assigns the fee plan in the same transaction as the status change; report what happened.
      // Best effort only - users who may not view fees simply get no extra message, and the admission is unaffected.
      try {
        const r = await getApplicantFeePlan(applicant.id);
        const a = r.assignment;
        if (a?.status === "active") {
          toast({ title: "Fee plan assigned", description: `${a.structure_name ?? "Fee plan"}: net payable ${formatInr(a.net_total)}` });
        } else {
          toast({
            title: "No matching fee structure",
            description: `Nothing matches ${r.class_grade}, ${r.academic_year}${r.category ? `, ${r.category}` : ""}. Add a fee structure in ERP Fees or use the Fee plan button to assign one manually.`,
            variant: "destructive",
          });
        }
      } catch { /* not permitted to view fees */ }
      void refetchFeePlans();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <Input
            placeholder="Search by student, parent name or phone..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
          />
          <button
            onClick={handleSearchSubmit}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-button bg-accent/10 text-accent"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>

        <Select
          value={filters.intakeId ?? "all"}
          onValueChange={(v) => onFiltersChange({ ...filters, intakeId: v as string })}
        >
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="All grades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grades</SelectItem>
            {intakes.map((intake) => (
              <SelectItem key={intake.id} value={intake.id}>
                {intake.grade} · {intake.academic_year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) => onFiltersChange({ ...filters, status: v as ApplicantStatus | "all" })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : APPLICANT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[170px]" aria-label="Lead source">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="integration">Any integration</SelectItem>
            <SelectItem value="manual">Walk-in / manual</SelectItem>
            {(Object.keys(LEAD_PROVIDER_LABELS) as (keyof typeof LEAD_PROVIDER_LABELS)[]).map((k) => (
              <SelectItem key={k} value={k}>{LEAD_PROVIDER_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          placeholder="Min %"
          className="w-[100px]"
          value={filters.minPercentage ?? ""}
          onChange={(e) =>
            onFiltersChange({ ...filters, minPercentage: e.target.value ? Number(e.target.value) : null })
          }
        />

        <Select
          value={filters.sortBy ?? "created_at"}
          onValueChange={(v) => onFiltersChange({ ...filters, sortBy: v as ApplicantFilters["sortBy"] })}
        >
          <SelectTrigger className="w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Sort: Newest first</SelectItem>
            <SelectItem value="previous_percentage">Sort: Previous %</SelectItem>
            <SelectItem value="priority_score">Sort: Priority score</SelectItem>
            <SelectItem value="meeting_date">Sort: Meeting date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ActiveCallBanner name={callingFor?.name ?? "Lead"} call={session.call} error={session.error} onDismiss={session.dismiss}
        onOpenLead={callingFor ? () => setPanelLead(callingFor) : undefined} />

      {loading ? (
        <LoadingSpinner />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users2}
          title="No applicants match these filters"
          description="Log a new applicant, or widen your filters (grade, status, or minimum percentage)."
        />
      ) : (
        <div className="rounded-card border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead className="w-10"><Checkbox checked={allTicked} onCheckedChange={toggleAll} aria-label="Select all shown leads" /></TableHead>
                )}
                <TableHead>Student</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Parent / Phone</TableHead>
                <TableHead>Previous %</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Sibling</TableHead>
                <TableHead>Meeting Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-end">Docs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((applicant) => {
                const lead = meta[applicant.id];
                return (
                <TableRow key={applicant.id}>
                  {selectable && (
                    <TableCell><Checkbox checked={selected.has(applicant.id)} onCheckedChange={() => toggleOne(applicant.id)} aria-label={`Select ${applicant.full_name}`} /></TableCell>
                  )}
                  <TableCell className="font-medium text-foreground">{applicant.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {applicant.intake?.grade ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div>{applicant.parent_name}</div>
                    <div className="text-xs">{applicant.parent_phone}</div>
                    <div className="mt-1 flex items-center gap-1">
                      <CallButton applicantName={applicant.full_name} parentPhone={applicant.parent_phone} starting={session.starting}
                        disabled={!!session.call && !["completed", "missed", "busy", "failed", "cancelled"].includes(session.call.status)}
                        onStart={(o) => { setCallingFor({ id: applicant.id, name: applicant.full_name }); return session.start(applicant.id, o); }} />
                      <Button size="sm" variant="ghost" className="h-7 px-1.5" title="Call history, notes and follow-ups" onClick={() => setPanelLead({ id: applicant.id, name: applicant.full_name })}><HistoryIcon className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                  <TableCell>{applicant.previous_percentage != null ? `${applicant.previous_percentage}%` : "—"}</TableCell>
                  <TableCell>{applicant.distance_from_school_km != null ? `${applicant.distance_from_school_km} km` : "—"}</TableCell>
                  <TableCell>{applicant.sibling_studying_here ? "Yes" : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{applicant.meeting_date}</TableCell>
                  <TableCell>
                    {lead ? (
                      <div className="space-y-1">
                        <LeadSourceBadge source={lead.lead_source} label={integrationName(lead.integration_id)} />
                        {lead.enquiry_count > 1 && (
                          <div className="text-[11px] text-amber-700" title="Merged repeat enquiries">{lead.enquiry_count} enquiries</div>
                        )}
                        <LeadActivityDialog applicant={applicant} meta={lead} onChanged={refetchMeta} />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{APPLICANT_SOURCE_LABELS[applicant.source] ?? applicant.source}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select value={applicant.status} onValueChange={(v) => handleStatusChange(applicant, v as ApplicantStatus)}>
                      <SelectTrigger className="w-[150px] h-8">
                        <SelectValue>
                          <StatusBadge variant={APPLICANT_STATUS_BADGE_VARIANT[applicant.status]}>
                            {APPLICANT_STATUS_LABELS[applicant.status]}
                          </StatusBadge>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(APPLICANT_STATUS_LABELS) as ApplicantStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {APPLICANT_STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {canSeeFees && applicant.status === "admitted" && feeSchoolId && (
                      <ApplicantFeePlanCell applicant={applicant} plan={feePlans[applicant.id]} schoolId={feeSchoolId} onChanged={refetchFeePlans} />
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <ApplicantDocumentsDialog
                      applicant={applicant}
                      documentCount={applicant.documents?.[0]?.count ?? 0}
                      onDocumentsChanged={onDocumentsChanged}
                    />
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <LeadCallPanel applicantId={panelLead?.id ?? null} applicantName={panelLead?.name ?? ""} onOpenChange={(o) => { if (!o) setPanelLead(null); }} />
    </div>
  );
}