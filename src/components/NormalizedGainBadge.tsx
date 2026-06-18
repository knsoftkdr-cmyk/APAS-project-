import { cn } from "@/lib/utils";

interface NormalizedGainBadgeProps {
  gain: number;
  className?: string;
  showValue?: boolean;
}

function getGainInfo(g: number) {
  if (g >= 0.7) return { label: "High Gain 🟢", variant: "success" as const, color: "text-success bg-success/15" };
  if (g >= 0.3) return { label: "Medium Gain 🟡", variant: "warning" as const, color: "text-warning bg-warning/15" };
  return { label: "Low Gain 🔴", variant: "danger" as const, color: "text-danger bg-danger/15" };
}

export function NormalizedGainBadge({ gain, className, showValue = true }: NormalizedGainBadgeProps) {
  const info = getGainInfo(gain);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", info.color, className)}>
      {showValue && <span className="font-bold">{gain.toFixed(3)}</span>}
      {info.label}
    </span>
  );
}

export { getGainInfo };
