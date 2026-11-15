import { Flame, Snowflake, Sun, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, CATEGORY_TONES, type LeadCategory, type LeadScore } from "@/lib/leadScoring";

const ICONS = { hot: Flame, warm: Sun, cold: Snowflake } as const;

/** Hot / Warm / Cold chip: icon + word + colour (never colour alone). */
export function CategoryChip({ category, className }: { category: LeadCategory; className?: string }) {
  const Icon = ICONS[category];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", CATEGORY_TONES[category].chip, className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

interface Props { score?: LeadScore | null; onClick?: () => void; name?: string; className?: string }

/** Score (0-100) with its category. Opens the score breakdown when clicked. */
export function LeadScoreBadge({ score, onClick, name, className }: Props) {
  if (!score) return <span className="text-xs text-muted-foreground" title="Score not calculated yet">—</span>;
  const tone = CATEGORY_TONES[score.category];
  const adjusted = score.override_score != null;
  const label = `Lead score ${score.score} out of 100, ${CATEGORY_LABELS[score.category]}${adjusted ? ", manually adjusted" : ""}${name ? ` for ${name}` : ""}. Show breakdown`;
  const body = (
    <>
      <span className={cn("text-lg font-bold tabular-nums leading-none", tone.ring)}>{score.score}</span>
      <span className="flex flex-col items-start gap-0.5">
        <CategoryChip category={score.category} />
        {adjusted && <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500"><PencilLine className="h-2.5 w-2.5" />adjusted</span>}
      </span>
    </>
  );
  const cls = cn("inline-flex items-center gap-2 rounded-lg px-1.5 py-1 text-start", onClick && "hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400", className);
  return onClick
    ? <button type="button" onClick={onClick} aria-label={label} className={cls}>{body}</button>
    : <span className={cls}>{body}</span>;
}
