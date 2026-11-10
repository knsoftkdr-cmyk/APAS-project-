import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { requestInstalmentPlan } from "@/lib/instalmentApi";
import { formatINR, splitEvenly, type InstalmentSettings, type ParentFee } from "@/lib/instalments";

interface Props { open: boolean; onOpenChange: (v: boolean) => void; studentId: string; fee: ParentFee | null; settings: InstalmentSettings; onDone: () => void }

export function RequestInstalmentDialog({ open, onOpenChange, studentId, fee, settings, onDone }: Props) {
  const { toast } = useToast();
  const counts = useMemo(() => (settings.allow_flexible ? [...settings.allowed_counts].sort((a, b) => a - b) : [settings.default_count]), [settings]);
  const [count, setCount] = useState<number>(counts[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCount(counts.includes(settings.default_count) ? settings.default_count : counts[0]); setReason(""); } }, [open, counts, settings.default_count]);
  if (!fee) return null;

  const balance = fee.balance;
  const problem = (c: number): string | null => {
    const avg = balance / c;
    if (settings.min_instalment_amount != null && avg < settings.min_instalment_amount) return `Each would be under the school minimum of ${formatINR(settings.min_instalment_amount)}`;
    if (settings.max_instalment_amount != null && avg > settings.max_instalment_amount) return `Each would be over the school maximum of ${formatINR(settings.max_instalment_amount)}`;
    return null;
  };
  const parts = splitEvenly(balance, count);
  const chosenProblem = problem(count);
  const canSubmit = !busy && !chosenProblem && reason.trim().length >= 3;

  const submit = async () => {
    setBusy(true);
    try {
      await requestInstalmentPlan(studentId, fee.fee_payment_id, settings.allow_flexible ? count : null, reason.trim());
      toast({ title: "Request sent", description: "The school will review it and you'll be notified." });
      onOpenChange(false); onDone();
    } catch (e) { toast({ title: "Couldn't send the request", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#12203a]">Request an instalment plan</DialogTitle>
          <DialogDescription>Outstanding balance <strong>{formatINR(balance)}</strong>. The school reviews every request and sets the due dates.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{settings.allow_flexible ? "How many instalments?" : "Number of instalments (set by the school)"}</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Number of instalments">
            {counts.map((c) => {
              const p = problem(c);
              const selected = c === count;
              return (
                <button key={c} type="button" role="radio" aria-checked={selected} disabled={!!p || !settings.allow_flexible} onClick={() => setCount(c)}
                  className={`rounded-lg border p-3 text-start transition ${selected ? "border-[#c9a227] bg-amber-50 ring-1 ring-[#c9a227]" : "border-slate-200 bg-white"} ${p ? "opacity-50 cursor-not-allowed" : settings.allow_flexible ? "hover:border-[#12203a]" : ""}`}>
                  <span className="block text-sm font-semibold text-[#12203a]">{c} instalments</span>
                  <span className="block text-xs text-slate-600">≈ {formatINR(splitEvenly(balance, c)[0])} each</span>
                  {p && <span className="block text-[11px] text-red-600 mt-0.5">{p}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
          <p className="font-medium text-slate-700 mb-1">Proposed split</p>
          <p className="text-slate-600">{parts.map((p) => formatINR(p)).join(" + ")} = <strong>{formatINR(balance)}</strong></p>
          <p className="text-xs text-slate-500 mt-1">The school may adjust amounts and dates when approving. No extra fees are added.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inst-reason">Reason for the request</Label>
          <Textarea id="inst-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="e.g. I would like to pay in parts because…" />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">{busy ? "Sending…" : "Send request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
