import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REVIEWER_ROLE_LABEL } from "@/lib/approvalWorkflow";
import { friendlyCourseError } from "@/lib/courseStructure";
import { useIsAdminLevel, useSaveWorkflowSettings, useWorkflowSettings, type WorkflowSettings } from "@/hooks/useApprovalWorkflow";

const EMPTY: WorkflowSettings = { enabled: false, allow_self_approval: false, admin_can_skip_stages: false, publish_mode: "manual", stages: [] };

export function ApprovalSettingsTab() {
  const { data, isLoading } = useWorkflowSettings();
  const save = useSaveWorkflowSettings();
  const canEdit = useIsAdminLevel();
  const [s, setS] = useState<WorkflowSettings>(EMPTY);
  useEffect(() => { if (data) setS(data); }, [data]);
  if (isLoading) return <Skeleton className="h-64" />;
  const dirty = JSON.stringify(s) !== JSON.stringify(data ?? EMPTY);
  const move = (i: number, d: -1 | 1) => setS((x) => { const st = [...x.stages]; const j = i + d; if (j < 0 || j >= st.length) return x; [st[i], st[j]] = [st[j], st[i]]; return { ...x, stages: st }; });

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval workflow</CardTitle>
          <CardDescription>When on, teachers submit modules, chapters, topics and materials for review and nothing reaches students until it is approved and published. Existing published content stays published.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div><Label htmlFor="wf-enabled">Require approval before publishing</Label></div>
            <Switch id="wf-enabled" checked={s.enabled} disabled={!canEdit} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div><Label htmlFor="wf-self">Allow people to approve their own submissions</Label><p className="text-xs text-muted-foreground">Off is recommended.</p></div>
            <Switch id="wf-self" checked={s.allow_self_approval} disabled={!canEdit} onCheckedChange={(v) => setS({ ...s, allow_self_approval: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div><Label htmlFor="wf-skip">Admin approval completes all stages</Label><p className="text-xs text-muted-foreground">A principal / admin approval skips the remaining stages.</p></div>
            <Switch id="wf-skip" checked={s.admin_can_skip_stages} disabled={!canEdit} onCheckedChange={(v) => setS({ ...s, admin_can_skip_stages: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>After final approval</Label>
            <Select value={s.publish_mode} disabled={!canEdit} onValueChange={(v) => setS({ ...s, publish_mode: v as "manual" | "auto" })}>
              <SelectTrigger className="sm:w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Wait for someone to press Publish</SelectItem>
                <SelectItem value="auto">Publish automatically</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval chain</CardTitle>
          <CardDescription>Stages run in order. With no stages, any admin, principal or school admin can approve in one step. Up to 5 stages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {s.stages.length === 0 && <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">Single step: Teacher → Admin / Principal → Publish</p>}
          {s.stages.map((st, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span className="w-6 text-center text-sm font-semibold text-muted-foreground">{i + 1}</span>
              <Input className="flex-1 min-w-32" value={st.name} disabled={!canEdit} aria-label={`Stage ${i + 1} name`} maxLength={60}
                onChange={(e) => setS({ ...s, stages: s.stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Select value={st.reviewer_role} disabled={!canEdit} onValueChange={(v) => setS({ ...s, stages: s.stages.map((x, j) => (j === i ? { ...x, reviewer_role: v } : x)) })}>
                <SelectTrigger className="sm:w-60" aria-label={`Stage ${i + 1} reviewer role`}><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(REVIEWER_ROLE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
              {canEdit && <>
                <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === s.stages.length - 1} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setS({ ...s, stages: s.stages.filter((_, j) => j !== i) })} aria-label="Remove stage"><Trash2 className="h-4 w-4" /></Button>
              </>}
            </div>
          ))}
          {canEdit && s.stages.length < 5 && (
            <Button variant="outline" size="sm" onClick={() => setS({ ...s, stages: [...s.stages, { name: s.stages.length === 0 ? "Subject coordinator" : "Principal", reviewer_role: s.stages.length === 0 ? "hod" : "principal" }] })}>
              <Plus className="h-4 w-4 me-1.5" />Add stage
            </Button>
          )}
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button disabled={!dirty || save.isPending || s.stages.some((x) => !x.name.trim())}
            onClick={() => save.mutate(s, { onError: (e) => toast.error(friendlyCourseError(e.message)), onSuccess: () => toast.success("Approval settings saved") })}>
            {save.isPending && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}Save settings
          </Button>
          {dirty && <Button variant="ghost" onClick={() => setS(data ?? EMPTY)}>Discard changes</Button>}
        </div>
      ) : <p className="text-sm text-muted-foreground">Only school administrators can change these settings.</p>}
    </div>
  );
}
