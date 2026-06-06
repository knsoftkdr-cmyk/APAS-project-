/**
 * RiskPredictionDashboard.tsx — Risk Prediction for KNSoft Admin
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { AlertTriangle, TrendingUp, Users, Brain } from "lucide-react";
import alertsbanner from "@/assets/alerts-banner.png";
interface Prediction {
  id: string;
  student_id: string;
  subject: string;
  risk_level: string;
  dropout_risk_percentage: number;
  predicted_score_next_test: number | null;
  confidence_score: number | null;
  contributing_factors: any;
  created_at: string;
  updated_at: string;
}

const RISK_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
  critical: "#7c3aed",
};

export default function RiskPredictionDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selected, setSelected] = useState<Prediction | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("student_predictions")
        .select("*")
        .order("dropout_risk_percentage", { ascending: false });
      setPredictions(data ?? []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Stats
  const high = predictions.filter(p => p.risk_level === "high" || p.risk_level === "critical").length;
  const medium = predictions.filter(p => p.risk_level === "medium").length;
  const low = predictions.filter(p => p.risk_level === "low").length;
  const avgRisk = predictions.length ? Math.round(predictions.reduce((a, p) => a + (p.dropout_risk_percentage ?? 0), 0) / predictions.length) : 0;

  // By subject chart
  const subjectMap: Record<string, { high: number; medium: number; low: number }> = {};
  for (const p of predictions) {
    const s = p.subject ?? "Unknown";
    if (!subjectMap[s]) subjectMap[s] = { high: 0, medium: 0, low: 0 };
    if (p.risk_level === "high" || p.risk_level === "critical") subjectMap[s].high++;
    else if (p.risk_level === "medium") subjectMap[s].medium++;
    else subjectMap[s].low++;
  }
  const subjectChart = Object.entries(subjectMap).map(([subject, v]) => ({ subject, ...v }));

  // Pie chart data
  const pieData = [
    { name: "High Risk", value: high, color: "#ef4444" },
    { name: "Medium Risk", value: medium, color: "#f59e0b" },
    { name: "Low Risk", value: low, color: "#22c55e" },
  ].filter(d => d.value > 0);

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 p-8 text-white mb-6">
        
          {/* Decorations */}
          <div className="hidden md:block absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
          <div className="hidden md:block absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/60"></div>
          <div className="hidden md:block absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/60"></div>
        
          <div className="hidden md:block absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="hidden md:block absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="hidden md:block absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
        
          <div className="hidden md:block absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>
        
          <div className="relative z-10 flex items-center gap-4">
                  <div className="h-14 w-14 rounded-xl bg-white/20 flex items-center justify-center">
                    <AlertTriangle className="h-7 w-7" />
                  </div>
            <div>
              <h1 className="text-3xl text-black/80 md:text-4xl font-bold">
                Risk Prediction Dashboard
              </h1>
        
              <p className="text-black/80 mt-1">
                Weak students, absentee risks, behavior alerts
              </p>
        
            </div>
        
          </div>
                  <img
                    src={alertsbanner}
                    alt="Alerts Banner"
                    /* className="absolute right-10 bottom-6 h-[160px]" */
                    className="hidden md:block absolute right-5 bottom-3 w-[90px] z-10"
                  />
        </div>
          {/*         <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Risk Prediction Dashboard</h1>
            <p className="text-sm text-muted-foreground">Weak students, absentee risks, behavior alerts</p>
          </div>
        </div> */}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "High Risk Students", value: high, icon: AlertTriangle, color: "text-red-600" },
            { label: "Medium Risk", value: medium, icon: TrendingUp, color: "text-yellow-600" },
            { label: "Low Risk", value: low, icon: Users, color: "text-green-600" },
            { label: "Avg Dropout Risk", value: `${avgRisk}%`, icon: Brain, color: avgRisk > 50 ? "text-red-600" : avgRisk > 25 ? "text-yellow-600" : "text-green-600" },
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

        <Tabs defaultValue="heatmap" className="space-y-4">
          <TabsList>
            <TabsTrigger value="heatmap">Risk Heatmap</TabsTrigger>
            <TabsTrigger value="alerts">Alert Cards</TabsTrigger>
            <TabsTrigger value="interventions">Interventions</TabsTrigger>
          </TabsList>

          {/* Heatmap */}
          <TabsContent value="heatmap" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle>Risk Distribution by Subject</CardTitle></CardHeader>
                <CardContent className="px-2 pb-4 pt-0">
                  {subjectChart.length === 0 ? <p className="text-center text-muted-foreground py-8">No data.</p> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={subjectChart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="subject" tick={{ fontSize: 13, fontWeight: 600 }} interval={0} />
                        <YAxis tick={{ fontSize: 13, fontWeight: 600 }} />
                        <Tooltip />
                        <Bar dataKey="high" stackId="a" fill="#ef4444" name="High" />
                        <Bar dataKey="medium" stackId="a" fill="#f59e0b" name="Medium" />
                        <Bar dataKey="low" stackId="a" fill="#22c55e" name="Low" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Overall Risk Breakdown</CardTitle></CardHeader>
                <CardContent className="flex justify-center">
                  {pieData.length === 0 ? <p className="text-center text-muted-foreground py-8">No data.</p> : (
                    <PieChart width={300} height={260}>
                      <Pie data={pieData} cx={150} cy={110} outerRadius={80} dataKey="value">
                        {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [v, n]} />
                      <Legend />
                    </PieChart>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Risk progress bars */}
            <Card>
              <CardHeader><CardTitle>Dropout Risk by Student</CardTitle></CardHeader>
              <CardContent className="space-y-3 max-h-80 overflow-y-auto">
                {predictions.slice(0, 20).map((p) => (
                  <div key={p.id} className="space-y-1 cursor-pointer hover:bg-muted/50 rounded p-2" onClick={() => setSelected(p)}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium font-mono text-xs">{p.student_id?.slice(0,8)}… <span className="text-muted-foreground">({p.subject})</span></span>
                      <div className="flex items-center gap-2">
                        <Badge style={{ backgroundColor: RISK_COLORS[p.risk_level] ?? "#6b7280", color: "white" }} className="text-xs">{p.risk_level}</Badge>
                        <span className="font-semibold text-xs">{p.dropout_risk_percentage}%</span>
                      </div>
                    </div>
                    <Progress value={p.dropout_risk_percentage} className="h-1.5" />
                  </div>
                ))}
                {predictions.length === 0 && <p className="text-center text-muted-foreground py-4">No predictions yet.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Alert Cards */}
          <TabsContent value="alerts">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {predictions.filter(p => p.risk_level === "high" || p.risk_level === "critical").length === 0 ? (
                <Card className="col-span-full"><CardContent className="py-12 text-center text-muted-foreground">No high risk students — all clear! ✅</CardContent></Card>
              ) : (
                predictions.filter(p => p.risk_level === "high" || p.risk_level === "critical").map((p) => (
                  <Card key={p.id} className="border-red-200">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-mono text-xs text-muted-foreground">{p.student_id?.slice(0,8)}…</p>
                          <p className="font-semibold">{p.subject}</p>
                        </div>
                        <Badge style={{ backgroundColor: RISK_COLORS[p.risk_level], color: "white" }}>{p.risk_level}</Badge>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Dropout Risk</span>
                          <span className="font-bold text-red-600">{p.dropout_risk_percentage}%</span>
                        </div>
                        <Progress value={p.dropout_risk_percentage} className="h-2" />
                      </div>
                      {p.predicted_score_next_test !== null && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Predicted Next Score</span>
                          <span className="font-semibold">{p.predicted_score_next_test}%</span>
                        </div>
                      )}
                      {p.confidence_score !== null && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Confidence</span>
                          <span>{Math.round(p.confidence_score * 100)}%</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Interventions */}
          <TabsContent value="interventions">
            <Card>
              <CardHeader><CardTitle>Trigger Interventions</CardTitle><CardDescription>Students requiring immediate action</CardDescription></CardHeader>
              <CardContent className="p-0">
                {predictions.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No prediction data yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead className="text-center">Dropout Risk</TableHead>
                        <TableHead className="text-center">Predicted Score</TableHead>
                        <TableHead className="text-center">Risk Level</TableHead>
                        <TableHead className="text-center">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {predictions.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.student_id?.slice(0,8)}…</TableCell>
                          <TableCell>{p.subject ?? "—"}</TableCell>
                          <TableCell className="text-center font-semibold" style={{ color: RISK_COLORS[p.risk_level] }}>{p.dropout_risk_percentage}%</TableCell>
                          <TableCell className="text-center">{p.predicted_score_next_test !== null ? `${p.predicted_score_next_test}%` : "—"}</TableCell>
                          <TableCell className="text-center">
                            <Badge style={{ backgroundColor: RISK_COLORS[p.risk_level] ?? "#6b7280", color: "white" }}>{p.risk_level}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {(p.risk_level === "high" || p.risk_level === "critical")
                              ? <Badge className="bg-red-100 text-red-800 cursor-pointer">Intervene Now</Badge>
                              : p.risk_level === "medium"
                              ? <Badge className="bg-yellow-100 text-yellow-800 cursor-pointer">Monitor</Badge>
                              : <Badge className="bg-green-100 text-green-800">On Track</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
