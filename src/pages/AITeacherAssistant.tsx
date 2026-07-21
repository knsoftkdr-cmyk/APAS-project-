import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { InterventionDrawer, Intervention } from "@/components/InterventionDrawer";
import {
  Sparkles, BookOpen, ClipboardList, BarChart3,
  Clock, Bell, CalendarDays, Lightbulb, RefreshCw,
} from "lucide-react";

interface AtRiskStudent {
  student_id: string;
  student_name: string;
  subject: string;
  risk_level: string;
  factors: string[];
}

interface RemedialActivity {
  student_name: string;
  subject: string;
  activity: string;
  estimated_minutes: number;
}

interface ClassInsight {
  class: string;
  homework_completion_pct: number;
  observation: string;
  recommendation: string;
}

const PRESET_INTERVENTION_ACTIONS = ["Meet Student", "Call Parents", "Provide Remedial Worksheets", "Weekly Monitoring"];

export default function AITeacherAssistant() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [interventions, setInterventions] = useState<Map<string, Intervention>>(new Map());

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerStudent, setDrawerStudent] = useState<{ id: string; full_name: string; class: string; section: string } | null>(null);
  const [drawerIntervention, setDrawerIntervention] = useState<Intervention | null>(null);
  const [drawerSeed, setDrawerSeed] = useState<{ reason?: string; actionPlan?: string[] } | null>(null);

  const fetchAssistant = useCallback(async () => {
    if (!user?.id || !profile?.school_id) return;
    setLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("ai-teacher-assistant", {
        body: { teacher_id: user.id, school_id: profile.school_id },
      });
      if (error) throw error;
      setData(result);

      // Check which at-risk students already have an active intervention
      const studentIds = (result?.at_risk_students || []).map((s: AtRiskStudent) => s.student_id);
      if (studentIds.length) {
        const { data: ivs } = await supabase
          .from("student_interventions")
          .select("*")
          .eq("teacher_id", user.id)
          .in("student_id", studentIds)
          .order("created_at", { ascending: false });
        const map = new Map<string, Intervention>();
        (ivs || []).forEach((iv: any) => {
          const existing = map.get(iv.student_id);
          if (!existing || (existing.status !== "active" && iv.status === "active")) map.set(iv.student_id, iv);
        });
        setInterventions(map);
      }
    } catch (e: any) {
      toast({ title: "Couldn't load AI suggestions", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user?.id, profile?.school_id, toast]);

  useEffect(() => { fetchAssistant(); }, [fetchAssistant]);

  const openInterventionFor = async (s: AtRiskStudent) => {
    // Need class/section for the drawer's read-only student header
    const { data: studentRow } = await supabase
      .from("students").select("id, full_name, class, section").eq("id", s.student_id).maybeSingle();
    if (!studentRow) return;

    const existing = interventions.get(s.student_id) || null;
    setDrawerStudent(studentRow);
    setDrawerIntervention(existing);
    setDrawerSeed(existing ? null : { reason: s.factors.join(". "), actionPlan: PRESET_INTERVENTION_ACTIONS });
    setDrawerOpen(true);
  };

  const goGenerateWorksheet = (activity: RemedialActivity) => {
    toast({ title: "Opening Lesson Plan Generator", description: `Create a worksheet for ${activity.subject} — ${activity.student_name}.` });
    navigate("/curative");
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  const atRisk: AtRiskStudent[] = data?.at_risk_students || [];
  const remedial: RemedialActivity[] = data?.remedial_activities || [];
  const classInsights: ClassInsight[] = data?.class_insights || [];
  const workload = data?.workload_suggestion;
  const behaviourInsight = data?.behaviour_insight;
  const concernStudents = data?.repeated_concern_students || [];
  const calendarSuggestion = data?.calendar_suggestion;
  const upcomingExams = data?.upcoming_exams || [];
  const teachingTip = data?.teaching_tip;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-4xl">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold">AI Teacher Assistant</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">Actionable suggestions based on your students, classes, and workload</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAssistant} className="w-full sm:w-auto shrink-0 bg-blue-600 text-white">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>

        {/* 1. Remedial Activities */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4 text-purple-600" /> Students Needing Extra Support</CardTitle>
          </CardHeader>
          <CardContent>
            {remedial.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No remedial suggestions right now — no at-risk students detected in your classes.</p>
            ) : (
              <div className="space-y-3">
                {remedial.map((r, i) => (
                  <div key={i} className="rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{r.student_name}</p>
                      <p className="text-xs text-muted-foreground">Weak in {r.subject}</p>
                      <p className="text-sm mt-1">{r.activity}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Estimated time: {r.estimated_minutes} minutes</p>
                    </div>
                    <Button size="sm" onClick={() => goGenerateWorksheet(r)} className="w-full sm:w-auto shrink-0 bg-cyan-600">Generate Worksheet</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Intervention Suggestions */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4 text-red-600" /> Intervention Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            {atRisk.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No students currently at risk in your classes.</p>
            ) : (
              <div className="space-y-3">
                {atRisk.map((s) => {
                  const existing = interventions.get(s.student_id);
                  return (
                    <div key={`${s.student_id}-${s.subject}`} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-semibold">{s.student_name}</p>
                        <Badge className={s.risk_level === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}>
                          {s.risk_level} risk
                        </Badge>
                      </div>
                      {s.factors.length > 0 && (
                        <ul className="text-xs text-muted-foreground list-disc list-inside mb-2">
                          {s.factors.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      )}
                      {!existing && (
                        <div className="text-xs text-muted-foreground mb-2">
                          Suggested: {PRESET_INTERVENTION_ACTIONS.join(" · ")}
                        </div>
                      )}
                      <Button size="sm" variant={existing ? "outline" : "default"} onClick={() => openInterventionFor(s)} className="w-full sm:w-auto bg-emerald-600 text-white">
                        {existing ? "View Intervention" : "Create Intervention"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Class Analytics */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-600" /> Class Insights</CardTitle>
          </CardHeader>
          <CardContent>
            {classInsights.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Not enough homework data yet to generate class insights.</p>
            ) : (
              <div className="space-y-3">
                {classInsights.map((c, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold">{c.class}</p>
                      <span className="text-sm font-bold">{c.homework_completion_pct}%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.observation}</p>
                    <p className="text-xs text-blue-600 mt-1">{c.recommendation}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. Teacher Workload Suggestions */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-orange-600" /> Workload</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.pending_homework_count > 0 ? (
              <div className="rounded-lg border p-3">
                <p className="text-sm">You have <span className="font-semibold">{data.pending_homework_count} homework submissions</span> pending evaluation.</p>
                {workload && (
                  <>
                    <p className="text-xs text-muted-foreground mt-1.5">{workload.text}</p>
                    <p className="text-xs text-muted-foreground">Estimated time: {workload.estimated_minutes} minutes</p>
                  </>
                )}
                <Button size="sm" className="mt-2 bg-blue-600" onClick={() => navigate("/submissions")}>Start Evaluation</Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">All caught up — no pending homework to evaluate.</p>
            )}
          </CardContent>
        </Card>

        {/* 5. Behaviour Insights */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4 text-amber-600" /> Behaviour Insights</CardTitle>
          </CardHeader>
          <CardContent>
            {concernStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No repeated behaviour concerns this month.</p>
            ) : (
              <div className="rounded-lg border p-3">
                <p className="text-sm">
                  {concernStudents.length} student{concernStudents.length > 1 ? "s have" : " has"} repeated "Concern" notes this month
                  {": "}
                  {concernStudents.map((s: any) => s.name).join(", ")}.
                </p>
                {behaviourInsight && <p className="text-xs text-blue-600 mt-1.5">Suggested action: {behaviourInsight.suggested_action}</p>}
                <Button size="sm" variant="outline" className="mt-2 bg-green-600 text-white" onClick={() => navigate("/teacher-behaviour")}>Open Behaviour Dashboard</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 6. Calendar Suggestions */}
        {upcomingExams.length > 0 && (
          <Card className="border border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4 text-green-600" /> Calendar Suggestions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcomingExams.map((ev: any, i: number) => (
                <div key={i} className="rounded-lg border p-3">
                  <p className="text-sm font-semibold">{ev.title}</p>
                  <p className="text-xs text-muted-foreground">{ev.start_date}</p>
                  {calendarSuggestion && <p className="text-xs text-green-700 mt-1">{calendarSuggestion.text}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* 7. Smart Teaching Tip (rule-based) */}
        {teachingTip && (
          <Card className="border border-amber-200 bg-amber-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-600" /> Teaching Tip</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{teachingTip.observation}</p>
              <p className="text-sm text-amber-700 mt-1">{teachingTip.suggestion}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {drawerStudent && (
        <InterventionDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          student={drawerStudent}
          intervention={drawerIntervention}
          seedReason={drawerSeed?.reason}
          seedActionPlan={drawerSeed?.actionPlan}
          onSaved={fetchAssistant}
        />
      )}
    </AppLayout>
  );
}
