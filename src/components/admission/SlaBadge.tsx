import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLOCK_LABELS, SLA_LABELS, SLA_TONES, formatRemaining, slaStateAt, type SlaClock, type SlaClockKind, type SlaState } from "@/lib/admissionAssignment";

const ICONS: Record<SlaState, React.ElementType> = { on_track: CheckCircle2, due_soon: Clock, overdue: AlertTriangle };

/** State chip: icon + words + colour (never colour alone). */
export function SlaStateChip({ state, className }: { state: SlaState; className?: string }) {
  const Icon = ICONS[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", SLA_TONES[state], className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />{SLA_LABELS[state]}
    </span>
  );
}

interface Props { kind: SlaClockKind; clock: SlaClock | null; nowMs: number; className?: string }

/** One SLA clock: which clock, its state right now, and the time left (or how late). Renders nothing when no clock is running. */
export function SlaBadge({ kind, clock, nowMs, className }: Props) {
  if (!clock) return null;
  const state = slaStateAt(clock, nowMs) ?? clock.state;
  const remaining = formatRemaining(clock.due_at, nowMs);
  const due = new Date(clock.due_at).toLocaleString();
  const label = `${CLOCK_LABELS[kind]}: ${SLA_LABELS[state]}, ${remaining}. Due ${due}`;
  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)} title={label} aria-label={label} data-testid={`sla-${kind}`} data-state={state}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{CLOCK_LABELS[kind]}</span>
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <SlaStateChip state={state} />
        <span className={cn("text-xs tabular-nums", state === "overdue" ? "text-red-700 font-semibold" : "text-slate-600")}>{remaining}</span>
      </span>
    </span>
  );
}
