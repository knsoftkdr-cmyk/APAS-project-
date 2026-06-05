import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp, TrendingDown, BarChart3, Users, Brain, Loader2,
  AlertTriangle, GraduationCap, BookOpen, Sparkles, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { toast } from "sonner";
import schoolIntelligencebanner from "@/assets/SchoolIntelligence-banner.png";

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

const SchoolAnalytics = () => {
  const [runningDetection, setRunningDetection] = useState(false);
  const [runningPrediction, setRunningPrediction] = useState(false);

  const { data: metrics, isLoading, refetch } = useQuery({
    queryKey: ["school-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_metrics")
        .select("*")
        .order("snapshot_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: predictions } = useQuery({
    queryKey: ["student-predictions-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_predictions")
        .select("student_id, subject, predicted_score_next_test, risk_level, dropout_risk_percentage, contributing_factors, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ["smart-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mismatch_alerts")
        .select("*")
        .eq("status", "flagged")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  const latestMetric = metrics?.[0];
  const riskSummary = (latestMetric?.risk_summary as any) || { high: 0, medium: 0, low: 0, total: 0 };

  const highRiskStudents = (predictions || []).filter(p => p.risk_level === "high");
  const medRiskStudents = (predictions || []).filter(p => p.risk_level === "medium");

  // Chart data
  const gainTrend = (metrics || []).slice(0, 12).reverse().map(m => ({
    date: new Date(m.snapshot_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    gain: Number(m.learning_gain_index) * 100,
    effectiveness: Number(m.teaching_effectiveness_score),
  }));

  const riskPieData = [
    { name: "High Risk", value: highRiskStudents.length, fill: "hsl(0, 84%, 60%)" },
    { name: "Medium Risk", value: medRiskStudents.length, fill: "hsl(45, 93%, 47%)" },
    { name: "Low Risk", value: (predictions || []).filter(p => p.risk_level === "low").length, fill: "hsl(142, 71%, 45%)" },
  ].filter(d => d.value > 0);

  const runDetection = async () => {
    setRunningDetection(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect-learning-issues");
      if (error) throw error;
      toast.success(`Detected ${data.issues_detected} issues, created ${data.alerts_created} alerts`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Detection failed");
    }
    setRunningDetection(false);
  };

  const runPrediction = async () => {
    setRunningPrediction(true);
    try {
      const { data, error } = await supabase.functions.invoke("predict-performance");
      if (error) throw error;
      toast.success(`Analyzed ${data.summary.total_analyzed} students: ${data.summary.high_risk} high risk`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Prediction failed");
    }
    setRunningPrediction(false);
  };

return (
  <AppLayout>
    <div className="space-y-6">

      {/* Hero Banner */}
      <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-500 p-8 relative min-h-[220px]">
        {/* Decorative Circles */}
        <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
        <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
        <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
<div className="hidden md:block">
        {/* Stars */}
        <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
        <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
        <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>

        <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
        <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
        <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
        <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

        {/* Triangles */}
        <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

        <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

        <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
        {/* Content */}
        <div className="relative z-10 max-w-xl">
          <h1 className="text-5xl font-bold text-slate-900">
            School Performance Intelligence
          </h1>

          <p className="mt-3 text-lg text-slate-700">
            AI-powered school-wide analytics and predictions
          </p>
        </div>

        {/* Banner Image */}
        <img
          src={schoolIntelligencebanner}
          alt="School Intelligence Banner"
          /* className="absolute right-10 bottom-0 h-[200px] object-contain" */
          className="hidden md:block absolute right-10 bottom-5 w-[180px] z-10"
        />
      </div>

      {/* Action Buttons Only */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={runDetection}
          disabled={runningDetection}
        >
          {runningDetection ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <AlertTriangle className="h-4 w-4 mr-1" />
          )}
          Run Issue Detection
        </Button>

        <Button
          size="sm"
          onClick={runPrediction}
          disabled={runningPrediction}
        >
          {runningPrediction ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <Brain className="h-4 w-4 mr-1" />
          )}
          Run Predictions
        </Button>
      </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">Learning Gain Index</span>
              </div>
              <p className="text-2xl font-bold">{latestMetric ? `${(Number(latestMetric.learning_gain_index) * 100).toFixed(1)}%` : "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <GraduationCap className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">Teaching Effectiveness</span>
              </div>
              <p className="text-2xl font-bold">{latestMetric ? `${Number(latestMetric.teaching_effectiveness_score).toFixed(1)}` : "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">AI Lessons Generated</span>
              </div>
              <p className="text-2xl font-bold">{latestMetric?.ai_usage_count ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-xs text-muted-foreground">At-Risk Students</span>
              </div>
              <p className="text-2xl font-bold text-destructive">{highRiskStudents.length}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="predictions">Predictions</TabsTrigger>
            <TabsTrigger value="alerts">Smart Alerts ({alerts?.length || 0})</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Gain Trend */}
              <Card>
                <CardHeader><CardTitle className="text-base">Learning Gain Trend</CardTitle></CardHeader>
                <CardContent>
                  {gainTrend.length > 0 ? (
                    <ChartContainer config={{ gain: { label: "Gain %", color: "hsl(var(--primary))" } }} className="h-[250px]">
                      <LineChart data={gainTrend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={11} />
                        <YAxis fontSize={11} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line type="monotone" dataKey="gain" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No data yet. Run Issue Detection to generate metrics.</p>
                  )}
                </CardContent>
              </Card>

              {/* Risk Distribution */}
              <Card>
                <CardHeader><CardTitle className="text-base">Student Risk Distribution</CardTitle></CardHeader>
                <CardContent>
                  {riskPieData.length > 0 ? (
                    <ChartContainer config={{ risk: { label: "Risk" } }} className="h-[250px]">
                      <PieChart>
                        <Pie data={riskPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                          {riskPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No predictions yet. Run Predictions to analyze students.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Predictions Tab */}
          <TabsContent value="predictions" className="space-y-4">
            {highRiskStudents.length > 0 && (
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    High Risk Students ({highRiskStudents.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {highRiskStudents.map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{p.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          Predicted: {Number(p.predicted_score_next_test).toFixed(0)}% | Dropout Risk: {Number(p.dropout_risk_percentage).toFixed(0)}%
                        </p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(Array.isArray(p.contributing_factors) ? p.contributing_factors : typeof p.contributing_factors === "string" ? JSON.parse(p.contributing_factors || "[]") : []).slice(0, 3).map((f, j) => (
                            <Badge key={j} variant="outline" className="text-xs">{f}</Badge>
                          ))}
                        </div>
                      </div>
                      <Badge variant="destructive">HIGH</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {medRiskStudents.length > 0 && (
              <Card className="border-accent">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-muted-foreground" />
                    Medium Risk Students ({medRiskStudents.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {medRiskStudents.slice(0, 10).map((p, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{p.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          Predicted: {Number(p.predicted_score_next_test).toFixed(0)}%
                        </p>
                      </div>
                      <Badge variant="secondary">MEDIUM</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {(predictions || []).length === 0 && (
              <Card>
                <CardContent className="p-8 text-center">
                  <Brain className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No predictions yet. Click "Run Predictions" to analyze student performance.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Smart Alerts Tab */}
          <TabsContent value="alerts" className="space-y-3">
            {(alerts || []).length > 0 ? (
              alerts!.map((alert) => (
                <Card key={alert.id} className="border-l-4 border-l-destructive/50">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{alert.lesson_type}</Badge>
                        <Badge variant="destructive" className="text-xs">{alert.fail_rate}% fail rate</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(alert.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium mb-1">{alert.student_group}</p>
                    <p className="text-xs text-muted-foreground mb-2">{alert.trigger_condition}</p>
                    <p className="text-xs text-primary">{alert.recommendation}</p>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No active alerts. Run Issue Detection to scan for learning issues.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default SchoolAnalytics;
