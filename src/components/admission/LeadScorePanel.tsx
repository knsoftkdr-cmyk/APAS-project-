import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { Info, Loader2, PencilLine, Undo2 } from "lucide-react";
import { CategoryChip } from "./LeadScoreBadge";
import { clearScoreOverride, setScoreOverride, useScoreHistory } from "@/hooks/useLeadScores";
import {
  CATEGORY_RANGES, CATEGORY_TONES, FACTOR_ORDER, TRIGGER_LABELS, scoreCategory,
  type LeadScore, type ScoreFactor,
} from "@/lib/leadScoring";

const when = (iso: string) => new Date(iso).toLocaleString();

function FactorCard({ f }: { f: ScoreFactor }) {
  const pct = f.score ?? 0;
  const band = scoreCategory(Math.round(pct));
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800">{f.label}</div>
          <div className="text-[11px] text-muted-foreground">Weight {f.weight}%</div>
        </div>
        {f.available ? (
          <div className="text-end">
            <div className="text-sm font-bold tabular-nums">{Math.round(pct)}<span className="text-xs font-normal text-muted-foreground">/100</span></div>
            <div className="text-[11px] text-muted-foreground">adds {f.contribution?.toFixed(1)} pts</div>
          </div>
        ) : (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">No data yet</span>
        )}
      </div>
      {f.available ? (
        <>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${f.label}: ${Math.round(pct)} out of 100`}>
            <div className={`h-full rounded-full ${CATEGORY_TONES[band].bar}`} style={{ width: `${pct}%` }} />
          </div>
          <ul className="space-y-1">
            {f.signals.map((s) => (
              <li key={s.key} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-slate-600 break-words">{s.label}: <span className="text-slate-800">{s.detail}</span></span>
                <span className="tabular-nums text-slate-500 shrink-0">{Math.round(s.score)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing recorded yet, so this factor is left out instead of being counted as zero.</p>
      )}
    </div>
  );
}

interface Props { applicantId: string; score: LeadScore | null; onChanged: () => void }

export function LeadScorePanel({ applicantId, score, onChanged }: Props) {
  const { toast } = useToast();
  const { rows, names, loading, refetch } = useScoreHistory(applicantId, true);
  const [adjusting, setAdjusting] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!score) {
    return <p className="text-sm text-muted-foreground py-6 text-center">The score for this lead has not been calculated yet. It appears automatically after the next change to the lead.</p>;
  }

  const adjusted = score.override_score != null;
  const parsed = value.trim() === "" ? NaN : Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
  const reasonOk = reason.trim().length >= 5;
  const preview = valid ? scoreCategory(parsed) : null;

  const finish = async (title: string) => {
    setAdjusting(false); setValue(""); setReason("");
    await refetch(); onChanged();
    toast({ title });
  };
  const apply = async () => {
    if (!valid || !reasonOk) return;
    setSaving(true);
    const { error } = await setScoreOverride(applicantId, parsed, reason.trim());
    setSaving(false);
    if (error) { toast({ title: "Could not adjust score", description: error, variant: "destructive" }); return; }
    await finish("Score adjusted");
  };
  const remove = async () => {
    if (!reasonOk) return;
    setSaving(true);
    const { error } = await clearScoreOverride(applicantId, reason.trim());
    setSaving(false);
    if (error) { toast({ title: "Could not remove adjustment", description: error, variant: "destructive" }); return; }
    await finish("Back to the calculated score");
  };

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="rounded-xl border p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className={`text-4xl font-bold tabular-nums ${CATEGORY_TONES[score.category].ring}`} aria-label={`Score ${score.score} out of 100`}>{score.score}<span className="text-base font-normal text-muted-foreground">/100</span></div>
          <CategoryChip category={score.category} className="text-xs px-2.5 py-1" />
          <div className="ms-auto text-end text-[11px] text-muted-foreground">
            <div>Last updated {when(score.calculated_at)}</div>
            <div>Last changed {when(score.score_changed_at)}</div>
          </div>
        </div>
        {/* bar with the Cold / Warm / Hot bands */}
        <div>
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Score ${score.score}; Hot is 70 and above, Warm 40 to 69, Cold below 40`}>
            <div className="absolute inset-y-0 start-0 bg-sky-100" style={{ width: "40%" }} />
            <div className="absolute inset-y-0 bg-amber-100" style={{ insetInlineStart: "40%", width: "30%" }} />
            <div className="absolute inset-y-0 end-0 bg-red-100" style={{ width: "30%" }} />
            <div className={`absolute inset-y-0 start-0 ${CATEGORY_TONES[score.category].bar}`} style={{ width: `${score.score}%` }} />
          </div>
          <div className="mt-1 flex text-[10px] text-muted-foreground"><span style={{ width: "40%" }}>Cold {CATEGORY_RANGES.cold}</span><span style={{ width: "30%" }}>Warm {CATEGORY_RANGES.warm}</span><span className="text-end flex-1">Hot {CATEGORY_RANGES.hot}</span></div>
        </div>
        {score.coverage < 100 && (
          <div className="flex gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
            <Info className="h-4 w-4 shrink-0 text-slate-400" />
            <span>Based on {score.coverage}% of the scoring weight. Information that hasn’t been collected yet is not counted against this lead; the score updates as calls, documents, visits and budget details are recorded.</span>
          </div>
        )}
        {adjusted && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-0.5">
            <div className="font-semibold flex items-center gap-1"><PencilLine className="h-3.5 w-3.5" />Manually adjusted to {score.override_score} (calculated score is {score.computed_score})</div>
            <div>“{score.override_reason}”</div>
            {score.override_at && <div className="text-amber-700">{names[score.override_by ?? ""] ?? "Staff"} · {when(score.override_at)}</div>}
          </div>
        )}
      </div>

      {/* Contributing factors */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2">What contributes to this score</h3>
        <div className="grid gap-2.5">{FACTOR_ORDER.map((k) => <FactorCard key={k} f={score.factors[k]} />)}</div>
      </div>

      {/* Manual adjustment */}
      <div className="rounded-lg border p-3 space-y-2">
        {!adjusting ? (
          <Button type="button" variant="outline" size="sm" onClick={() => { setAdjusting(true); setValue(String(score.score)); }}>
            <PencilLine className="h-4 w-4 me-1.5" />{adjusted ? "Change or remove adjustment" : "Adjust score manually"}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-[110px_1fr] gap-3 items-end">
              <div>
                <Label htmlFor="ls-value" className="text-xs">New score (0–100)</Label>
                <Input id="ls-value" type="number" inputMode="numeric" min={0} max={100} value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div className="text-xs text-muted-foreground pb-2">{preview ? <>Will be shown as <CategoryChip category={preview} /></> : "Enter a whole number from 0 to 100"}</div>
            </div>
            <div>
              <Label htmlFor="ls-reason" className="text-xs">Reason (required, kept in the audit history)</Label>
              <Textarea id="ls-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Parent confirmed the seat in person" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={apply} disabled={saving || !valid || !reasonOk}>{saving && <Loader2 className="h-4 w-4 animate-spin me-1.5" />}Save adjustment</Button>
              {adjusted && <Button type="button" size="sm" variant="outline" onClick={remove} disabled={saving || !reasonOk}><Undo2 className="h-4 w-4 me-1.5" />Remove adjustment</Button>}
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdjusting(false)} disabled={saving}>Cancel</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">The calculated score keeps updating underneath, and your adjustment stays until you remove it.</p>
          </div>
        )}
      </div>

      {/* Audit history */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Score history</h3>
        {loading ? <LoadingSpinner /> : (
          <ol className="space-y-2.5 border-s ps-4">
            {rows.map((r) => (
              <li key={r.id} className="relative text-sm">
                <span className={`absolute -start-[21px] top-1.5 h-2 w-2 rounded-full ${r.change_type === "auto" ? "bg-slate-400" : "bg-amber-500"}`} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium tabular-nums">{r.old_score != null ? `${r.old_score} → ` : ""}{r.new_score}</span>
                  <CategoryChip category={r.new_category} />
                  <span className="text-xs text-muted-foreground">
                    {r.change_type === "manual_override" ? "Manual adjustment" : r.change_type === "manual_clear" ? "Adjustment removed" : TRIGGER_LABELS[r.trigger_source ?? ""] ?? "Recalculated"}
                  </span>
                </div>
                {r.reason && <div className="text-xs text-slate-700 break-words">“{r.reason}”</div>}
                <div className="text-[11px] text-muted-foreground">{when(r.created_at)}{r.created_by ? ` · ${names[r.created_by] ?? "Staff"}` : " · automatic"}</div>
              </li>
            ))}
            {rows.length === 0 && <li className="text-sm text-muted-foreground">No changes recorded yet.</li>}
          </ol>
        )}
      </div>
    </div>
  );
}
