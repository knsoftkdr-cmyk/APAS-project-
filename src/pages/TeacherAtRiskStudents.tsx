/**
 * TeacherAtRiskStudents.tsx — At-risk students, scoped to the logged-in teacher's
 * assigned classes only (via class_teachers -> classes -> students -> student_predictions).
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, Users, ClipboardList, Brain, Loader2 } from "lucide-react";
import { InterventionDrawer, Intervention } from "@/components/InterventionDrawer";

const RISK_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

interface RiskRow {
  prediction_id: string;
  student_id: string;
  student_name: string;
  class: string;
  section: string;
  subject: string;
  risk_level: string;
  dropout_risk_percentage: number;
  predicted_score_next_test: number | null;
  confidence_score: number | null;
  contributing_factors: any;
}

export default function TeacherAtRiskStudents() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [studentProfileIds, setStudentProfileIds] = useState<string[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<Map<string, Intervention[]>>(new Map());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerStudent, setDrawerStudent] = useState<{ id: string; full_name: string; class: string; section: string } | null>(null);
  const [drawerInterventions, setDrawerInterventions] = useState<Intervention[]>([]);
  const [drawerRisk, setDrawerRisk] = useState<string | undefined>(undefined);
  const [drawerFactors, setDrawerFactors] = useState<string[]>([]);

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // 1. Classes this teacher is assigned to
      const { data: assignedClasses } = await supabase
        .from("class_teachers")
        .select("class_id")
        .eq("teacher_id", user.id);
const classIds = [...new Set((assignedClasses || []).map((c: any) => c.class_id))];
      if (classIds.length === 0) { setRows([]); setStudentProfileIds([]); setLoading(false); return; }

      // 2. Resolve to class name + section
      const { data: classRows } = await supabase
        .from("classes")
        .select("name, section")
        .in("id", classIds);
      if (!classRows || classRows.length === 0) { setRows([]); setStudentProfileIds([]); setLoading(false); return; }

      // 3. Students in those classes
      const orFilter = classRows
        .map((c: any) => `and(class.eq.${c.name},section.eq.${c.section})`)
        .join(",");
      const { data: students } = await supabase
        .from("students")
        .select("id, full_name, class, section, profile_id")
        .or(orFilter)
        .eq("school_id", profile?.school_id ?? "");
      if (!students || students.length === 0) { setRows([]); setStudentProfileIds([]); setLoading(false); return; }

      const studentIds = students.map((s: any) => s.id);
      const studentMap = new Map(students.map((s: any) => [s.id, s]));
      setStudentProfileIds(students.map((s: any) => s.profile_id).filter(Boolean));

      // 4. Predictions for exactly those students
      const { data: preds } = await supabase
        .from("student_predictions")
        .select("*")
        .in("student_id", studentIds)
        .order("dropout_risk_percentage", { ascending: false });

      const merged: RiskRow[] = (preds || []).map((p: any) => {
        const s = studentMap.get(p.student_id);
        return {
          prediction_id: p.id,
          student_id: p.student_id,
          student_name: s?.full_name || "Unknown Student",
          class: s?.class || "—",
          section: s?.section || "—",
          subject: p.subject,
          risk_level: p.risk_level,
          dropout_risk_percentage: p.dropout_risk_percentage ?? 0,
          predicted_score_next_test: p.predicted_score_next_test,
          confidence_score: p.confidence_score,
          contributing_factors: p.contributing_factors,
        };
      });

      setRows(merged);
      await fetchInterventions(studentIds);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user?.id, profile?.school_id, toast]);

const fetchInterventions = useCallback(async (studentIds: string[]) => {
    if (!user?.id || studentIds.length === 0) return;
    const { data } = await supabase
      .from("student_interventions")
      .select("*")
      .eq("teacher_id", user.id)
      .in("student_id", studentIds)
      .order("created_at", { ascending: false });

    // Group ALL interventions per student (a student can have many over time)
    const map = new Map<string, Intervention[]>();
    (data || []).forEach((iv: any) => {
      const list = map.get(iv.student_id) || [];
      list.push(iv);
      map.set(iv.student_id, list);
    });
    setInterventions(map);
  }, [user?.id]);

const runPredictions = async () => {
    if (studentProfileIds.length === 0) {
      toast({ title: "No students to analyze", description: "No students found in your assigned classes." });
      return;
    }
    setRunning(true);
    try {
      const results = await Promise.allSettled(
        studentProfileIds.map((pid) =>
          supabase.functions.invoke("predict-performance", { body: { student_id: pid } })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;
      toast({
        title: "Predictions updated",
        description: failed > 0
          ? `Analyzed ${succeeded} student(s), ${failed} failed.`
          : `Analyzed ${succeeded} student(s) in your classes.`,
        variant: failed > 0 ? "destructive" : undefined,
      });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const subjects = [...new Set(rows.map(r => r.subject).filter(Boolean))];
  const filtered = rows.filter(r =>
    (subjectFilter === "all" || r.subject === subjectFilter) &&
    (riskFilter === "all" || r.risk_level === riskFilter)
  );

  const high = rows.filter(r => r.risk_level === "high").length;
  const medium = rows.filter(r => r.risk_level === "medium").length;
  const avgRisk = rows.length
    ? Math.round(rows.reduce((a, r) => a + r.dropout_risk_percentage, 0) / rows.length)
    : 0;

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-red-500 via-red-500 to-orange-500 p-8 shadow-xl">
            {/* Decorative circles */}
            <div className="absolute top-5 right-10 h-24 w-24 rounded-full bg-white/10"></div>
            <div className="absolute bottom-4 right-36 h-12 w-12 rounded-full bg-white/10"></div>
            <div className="absolute top-10 left-1/2 h-4 w-4 rounded-full bg-white/20"></div>

            <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Left */}
              <div className="flex items-center gap-5">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                  <AlertTriangle className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white">
                    At-Risk Students
                  </h1>
                  <p className="mt-2 text-red-100">
                    Students in your assigned classes flagged by AI risk prediction.
                  </p>
                </div>
                <div className="w-full md:w-auto">
                  <Button
                    onClick={runPredictions}
                    disabled={running}
                    className="w-full md:w-auto bg-white text-red-600 hover:bg-red-50 font-semibold px-6 py-6 rounded-xl shadow-lg"
                  >
                    {running ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Brain className="mr-2 h-5 w-5" />
                        Run Predictions
                      </>
                    )}
                  </Button>
                </div>
              </div>
          </div>
      </div>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                label: "High Risk",
                value: high,
                icon: AlertTriangle,
                iconBg: "bg-red-100",
                iconColor: "text-red-600",
                border: "border-red-500",
              },
              {
                label: "Medium Risk",
                value: medium,
                icon: TrendingUp,
                iconBg: "bg-amber-100",
                iconColor: "text-amber-600",
                border: "border-amber-500",
              },
              {
                label: "Avg Dropout Risk",
                value: `${avgRisk}%`,
                icon: Users,
                iconBg: avgRisk > 50
                  ? "bg-red-100"
                  : avgRisk > 25
                  ? "bg-amber-100"
                  : "bg-green-100",
                iconColor: avgRisk > 50
                  ? "text-red-600"
                  : avgRisk > 25
                  ? "text-amber-600"
                  : "text-green-600",
                border: avgRisk > 50
                  ? "border-red-500"
                  : avgRisk > 25
                  ? "border-amber-500"
                  : "border-green-500",
              },
            ].map(({ label, value, icon: Icon, iconBg, iconColor, border }) => (
              <Card
                key={label}
                className={`group border border-gray-200 border-l-4 ${border} shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300`}
              >
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      {label}
                    </p>
                    <p className="text-3xl font-bold mt-2">
                      {value}
                    </p>
                  </div>
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center ${iconBg} transition-all duration-300 group-hover:rotate-12 group-hover:scale-110`}
                  >
                    <Icon className={`h-6 w-6 ${iconColor}`} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Risk Level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Levels</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table with drill-down */}
        <Card className="border border-orange-400">
          <CardHeader><CardTitle>Students ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground text-sm">
                {rows.length === 0 ? "No at-risk data for your assigned classes yet." : "No students match the current filters."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="text-center">Dropout Risk</TableHead>
                    <TableHead className="text-center">Predicted Score</TableHead>
                    <TableHead className="text-center">Risk Level</TableHead>
                    <TableHead className="text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <>
                      <TableRow
                        key={r.prediction_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpanded(expanded === r.prediction_id ? null : r.prediction_id)}
                      >
                        <TableCell className="font-medium">{r.student_name}</TableCell>
                        <TableCell>{r.class} - {r.section}</TableCell>
                        <TableCell>{r.subject ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-xs" style={{ color: RISK_COLORS[r.risk_level] }}>
                              {r.dropout_risk_percentage}%
                            </span>
                            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min(100, Math.max(0, r.dropout_risk_percentage))}%`,
                                  backgroundColor: RISK_COLORS[r.risk_level] ?? "#6b7280",
                                }}
                              />
                            </div>        
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {r.predicted_score_next_test !== null ? `${r.predicted_score_next_test}%` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge style={{ backgroundColor: RISK_COLORS[r.risk_level] ?? "#6b7280", color: "white" }}>
                            {r.risk_level}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                         <Button className={`bg-blue-500 ${interventions.get(r.student_id)?.some(iv => iv.status === "active") ? "text-white hover:text-white" : "text-white" }`}
                            size="sm"
                            variant={interventions.get(r.student_id)?.some(iv => iv.status === "active") ? "outline" : "default"}
                            onClick={() => {
                              setDrawerStudent({ id: r.student_id, full_name: r.student_name, class: r.class, section: r.section });
                              setDrawerInterventions(interventions.get(r.student_id) || []);
                              setDrawerRisk(r.risk_level);
                              setDrawerFactors(Array.isArray(r.contributing_factors) ? r.contributing_factors : []);
                              setDrawerOpen(true);
                            }}
                          >
                            <ClipboardList className="h-5 w-5 mr-1.5 text-white" />
                            {interventions.get(r.student_id)?.some(iv => iv.status === "active")
                              ? "View Intervention"
                              : interventions.get(r.student_id)?.length
                                ? "Interventions"
                                : "Create Intervention"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded === r.prediction_id && (
                        <TableRow key={`${r.prediction_id}-detail`}>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="py-2 space-y-2 text-sm">
                              {r.confidence_score !== null && (
                                <p><span className="text-muted-foreground">Confidence:</span> {Math.round((r.confidence_score ?? 0) * 100)}%</p>
                              )}
                              <p className="text-muted-foreground font-medium">Contributing Factors:</p>
                              {Array.isArray(r.contributing_factors) && r.contributing_factors.length > 0 ? (
                                <ul className="list-disc list-inside space-y-0.5">
                                  {r.contributing_factors.map((f: any, i: number) => (
                                    <li key={i}>{typeof f === "string" ? f : JSON.stringify(f)}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-muted-foreground text-xs">No contributing factor details available.</p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <InterventionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        student={drawerStudent}
        riskLevel={drawerRisk}
        contributingFactors={drawerFactors}
        interventions={drawerInterventions}
        onSaved={() => fetchInterventions(rows.map(r => r.student_id))}
      />
    </AppLayout>
  );
}
