import { useEffect, useState } from "react";
import { AlertTriangle, Check, ShieldCheck, Smartphone } from "lucide-react";
import { GATEWAY_META, listGateways, type GatewayId, type GatewayInfo } from "@/lib/paymentGateways";

const ICONS: Record<GatewayId, typeof Smartphone> = { razorpay: Smartphone };

interface Props {
  schoolId: string | null | undefined;
  value: GatewayId | null;
  onChange: (g: GatewayId | null) => void;
  disabled?: boolean;
  /** compact = smaller cards (used above an instalment schedule) */
  compact?: boolean;
}

/** Shows the payment method (Razorpay) when the school has it switched ON and it is fully configured on the server. */
export function GatewayPicker({ schoolId, value, onChange, disabled, compact }: Props) {
  const [options, setOptions] = useState<GatewayInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!schoolId) return;
    setOptions(null); setError(null);
    listGateways(schoolId)
      .then((all) => { if (!alive) return; const ok = all.filter((g) => g.enabled && g.configured); setOptions(ok); onChange(ok.some((g) => g.id === value) ? value : ok[0]?.id ?? null); })
      .catch((e) => { if (alive) { setError((e as Error).message); onChange(null); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> Couldn't load payment methods: {error}</div>;
  if (!options) return <div className="h-20 rounded-xl bg-slate-100 animate-pulse" aria-label="Loading payment methods" />;
  if (options.length === 0) return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> Online payment isn't available right now. Please contact the school office.</div>;

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-semibold text-[#12203a] mb-2">Pay with</legend>
      <div role="radiogroup" aria-label="Payment method" className={`grid gap-2 ${compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
        {options.map((g) => {
          const Icon = ICONS[g.id]; const selected = value === g.id;
          return (
            <button key={g.id} type="button" role="radio" aria-checked={selected} onClick={() => onChange(g.id)}
              className={`relative flex items-center gap-3 rounded-xl border-2 text-start transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a227] ${compact ? "p-2.5" : "p-3.5"} ${selected ? "border-[#c9a227] bg-[#fffbe8] shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"} disabled:opacity-60`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-[#12203a] text-[#f0d060]" : "bg-slate-100 text-slate-600"}`}><Icon className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{GATEWAY_META[g.id].label}</span>
                <span className="block text-xs text-slate-500 leading-snug">{GATEWAY_META[g.id].tagline}</span>
              </span>
              {selected && <span className="ms-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#c9a227] text-white shrink-0"><Check className="h-3.5 w-3.5" aria-hidden /></span>}
            </button>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Payments are processed by the gateway; we never see or store your card details.</p>
    </fieldset>
  );
}
