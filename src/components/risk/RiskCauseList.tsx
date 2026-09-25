import { AlertTriangle, CircleAlert, CircleCheck, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAUSE_LABELS } from "./RiskBadge";
import type { RiskCause } from "@/hooks/useStudentRisk";

const STRENGTH_ICON: Record<string, typeof AlertTriangle> = {
  strong: AlertTriangle,
  moderate: CircleAlert,
  none: CircleCheck,
  insufficient_data: HelpCircle,
  unavailable: HelpCircle,
};

const STRENGTH_COLOR: Record<string, string> = {
  strong: "text-red-600 dark:text-red-400",
  moderate: "text-amber-600 dark:text-amber-400",
  none: "text-emerald-600 dark:text-emerald-400",
  insufficient_data: "text-muted-foreground",
  unavailable: "text-muted-foreground",
};

/** Renders the four early-warning causes (module 13) with icon + explanation. */
export function RiskCauseList({ causes, className }: { causes: RiskCause[]; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {causes.map((cause) => {
        const Icon = STRENGTH_ICON[cause.evidence_strength] ?? HelpCircle;
        const color = STRENGTH_COLOR[cause.evidence_strength] ?? "text-muted-foreground";
        return (
          <div key={cause.cause_type} className="flex items-start gap-2.5">
            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", color)} />
            <div>
              <p className="text-sm font-medium">{CAUSE_LABELS[cause.cause_type] ?? cause.cause_type}</p>
              <p className="text-xs text-muted-foreground">{cause.explanation}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
