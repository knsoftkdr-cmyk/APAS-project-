import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { fetchGatewaySettings, GATEWAY_META, GATEWAY_ORDER, listGateways, saveGatewaySettings, type GatewayId, type GatewayInfo } from "@/lib/paymentGateways";
import { PaymentHistoryList } from "./PaymentHistoryList";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "https://<your-project>.supabase.co";

/** ERP Fees > Payment Gateways: which gateways parents may use, whether the server has its credentials, and the unified transactions. */
export function PaymentGatewaysAdminTab({ schoolId, view }: { schoolId: string; view: "gateways" | "transactions" }) {
  const { toast } = useToast();
  const [state, setState] = useState<Record<GatewayId, boolean> | null>(null);
  const [info, setInfo] = useState<GatewayInfo[] | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [saving, setSaving] = useState<GatewayId | null>(null);

  const load = useCallback(async () => {
    try { setState(await fetchGatewaySettings(schoolId)); } catch (e) { toast({ title: "Couldn't load gateway settings", description: (e as Error).message, variant: "destructive" }); }
    try { setInfo(await listGateways(schoolId)); setInfoError(null); } catch (e) { setInfoError((e as Error).message); }
  }, [schoolId, toast]);
  useEffect(() => { if (view === "gateways") void load(); }, [load, view]);

  const toggle = async (g: GatewayId, on: boolean) => {
    if (!state) return;
    const next = { ...state, [g]: on };
    setSaving(g);
    try {
      await saveGatewaySettings(schoolId, next);   // saves all four so a school's first change can't silently drop Razorpay
      setState(next);
      toast({ title: `${GATEWAY_META[g].label} ${on ? "enabled" : "disabled"}`, description: Object.values(next).some(Boolean) ? undefined : "No gateway is enabled - parents can't pay online until you enable one." });
    } catch (e) { toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" }); }
    finally { setSaving(null); }
  };
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast({ title: "Copied" }); } catch { toast({ title: "Copy failed", variant: "destructive" }); } };

  if (view === "transactions") return <PaymentHistoryList schoolId={schoolId} admin />;
  if (!state) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">Choose which payment gateways parents can use for school fees and instalments. Credentials are stored as Supabase secrets on the server - they are never shown or saved here.</p>
      {infoError && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> Couldn't check which gateways are configured on the server: {infoError}</div>}
      {!Object.values(state).some(Boolean) && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2"><ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" /> No gateway is enabled. Parents cannot pay online.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {GATEWAY_ORDER.map((g) => {
          const meta = GATEWAY_META[g]; const i = info?.find((x) => x.id === g); const configured = i?.configured === true;
          return (
            <section key={g} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" aria-label={meta.label}>
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[#12203a]">{meta.label}</h3>
                  <p className="text-xs text-slate-500">{meta.tagline}</p>
                </div>
                <div className="ms-auto flex items-center gap-2">
                  <span className={`text-xs font-medium ${state[g] ? "text-emerald-700" : "text-slate-500"}`}>{state[g] ? "Enabled" : "Disabled"}</span>
                  <Switch checked={state[g]} disabled={saving === g || (!state[g] && !configured)} onCheckedChange={(v) => void toggle(g, v)} aria-label={`${state[g] ? "Disable" : "Enable"} ${meta.label}`} />
                </div>
              </div>
              {i && (configured
                ? <p className="flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Server credentials found</p>
                : <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
                    <p className="font-medium text-slate-700 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Not set up on the server yet - it can't be enabled.</p>
                    <p className="text-slate-600">Add these Supabase secrets: <code className="break-words">{meta.secrets.join(", ")}</code></p>
                    {i.missing && i.missing.length > 0 && <p className="text-slate-500">Missing: <code>{i.missing.join(", ")}</code></p>}
                  </div>)}
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer font-medium text-slate-700">Webhook setup</summary>
                <div className="mt-2 space-y-1.5">
                  <p>Webhook URL (paste into the {meta.label} dashboard):</p>
                  <div className="flex items-center gap-2"><code className="flex-1 break-all rounded bg-slate-100 px-2 py-1">{meta.webhook(SUPABASE_URL)}</code><Button type="button" size="sm" variant="outline" onClick={() => void copy(meta.webhook(SUPABASE_URL))} aria-label="Copy webhook URL"><Copy className="h-3.5 w-3.5" /></Button></div>
                  <p>Events: {meta.events}</p>
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
