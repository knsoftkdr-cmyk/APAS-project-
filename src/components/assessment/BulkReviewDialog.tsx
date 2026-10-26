// src/components/assessment/BulkReviewDialog.tsx
//
// Bulk actions (sheet row 45) for Exam Reviews: confirm the AI marks on many answer sheets in one go - safely.
//   1. Preview: the server works out exactly what will change (answers with no AI mark are skipped, never guessed).
//   2. Confirm: the teacher ticks "I've checked this" before anything is written.
//   3. Undo: every batch can be rolled back for 24 hours (here, from the toast, or from "Recent batches").
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBulkBatches, useBulkReview, type BulkPreview } from "@/hooks/useExamReviews";

export function BulkReviewDialog({ open, onOpenChange, attemptIds, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; attemptIds: string[]; onDone: () => void;
}) {
  const bulk = useBulkReview();
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [checked, setChecked] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null); setError(null); setChecked(false); setFeedback("");
    setLoading(true);
    bulk.preview(attemptIds).then(setPreview).catch((e) => setError(e instanceof Error ? e.message : "Preview failed")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attemptIds.join(",")]);

  const undo = async (batchId: string) => {
    try {
      const r = await bulk.undo(batchId);
      toast.success(`Undone - ${r.restored} answer${r.restored === 1 ? "" : "s"} restored${r.not_restored ? ` (${r.not_restored} were re-marked since and kept)` : ""}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Undo failed"); }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await bulk.apply(attemptIds, feedback);
      onOpenChange(false);
      onDone();
      toast.success(`Confirmed ${r.changed} answer${r.changed === 1 ? "" : "s"} on ${r.attempts} sheet${r.attempts === 1 ? "" : "s"}`, {
        duration: 15000, action: { label: "Undo", onClick: () => undo(r.batch_id) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Accept AI marks for {attemptIds.length} answer sheet{attemptIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Nothing changes until you confirm. Answers the AI couldn't mark are skipped - you'll still need to mark those yourself.</DialogDescription>
        </DialogHeader>

        {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" />Checking what will change…</div>
          : error ? <p className="text-sm text-destructive">{error}</p>
          : preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <Stat label="Will be confirmed" value={preview.will_confirm} tone="text-emerald-700" />
                <Stat label="Skipped (no AI mark)" value={preview.will_skip} tone={preview.will_skip ? "text-amber-700" : ""} />
                <Stat label="Results become final" value={preview.becomes_final} />
                <Stat label="Not allowed" value={preview.denied} tone={preview.denied ? "text-red-700" : ""} />
              </div>
              <div className="rounded-md border divide-y max-h-60 overflow-y-auto text-sm">
                {preview.per_attempt.map((a) => (
                  <div key={a.attempt_id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="flex-1 truncate">{a.student} <span className="text-xs text-muted-foreground">· {a.exam}</span></span>
                    <span className="text-xs tabular-nums">{a.will_confirm}/{a.pending} answers · AI {a.ai_marks} marks</span>
                    {a.becomes_final ? <Badge variant="outline" className="text-[10px] text-emerald-700">Final</Badge>
                      : a.will_skip ? <Badge variant="outline" className="text-[10px] text-amber-700">Needs you</Badge> : null}
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium">Feedback for these answers (optional - otherwise the AI's feedback is kept)</label>
                <Textarea rows={2} className="mt-1" maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Good attempt - see the model answer for the full method." />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                I've checked this preview. Confirm {preview.will_confirm} answer{preview.will_confirm === 1 ? "" : "s"} with the AI's marks (can be undone for 24 hours).
              </label>
            </div>
          )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!preview || !checked || !preview.will_confirm || applying} className="gap-1.5">
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirm {preview?.will_confirm ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-md border p-2"><p className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>;
}

/** The caller's recent batches with an Undo button (24 h window). */
export function RecentBatchesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading, refetch } = useBulkBatches(open);
  const bulk = useBulkReview();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />Recent bulk actions</DialogTitle></DialogHeader>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : !data?.length ? <p className="text-sm text-muted-foreground">No bulk actions yet.</p> : (
          <div className="space-y-2">
            {data.map((b) => (
              <div key={b.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <div className="flex-1">
                  <p>Accepted AI marks · {b.changed} answers on {b.attempts} sheets{b.skipped ? ` · ${b.skipped} skipped` : ""}</p>
                  <p className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString()}{b.undone_at ? " · undone" : ""}</p>
                </div>
                {b.can_undo ? (
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy === b.id} onClick={async () => {
                    setBusy(b.id);
                    try { const r = await bulk.undo(b.id); toast.success(`Undone - ${r.restored} restored`); await refetch(); }
                    catch (e) { toast.error(e instanceof Error ? e.message : "Undo failed"); }
                    finally { setBusy(null); }
                  }}><Undo2 className="h-3.5 w-3.5" />Undo</Button>
                ) : b.undone_at ? null : <span className="text-[11px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />over 24 h</span>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
