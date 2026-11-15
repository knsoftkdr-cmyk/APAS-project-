import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  RESULT_META,
  attendedPercent,
  classifyAttendance,
  fetchRules,
  saveRules,
  validateRules,
  type LiveAttendanceRules,
} from "@/lib/liveAttendance";

type Draft = Omit<LiveAttendanceRules, "school_id" | "can_edit">;

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

function NumberField({ label, hint, value, onChange, disabled }: {
  label: string; hint: string; value: number; onChange: (n: number) => void; disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-slate-600">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(num(e.target.value))}
        disabled={disabled}
        className="border-slate-200"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** School-wide rules for turning time in a live class into Present / Partial / Absent. */
export function LiveAttendanceRulesCard() {
  const { toast } = useToast();
  const [rules, setRules] = useState<LiveAttendanceRules | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchRules()
      .then((r) => {
        if (!alive) return;
        if (!r) { setUnavailable(true); return; }
        setRules(r);
        setDraft({ ...r });
      })
      .catch(() => { if (alive) setUnavailable(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading || unavailable || !rules || !draft) {
    return loading ? null : (
      <Card><CardContent className="p-3 text-xs text-muted-foreground">
        Live-class attendance rules are not available yet (the database update has not been applied).
      </CardContent></Card>
    );
  }

  const canEdit = rules.can_edit;
  const problem = validateRules(draft);
  const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== rules[k]);

  // worked example for a 40-minute class, so the thresholds are easy to picture
  const exampleMinutes = [40, Math.round(40 * draft.present_min_percent / 100), Math.max(1, Math.round(40 * draft.partial_min_percent / 100)), Math.max(0, Math.round(40 * draft.partial_min_percent / 100) - 5)];

  async function save() {
    if (!draft || problem) return;
    setSaving(true);
    try {
      const saved = await saveRules(draft);
      if (saved) { setRules(saved); setDraft({ ...saved }); }
      toast({ title: "Attendance rules saved", description: "New classes use these rules; reports recalculate when opened." });
    } catch (e) {
      toast({ title: "Could not save rules", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Live class attendance rules</CardTitle>
        <p className="text-xs text-muted-foreground">
          Attendance is recorded automatically when students join. The share of the scheduled class a student was present for decides the status.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
          <div>
            <p className="text-sm font-medium">Automatic attendance</p>
            <p className="text-xs text-muted-foreground">When off, joining only records a plain "joined" mark, as before.</p>
          </div>
          <Switch checked={draft.auto_enabled} onCheckedChange={(v) => setDraft({ ...draft, auto_enabled: v })} disabled={!canEdit} aria-label="Automatic attendance" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField label="Present from (%)" hint="Time in class needed to count as Present." value={draft.present_min_percent}
            onChange={(n) => setDraft({ ...draft, present_min_percent: n })} disabled={!canEdit} />
          <NumberField label="Partial from (%)" hint="Below this the student is Absent." value={draft.partial_min_percent}
            onChange={(n) => setDraft({ ...draft, partial_min_percent: n })} disabled={!canEdit} />
          <NumberField label="Late after (minutes)" hint="Joining later than this after the start is flagged Late." value={draft.late_grace_minutes}
            onChange={(n) => setDraft({ ...draft, late_grace_minutes: n })} disabled={!canEdit} />
          <NumberField label="Connection timeout (seconds)" hint="If APAS stops hearing from a student's open page for this long, the stay ends." value={draft.heartbeat_timeout_seconds}
            onChange={(n) => setDraft({ ...draft, heartbeat_timeout_seconds: n })} disabled={!canEdit} />
          <NumberField label="Background grace (minutes)" hint="Students on the Meet app may leave APAS in the background; this is how long that still counts." value={draft.background_grace_minutes}
            onChange={(n) => setDraft({ ...draft, background_grace_minutes: n })} disabled={!canEdit} />
        </div>

        {!problem && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-0.5">
            <p className="font-medium text-slate-700">Example: a 40-minute class</p>
            {[...new Set(exampleMinutes)].map((m) => {
              const r = classifyAttendance(attendedPercent(m * 60, 40 * 60), draft);
              return <p key={m}>{m} min in class ({Math.round((m / 40) * 100)}%) → <span className="font-semibold">{RESULT_META[r].label}</span></p>;
            })}
          </div>
        )}
        {problem && <p className="text-xs text-red-600">{problem}</p>}

        {canEdit ? (
          <Button onClick={save} disabled={saving || !!problem || !changed}
            className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white">
            {saving ? "Saving..." : "Save rules"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Only a school administrator can change these rules.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default LiveAttendanceRulesCard;
