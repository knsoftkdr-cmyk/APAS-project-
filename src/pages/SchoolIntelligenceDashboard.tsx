/**
 * SchoolIntelligenceDashboard.tsx
 * KNSoft Admin — School Intelligence
 * Overall school AI insights, cross-department KPIs, executive dashboards
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { BarChart3, GraduationCap, Users, TrendingUp, Brain, BookOpen, RefreshCw, Award } from "lucide-react";
import schoolintelligenceBanner from "@/assets/SchoolIntelligence-banner.png";

interface SchoolKPI {
  id: string;
  name: string;
  plan: string | null;
  is_active: boolean | null;
  student_count: number;
  teacher_count: number;
  avg_score: number | null;
  prediction_count: number;
  risk_high: number;
}

const SchoolIntelligenceDashboard = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<SchoolKPI[]>([]);
  const [totalStats, setTotalStats] = useState({ students: 0, teachers: 0, predictions: 0, highRisk: 0 });
  const [activeTab, setActiveTab] = useState<"overview" | "performance" | "predictions">("overview");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: schoolsData } = await supabase
        .from("schools")
        .select("id, name, subscription_plan, is_active")
        .order("name");

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, role, school_id");

      const { data: predictions } = await supabase
        .from("student_predictions")
        .select("student_id, risk_level, predicted_score_next_test");

      const { data: diagResults } = await supabase
        .from("diagnostic_results")
        .select("student_id, score")
        .not("score", "is", null);

      // Build score map
      const scoreMap = new Map<string, number[]>();
      for (const r of (diagResults ?? []) as any[]) {
        if (!scoreMap.has(r.student_id)) scoreMap.set(r.student_id, []);
        scoreMap.get(r.student_id)!.push(Number(r.score));
      }

      // Build KPIs per school
      const kpis: SchoolKPI[] = (schoolsData ?? []).map((s: any) => {
        const schoolProfiles = (profiles ?? []).filter((p: any) => p.school_id === s.id);
        const studentIds = schoolProfiles.filter((p: any) => p.role === "student").map((p: any) => p.id);
        const teacherCount = schoolProfiles.filter((p: any) => p.role === "teacher").length;

        const scores = studentIds.flatMap(id => scoreMap.get(id) ?? []);
        const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

        const schoolPreds = (predictions ?? []).filter((p: any) => studentIds.includes(p.student_id));
        const highRisk = schoolPreds.filter((p: any) => p.risk_level === "high").length;

        return {
          id: s.id,
          name: s.name,
          plan: s.subscription_plan,
          is_active: s.is_active,
          student_count: studentIds.length,
          teacher_count: teacherCount,
          avg_score: avgScore,
          prediction_count: schoolPreds.length,
          risk_high: highRisk,
        };
      });

      setSchools(kpis);
      setTotalStats({
        students: kpis.reduce((a, s) => a + s.student_count, 0),
        teachers: kpis.reduce((a, s) => a + s.teacher_count, 0),
        predictions: kpis.reduce((a, s) => a + s.prediction_count, 0),
        highRisk: kpis.reduce((a, s) => a + s.risk_high, 0),
      });
    } catch (e: any) {
      toast({ title: "Error loading data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const planColor = (plan: string | null) => {
    if (plan === "premium") return "bg-yellow-100 text-yellow-800";
    if (plan === "standard") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-700";
  };

  const scoreColor = (score: number | null) => {
    if (!score) return "text-muted-foreground";
    if (score >= 75) return "text-green-600 font-semibold";
    if (score >= 50) return "text-yellow-600 font-semibold";
    return "text-red-600 font-semibold";
  };

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  const tabs = [
    { id: "overview", label: "Executive Overview" },
    { id: "performance", label: "Academic Performance" },
    { id: "predictions", label: "AI Predictions" },
  ] as const;

  return (
    <AppLayout>
            <div className="space-y-6">
              <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-[#EDE9FE] via-[#DDD6FE] to-[#C4B5FD] p-8 relative min-h-[220px]">
      
                <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
                <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
                <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
      
                          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
                <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
                <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
                
                <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
                <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
                <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
                <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>
      
                <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>
      
                <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>
      
                <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
      
      
                <div className="max-w-xl">
                  <h1 className="text-5xl font-bold text-slate-900">
                    School Intelligence
                  </h1>
      
                  <p className="mt-3 text-slate-700 text-lg">
                    AI-powered school-wide analytics and predictions
                  </p>
                </div>
      
                <img
                  src={schoolintelligenceBanner}
                  alt="School Intelligence Banner"
                  className="absolute right-10 bottom-8 h-[130px]"
                />
              </div>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">School Intelligence</h1>
              <p className="text-sm text-muted-foreground">Cross-school AI insights and executive KPIs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Students", value: totalStats.students, icon: GraduationCap, color: "text-blue-600" },
            { label: "Total Teachers", value: totalStats.teachers, icon: Users, color: "text-green-600" },
            { label: "AI Predictions", value: totalStats.predictions, icon: Brain, color: "text-purple-600" },
            { label: "High Risk Students", value: totalStats.highRisk, icon: TrendingUp, color: "text-red-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-6 pb-4 flex items-center gap-4">
                <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === "overview" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5" />School KPI Summary</CardTitle>
              <CardDescription>Executive overview across all schools</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-center">Students</TableHead>
                    <TableHead className="text-center">Teachers</TableHead>
                    <TableHead className="text-center">Avg Score</TableHead>
                    <TableHead className="text-center">High Risk</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schools.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell><Badge className={planColor(s.plan)}>{s.plan ?? "basic"}</Badge></TableCell>
                      <TableCell className="text-center">{s.student_count}</TableCell>
                      <TableCell className="text-center">{s.teacher_count}</TableCell>
                      <TableCell className={`text-center ${scoreColor(s.avg_score)}`}>{s.avg_score ? `${s.avg_score}%` : "—"}</TableCell>
                      <TableCell className="text-center">
                        {s.risk_high > 0 ? <Badge className="bg-red-100 text-red-800 hover:bg-red-100">{s.risk_high}</Badge> : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell>
                        {s.is_active !== false
                          ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                          : <Badge variant="outline">Inactive</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Performance */}
        {activeTab === "performance" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {schools.map(s => (
              <Card key={s.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    {s.name}
                    <Badge className={planColor(s.plan)}>{s.plan ?? "basic"}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    ["Students", s.student_count],
                    ["Teachers", s.teacher_count],
                    ["Avg Score", s.avg_score ? `${s.avg_score}%` : "No data"],
                    ["High Risk", s.risk_high],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </div>
                  ))}
                  <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all"
                      style={{ width: s.avg_score ? `${s.avg_score}%` : "0%" }} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Predictions */}
        {activeTab === "predictions" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" />AI Prediction Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead className="text-center">Total Predictions</TableHead>
                    <TableHead className="text-center">High Risk Students</TableHead>
                    <TableHead>Risk Level</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schools.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-center">{s.prediction_count}</TableCell>
                      <TableCell className="text-center">{s.risk_high}</TableCell>
                      <TableCell>
                        {s.risk_high > 2 ? <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Critical</Badge>
                          : s.risk_high > 0 ? <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Moderate</Badge>
                          : <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Good</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default SchoolIntelligenceDashboard;
