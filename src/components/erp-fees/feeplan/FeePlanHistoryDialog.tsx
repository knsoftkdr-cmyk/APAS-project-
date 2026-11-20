import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HISTORY_LABELS, describeChange, type FeeHistoryEntry } from "@/lib/feePlan";
import { getApplicantFeePlan } from "@/lib/feePlanApi";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; applicantId: string | null; applicantName: string }

/** Append-only audit trail: who changed the fee plan, when, what changed and why. */
export function FeePlanHistoryDialog({ open, onOpenChange, applicantId, applicantName }: Props) {
  const [entries, setEntries] = useState<FeeHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !applicantId) return;
    let live = true;
    setEntries(null); setError(null);
    getApplicantFeePlan(applicantId).then((r) => { if (live) setEntries(r.history); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, applicantId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fee plan history</DialogTitle>
          <DialogDescription>{applicantName}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p>
          : entries === null ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
          : entries.length === 0 ? <p className="text-sm text-slate-500 py-4">No changes recorded yet.</p>
          : (
            <ol className="relative border-s border-slate-200 ms-2 space-y-4">
              {entries.map((h) => {
                const change = describeChange(h);
                return (
                  <li key={h.id} className="ms-4">
                    <span className={`absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white ${h.action === "error" || h.action === "no_match" ? "bg-amber-500" : "bg-[#12203a]"}`} aria-hidden />
                    <p className="text-sm font-medium text-slate-900">{HISTORY_LABELS[h.action] ?? h.action}{change && <span className="font-normal text-slate-600"> · {change}</span>}</p>
                    <p className="text-xs text-slate-500">{new Date(h.created_at).toLocaleString()} · {h.actor_name || "System"}</p>
                    {h.reason && <p className="mt-1 text-sm text-slate-700">{h.reason}</p>}
                  </li>
                );
              })}
            </ol>
          )}
      </DialogContent>
    </Dialog>
  );
}
