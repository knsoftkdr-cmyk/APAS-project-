import { Check } from "lucide-react";
import { stageProgress } from "@/lib/approvalWorkflow";

export function ApprovalStepper({ status, currentStage, stages }: { status: string; currentStage: number; stages: { name: string }[] }) {
  const steps = stageProgress(status, currentStage, stages);
  const failed = status === "rejected" || status === "changes_requested";
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Approval progress">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold border
            ${s.state === "done" ? "bg-emerald-600 border-emerald-600 text-white"
              : s.state === "current" ? (failed ? "border-red-500 text-red-600" : "border-primary text-primary") : "border-muted-foreground/30 text-muted-foreground"}`}>
            {s.state === "done" ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={`text-xs ${s.state === "todo" ? "text-muted-foreground" : "font-medium"}`}>{s.name}</span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
