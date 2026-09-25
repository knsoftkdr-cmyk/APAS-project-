import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ShieldAlert, ChevronDown, ClipboardList } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useClassRisk } from "@/hooks/useStudentRisk";
import { useClassInterventionRecommendations, type ClassInterventionRow } from "@/hooks/useInterventionRecommendations";
import { RiskBadge } from "@/components/risk/RiskBadge";
import { RiskCauseList } from "@/components/risk/RiskCauseList";
import { InterventionRecommendationList } from "@/components/risk/InterventionRecommendationList";
import { InterventionEffectivenessSummary } from "@/components/risk/InterventionEffectivenessSummary";
import { InterventionDrawer, Intervention } from "@/components/InterventionDrawer";

interface ClassOption { id: string; label: string; name: string; section: string }
type RiskRow = import("@/hooks/useStudentRisk").ClassRiskStudentRow;
type MergedRow = RiskRow & { recommendation?: ClassInterventionRow };

export default function EarlyWarningDashboard() {
  const { user, profile } = useAuth();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);

  const { data: students, isLoading } = useClassRisk(classId || undefined);
  const { data: recommendations } = useClassInterventionRecommendations(classId || undefined);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerStudent, setDrawerStudent] = useState<{ id: string; full_name: string; class: string; section: string } | null>(null);
  const [drawerInterventions, setDrawerInterventions] = useState<Intervention[]>([]);
  const [drawerRow, setDrawerRow] = useState<MergedRow | null>(null);

  useEffect(() => {
    async function loadOptions() {
      setLoadingOptions(true);
      const isStaffAdmin = ["admin", "principal", "school_admin", "hod"].includes(profile?.role ?? "");

      const classQuery = isStaffAdmin
        ? supabase.from("classes").select("id, name, section")
        : supabase.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", profile?.id ?? "");

      const { data: classData } = await classQuery;

      const classOptions: ClassOption[] = isStaffAdmin
        // deno-lint-ignore no-explicit-any
        ? (classData as any[] ?? []).map((c) => ({ id: c.id, label: `${c.name}${c.section ? " - " + c.section : ""}`, name: c.name, section: c.section }))
        // deno-lint-ignore no-explicit-any
        : (classData as any[] ?? [])
            .filter((c) => c.classes)
            .map((c) => ({ id: c.classes.id, label: `${c.classes.name}${c.classes.section ? " - " + c.classes.section : ""}`, name: c.classes.name, section: c.classes.section }));

      setClasses(classOptions);
      setLoadingOptions(false);
    }
    if (profile?.id) loadOptions();
  }, [profile?.id, profile?.role]);

  const recByStudentId = new Map((recommendations ?? []).map((r) => [r.student_id, r]));
  const mergedStudents: MergedRow[] = (students ?? []).map((s) => ({ ...s, recommendation: recByStudentId.get(s.student_id) }));

  const highRisk = mergedStudents.filter((s) => s.overall_risk_level === "high");
  const mediumRisk = mergedStudents.filter((s) => s.overall_risk_level === "medium");
  const lowOrUnknown = mergedStudents.filter((s) => !["high", "medium"].includes(s.overall_risk_level));

  const openIntervention = async (row: MergedRow) => {
    const selectedClass = classes.find((c) => c.id === classId);
    setDrawerRow(row);
    setDrawerStudent({
      id: row.student_id,
      full_name: row.full_name,
      class: selectedClass?.name ?? "",
      section: selectedClass?.section ?? "",
    });
    const { data } = await supabase
      .from("student_interventions")
      .select("*")
      .eq("teacher_id", user?.id ?? "")
      .eq("student_id", row.student_id)
      .order("created_at", { ascending: false });
    setDrawerInterventions((data as Intervention[]) ?? []);
    setDrawerOpen(true);
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-rose-600 to-orange-500 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Early Warning</h1>
              <p className="text-orange-50 text-xs md:text-sm mt-0.5">
                Students showing signs of academic decline, disengagement, stalled progress or chronic absenteeism.
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <Select value={classId} onValueChange={setClassId} disabled={loadingOptions}>
              <SelectTrigger className="sm:w-64"><SelectValue placeholder="Choose a class" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <InterventionEffectivenessSummary classId={classId || undefined} />

        {!classId ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            Pick a class to see its early-warning list.
          </CardContent></Card>
        ) : isLoading ? (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
          </CardContent></Card>
        ) : !students || students.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            No students found on this class's roster.
          </CardContent></Card>
        ) : (
          <>
            {highRisk.length > 0 && (
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-red-600 dark:text-red-400">
                    {highRisk.length} student{highRisk.length > 1 ? "s" : ""} need attention now
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {highRisk.map((s) => (
                    <StudentRow key={s.student_id} student={s} open={openStudentId === s.student_id}
                      onToggle={() => setOpenStudentId(openStudentId === s.student_id ? null : s.student_id)}
                      onCreateIntervention={() => openIntervention(s)} />
                  ))}
                </CardContent>
              </Card>
            )}

            {mediumRisk.length > 0 && (
              <Card className="border-amber-200 dark:border-amber-900">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-amber-600 dark:text-amber-400">
                    {mediumRisk.length} student{mediumRisk.length > 1 ? "s" : ""} worth watching
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {mediumRisk.map((s) => (
                    <StudentRow key={s.student_id} student={s} open={openStudentId === s.student_id}
                      onToggle={() => setOpenStudentId(openStudentId === s.student_id ? null : s.student_id)}
                      onCreateIntervention={() => openIntervention(s)} />
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  {lowOrUnknown.length} other student{lowOrUnknown.length !== 1 ? "s" : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {lowOrUnknown.map((s) => (
                  <StudentRow key={s.student_id} student={s} open={openStudentId === s.student_id}
                    onToggle={() => setOpenStudentId(openStudentId === s.student_id ? null : s.student_id)}
                    onCreateIntervention={() => openIntervention(s)} />
                ))}
              </CardContent>
            </Card>

            <p className="text-[11px] text-muted-foreground text-center">
              Each signal needs a minimum amount of activity history before it can be assessed — new students
              will show "not enough data" until they've built up a track record.
            </p>
          </>
        )}
      </div>

      <InterventionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        student={drawerStudent}
        riskLevel={drawerRow?.overall_risk_level}
        contributingFactors={drawerRow?.causes.filter((c) => c.evidence_strength === "strong" || c.evidence_strength === "moderate").map((c) => c.explanation)}
        suggestedTier={drawerRow?.recommendation?.suggested_tier}
        suggestedPriority={drawerRow?.recommendation?.suggested_priority}
        suggestedActions={drawerRow?.recommendation?.suggested_action_plan}
        interventions={drawerInterventions}
        onSaved={() => drawerStudent && openIntervention(drawerRow!)}
      />
    </AppLayout>
  );
}

function StudentRow({ student, open, onToggle, onCreateIntervention }: {
  student: MergedRow;
  open: boolean;
  onToggle: () => void;
  onCreateIntervention: () => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center gap-3 w-full py-2 text-left hover:bg-muted/50 rounded-lg px-2 -mx-2">
        <span className="flex-1 text-sm font-medium truncate">{student.full_name}</span>
        {student.primary_cause && (
          <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[220px]">
            {student.primary_cause.explanation}
          </span>
        )}
        <RiskBadge level={student.overall_risk_level} className="text-[10px] px-1.5 py-0 shrink-0" />
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-2 pb-3 pt-2 space-y-3">
        <RiskCauseList causes={student.causes} />
        {student.recommendation && (
          <div className="pt-2 border-t">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Recommended</p>
            <InterventionRecommendationList recommendations={student.recommendation.recommended_interventions} />
          </div>
        )}
        <Button size="sm" variant="outline" className="gap-1.5" onClick={(e) => { e.stopPropagation(); onCreateIntervention(); }}>
          <ClipboardList className="h-3.5 w-3.5" /> Create Intervention
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
