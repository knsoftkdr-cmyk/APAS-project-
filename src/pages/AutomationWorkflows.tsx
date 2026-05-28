import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Plus, Zap, History, Play } from "lucide-react";
import { format } from "date-fns";

const TRIGGER_EVENTS = [
  { value: "diagnostic_completed", label: "Diagnostic Completed" },
  { value: "lesson_completed", label: "Lesson Completed" },
  { value: "test_completed", label: "Test Completed" },
  { value: "homework_submitted", label: "Homework Submitted" },
  { value: "low_score_detected", label: "Low Score Detected" },
];

const ACTION_TYPES = [
  { value: "generate_lesson", label: "Generate Lesson Plan" },
  { value: "run_predictions", label: "Run Predictions" },
  { value: "detect_issues", label: "Detect Learning Issues" },
  { value: "notify", label: "Send Notification" },
];

const AutomationWorkflows = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("");
  const [actionType, setActionType] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ["automation-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("automation_rules").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ["automation-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("automation_logs").select("*, automation_rules(name)").order("executed_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const createRule = useMutation({
    mutationFn: async () => {
      const actionJson: Record<string, unknown> = { type: actionType };
      if (actionType === "notify" && actionMessage) {
        actionJson.params = { title: "Automation Alert", message: actionMessage };
      }
      const { error } = await supabase.from("automation_rules").insert([{
        name,
        description,
        trigger_event: triggerEvent,
        action_json: actionJson as any,
        created_by: user!.id,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
      toast.success("Rule created successfully");
      setDialogOpen(false);
      setName("");
      setDescription("");
      setTriggerEvent("");
      setActionType("");
      setActionMessage("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("automation_rules").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation-rules"] }),
  });

  const testRule = async (ruleId: string, triggerEvent: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("run-automation-engine", {
        body: { trigger_event: triggerEvent, trigger_data: { test: true, rule_id: ruleId } },
      });
      if (error) throw error;
      toast.success(`Rule tested: ${data?.executed || 0} actions executed`);
      queryClient.invalidateQueries({ queryKey: ["automation-logs"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <AppLayout>
      <PageHeader title="Automation Workflows" subtitle="Create trigger-based automation rules" />

      <Tabs defaultValue="rules" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rules"><Zap className="h-4 w-4 mr-1" /> Rules</TabsTrigger>
          <TabsTrigger value="logs"><History className="h-4 w-4 mr-1" /> Execution Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Create Rule</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Automation Rule</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Rule Name</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Auto-generate lesson after diagnostic" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what this rule does..." />
                  </div>
                  <div className="space-y-2">
                    <Label>When this happens (Trigger)</Label>
                    <Select value={triggerEvent} onValueChange={setTriggerEvent}>
                      <SelectTrigger><SelectValue placeholder="Select trigger..." /></SelectTrigger>
                      <SelectContent>
                        {TRIGGER_EVENTS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Do this (Action)</Label>
                    <Select value={actionType} onValueChange={setActionType}>
                      <SelectTrigger><SelectValue placeholder="Select action..." /></SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {actionType === "notify" && (
                    <div className="space-y-2">
                      <Label>Notification Message</Label>
                      <Textarea value={actionMessage} onChange={e => setActionMessage(e.target.value)} placeholder="Message to send..." />
                    </div>
                  )}
                  <Button onClick={() => createRule.mutate()} disabled={!name || !triggerEvent || !actionType || createRule.isPending} className="w-full">
                    {createRule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Rule
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {rulesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !rules?.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No automation rules created yet. Click "Create Rule" to get started.</CardContent></Card>
          ) : (
            <div className="grid gap-4">
              {rules.map(rule => (
                <Card key={rule.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{rule.name}</h3>
                        <Badge variant={rule.is_active ? "default" : "secondary"}>{rule.is_active ? "Active" : "Inactive"}</Badge>
                      </div>
                      {rule.description && <p className="text-sm text-muted-foreground">{rule.description}</p>}
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span>Trigger: <strong>{TRIGGER_EVENTS.find(t => t.value === rule.trigger_event)?.label || rule.trigger_event}</strong></span>
                        <span>→</span>
                        <span>Action: <strong>{ACTION_TYPES.find(a => a.value === (rule.action_json as any)?.type)?.label || (rule.action_json as any)?.type}</strong></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" onClick={() => testRule(rule.id, rule.trigger_event)}>
                        <Play className="h-3 w-3 mr-1" /> Test
                      </Button>
                      <Switch
                        checked={rule.is_active}
                        onCheckedChange={checked => toggleRule.mutate({ id: rule.id, is_active: checked })}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs">
          {logsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !logs?.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No execution logs yet.</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Executed At</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">{(log as any).automation_rules?.name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={log.status === "success" ? "default" : "destructive"}>{log.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{format(new Date(log.executed_at), "MMM d, h:mm a")}</TableCell>
                      <TableCell className="text-sm text-destructive">{log.error_message || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
};

export default AutomationWorkflows;
