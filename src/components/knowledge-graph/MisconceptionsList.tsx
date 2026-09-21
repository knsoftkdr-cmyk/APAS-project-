import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import type { Misconception } from "@/hooks/useKnowledgeGraph";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<string, string> = {
  high: "text-rose-600 border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-900",
  medium: "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-900",
  low: "text-slate-600 border-slate-200 bg-slate-50 dark:bg-slate-500/10 dark:border-slate-800",
};

export function MisconceptionsList({ misconceptions }: { misconceptions: Misconception[] }) {
  if (misconceptions.length === 0) {
    return <p className="text-sm text-muted-foreground">No misconceptions catalogued for this concept yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {misconceptions.map((m) => (
        <li key={m.id} className={cn("rounded-lg border p-3 text-sm", SEVERITY_STYLES[m.severity] ?? SEVERITY_STYLES.medium)}>
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{m.text}</p>
              {m.why && <p className="text-xs opacity-80">Why it happens: {m.why}</p>}
              {m.correction && <p className="text-xs opacity-80">Correction: {m.correction}</p>}
            </div>
            <Badge variant="outline" className="ml-auto shrink-0 capitalize text-[10px]">{m.severity}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
