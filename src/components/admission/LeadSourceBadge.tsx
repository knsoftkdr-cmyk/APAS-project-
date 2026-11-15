import { LEAD_SOURCE_LABELS } from "@/types/admission";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  meta: "bg-blue-50 text-blue-700 border-blue-200",
  google: "bg-red-50 text-red-700 border-red-200",
  zoho: "bg-amber-50 text-amber-700 border-amber-200",
  website: "bg-emerald-50 text-emerald-700 border-emerald-200",
  zapier: "bg-orange-50 text-orange-700 border-orange-200",
  make: "bg-violet-50 text-violet-700 border-violet-200",
};

/** Where a lead came from. `source` is the lead channel; `label` falls back to the channel name. */
export function LeadSourceBadge({ source, label, className }: { source: string; label?: string | null; className?: string }) {
  return (
    <span
      title={label ? `${LEAD_SOURCE_LABELS[source] ?? source} · ${label}` : undefined}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[source] ?? "bg-slate-50 text-slate-700 border-slate-200", className)}
    >
      {LEAD_SOURCE_LABELS[source] ?? source}
    </span>
  );
}
