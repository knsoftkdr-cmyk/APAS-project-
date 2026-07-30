import { AdmissionIntake } from "@/types/admission";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Users, Loader2, GraduationCap } from "lucide-react";

interface IntakesListProps {
  intakes: AdmissionIntake[];
  loading: boolean;
  selectedIntakeId: string | null;
  onSelect: (id: string) => void;
  onToggleOpen: (id: string, isOpen: boolean) => void;
}

export function IntakesList({ intakes, loading, selectedIntakeId, onSelect, onToggleOpen }: IntakesListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" /> Loading intakes...
      </div>
    );
  }

  if (intakes.length === 0) {
    return (
      <Card className="border-2 border-dashed border-indigo-200 bg-gradient-to-b from-indigo-50/60 to-white rounded-2xl">
        <CardContent className="py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mx-auto mb-4 shadow-md shadow-indigo-200">
            <GraduationCap className="h-7 w-7 text-white" />
          </div>
          <p className="font-semibold text-slate-800">No admission intakes yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create one to start logging applicants.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {intakes.map((intake) => {
        const filled = intake.seats_filled ?? 0;
        const total = intake.total_seats || 1;
        const pct = Math.min(100, Math.round((filled / total) * 100));
        const isSelected = selectedIntakeId === intake.id;
        const isNearlyFull = pct >= 90;

        // Circular ring geometry
        const radius = 26;
        const circumference = 2 * Math.PI * radius;
        const dashOffset = circumference - (pct / 100) * circumference;

        const accent = isNearlyFull
          ? { from: "from-amber-500", to: "to-orange-500", ring: "#f59e0b", wash: "from-amber-50/70" }
          : { from: "from-indigo-500", to: "to-violet-500", ring: "#6366f1", wash: "from-indigo-50/70" };

        return (
          <Card
            key={intake.id}
            onClick={() => onSelect(intake.id)}
            className={`group relative overflow-hidden cursor-pointer rounded-2xl border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 bg-gradient-to-br ${accent.wash} via-white to-white ${
              isSelected ? "border-indigo-400 ring-4 ring-indigo-100 shadow-lg" : "border-slate-200 shadow-sm"
            }`}
          >
            {/* decorative glow orb */}
            <div className={`absolute -top-8 -right-8 w-28 h-28 rounded-full bg-gradient-to-br ${accent.from} ${accent.to} opacity-10 blur-2xl transition-transform duration-500 group-hover:scale-125`} />

            <CardContent className="relative p-5">
              {/* Header row: grade badge + name + toggle */}
              <div className="flex items-start justify-between gap-2 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`relative w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-white font-bold text-base shadow-md bg-gradient-to-br ${accent.from} ${accent.to} transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3`}>
                    {intake.grade}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">Grade {intake.grade}</p>
                    <p className="text-xs text-muted-foreground">{intake.academic_year}</p>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                  <Switch
                    checked={intake.is_open}
                    onCheckedChange={(checked) => onToggleOpen(intake.id, checked)}
                    className="data-[state=checked]:bg-indigo-600"
                  />
                </div>
              </div>

              {/* Circular seat-progress ring + stats */}
              <div className="flex items-center gap-4 mb-4 bg-white/70 backdrop-blur-sm rounded-xl border border-slate-100 p-3">
                <div className="relative w-16 h-16 shrink-0">
                  <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="6" />
                    <circle
                      cx="32" cy="32" r={radius} fill="none"
                      stroke={accent.ring}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-extrabold text-slate-800">{pct}%</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm text-slate-700 font-semibold">
                    <Users className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                    {filled} / {intake.total_seats}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">seats filled</p>
                </div>
              </div>

              {/* Status pills */}
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  intake.is_open ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${intake.is_open ? "bg-emerald-500" : "bg-slate-400"}`} />
                  {intake.is_open ? "Open" : "Closed"}
                </span>
                {intake.min_percentage_required != null && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                    Min {intake.min_percentage_required}%
                  </span>
                )}
                {(intake.applicants_pending_review ?? 0) > 0 && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                    {intake.applicants_pending_review} pending
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
