/**
 * AICostMonitoringDashboard.tsx — AI Cost Monitoring for KNSoft Admin
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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Bot, DollarSign, Zap, TrendingUp, AlertCircle, CheckCircle } from "lucide-react";

interface DailySummary {
  id: string;
  summary_date: string;
  total_calls: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_response_time_ms: number;
  error_rate: number;
}

interface UsageLog {
  id: string;
  model_used: string;
  task_type: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  status: string;
  created_at: string;
}

interface ModelCost {
  id: string;
  model_name: string;
  provider: string;
  input_cost_per_1k_tokens: number;
  output_cost_per_1k_tokens: number;
  is_active: boolean;
}

export default function AICostMonitoringDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [recentLogs, setRecentLogs] = useState<UsageLog[]>([]);
  const [modelCosts, setModelCosts] = useState<ModelCost[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: summaries }, { data: logs }, { data: models }] = await Promise.all([
        supabase.from("ai_usage_daily_summary").select("*").order("summary_date", { ascending: false }).limit(30),
        supabase.from("ai_usage_logs").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("ai_model_costs").select("*").order("model_name"),
      ]);
      setDailySummaries(summaries ?? []);
      setRecentLogs(logs ?? []);
      setModelCosts(models ?? []);
    } catch (e: any) {
      toast({ title: "Error loading data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalCost = dailySummaries.reduce((a, s) => a + (s.total_cost_usd ?? 0), 0);
  const totalCalls = dailySummaries.reduce((a, s) => a + (s.total_calls ?? 0), 0);
  const totalTokens = dailySummaries.reduce((a, s) => a + (s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0), 0);
  const avgErrorRate = dailySummaries.length ? dailySummaries.reduce((a, s) => a + (s.error_rate ?? 0), 0) / dailySummaries.length : 0;

  const chartData = [...dailySummaries].reverse().slice(-14).map(s => ({
    date: new Date(s.summary_date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    cost: Number((s.total_cost_usd ?? 0).toFixed(4)),
    calls: s.total_calls ?? 0,
    tokens: ((s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0)),
  }));

  // Model usage breakdown from logs
  const modelUsage = recentLogs.reduce((acc, log) => {
    const m = log.model_used ?? "unknown";
    if (!acc[m]) acc[m] = { calls: 0, tokens: 0, cost: 0 };
    acc[m].calls++;
    acc[m].tokens += log.total_tokens ?? 0;
    acc[m].cost += log.cost_usd ?? 0;
    return acc;
  }, {} as Record<string, { calls: number; tokens: number; cost: number }>);

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AI Cost Monitoring</h1>
            <p className="text-sm text-muted-foreground">Token usage, OCR cost, cache hit %, model usage</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Cost (30d)", value: `$${totalCost.toFixed(4)}`, icon: DollarSign, color: "text-green-600" },
            { label: "Total API Calls", value: totalCalls.toLocaleString(), icon: Zap, color: "text-blue-600" },
            { label: "Total Tokens", value: totalTokens > 1000 ? `${(totalTokens/1000).toFixed(1)}K` : totalTokens.toString(), icon: TrendingUp, color: "text-purple-600" },
            { label: "Avg Error Rate", value: `${(avgErrorRate * 100).toFixed(1)}%`, icon: AlertCircle, color: avgErrorRate > 0.05 ? "text-red-600" : "text-green-600" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-6 pb-4 flex items-center gap-4">
                <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-5 w-5" /></div>
                <div>
                  <p className="text-xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="charts" className="space-y-4">
          <TabsList>
            <TabsTrigger value="charts">Token Graphs</TabsTrigger>
            <TabsTrigger value="models">Model Usage</TabsTrigger>
            <TabsTrigger value="logs">Recent Logs</TabsTrigger>
            <TabsTrigger value="pricing">Model Pricing</TabsTrigger>
          </TabsList>

          {/* Charts */}
          <TabsContent value="charts" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Daily Cost (Last 14 Days)</CardTitle></CardHeader>
              <CardContent>
                {chartData.length === 0 ? <p className="text-center text-muted-foreground py-8">No data yet.</p> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(6)}`, "Cost"]} />
                      <Line type="monotone" dataKey="cost" stroke="#2563eb" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Daily API Calls</CardTitle></CardHeader>
              <CardContent>
                {chartData.length === 0 ? <p className="text-center text-muted-foreground py-8">No data yet.</p> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="calls" fill="#8b5cf6" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Model Usage */}
          <TabsContent value="models">
            <Card>
              <CardHeader><CardTitle>Model Usage Breakdown</CardTitle><CardDescription>From last 50 API calls</CardDescription></CardHeader>
              <CardContent className="p-0">
                {Object.keys(modelUsage).length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No usage data yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Model</TableHead><TableHead className="text-center">Calls</TableHead><TableHead className="text-center">Tokens</TableHead><TableHead className="text-center">Cost</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {Object.entries(modelUsage).map(([model, stats]) => (
                        <TableRow key={model}>
                          <TableCell className="font-medium font-mono text-sm">{model}</TableCell>
                          <TableCell className="text-center">{stats.calls}</TableCell>
                          <TableCell className="text-center">{stats.tokens.toLocaleString()}</TableCell>
                          <TableCell className="text-center">${stats.cost.toFixed(6)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Logs */}
          <TabsContent value="logs">
            <Card>
              <CardHeader><CardTitle>Recent AI Calls</CardTitle></CardHeader>
              <CardContent className="p-0">
                {recentLogs.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No logs yet.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Model</TableHead><TableHead>Task</TableHead><TableHead className="text-center">Tokens</TableHead><TableHead className="text-center">Cost</TableHead><TableHead className="text-center">Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {recentLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</TableCell>
                          <TableCell className="font-mono text-xs">{log.model_used ?? "—"}</TableCell>
                          <TableCell className="text-sm">{log.task_type ?? "—"}</TableCell>
                          <TableCell className="text-center">{(log.total_tokens ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-center">${(log.cost_usd ?? 0).toFixed(6)}</TableCell>
                          <TableCell className="text-center">
                            {log.status === "success" ? <Badge className="bg-green-100 text-green-800">Success</Badge>
                              : log.status === "error" ? <Badge className="bg-red-100 text-red-800">Error</Badge>
                              : <Badge variant="outline">{log.status ?? "—"}</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pricing */}
          <TabsContent value="pricing">
            <Card>
              <CardHeader><CardTitle>Model Pricing</CardTitle><CardDescription>Cost per 1K tokens</CardDescription></CardHeader>
              <CardContent className="p-0">
                {modelCosts.length === 0 ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">No pricing configured.</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Provider</TableHead><TableHead className="text-center">Input/1K</TableHead><TableHead className="text-center">Output/1K</TableHead><TableHead className="text-center">Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {modelCosts.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium font-mono text-sm">{m.model_name}</TableCell>
                          <TableCell>{m.provider}</TableCell>
                          <TableCell className="text-center">${m.input_cost_per_1k_tokens}</TableCell>
                          <TableCell className="text-center">${m.output_cost_per_1k_tokens}</TableCell>
                          <TableCell className="text-center">
                            {m.is_active ? <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Active</Badge>
                              : <Badge variant="outline">Inactive</Badge>}
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
