/**
 * AutomationDashboard.tsx
 * KNSoft Admin — Automation & Workflow Management
 * Workflow automations, trigger rules, AI jobs
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Zap, Play, Pause, Plus, RefreshCw, CheckCircle, Clock, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  is_active: boolean;
  created_at: string;
  condition_json: any;
  action_json: any;
}

const TRIGGER_EVENTS = [
  "student_low_score",
  "homework_overdue",
  "diagnostic_completed",
  "lesson_plan_generated",
  "user_created",
  "risk_level_changed",
];

const AutomationDashboard = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTrigger, setNewTrigger] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<"rules" | "monitor" | "logs">("rules");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("automation_rules")
        .select("*")
        .order("created_at", { ascending: false });
      setRules(data ?? []);
    } catch (e: any) {
      toast({ title: "Error loading automations", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleToggle = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from("automation_rules")
      .update({ is_active: !current })
      .eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Rule ${!current ? "activated" : "paused"}` }); fetchData(); }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newTrigger) {
      toast({ title: "Name and trigger are required", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("automation_rules").insert({
      name: newName.trim(),
      description: newDesc.trim() || null,
      trigger_event: newTrigger,
      is_active: true,
      condition_json: {},
      action_json: {},
    });
    setCreating(false);
    if (error) toast({ title: "Error creating rule", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Automation rule created ✅" });
      setCreateOpen(false);
      setNewName(""); setNewDesc(""); setNewTrigger("");
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this automation rule?")) return;
    const { error } = await supabase.from("automation_rules").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Rule deleted" }); fetchData(); }
  };

  const activeCount = rules.filter(r => r.is_active).length;
  const pausedCount = rules.filter(r => !r.is_active).length;

  // Mock AI job logs
  const mockLogs = [
    { id: 1, job: "generate-lessons", status: "completed", duration: "2.3s", time: "10 min ago" },
    { id: 2, job: "predict-performance", status: "completed", duration: "1.8s", time: "25 min ago" },
    { id: 3, job: "ai-router", status: "failed", duration: "0.5s", time: "1 hr ago" },
    { id: 4, job: "build-student-profile", status: "completed", duration: "3.1s", time: "2 hr ago" },
    { id: 5, job: "detect-learning-issues", status: "running", duration: "—", time: "Just now" },
  ];

  if (loading) return <AppLayout><div className="flex min-h-[60vh] items-center justify-center"><LoadingSpinner size="lg" /></div></AppLayout>;

  const tabs = [
    { id: "rules", label: "Automation Rules" },
    { id: "monitor", label: "Workflow Monitor" },
    { id: "logs", label: "AI Job Logs" },
  ] as const;

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Automation Dashboard</h1>
              <p className="text-sm text-muted-foreground">Manage workflow automations, trigger rules and AI jobs</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Rules", value: rules.length, icon: Zap, color: "text-blue-600" },
            { label: "Active", value: activeCount, icon: Play, color: "text-green-600" },
            { label: "Paused", value: pausedCount, icon: Pause, color: "text-yellow-600" },
            { label: "AI Jobs Running", value: mockLogs.filter(l => l.status === "running").length, icon: Clock, color: "text-purple-600" },
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

        {/* Automation Rules */}
        {activeTab === "rules" && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Automation Rules</CardTitle>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Rule</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Create Automation Rule</DialogTitle></DialogHeader>
                    <div className="space-y-4 pt-2">
                      <div className="space-y-1.5">
                        <Label>Rule Name *</Label>
                        <Input placeholder="e.g. Alert on low score" value={newName} onChange={e => setNewName(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Input placeholder="Optional description" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Trigger Event *</Label>
                        <Select value={newTrigger} onValueChange={setNewTrigger}>
                          <SelectTrigger><SelectValue placeholder="Select trigger" /></SelectTrigger>
                          <SelectContent>
                            {TRIGGER_EVENTS.map(t => (
                              <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button className="w-full" onClick={handleCreate} disabled={creating}>
                        {creating ? <LoadingSpinner size="sm" /> : "Create Rule"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {rules.length === 0 ? (
                <p className="py-12 text-center text-muted-foreground">No automation rules yet. Create one above.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule Name</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <p className="font-medium">{r.name}</p>
                          {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{r.trigger_event.replace(/_/g, " ")}</Badge>
                        </TableCell>
                        <TableCell>
                          {r.is_active
                            ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                            : <Badge variant="outline">Paused</Badge>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleToggle(r.id, r.is_active)}>
                              {r.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)} className="text-destructive hover:text-destructive">
                              ✕
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Workflow Monitor */}
        {activeTab === "monitor" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Trigger Event Distribution</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {TRIGGER_EVENTS.map(event => {
                  const count = rules.filter(r => r.trigger_event === event).length;
                  return (
                    <div key={event} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground capitalize">{event.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: count > 0 ? "100%" : "0%" }} />
                        </div>
                        <span className="font-medium w-4 text-right">{count}</span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Active Rules Overview</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total rules</span>
                  <span className="font-semibold">{rules.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Active</span>
                  <span className="font-semibold text-green-600">{activeCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Paused</span>
                  <span className="font-semibold text-yellow-600">{pausedCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Activation rate</span>
                  <span className="font-semibold">{rules.length > 0 ? Math.round((activeCount / rules.length) * 100) : 0}%</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Job Logs */}
        {activeTab === "logs" && (
          <Card>
            <CardHeader>
              <CardTitle>AI Job Logs</CardTitle>
              <CardDescription>Recent edge function execution history</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockLogs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-sm">{log.job}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {log.status === "completed" && <CheckCircle className="h-4 w-4 text-green-600" />}
                          {log.status === "failed" && <AlertTriangle className="h-4 w-4 text-red-600" />}
                          {log.status === "running" && <Clock className="h-4 w-4 text-blue-600 animate-spin" />}
                          <Badge className={
                            log.status === "completed" ? "bg-green-100 text-green-800 hover:bg-green-100" :
                            log.status === "failed" ? "bg-red-100 text-red-800 hover:bg-red-100" :
                            "bg-blue-100 text-blue-800 hover:bg-blue-100"
                          }>{log.status}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{log.duration}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{log.time}</TableCell>
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

export default AutomationDashboard;
