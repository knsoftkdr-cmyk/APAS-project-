import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatusBadge } from "@/components/StatusBadge";
import { Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useIntegrationActivity } from "@/hooks/useAdmissionIntegrations";
import { callIntegrationApi, type AdmissionIntegration, type LeadIngestion } from "@/lib/admissionIntegrations";

const STATUS: Record<LeadIngestion["status"], { label: string; variant: "success" | "warning" | "danger" | "info" }> = {
  created: { label: "Lead created", variant: "success" },
  duplicate: { label: "Matched existing", variant: "info" },
  failed: { label: "Failed", variant: "danger" },
  needs_review: { label: "Needs review", variant: "warning" },
  test: { label: "Test", variant: "info" },
  rejected: { label: "Rejected", variant: "warning" },
};

interface Props { integration: AdmissionIntegration | null; canManage: boolean; onClose: () => void; onChanged: () => void }

export function IntegrationActivityDialog({ integration, canManage, onClose, onChanged }: Props) {
  const { toast } = useToast();
  const { rows, loading, refetch } = useIntegrationActivity(integration?.id ?? null, !!integration);
  const [retrying, setRetrying] = useState<string | null>(null);

  const retry = async (ingestionId?: string) => {
    if (!integration) return;
    setRetrying(ingestionId ?? "all");
    try {
      const r = await callIntegrationApi("retry", { id: integration.id, ingestion_id: ingestionId });
      toast({ title: "Retry finished", description: `${r.created ?? 0} created, ${r.duplicate ?? 0} matched existing, ${(r.failed ?? 0) + (r.needs_review ?? 0)} still need attention.` });
      await refetch(); onChanged();
    } catch (e) {
      toast({ title: "Retry failed", description: (e as Error).message, variant: "destructive" });
    } finally { setRetrying(null); }
  };

  const retryable = rows.filter((r) => r.status === "failed" || r.status === "needs_review");

  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Activity — {integration?.name}</DialogTitle>
          <DialogDescription>The last 50 deliveries. Contact details are masked.</DialogDescription>
        </DialogHeader>
        {canManage && retryable.length > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <span>{retryable.length} delivery(ies) need attention. After fixing the cause (e.g. open an intake, renew a token) retry them.</span>
            <Button size="sm" variant="outline" onClick={() => retry()} disabled={!!retrying}>
              {retrying === "all" ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <RotateCw className="h-4 w-4 me-1.5" />}Retry all
            </Button>
          </div>
        )}
        {loading ? <LoadingSpinner /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nothing received yet. Send a test submission from the source platform.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.id} className="p-3 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</StatusBadge>
                    <span className="font-medium">{r.summary?.student ?? "—"}</span>
                    {r.summary?.grade && <span className="text-muted-foreground">· {r.summary.grade}</span>}
                    {r.summary?.phone && <span className="text-xs text-muted-foreground">{r.summary.phone}</span>}
                  </div>
                  {r.error && <p className="text-xs text-red-600 mt-1 break-words">{r.error}</p>}
                  <p className="text-[11px] text-muted-foreground mt-0.5">{new Date(r.received_at).toLocaleString()}</p>
                </div>
                {canManage && (r.status === "failed" || r.status === "needs_review") && (
                  <Button size="sm" variant="ghost" onClick={() => retry(r.id)} disabled={!!retrying}>
                    {retrying === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
