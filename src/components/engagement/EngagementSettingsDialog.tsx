// School administrators: configure the scoring weights and reporting period.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACTIVITY_META, ACTIVITY_ORDER, fetchEngagementSettings, saveEngagementSettings, type ActivityKey } from "@/lib/engagement";

export default function EngagementSettingsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["engagement", "settings"], queryFn: fetchEngagementSettings, enabled: open });
  const [weights, setWeights] = useState<Record<ActivityKey, number> | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (q.data) { setWeights({ ...q.data.config.weights }); setDays(Number(q.data.config.window_days) || 30); }
  }, [q.data]);

  const total = weights ? ACTIVITY_ORDER.reduce((s, k) => s + (Number(weights[k]) || 0), 0) : 0;
  const save = useMutation({
    mutationFn: () => saveEngagementSettings({ weights: weights!, window_days: days }),
    onSuccess: () => { toast.success("Engagement settings saved. Scores refresh automatically."); qc.invalidateQueries({ queryKey: ["engagement"] }); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" /> Weights</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-blue-950">Engagement score settings</DialogTitle></DialogHeader>
        {!weights || !q.data?.can_edit ? (
          <p className="text-sm text-slate-500">{q.isLoading ? "Loading..." : q.data && !q.data.can_edit ? "Only school administrators can change these settings." : (q.error as Error | null)?.message}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Weights are relative. If an activity does not apply to a student it is left out and the rest are rebalanced, so you do not need to total exactly 100.</p>
            {ACTIVITY_ORDER.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <Label htmlFor={`w-${k}`} className="text-sm">{ACTIVITY_META[k].label}</Label>
                <Input id={`w-${k}`} type="number" min={0} max={100} className="w-20" value={weights[k]}
                  onChange={(e) => setWeights({ ...weights, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
              </div>
            ))}
            <p className={`text-xs ${total === 100 ? "text-slate-400" : "text-amber-700"}`}>Total: {total}{total !== 100 && " (used proportionally)"}</p>
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Label htmlFor="w-days" className="text-sm">Reporting period (days)</Label>
              <Input id="w-days" type="number" min={7} max={90} className="w-20" value={days} onChange={(e) => setDays(Math.max(7, Math.min(90, Number(e.target.value) || 30)))} />
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setWeights({ ...q.data!.defaults.weights })}>Reset to defaults</Button>
              <Button size="sm" disabled={total <= 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
