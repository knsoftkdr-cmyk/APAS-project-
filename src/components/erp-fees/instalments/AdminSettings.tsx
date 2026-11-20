import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { fetchSettings, saveSettings } from "@/lib/instalmentApi";
import type { InstalmentSettingsRow } from "@/lib/instalments";

const CHOICES = [2, 3, 4, 5, 6, 9, 10, 12];
const parseList = (v: string) => [...new Set(v.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => b - a);

export function AdminSettings({ schoolId }: { schoolId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [counts, setCounts] = useState<number[]>([2, 3, 4, 6]);
  const [flexible, setFlexible] = useState(true);
  const [defCount, setDefCount] = useState("4");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [interval, setIntervalDays] = useState("30");
  const [reminders, setReminders] = useState("7, 3, 1");
  const [repeat, setRepeat] = useState("3");
  // Automatic reminders for ALL fees (push + email + in-app); column added by 20261118000000_fee_reminders.sql.
  const [feeReminders, setFeeReminders] = useState(true);
  const [hasFeeReminderColumn, setHasFeeReminderColumn] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const s = await fetchSettings(schoolId);
        if (s) {
          setEnabled(s.enabled); setCounts(s.allowed_counts); setFlexible(s.allow_flexible); setDefCount(String(s.default_count));
          setMinAmt(s.min_instalment_amount == null ? "" : String(s.min_instalment_amount)); setMaxAmt(s.max_instalment_amount == null ? "" : String(s.max_instalment_amount));
          setIntervalDays(String(s.default_interval_days)); setReminders(s.reminder_days.join(", ")); setRepeat(String(s.overdue_repeat_days));
          setHasFeeReminderColumn("fee_reminders_enabled" in s);
          setFeeReminders(s.fee_reminders_enabled !== false);
        }
      } catch (e) { toast({ title: "Couldn't load settings", description: (e as Error).message, variant: "destructive" }); }
      finally { setLoading(false); }
    })();
  }, [schoolId, toast]);

  const toggleCount = (n: number) => setCounts((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n].sort((a, b) => a - b)));

  const save = async () => {
    const def = parseInt(defCount, 10);
    const min = minAmt.trim() === "" ? null : Number(minAmt);
    const max = maxAmt.trim() === "" ? null : Number(maxAmt);
    const reminderDays = parseList(reminders).filter((n) => n > 0);
    const problems: string[] = [];
    if (counts.length === 0) problems.push("Allow at least one number of instalments.");
    if (!(def >= 2)) problems.push("The default must be at least 2 instalments.");
    if (counts.length > 0 && flexible && !counts.includes(def)) problems.push("The default number must be one of the allowed numbers.");
    if (min !== null && !(min >= 0)) problems.push("Minimum amount must be 0 or more.");
    if (max !== null && !(max > 0)) problems.push("Maximum amount must be above 0.");
    if (min !== null && max !== null && min > max) problems.push("Minimum cannot be higher than maximum.");
    if (!(parseInt(interval, 10) > 0)) problems.push("Days between instalments must be above 0.");
    if (!(parseInt(repeat, 10) >= 0)) problems.push("Overdue repeat must be 0 or more.");
    if (problems.length) { toast({ title: "Please check the settings", description: problems[0], variant: "destructive" }); return; }

    const row: InstalmentSettingsRow = {
      school_id: schoolId, enabled, allowed_counts: counts, allow_flexible: flexible, default_count: def, min_instalment_amount: min, max_instalment_amount: max,
      default_interval_days: parseInt(interval, 10), reminder_days: reminderDays.length ? reminderDays : [7, 3, 1], overdue_repeat_days: parseInt(repeat, 10),
      // Only sent once the database has the column, so saving still works before the migration is run.
      ...(hasFeeReminderColumn ? { fee_reminders_enabled: feeReminders } : {}),
    };
    setSaving(true);
    try { await saveSettings(row); toast({ title: "Settings saved" }); }
    catch (e) { toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (loading) return <p className="text-sm text-slate-500 p-6">Loading settings…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-[#12203a]">Allow instalment plans</h3>
          <p className="text-sm text-slate-500 mt-0.5">Optional. When off, parents can't request instalments and only pay fees in full. Existing plans keep working.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Allow instalment plans" />
      </div>

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4" disabled={saving}>
        <legend className="px-1 text-sm font-semibold text-[#12203a]">Plan options</legend>
        <div className="space-y-2">
          <Label>Permitted number of instalments</Label>
          <div className="flex flex-wrap gap-2">{CHOICES.map((n) => (
            <button key={n} type="button" aria-pressed={counts.includes(n)} onClick={() => toggleCount(n)}
              className={`h-9 min-w-9 px-3 rounded-full border text-sm font-medium ${counts.includes(n) ? "bg-[#12203a] text-white border-[#12203a]" : "bg-white text-slate-600 border-slate-300"}`}>{n}</button>))}</div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div><Label>Let parents choose the number</Label><p className="text-xs text-slate-500">Off = parents always get the default number below.</p></div>
          <Switch checked={flexible} onCheckedChange={setFlexible} aria-label="Let parents choose the number of instalments" />
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-1.5"><Label htmlFor="s-def">Default instalments</Label><Input id="s-def" type="number" min={2} value={defCount} onChange={(e) => setDefCount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-min">Minimum per instalment (₹)</Label><Input id="s-min" type="number" min={0} placeholder="No minimum" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-max">Maximum per instalment (₹)</Label><Input id="s-max" type="number" min={0} placeholder="No maximum" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5 max-w-xs"><Label htmlFor="s-int">Days between instalments (automatic schedule)</Label><Input id="s-int" type="number" min={1} value={interval} onChange={(e) => setIntervalDays(e.target.value)} /></div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4" disabled={saving}>
        <legend className="px-1 text-sm font-semibold text-[#12203a]">Reminders to parents</legend>
        <div className="flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3">
          <div>
            <p className="text-sm font-medium text-[#12203a]">Automatic fee reminders</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Parents of every student with an unpaid fee are reminded automatically before the due date, on the due date and while it is overdue, by app notification, push notification and email. No staff action is needed. Sent between 9 AM and 8 PM. Instalment plans always get their own reminders.
            </p>
          </div>
          <Switch checked={feeReminders} onCheckedChange={setFeeReminders} aria-label="Automatic fee reminders" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label htmlFor="s-rem">Remind this many days before the due date</Label><Input id="s-rem" value={reminders} onChange={(e) => setReminders(e.target.value)} placeholder="7, 3, 1" /><p className="text-xs text-slate-500">Comma separated. A reminder is also sent on the due date. Used for fees and instalments.</p></div>
          <div className="space-y-1.5"><Label htmlFor="s-rep">Repeat overdue notice every (days)</Label><Input id="s-rep" type="number" min={0} value={repeat} onChange={(e) => setRepeat(e.target.value)} /><p className="text-xs text-slate-500">0 = send a single overdue notice.</p></div>
        </div>
        <p className="text-xs text-slate-500">No late fees or penalties are added by instalment plans.</p>
      </fieldset>

      <Button onClick={save} disabled={saving} className="bg-[#12203a] hover:bg-[#1b2f55] text-white">{saving ? "Saving…" : "Save settings"}</Button>
    </div>
  );
}
