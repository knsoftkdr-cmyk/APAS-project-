import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { callIntegrationApi, LEAD_PROVIDER_LABELS, webhookUrl, type AdmissionIntegration } from "@/lib/admissionIntegrations";

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="flex items-center gap-2">
        <code className={`flex-1 min-w-0 rounded-md border bg-slate-50 px-2.5 py-1.5 text-xs break-all ${secret ? "border-amber-300 bg-amber-50" : ""}`}>{value}</code>
        <Button size="sm" variant="outline" className="shrink-0" aria-label={`Copy ${label}`}
          onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal ps-5 space-y-1.5 text-sm text-slate-700">{children}</ol>;
}

interface Props {
  integration: AdmissionIntegration | null;
  /** Secrets that were just generated; shown once. */
  generated?: Record<string, string> | null;
  canManage: boolean;
  onClose: () => void;
  onRotated: (generated: Record<string, string>) => void;
}

export function IntegrationSetupDialog({ integration, generated, canManage, onClose, onRotated }: Props) {
  const { toast } = useToast();
  const [rotating, setRotating] = useState(false);
  if (!integration) return null;
  const url = webhookUrl(integration.webhook_token);
  const p = integration.provider;
  const hasSecret = p === "meta" || p === "google" || p === "zoho" || p === "zapier" || p === "make";

  const rotate = async () => {
    if (!confirm("Generate a new secret? The old one stops working immediately, so you must update it in the source platform.")) return;
    setRotating(true);
    try {
      const res = await callIntegrationApi("rotate", { id: integration.id, what: "secret" });
      onRotated(res.generated ?? {});
      toast({ title: "New secret generated" });
    } catch (e) {
      toast({ title: "Could not rotate secret", description: (e as Error).message, variant: "destructive" });
    } finally { setRotating(false); }
  };

  const origin = (integration.config.allowed_origins?.[0] as string | undefined) ?? "https://your-school-site";

  return (
    <Dialog open={!!integration} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect {LEAD_PROVIDER_LABELS[p]}</DialogTitle>
          <DialogDescription>{integration.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <CopyField label={p === "meta" ? "Callback URL" : "Webhook URL"} value={url} />

          {generated && Object.keys(generated).length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3">
              <div className="flex items-start gap-2 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Copy these now. For security they are shown only once — if you lose one, generate a new one.</span>
              </div>
              {generated.verify_token && <CopyField label="Verify token" value={generated.verify_token} secret />}
              {generated.google_key && <CopyField label="Google key" value={generated.google_key} secret />}
              {generated.api_key && <CopyField label="API key" value={generated.api_key} secret />}
            </div>
          )}

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-sm font-semibold text-slate-800">Setup steps</div>
            {p === "meta" && (
              <Steps>
                <li>In <b>Meta for Developers</b>, open your app → <b>Webhooks</b> → choose <b>Page</b> and click <b>Subscribe to this object</b>.</li>
                <li>Paste the <b>Callback URL</b> and <b>Verify token</b> above, then verify. Subscribe to the <b>leadgen</b> field.</li>
                <li>Save the Page ID and credentials here, then use <b>Subscribe Page</b> on the integration card and <b>Test connection</b>.</li>
                <li>Create a lead in Meta’s <b>Lead Ads Testing Tool</b> to see it arrive in Applicants.</li>
              </Steps>
            )}
            {p === "google" && (
              <Steps>
                <li>In <b>Google Ads</b>, open your lead form asset → <b>Lead delivery</b> → <b>Webhook integration</b>.</li>
                <li>Paste the <b>Webhook URL</b> and the <b>Google key</b> above, then click <b>Send test data</b>.</li>
                <li>Test data is recognised and does not create an applicant. Real leads appear in Applicants within seconds.</li>
              </Steps>
            )}
            {p === "zoho" && (
              <Steps>
                <li>To <b>receive</b> leads instantly: in Zoho CRM add a <b>Workflow Rule → Webhook</b> (module <i>Leads</i>, on create) with the Webhook URL above, method <b>POST</b>, and the header <code>x-api-key: &lt;API key&gt;</code>. Send fields such as Last_Name, Phone, Email and your student / grade fields.</li>
                <li>To <b>pull</b> leads, save the OAuth credentials and use <b>Sync now</b> on the integration card (first sync imports the last 7 days; it is safe to re-run).</li>
                <li>Use <b>Test connection</b> to verify the credentials.</li>
              </Steps>
            )}
            {(p === "zapier" || p === "make") && (
              <Steps>
                <li>Add a <b>{p === "zapier" ? "Webhooks by Zapier → POST" : "HTTP → Make a request"}</b> step as the last step of your {p === "zapier" ? "Zap" : "scenario"}.</li>
                <li>URL: the Webhook URL above. Method <b>POST</b>, payload type <b>JSON</b>. Add header <code>x-api-key</code> with the API key.</li>
                <li>Map fields: <code>name</code> (parent), <code>child_name</code>, <code>phone</code>, <code>email</code>, <code>class</code>. Add an <code>id</code> field to prevent repeats on retries.</li>
              </Steps>
            )}
            {p === "website" && (
              <>
                <Steps>
                  <li>Point your enquiry form at the Webhook URL (below). Required: a parent <code>phone</code> or <code>email</code>.</li>
                  <li>Recognised field names: <code>name</code>, <code>child_name</code>, <code>phone</code>, <code>email</code>, <code>class</code>, <code>message</code> (plus <code>utm_*</code> tags).</li>
                  <li>Add the hidden <code>_hp</code> field to block bots. List your site under <b>Allowed website addresses</b>.</li>
                </Steps>
                <pre className="mt-2 rounded-md bg-slate-900 text-slate-100 text-[11px] p-3 overflow-x-auto">{`<form method="POST" action="${url}">
  <input name="name" placeholder="Parent name" required>
  <input name="child_name" placeholder="Student name" required>
  <input name="phone" placeholder="Phone" required>
  <input name="email" type="email" placeholder="Email">
  <input name="class" placeholder="Class applying for">
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button>Enquire</button>
</form>
<!-- posted from ${origin} -->`}</pre>
              </>
            )}
          </div>

          {canManage && hasSecret && p !== "zoho" && (
            <Button variant="outline" size="sm" onClick={rotate} disabled={rotating}>
              {rotating ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <KeyRound className="h-4 w-4 me-1.5" />}
              Generate new secret
            </Button>
          )}
          {canManage && p === "zoho" && (
            <Button variant="outline" size="sm" onClick={rotate} disabled={rotating}>
              {rotating ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <KeyRound className="h-4 w-4 me-1.5" />}
              Generate new API key
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
