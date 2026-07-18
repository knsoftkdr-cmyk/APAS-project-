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
import { DashStatCard } from "@/components/dashboard/DashStatCard";
import { PredictiveAnalyticsContent } from "@/pages/PredictiveAnalytics";
import { SchoolBenchmarkingContent } from "@/pages/SchoolBenchmarking";


const PRIORITY_DOT: Record<string, string> = { red: "bg-red-500", orange: "bg-orange-500", yellow: "bg-amber-400", green: "bg-green-500" };
const RISK_BADGE: Record<string, string> = { High: "bg-red-100 text-red-700", Medium: "bg-amber-100 text-amber-700", Low: "bg-green-100 text-green-700", "No Data": "bg-gray-100 text-gray-500", "No Tests": "bg-gray-100 text-gray-500" };

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
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Executive Report
          </button>
          <button
            onClick={() => setActiveTab("predictive")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "predictive"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Predictive Analytics
          </button>
          <button
            onClick={() => setActiveTab("benchmarking")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "benchmarking"
                ? "border-blue-600 text-blue-700"
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
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-blue-600 to-sky-600 shadow-lg">
          <div className="absolute top-16 right-10 w-56 h-56 rounded-full bg-blue-300 opacity-[0.12] blur-3xl" />
          <div className="absolute bottom-24 right-1/4 w-48 h-48 rounded-full bg-blue-200 opacity-[0.10] blur-3xl" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">Executive Reporting</h1>
              <p className="text-blue-100 text-xs md:text-sm mt-0.5">Whole-school status at a glance</p>
            </div>
            <Button size="sm" onClick={fetchReport} className="bg-white text-blue-700 hover:bg-blue-50">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* 1. Executive Summary */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <DashStatCard label="Students" value={data.summary.total_students} icon={Users} accent="blue" />
          <DashStatCard label="Teachers" value={data.summary.total_teachers} icon={GraduationCap} accent="purple" />
          <DashStatCard label="Average Performance" value={na(data.summary.average_performance)} icon={TrendingUp} accent="emerald" />
          <DashStatCard label="At-Risk Students" value={data.summary.at_risk_count} icon={AlertTriangle} accent="pink" />
          <DashStatCard label="Homework Completion" value={na(data.summary.homework_completion_pct)} icon={BookOpen} accent="amber" />
          <DashStatCard label="School Health" value={data.health_score !== null ? `${data.health_score}/100` : "N/A"} icon={Activity} accent="orange" />
        </div>

        {/* 11. School Health Score breakdown */}
        {data.health_components?.length > 0 && (
          <Card className="relative overflow-hidden border-2 border-indigo-200 hover:border-indigo-300 rounded-2xl bg-gradient-to-br from-indigo-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-indigo-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-sm shadow-indigo-200"><Activity className="h-3.5 w-3.5" /></div>School Health Score — {data.health_score}/100</CardTitle></CardHeader>
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
          <Card className="relative overflow-hidden border-2 border-dashed border-blue-300 rounded-2xl bg-gradient-to-br from-blue-50/70 via-white to-white shadow-sm">
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-blue-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-sm shadow-blue-200"><Sparkles className="h-3.5 w-3.5" /></div>AI Executive Insights</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {data.ai_insights.map((insight: string, i: number) => <p key={i} className="text-sm">{insight}</p>)}
            </CardContent>
          </Card>
        )}

        {/* At-Risk Students Report */}
        <Card className="relative overflow-hidden border-2 border-pink-200 hover:border-pink-300 rounded-2xl bg-gradient-to-br from-pink-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-pink-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-sm shadow-pink-200"><AlertTriangle className="h-3.5 w-3.5" /></div>At-Risk Students</CardTitle></CardHeader>
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
          <Card className="relative overflow-hidden border-2 border-pink-200 hover:border-pink-300 rounded-2xl bg-gradient-to-br from-pink-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-pink-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-sm shadow-pink-200"><Heart className="h-3.5 w-3.5" /></div>Behaviour Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Positive Notes: <span className="font-semibold">{data.behaviour.positive}</span></p>
              <p>Concern Notes: <span className="font-semibold">{data.behaviour.concern}</span></p>
              <p>Incidents: <span className="font-semibold">{data.behaviour.incident}</span></p>
              <p>Resolved: <span className="font-semibold">{data.behaviour.resolved}</span></p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-2 border-blue-200 hover:border-blue-300 rounded-2xl bg-gradient-to-br from-blue-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-blue-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-sm shadow-blue-200"><ClipboardList className="h-3.5 w-3.5" /></div>Intervention Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Created: <span className="font-semibold">{data.interventions.created}</span></p>
              <p>Completed: <span className="font-semibold">{data.interventions.completed}</span></p>
              <p>Active: <span className="font-semibold">{data.interventions.active}</span></p>
              <p>Success Rate: <span className="font-semibold">{na(data.interventions.success_rate)}</span></p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-2 border-amber-200 hover:border-amber-300 rounded-2xl bg-gradient-to-br from-amber-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-amber-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-amber-500 to-yellow-500 text-white shadow-sm shadow-amber-200"><BookOpen className="h-3.5 w-3.5" /></div>Homework Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Assigned: <span className="font-semibold">{data.homework.assigned}</span></p>
              <p>Submitted: <span className="font-semibold">{data.homework.submitted}</span></p>
              <p className="col-span-2">Completion Rate: <span className="font-semibold">{na(data.homework.completion_rate)}</span></p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-emerald-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-200"><TrendingUp className="h-3.5 w-3.5" /></div>Assessment Summary</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <p>Conducted: <span className="font-semibold">{data.assessment.conducted}</span></p>
              <p>Avg Score: <span className="font-semibold">{na(data.assessment.average_score)}</span></p>
              <p className="col-span-2">Pass Rate: <span className="font-semibold">{na(data.assessment.pass_rate)}</span></p>
              <p className="col-span-2 text-xs text-muted-foreground">
                {data.assessment.from_academic_tests} from Academic Tests · {data.assessment.from_semester_engine} from Semester Engine
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Grade-wise Report */}
        {data.grade_wise?.length > 0 && (
          <Card className="relative overflow-hidden border-2 border-purple-200 hover:border-purple-300 rounded-2xl bg-gradient-to-br from-purple-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-purple-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-purple-500 to-violet-500 text-white shadow-sm shadow-purple-200"><GraduationCap className="h-3.5 w-3.5" /></div>Grade-wise Report</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Grade</TableHead><TableHead>Avg Score</TableHead><TableHead>Risk</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.grade_wise.map((g: any) => (
                    <TableRow key={g.grade}>
                      <TableCell className="font-medium">{g.grade}</TableCell>
                      <TableCell>{g.avg_score !== null ? `${g.avg_score}%` : "No Tests"}</TableCell>
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
          <Card className="relative overflow-hidden border-2 border-orange-200 hover:border-orange-300 rounded-2xl bg-gradient-to-br from-orange-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-orange-400/10 blur-3xl" />
            <CardHeader className="pb-2 relative"><CardTitle className="text-base flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-200"><Users className="h-3.5 w-3.5" /></div>Teacher Summary</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Teacher</TableHead>
                    <TableHead>Classes</TableHead>
                    <TableHead>Interventions</TableHead>
                    <TableHead>Pending Grading</TableHead>
                    <TableHead>At-Risk Students</TableHead>
                    <TableHead>Workload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.teacher_performance.teacher_summary.map((t: any) => (
                    <TableRow key={t.teacher_name}>
                      <TableCell className="font-medium">{t.teacher_name}</TableCell>
                      <TableCell>{t.class_assignments}</TableCell>
                      <TableCell>{t.active_interventions}</TableCell>
                      <TableCell>{t.pending_evaluations}</TableCell>
                      <TableCell>{t.at_risk_students}</TableCell>
                      <TableCell><Badge className={t.workload === "High" ? "bg-red-100 text-red-700" : t.workload === "Medium" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}>{t.workload}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground p-3 italic">Workload = weighted score across classes taught, active interventions, pending grading, homework/worksheets created, and at-risk students in their classes.</p>
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
