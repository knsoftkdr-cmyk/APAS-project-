import { ACTION_LABEL } from "@/lib/approvalWorkflow";
import type { HistoryEntry } from "@/hooks/useApprovalWorkflow";
import { StatusPill } from "./StatusPill";

/** Read-only audit trail, oldest first. The data comes from an append-only table. */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No approval activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-s ps-5" aria-label="Approval history">
      {entries.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -start-[1.65rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
            {h.to_status && h.from_status !== h.to_status && <StatusPill status={h.to_status} />}
            {h.version ? <span className="text-xs text-muted-foreground">v{h.version}</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {h.actor_name ?? "Someone"}{h.actor_role ? ` (${h.actor_role})` : ""} · {new Date(h.created_at).toLocaleString()}
            {h.stage ? ` · stage ${h.stage}` : ""}
          </p>
          {(h.reason || h.comment) && <p className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{h.reason ?? h.comment}</p>}
        </li>
      ))}
    </ol>
  );
}
