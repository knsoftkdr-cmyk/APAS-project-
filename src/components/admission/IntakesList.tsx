import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { GraduationCap, Users } from "lucide-react";
import type { AdmissionIntake } from "@/types/admission";

interface IntakesListProps {
  intakes: AdmissionIntake[];
  loading: boolean;
  selectedIntakeId: string | null;
  onSelect: (id: string) => void;
  onToggleOpen: (id: string, isOpen: boolean) => void;
}

export function IntakesList({ intakes, loading, selectedIntakeId, onSelect, onToggleOpen }: IntakesListProps) {
  if (loading) return <LoadingSpinner />;

  if (intakes.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No admission intakes yet"
        description="Create one to start logging applicants for a grade — e.g. Grade 5, academic year 2027-2028, 40 seats."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {intakes.map((intake) => {
        const filled = intake.seats_filled ?? 0;
        const remaining = intake.seats_remaining ?? intake.total_seats;
        const pctFilled = intake.total_seats > 0 ? Math.min(100, Math.round((filled / intake.total_seats) * 100)) : 0;
        const isSelected = selectedIntakeId === intake.id;

        return (
          <button
            key={intake.id}
            onClick={() => onSelect(intake.id)}
            className={`text-left rounded-card bg-card p-4 shadow-card border transition-colors ${
              isSelected ? "border-accent ring-1 ring-accent" : "border-transparent hover:border-border"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground">{intake.grade}</p>
                <p className="text-xs text-muted-foreground">{intake.academic_year}</p>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch checked={intake.is_open} onCheckedChange={(checked) => onToggleOpen(intake.id, checked)} />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>
                {filled} / {intake.total_seats} seats filled
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${remaining <= 0 ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${pctFilled}%` }}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <StatusBadge variant={intake.is_open ? "success" : "danger"}>
                {intake.is_open ? "Open" : "Closed"}
              </StatusBadge>
              {remaining <= 0 && <StatusBadge variant="warning">Seats full</StatusBadge>}
              {intake.min_percentage_required != null && (
                <StatusBadge variant="info">Min {intake.min_percentage_required}%</StatusBadge>
              )}
              {(intake.applicants_pending_review ?? 0) > 0 && (
                <StatusBadge variant="warning">{intake.applicants_pending_review} pending review</StatusBadge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
