import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, BookOpen, Loader2, Pause, Pencil, Play, Plug, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import type { AdmissionIntake } from "@/types/admission";
import { useAdmissionIntegrations } from "@/hooks/useAdmissionIntegrations";
import { callIntegrationApi, LEAD_PROVIDER_LABELS, type AdmissionIntegration } from "@/lib/admissionIntegrations";
import { LeadSourceBadge } from "./LeadSourceBadge";
import { IntegrationFormDialog } from "./IntegrationFormDialog";
import { IntegrationSetupDialog } from "./IntegrationSetupDialog";
import { IntegrationActivityDialog } from "./IntegrationActivityDialog";

const STATUS_BADGE = { active: { v: "success", t: "Connected" }, paused: { v: "warning", t: "Paused" }, error: { v: "danger", t: "Needs attention" } } as const;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function IntegrationsPanel({ intakes, onLeadsChanged }: { intakes: AdmissionIntake[]; onLeadsChanged?: () => void }) {
  const { toast } = useToast();
  const { integrations, loading, error, canManage, refetch } = useAdmissionIntegrations();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdmissionIntegration | null>(null);
  const [setup, setSetup] = useState<{ integration: AdmissionIntegration; generated?: Record<string, string> | null } | null>(null);
  const [activity, setActivity] = useState<AdmissionIntegration | null>(null);
  const [deleting, setDeleting] = useState<AdmissionIntegration | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast({ title: "Something went wrong", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const test = (i: AdmissionIntegration) => run(`test-${i.id}`, async () => {
    const r = await callIntegrationApi("test", { id: i.id });
    toast({ title: r.ok ? "Connection OK" : "Connection problem", description: r.message, variant: r.ok ? "default" : "destructive" });
    await refetch();
  });
  const subscribe = (i: AdmissionIntegration) => run(`sub-${i.id}`, async () => {
    const r = await callIntegrationApi("subscribe", { id: i.id });
    toast({ title: r.ok ? "Subscribed" : "Could not subscribe", description: r.message, variant: r.ok ? "default" : "destructive" });
  });
  const sync = (i: AdmissionIntegration) => run(`sync-${i.id}`, async () => {
    const r = await callIntegrationApi("sync", { id: i.id });
    toast(r.ok
      ? { title: "Zoho sync complete", description: `${r.created} new, ${r.duplicate + r.idempotent} already in APAS${r.failed + r.needs_review ? `, ${r.failed + r.needs_review} need attention` : ""}.` }
      : { title: "Zoho sync failed", description: r.message, variant: "destructive" });
    await refetch(); onLeadsChanged?.();
  });
  const toggle = (i: AdmissionIntegration) => run(`tog-${i.id}`, async () => {
    await callIntegrationApi("update", { id: i.id, status: i.status === "paused" ? "active" : "paused" });
    await refetch();
  });
  const remove = (i: AdmissionIntegration) => run(`del-${i.id}`, async () => {
    await callIntegrationApi("delete", { id: i.id });
    toast({ title: "Integration deleted", description: "Leads already received stay in Applicants." });
    setDeleting(null); await refetch();
  });

  if (loading) return <LoadingSpinner />;
  if (error === "not_installed") {
    return <EmptyState icon={Plug} title="Integrations aren’t set up on this server yet" description="Ask your platform administrator to apply the database migration 20261113000000_admission_lead_integrations.sql." />;
  }
  if (error) return <EmptyState icon={AlertTriangle} title="Could not load integrations" description={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Collect enquiries automatically from Meta (Facebook &amp; Instagram) Lead Ads, Google Lead Forms, Zoho CRM, your website, Zapier and Make.
          Each one becomes an applicant, repeats are merged, and your team is notified.
        </p>
        {canManage && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-4 w-4 me-1.5" />Add integration</Button>
        )}
      </div>

      {integrations.length === 0 ? (
        <EmptyState icon={Plug} title="No integrations yet"
          description={canManage ? "Add your first lead source to start receiving admission enquiries automatically." : "Ask a school administrator to connect a lead source."} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {integrations.map((i) => {
            const st = STATUS_BADGE[i.status];
            const attention = i.leads_failed > 0 && i.last_error;
            return (
              <Card key={i.id} className="border-slate-200 shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{i.name}</div>
                      <div className="mt-1 flex items-center gap-2"><LeadSourceBadge source={i.provider} /><span className="text-xs text-muted-foreground">{LEAD_PROVIDER_LABELS[i.provider]}</span></div>
                    </div>
                    <StatusBadge variant={st.v}>{st.t}</StatusBadge>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[["Received", i.leads_received], ["Leads", i.leads_created], ["Repeats", i.leads_duplicate], ["Failed", i.leads_failed]].map(([l, v]) => (
                      <div key={l as string} className="rounded-md bg-slate-50 py-1.5">
                        <div className={`text-base font-bold ${l === "Failed" && (v as number) > 0 ? "text-red-600" : "text-slate-800"}`}>{v}</div>
                        <div className="text-[10px] text-muted-foreground">{l}</div>
                      </div>
                    ))}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Last lead: {ago(i.last_success_at)}{i.provider === "zoho" && <> · Last sync: {ago(i.last_sync_at)}</>}
                  </div>
                  {attention && (
                    <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span className="break-words">{i.last_error} <span className="opacity-70">({ago(i.last_error_at)})</span></span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setSetup({ integration: i })}><BookOpen className="h-3.5 w-3.5 me-1" />Setup</Button>
                    <Button size="sm" variant="outline" onClick={() => setActivity(i)}><Activity className="h-3.5 w-3.5 me-1" />Activity</Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === `test-${i.id}`} onClick={() => test(i)}>
                          {busy === `test-${i.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin me-1" /> : <Zap className="h-3.5 w-3.5 me-1" />}Test
                        </Button>
                        {i.provider === "meta" && <Button size="sm" variant="outline" disabled={busy === `sub-${i.id}`} onClick={() => subscribe(i)}>Subscribe Page</Button>}
                        {i.provider === "zoho" && (
                          <Button size="sm" variant="outline" disabled={busy === `sync-${i.id}` || i.status === "paused"} onClick={() => sync(i)}>
                            {busy === `sync-${i.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin me-1" /> : <RefreshCw className="h-3.5 w-3.5 me-1" />}Sync now
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(i); setFormOpen(true); }}><Pencil className="h-3.5 w-3.5 me-1" />Edit</Button>
                        <Button size="sm" variant="ghost" disabled={busy === `tog-${i.id}`} onClick={() => toggle(i)}>
                          {i.status === "paused" ? <><Play className="h-3.5 w-3.5 me-1" />Resume</> : <><Pause className="h-3.5 w-3.5 me-1" />Pause</>}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setDeleting(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <IntegrationFormDialog
        open={formOpen} onOpenChange={setFormOpen} intakes={intakes} editing={editing}
        onSaved={async ({ integration, generated, created }) => { await refetch(); if (created) setSetup({ integration, generated }); }}
      />
      <IntegrationSetupDialog
        integration={setup?.integration ?? null} generated={setup?.generated} canManage={canManage}
        onClose={() => setSetup(null)} onRotated={(g) => setSetup((s) => (s ? { ...s, generated: g } : s))}
      />
      <IntegrationActivityDialog integration={activity} canManage={canManage} onClose={() => setActivity(null)} onChanged={() => { void refetch(); onLeadsChanged?.(); }} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              New enquiries from this source will stop arriving and its saved credentials are erased. Applicants already received stay in your CRM.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove(deleting)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
