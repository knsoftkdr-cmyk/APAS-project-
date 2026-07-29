import { useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { Search, Users2 } from "lucide-react";
import type { AdmissionApplicant, ApplicantStatus } from "@/types/admission";
import { APPLICANT_STATUS_LABELS, APPLICANT_STATUS_BADGE_VARIANT } from "@/types/admission";
import type { ApplicantFilters } from "@/hooks/useAdmissionApplicants";
import type { AdmissionIntake } from "@/types/admission";
import { ApplicantDocumentsDialog } from "./ApplicantDocumentsDialog";

interface ApplicantsTableProps {
  applicants: AdmissionApplicant[];
  loading: boolean;
  intakes: AdmissionIntake[];
  filters: ApplicantFilters;
  onFiltersChange: (filters: ApplicantFilters) => void;
  onDecide: (id: string, status: ApplicantStatus) => Promise<{ error: string | null }>;
  onDocumentsChanged?: () => void;
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
}: ApplicantsTableProps) {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState(filters.search ?? "");

  const handleSearchSubmit = () => onFiltersChange({ ...filters, search: searchInput });

  const handleStatusChange = async (applicant: AdmissionApplicant, status: ApplicantStatus) => {
    const { error } = await onDecide(applicant.id, status);
    if (error) {
      toast({ title: "Could not update status", description: error, variant: "destructive" });
      return;
    }
    toast({ title: `${applicant.full_name} marked as ${APPLICANT_STATUS_LABELS[status]}` });
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

      {loading ? (
        <LoadingSpinner />
      ) : applicants.length === 0 ? (
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
                <TableHead>Student</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Parent / Phone</TableHead>
                <TableHead>Previous %</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Sibling</TableHead>
                <TableHead>Meeting Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Docs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applicants.map((applicant) => (
                <TableRow key={applicant.id}>
                  <TableCell className="font-medium text-foreground">{applicant.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {applicant.intake?.grade ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div>{applicant.parent_name}</div>
                    <div className="text-xs">{applicant.parent_phone}</div>
                  </TableCell>
                  <TableCell>{applicant.previous_percentage != null ? `${applicant.previous_percentage}%` : "—"}</TableCell>
                  <TableCell>{applicant.distance_from_school_km != null ? `${applicant.distance_from_school_km} km` : "—"}</TableCell>
                  <TableCell>{applicant.sibling_studying_here ? "Yes" : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{applicant.meeting_date}</TableCell>
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
                  </TableCell>
                  <TableCell className="text-right">
                    <ApplicantDocumentsDialog
                      applicant={applicant}
                      documentCount={applicant.documents?.[0]?.count ?? 0}
                      onDocumentsChanged={onDocumentsChanged}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
