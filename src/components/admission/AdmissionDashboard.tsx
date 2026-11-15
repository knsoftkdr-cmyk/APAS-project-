import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { IntakesList } from "./IntakesList";
import { IntakeFormDialog } from "./IntakeFormDialog";
import { ApplicantFormDialog } from "./ApplicantFormDialog";
import { ApplicantsTable } from "./ApplicantsTable";
import { ExportSelectedApplicantsButton } from "./ExportSelectedApplicantsButton";
import { useAdmissionIntakes } from "@/hooks/useAdmissionIntakes";
import { useAdmissionApplicants, type ApplicantFilters } from "@/hooks/useAdmissionApplicants";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { LeadSourceBadge } from "./LeadSourceBadge";
import { useAdmissionIntegrations } from "@/hooks/useAdmissionIntegrations";
import { LEAD_PROVIDER_LABELS } from "@/lib/admissionIntegrations";
import { GraduationCap, Users, UserCheck, Clock, LayoutGrid, Plug, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
type StatAccent = "indigo" | "violet" | "emerald" | "amber";

const ADMISSION_STAT_TONES: Record<StatAccent, { bar: string; chip: string; glow: string }> = {
  indigo: {
    bar: "from-indigo-500 to-blue-500",
    chip: "from-indigo-500 to-blue-500 shadow-indigo-200",
    glow: "bg-indigo-400/10",
  },
  violet: {
    bar: "from-violet-500 to-purple-500",
    chip: "from-violet-500 to-purple-500 shadow-violet-200",
    glow: "bg-violet-400/10",
  },
  emerald: {
    bar: "from-emerald-500 to-teal-500",
    chip: "from-emerald-500 to-teal-500 shadow-emerald-200",
    glow: "bg-emerald-400/10",
  },
  amber: {
    bar: "from-amber-500 to-orange-500",
    chip: "from-amber-500 to-orange-500 shadow-amber-200",
    glow: "bg-amber-400/10",
  },
};

function AdmissionStatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  accent: StatAccent;
}) {
  const tones = ADMISSION_STAT_TONES[accent];
  return (
    <Card className="group relative overflow-hidden border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
      <div className={`absolute -top-6 -end-6 w-20 h-20 rounded-full blur-2xl transition-transform duration-500 group-hover:scale-125 ${tones.glow}`} />
      <div className={`absolute inset-y-0 start-0 w-1.5 bg-gradient-to-b ${tones.bar}`} />
      <CardContent className="relative p-3 md:p-4 ps-4 md:ps-5 flex items-center gap-2.5 sm:gap-3">
        <div className={`w-9 h-9 sm:w-10 sm:h-10 md:w-11 md:h-11 rounded-xl bg-gradient-to-br ${tones.chip} flex items-center justify-center shadow-sm shrink-0 transition-transform duration-300 group-hover:scale-110`}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-lg sm:text-xl md:text-2xl font-extrabold tracking-tight text-slate-800 leading-tight">{value}</p>
          <p className="text-[10px] sm:text-[11px] md:text-xs text-muted-foreground font-medium leading-snug">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdmissionDashboard() {
  const { intakes, loading: intakesLoading, createIntake, toggleIntakeOpen } = useAdmissionIntakes();
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "applicants" | "sources">("overview");
  const [filters, setFilters] = useState<ApplicantFilters>({ intakeId: "all", status: "all" });

  const {
    applicants,
    loading: applicantsLoading,
    addApplicant,
    decideApplicant,
    refetch: refetchApplicants,
  } = useAdmissionApplicants(filters);

  const { integrations, refetch: refetchIntegrations } = useAdmissionIntegrations();
  // The Lead Sources panel owns its own copy; pick up its changes when the user leaves it.
  useEffect(() => { void refetchIntegrations(); }, [activeView, refetchIntegrations]);
  const needAttention = integrations.filter((i) => i.status === "error").length;

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
      <div className="absolute top-16 end-10 w-56 h-56 rounded-full bg-indigo-300 opacity-[0.10] blur-3xl" />
      <div className="absolute top-96 start-6 w-64 h-64 rounded-full bg-violet-200 opacity-[0.08] blur-3xl" />
      <div className="absolute bottom-24 end-1/4 w-48 h-48 rounded-full bg-indigo-200 opacity-[0.08] blur-3xl" />

      <div className="relative z-10 space-y-6 p-4 md:p-6 max-w-7xl mx-auto">

        {/* Hero */}
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg">
          <div className="absolute -end-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute end-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <GraduationCap className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Admissions</h1>
                <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Log walk-in and online enquiries, track seats, and shortlist who to admit</p>
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

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveView("overview")}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
              activeView === "overview"
                ? "bg-indigo-600 text-white shadow"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveView("applicants")}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
              activeView === "applicants"
                ? "bg-indigo-600 text-white shadow"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Users className="h-4 w-4" />
            Applicants
            {totalApplicants > 0 && (
              <span
                className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  activeView === "applicants" ? "bg-white/20" : "bg-indigo-100 text-indigo-700"
                }`}
              >
                {totalApplicants}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveView("sources")}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors ${
              activeView === "sources"
                ? "bg-indigo-600 text-white shadow"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Plug className="h-4 w-4" />
            Lead Sources
            {needAttention > 0 && (
              <span
                className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
                title={`${needAttention} integration${needAttention > 1 ? "s" : ""} need attention`}
              >
                <AlertTriangle className="h-3 w-3 inline -mt-0.5" /> {needAttention}
              </span>
            )}
          </button>
        </div>

        {/* Stat cards */}
        {activeView === "overview" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
          <AdmissionStatCard icon={GraduationCap} label="Open Intakes" value={intakes.filter((i) => i.is_open).length} accent="indigo" />
          <AdmissionStatCard icon={Users} label="Total Seats" value={totalSeats} accent="violet" />
          <AdmissionStatCard icon={UserCheck} label="Seats Filled" value={totalFilled} accent="emerald" />
          <AdmissionStatCard icon={Clock} label="Pending Review" value={totalPending} accent="amber" />
        </div>
        )}

        {/* Lead source status (only once an integration exists) */}
        {activeView === "overview" && integrations.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-3 md:p-4 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Plug className="h-4 w-4 text-indigo-600" />Lead sources</span>
            {integrations.map((i) => (
              <button key={i.id} type="button" onClick={() => setActiveView("sources")}
                title={`${LEAD_PROVIDER_LABELS[i.provider]} · ${i.leads_created} leads`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50">
                <span className={`h-2 w-2 rounded-full ${i.status === "active" ? "bg-emerald-500" : i.status === "paused" ? "bg-amber-500" : "bg-red-500"}`} />
                <span className="font-medium text-slate-700 max-w-[140px] truncate">{i.name}</span>
                <LeadSourceBadge source={i.provider} className="py-0" />
                <span className="text-muted-foreground">{i.leads_created}</span>
              </button>
            ))}
          </CardContent>
        </Card>
        )}

        {/* Admission Intakes */}
        {activeView === "overview" && (
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
        )}

        {/* Applicants */}
        {activeView === "applicants" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2.5">
              <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
              Applicants
              {totalApplicants > 0 && (
                <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                  {totalApplicants}
                </span>
              )}
            </h2>
            <ExportSelectedApplicantsButton />
          </div>
          <ApplicantsTable
            applicants={applicants}
            loading={applicantsLoading}
            intakes={intakes}
            filters={filters}
            onFiltersChange={setFilters}
            onDecide={decideApplicant}
            onDocumentsChanged={refetchApplicants}
            integrations={integrations}
          />
        </div>
        )}

        {/* Lead Sources (Meta, Google, Zoho, website, Zapier, Make) */}
        {activeView === "sources" && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2.5">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" />
            Lead Sources
          </h2>
          <IntegrationsPanel
            intakes={intakes}
            onLeadsChanged={() => { void refetchApplicants(); void refetchIntegrations(); }}
          />
        </div>
        )}
      </div>
    </div>
  );
}