import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { IntakesList } from "./IntakesList";
import { IntakeFormDialog } from "./IntakeFormDialog";
import { ApplicantFormDialog } from "./ApplicantFormDialog";
import { ApplicantsTable } from "./ApplicantsTable";
import { useAdmissionIntakes } from "@/hooks/useAdmissionIntakes";
import { useAdmissionApplicants, type ApplicantFilters } from "@/hooks/useAdmissionApplicants";
import { GraduationCap, Users, UserCheck, Clock } from "lucide-react";

export function AdmissionDashboard() {
  const { intakes, loading: intakesLoading, createIntake, toggleIntakeOpen } = useAdmissionIntakes();
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ApplicantFilters>({ intakeId: "all", status: "all" });

  const {
    applicants,
    loading: applicantsLoading,
    addApplicant,
    decideApplicant,
    refetch: refetchApplicants,
  } = useAdmissionApplicants(filters);

  const totalSeats = intakes.reduce((sum, i) => sum + i.total_seats, 0);
  const totalFilled = intakes.reduce((sum, i) => sum + (i.seats_filled ?? 0), 0);
  const totalPending = intakes.reduce((sum, i) => sum + (i.applicants_pending_review ?? 0), 0);
  const totalApplicants = applicants.length;

  const handleSelectIntake = (id: string) => {
    const next = selectedIntakeId === id ? null : id;
    setSelectedIntakeId(next);
    setFilters((f) => ({ ...f, intakeId: next ?? "all" }));
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
      <div className="absolute top-96 left-6 w-64 h-64 rounded-full bg-violet-200 opacity-[0.08] blur-3xl" />
      <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.08] blur-3xl" />

      <div className="relative z-10 space-y-6 p-4 md:p-6 max-w-7xl mx-auto">

        {/* Hero */}
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <GraduationCap className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Admissions</h1>
                <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Log walk-in applicants, track seats, and shortlist who to admit</p>
              </div>
            </div>
            <div className="shrink-0">
              <ApplicantFormDialog
                intakes={intakes}
                defaultIntakeId={selectedIntakeId}
                onCreate={addApplicant}
                onDocumentsUploaded={refetchApplicants}
              />
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={GraduationCap} label="Open Intakes" value={intakes.filter((i) => i.is_open).length} />
          <StatCard icon={Users} label="Total Seats" value={totalSeats} />
          <StatCard icon={UserCheck} label="Seats Filled" value={totalFilled} />
          <StatCard icon={Clock} label="Pending Review" value={totalPending} />
        </div>

        {/* Admission Intakes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2.5">
              <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
              Admission Intakes
            </h2>
            <IntakeFormDialog onCreate={createIntake} />
          </div>
          <IntakesList
            intakes={intakes}
            loading={intakesLoading}
            selectedIntakeId={selectedIntakeId}
            onSelect={handleSelectIntake}
            onToggleOpen={toggleIntakeOpen}
          />
        </div>

        {/* Applicants */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2.5">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
            Applicants
            {totalApplicants > 0 && (
              <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                {totalApplicants}
              </span>
            )}
          </h2>
          <ApplicantsTable
            applicants={applicants}
            loading={applicantsLoading}
            intakes={intakes}
            filters={filters}
            onFiltersChange={setFilters}
          onDecide={decideApplicant}
          onDocumentsChanged={refetchApplicants}
          />
        </div>
      </div>
    </div>
  );
}