import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { ReadinessResult } from "@/hooks/useKnowledgeGraph";
import { cn } from "@/lib/utils";

export function PrerequisiteReadinessCard({ readiness }: { readiness: ReadinessResult }) {
  if (readiness.prerequisite_count === 0) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> No prerequisites — clear to start.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className={cn(
        "flex items-center gap-1.5 text-xs font-medium",
        readiness.is_ready ? "text-emerald-600" : "text-rose-600",
      )}>
        {readiness.is_ready
          ? <><CheckCircle2 className="h-3.5 w-3.5" /> Prerequisites look solid</>
          : <><AlertTriangle className="h-3.5 w-3.5" /> Prerequisite gap detected</>}
        <span className="text-muted-foreground font-normal">({Math.round(readiness.readiness_score * 100)}% readiness)</span>
      </div>
      <ul className="space-y-1.5">
        {readiness.prerequisites.map((p) => (
          <li key={p.subtopic_id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-muted-foreground">{p.name}</span>
            {!p.attempted ? (
              <span className="text-muted-foreground">not assessed</span>
            ) : (
              <span className={p.p_mastery < 0.5 ? "text-rose-600" : "text-emerald-600"}>
                {Math.round(p.p_mastery * 100)}%
              </span>
            )}
            <Progress value={p.attempted ? p.p_mastery * 100 : 0} className="w-16 h-1.5" />
          </li>
        ))}
      </ul>
    </div>
  );
}
