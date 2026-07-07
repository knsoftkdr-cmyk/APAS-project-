import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Users, GraduationCap, TrendingUp, AlertTriangle, BookOpen,
  Heart, ClipboardList, RefreshCw, Sparkles, Activity,
} from "lucide-react";
import { PredictiveAnalyticsContent } from "@/pages/PredictiveAnalytics";
import { SchoolBenchmarkingContent } from "@/pages/SchoolBenchmarking";
const KPI = ({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) => (
  <Card className="border border-border/60">
    <CardContent className="pt-5 pb-4 flex items-center gap-3">
      <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-4 w-4" /></div>
      <div>
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </CardContent>
  </Card>
);

const PRIORITY_DOT: Record<string, string> = { red: "bg-red-500", orange: "bg-orange-500", yellow: "bg-amber-400", green: "bg-green-500" };
const RISK_BADGE: Record<string, string> = { High: "bg-red-100 text-red-700", Medium: "bg-amber-100 text-amber-700", Low: "bg-green-100 text-green-700" };

export default function ExecutiveReporting() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"executive" | "predictive" | "benchmarking">("executive");

  const fetchReport = useCallback(async () => {
    if (!profile?.school_id) return;
    setLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("executive-report", {
        body: { school_id: profile.school_id },
      });
      if (error) throw error;
      setData(result);
    } catch (e: any) {
      toast({ title: "Couldn't load report", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [profile?.school_id, toast]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div>
      </AppLayout>
    );
  }

  const na = (v: number | null | undefined, suffix = "%") => v === null || v === undefined ? "N/A" : `${v}${suffix}`;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6 max-w-5xl">

        <div className="flex gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab("executive")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "executive"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Executive Report
          </button>
          <button
            onClick={() => setActiveTab("predictive")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "predictive"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Predictive Analytics
          </button>
          <button
            onClick={() => setActiveTab("benchmarking")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "benchmarking"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Benchmarking
          </button>
        </div>

        {activeTab === "predictive" ? (
          <PredictiveAnalyticsContent />
        ) : activeTab === "benchmarking" ? (
          <SchoolBenchmarkingContent />
        ) : (
        <>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Executive Reporting</h1>
            <p className="text-sm text-muted-foreground">Whole-school status at a glance</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchReport}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
        </div>

        {/* 1. Executive Summary */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KPI label="Students" value={data.summary.total_students} icon={Users} color="text-blue-600" />
          <KPI label="Teachers" value={data.summary.total_teachers} icon={GraduationCap} color="text-purple-600" />
          <KPI label="Average Performance" value={na(data.summary.average_performance)} icon={TrendingUp} color="text-green-600" />
          <KPI label="At-Risk Students" value={data.summary.at_risk_count} icon={AlertTriangle} color="text-red-600" />
          <KPI label="Homework Completion" value={na(data.summary.homework_completion_pct)} icon={BookOpen} color="text-orange-600" />
          <KPI label="School Health" value={data.health_score !== null ? `${data.health_score}/100` : "N/A"} icon={Activity} color="text-indigo-600" />
        </div>

        {/* 11. School Health Score breakdown */}
        {data.health_components?.length > 0 && (
          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base">School Health Score — {data.health_score}/100</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {data.health_components.map((c: any) => (
                <span key={c.label}>{c.label}: <span className="font-semibold text-foreground">{c.value}%</span></span>
              ))}
              <span className="italic">Note: attendance isn't included — no attendance module exists yet.</span>
            </CardContent>
          </Card>
        )}



        {/* AI Executive Insights */}
        {data.ai_insights?.length > 0 && (
          <Card className="border border-blue-200 bg-blue-50/40">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-600" /> AI Executive Insights</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {data.ai_insights.map((insight: string, i: number) => <p key={i} className="text-sm">{insight}</p>)}
            </CardContent>
          </Card>
        )}

        {/* At-Risk Students Report */}
        <Card className="border border-border/60">
          <CardHeader className="pb-2"><CardTitle className="text-base">At-Risk Students</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 mb-2">
              <div className="text-center"><p className="text-lg font-bold text-red-600">{data.at_risk.high}</p><p className="text-xs text-muted-foreground">High Risk</p></div>
              <div className="text-center"><p className="text-lg font-bold text-amber-600">{data.at_risk.medium}</p><p className="text-xs text-muted-foreground">Medium Risk</p></div>
              <div className="text-center"><p className="text-lg font-bold text-green-600">{data.at_risk.low}</p><p className="text-xs text-muted-foreground">Low Risk</p></div>
            </div>
            
          </CardContent>
        </Card>

        {/* Behaviour + Intervention + Homework + Assessment summaries */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Heart className="h-4 w-4 text-pink-600" /> Behaviour Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Positive Notes: <span className="font-semibold">{data.behaviour.positive}</span></p>
              <p>Concern Notes: <span className="font-semibold">{data.behaviour.concern}</span></p>
              <p>Incidents: <span className="font-semibold">{data.behaviour.incident}</span></p>
              <p>Resolved: <span className="font-semibold">{data.behaviour.resolved}</span></p>
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4 text-blue-600" /> Intervention Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Created: <span className="font-semibold">{data.interventions.created}</span></p>
              <p>Completed: <span className="font-semibold">{data.interventions.completed}</span></p>
              <p>Active: <span className="font-semibold">{data.interventions.active}</span></p>
              <p>Success Rate: <span className="font-semibold">{na(data.interventions.success_rate)}</span></p>
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base">Homework Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Assigned: <span className="font-semibold">{data.homework.assigned}</span></p>
              <p>Submitted: <span className="font-semibold">{data.homework.submitted}</span></p>
              <p className="col-span-2">Completion Rate: <span className="font-semibold">{na(data.homework.completion_rate)}</span></p>
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base">Assessment Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Conducted: <span className="font-semibold">{data.assessment.conducted}</span></p>
              <p>Avg Score: <span className="font-semibold">{na(data.assessment.average_score)}</span></p>
              <p className="col-span-2">Pass Rate: <span className="font-semibold">{na(data.assessment.pass_rate)}</span></p>
            </CardContent>
          </Card>
        </div>

        {/* Grade-wise Report */}
        {data.grade_wise?.length > 0 && (
          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base">Grade-wise Report</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Grade</TableHead><TableHead>Avg Score</TableHead><TableHead>Risk</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.grade_wise.map((g: any) => (
                    <TableRow key={g.grade}>
                      <TableCell className="font-medium">{g.grade}</TableCell>
                      <TableCell>{g.avg_score}%</TableCell>
                      <TableCell><Badge className={RISK_BADGE[g.risk]}>{g.risk}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Teacher Performance Summary */}
        {data.teacher_performance.teacher_summary?.length > 0 && (
          <Card className="border border-border/60">
            <CardHeader className="pb-2"><CardTitle className="text-base">Teacher Summary</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Teacher</TableHead><TableHead>Class Assignments</TableHead><TableHead>Workload</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.teacher_performance.teacher_summary.map((t: any) => (
                    <TableRow key={t.teacher_name}>
                      <TableCell className="font-medium">{t.teacher_name}</TableCell>
                      <TableCell>{t.class_assignments}</TableCell>
                      <TableCell><Badge className={t.workload === "High" ? "bg-red-100 text-red-700" : t.workload === "Medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}>{t.workload}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground p-3 italic">Note: "Class Assignments" is a proxy based on class/subject assignments — no timetable data exists yet for true classes/day.</p>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground text-center pb-4">
          Not available yet: {data.unavailable?.join(" · ")}
        </p>
        </>
        )}
      </div>
    </AppLayout>
  );
}
