import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";
import type { AdmissionIntake } from "@/types/admission";
import {
  callIntegrationApi, LEAD_PROVIDER_HINTS, LEAD_PROVIDER_LABELS, PROVIDER_CREDENTIALS, ZOHO_DATA_CENTRES,
  type AdmissionIntegration, type LeadProvider,
} from "@/lib/admissionIntegrations";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intakes: AdmissionIntake[];
  /** When set, edits this integration; otherwise creates one. */
  editing?: AdmissionIntegration | null;
  onSaved: (result: { integration: AdmissionIntegration; generated?: Record<string, string>; created: boolean }) => void;
}

const PROVIDERS = Object.keys(LEAD_PROVIDER_LABELS) as LeadProvider[];
const splitList = (v: string) => v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

export function IntegrationFormDialog({ open, onOpenChange, intakes, editing, onSaved }: Props) {
  const { toast } = useToast();
  const [provider, setProvider] = useState<LeadProvider>("meta");
  const [name, setName] = useState("");
  const [intakeId, setIntakeId] = useState<string>("none");
  const [emails, setEmails] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [pageId, setPageId] = useState("");
  const [formIds, setFormIds] = useState("");
  const [zohoDc, setZohoDc] = useState("com");
  const [origins, setOrigins] = useState("");
  const [redirect, setRedirect] = useState("");
  const [followUpHours, setFollowUpHours] = useState("24");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = editing?.config ?? {};
    setProvider(editing?.provider ?? "meta");
    setName(editing?.name ?? "");
    setIntakeId(editing?.default_intake_id ?? "none");
    setEmails((editing?.notify_emails ?? []).join(", "));
    setCreds({});
    setPageId(c.page_id ?? "");
    setFormIds((c.form_ids ?? []).join(", "));
    setZohoDc(c.zoho_dc ?? "com");
    setOrigins((c.allowed_origins ?? []).join(", "));
    setRedirect(c.success_redirect ?? "");
    setFollowUpHours(String(c.followup_hours ?? 24));
  }, [open, editing]);

  const fields = PROVIDER_CREDENTIALS[provider];
  const isEdit = !!editing;

  const submit = async () => {
    if (!name.trim()) { toast({ title: "Give this integration a name", variant: "destructive" }); return; }
    const config: Record<string, unknown> = { followup_hours: Number(followUpHours) || 24 };
    if (provider === "meta") { config.page_id = pageId.trim(); config.form_ids = splitList(formIds); }
    if (provider === "google") config.form_ids = splitList(formIds);
    if (provider === "zoho") config.zoho_dc = zohoDc;
    if (provider === "website") { config.allowed_origins = splitList(origins); config.success_redirect = redirect.trim(); }
    // Only this provider's fields: values typed for a previously selected provider must never be sent.
    const allowed = new Set(fields.map((f) => f.key));
    const credentials = Object.fromEntries(Object.entries(creds).filter(([k, v]) => allowed.has(k) && v.trim()));
    setSaving(true);
    try {
      const common = { name: name.trim(), default_intake_id: intakeId === "none" ? null : intakeId, notify_emails: splitList(emails), config, credentials };
      const res = isEdit
        ? await callIntegrationApi("update", { id: editing!.id, ...common })
        : await callIntegrationApi("create", { provider, ...common });
      toast({ title: isEdit ? "Integration updated" : "Integration created" });
      onSaved({ integration: res.integration, generated: res.generated, created: !isEdit });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not save integration", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${editing!.name}` : "Add lead integration"}</DialogTitle>
          <DialogDescription>
            Enquiries from this source are added to Applicants automatically, de-duplicated, and your admissions team is notified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={provider} onValueChange={(v) => { setProvider(v as LeadProvider); setCreds({}); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>{LEAD_PROVIDER_LABELS[p]} — {LEAD_PROVIDER_HINTS[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="int-name">Name</Label>
            <Input id="int-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${LEAD_PROVIDER_LABELS[provider]} – 2027 admissions`} />
          </div>

          <div className="space-y-1.5">
            <Label>Default intake</Label>
            <Select value={intakeId} onValueChange={setIntakeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — only use the grade the parent selects</SelectItem>
                {intakes.map((i) => <SelectItem key={i.id} value={i.id}>{i.grade} · {i.academic_year}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used when the form has no grade, or the grade doesn’t match an open intake. Without one, such leads wait in the activity log for review instead of being lost.</p>
          </div>

          {provider === "meta" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="int-page">Facebook Page ID</Label>
                <Input id="int-page" inputMode="numeric" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="e.g. 104857392011234" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-forms">Only these form IDs (optional)</Label>
                <Input id="int-forms" value={formIds} onChange={(e) => setFormIds(e.target.value)} placeholder="Leave empty for all forms on the Page" />
              </div>
            </>
          )}
          {provider === "google" && (
            <div className="space-y-1.5">
              <Label htmlFor="int-forms">Only these form IDs (optional)</Label>
              <Input id="int-forms" value={formIds} onChange={(e) => setFormIds(e.target.value)} placeholder="Leave empty to accept every lead form" />
            </div>
          )}
          {provider === "zoho" && (
            <div className="space-y-1.5">
              <Label>Zoho data centre</Label>
              <Select value={zohoDc} onValueChange={setZohoDc}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ZOHO_DATA_CENTRES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {provider === "website" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="int-origins">Allowed website addresses</Label>
                <Input id="int-origins" value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://www.myschool.edu" />
                <p className="text-xs text-muted-foreground">Only forms on these sites can submit. Recommended.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="int-redirect">Thank-you page (optional)</Label>
                <Input id="int-redirect" value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="https://www.myschool.edu/thank-you" />
              </div>
            </>
          )}

          {fields.length > 0 && (
            <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> API credentials
              </div>
              <p className="text-xs text-muted-foreground">Stored encrypted on the server. They can’t be viewed again — leave a field blank to keep the saved value.</p>
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`cred-${f.key}`}>{f.label}</Label>
                  <Input id={`cred-${f.key}`} type="password" autoComplete="off" value={creds[f.key] ?? ""}
                    onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={isEdit ? "•••••••• saved" : ""} />
                  <p className="text-[11px] text-muted-foreground">{f.help}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="int-emails">Also email new leads to</Label>
              <Input id="int-emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="admissions@myschool.edu" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="int-fu">First follow-up due within (hours)</Label>
              <Input id="int-fu" type="number" min={1} max={720} value={followUpHours} onChange={(e) => setFollowUpHours(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Principals and admins always get an in-app notification.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}
            {isEdit ? "Save changes" : "Create integration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
