import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, Copy, ArrowLeft, AlertTriangle } from "lucide-react";
import {
  IEP_DOMAINS, draftToText, generateIepDraft,
  type IepDraft, type IepGenerateResponse,
} from "@/lib/iepGenerator";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senStudentId: string;
  studentName: string;
  createdBy?: string | null;
  /** Called after a plan has been saved so the page can reload its IEP list. */
  onSaved: () => void;
}

interface GoalRow { include: boolean; domain: string; goal_description: string; baseline: string; target_criteria: string; target_date: string }
interface AccRow { include: boolean; accommodation_type: string; applies_to: string; description: string }

export function IepGeneratorDialog({ open, onOpenChange, senStudentId, studentName, createdBy, onSaved }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<"options" | "review">("options");
  const [duration, setDuration] = useState("12");
  const [domains, setDomains] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [result, setResult] = useState<IepGenerateResponse | null>(null);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [accs, setAccs] = useState<AccRow[]>([]);

  // fresh state every time the dialog opens or the student changes
  useEffect(() => {
    if (!open) return;
    setStep("options");
    setResult(null);
    setDomains([]);
    setNotes("");
    setDuration("12");
  }, [open, senStudentId]);

  const toggleDomain = (d: string) => setDomains((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const generate = async () => {
    setLoading(true);
    try {
      const res = await generateIepDraft({
        senStudentId,
        durationMonths: Number(duration),
        focusDomains: domains,
        teacherNotes: notes.trim() || undefined,
      });
      setResult(res);
      setTitle(res.draft.title);
      setStartDate(res.draft.start_date);
      setEndDate(res.draft.end_date);
      setGoals(res.draft.goals.map((g) => ({ include: true, ...g })));
      setAccs(res.draft.accommodations.map((a) => ({ include: true, ...a })));
      setStep("review");
    } catch (e) {
      toast({ title: "Could not generate the IEP draft", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const currentDraft = (): IepDraft | null => {
    if (!result) return null;
    return {
      ...result.draft,
      title, start_date: startDate, end_date: endDate,
      goals: goals.filter((g) => g.include).map(({ include: _i, ...g }) => g),
      accommodations: accs.filter((a) => a.include).map(({ include: _i, ...a }) => a),
    };
  };

  const copyText = async () => {
    const d = currentDraft();
    if (!d) return;
    try {
      await navigator.clipboard.writeText(draftToText(d, studentName));
      toast({ title: "IEP copied to clipboard" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  const save = async () => {
    const chosenGoals = goals.filter((g) => g.include && g.goal_description.trim());
    if (!title.trim() || !startDate) {
      toast({ title: "Add a title and start date", variant: "destructive" });
      return;
    }
    if (endDate && endDate < startDate) {
      toast({ title: "End date is before the start date", variant: "destructive" });
      return;
    }
    if (!chosenGoals.length) {
      toast({ title: "Keep at least one goal", variant: "destructive" });
      return;
    }
    setSaving(true);

    // 1. the plan (saved as a draft; same insert the "New IEP Plan" dialog uses)
    const { data: plan, error: planErr } = await supabase
      .from("iep_plans")
      .insert({
        sen_student_id: senStudentId,
        title: title.trim(),
        start_date: startDate,
        end_date: endDate || null,
        status: "draft",
        created_by: createdBy ?? null,
      })
      .select("id")
      .single();
    if (planErr || !plan) {
      toast({ title: "Could not create IEP plan", description: planErr?.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // 2. goals; if this fails, remove the empty plan so nothing half-saved is left behind
    const { error: goalErr } = await supabase.from("iep_goals").insert(
      chosenGoals.map((g) => ({
        iep_plan_id: plan.id,
        domain: g.domain,
        goal_description: g.goal_description.trim(),
        baseline: g.baseline.trim() || null,
        target_criteria: g.target_criteria.trim() || null,
        target_date: g.target_date || null,
      })),
    );
    if (goalErr) {
      await supabase.from("iep_plans").delete().eq("id", plan.id);
      toast({ title: "Could not save the goals", description: goalErr.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // 3. accommodations (optional); the plan is already safe, so a failure here is only a warning
    const chosenAccs = accs.filter((a) => a.include && a.accommodation_type);
    if (chosenAccs.length) {
      const { error: accErr } = await supabase.from("sen_accommodations").insert(
        chosenAccs.map((a) => ({
          sen_student_id: senStudentId,
          accommodation_type: a.accommodation_type,
          applies_to: a.applies_to,
          description: a.description.trim() || null,
        })),
      );
      if (accErr) {
        toast({ title: "Plan saved, but accommodations were not", description: accErr.message, variant: "destructive" });
        setSaving(false);
        onSaved();
        onOpenChange(false);
        return;
      }
    }

    toast({ title: "IEP saved as a draft", description: "Review it, then set the status to Active when it is agreed." });
    setSaving(false);
    onSaved();
    onOpenChange(false);
  };

  const updateGoal = (i: number, patch: Partial<GoalRow>) => setGoals((cur) => cur.map((g, n) => (n === i ? { ...g, ...patch } : g)));
  const updateAcc = (i: number, patch: Partial<AccRow>) => setAccs((cur) => cur.map((a, n) => (n === i ? { ...a, ...patch } : a)));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving && !loading) onOpenChange(o); }}>
      <DialogContent className="rounded-2xl w-[calc(100%-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" /> Generate IEP draft{studentName ? ` for ${studentName}` : ""}
          </DialogTitle>
        </DialogHeader>

        {step === "options" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Drafts goals, accommodations and strategies from the SEN record, attendance, marks, behaviour, mastery and any earlier IEPs.
              You review and edit everything before it is saved.
            </p>
            <div>
              <Label>Plan length</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[3, 6, 9, 12].map((m) => <SelectItem key={m} value={String(m)}>{m} months</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Focus areas <span className="text-muted-foreground font-normal">(optional, leave empty to let it choose)</span></Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {IEP_DOMAINS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDomain(d)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${domains.includes(d) ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:bg-emerald-50"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Anything the plan should reflect <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                className="rounded-xl mt-1"
                rows={3}
                maxLength={1500}
                placeholder="e.g. Parents want a focus on reading fluency; struggles with transitions between lessons."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl w-full sm:w-auto" onClick={generate} disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Drafting...</> : <><Sparkles className="h-4 w-4 mr-1" /> Generate draft</>}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={result.source === "ai" ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-amber-200 text-amber-700 bg-amber-50"}>
                {result.source === "ai" ? "AI draft" : "Template draft"}
              </Badge>
              <span className="text-xs text-muted-foreground">Draft only. Check every line against what you know of the student.</span>
            </div>

            {(result.warnings.length > 0 || result.data_gaps.length > 0) && (
              <div className="text-xs rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-1 text-amber-800">
                {[...result.warnings, ...result.data_gaps].map((w, n) => (
                  <p key={n} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3"><Label>Title</Label><Input className="rounded-xl mt-1" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><Label>Start date</Label><Input type="date" className="rounded-xl mt-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div><Label>End date</Label><Input type="date" className="rounded-xl mt-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
              <div><Label>Next review</Label><Input readOnly className="rounded-xl mt-1 bg-slate-50" value={result.draft.next_review_date} /></div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2 text-sm">
              <p className="font-semibold text-slate-700">Present levels</p>
              <p className="text-slate-700">{result.draft.present_levels}</p>
              {result.draft.strengths.length > 0 && (
                <div><p className="font-medium text-xs text-emerald-700">Strengths</p><ul className="list-disc pl-5 text-xs text-slate-600">{result.draft.strengths.map((s, n) => <li key={n}>{s}</li>)}</ul></div>
              )}
              {result.draft.needs.length > 0 && (
                <div><p className="font-medium text-xs text-amber-700">Needs</p><ul className="list-disc pl-5 text-xs text-slate-600">{result.draft.needs.map((s, n) => <li key={n}>{s}</li>)}</ul></div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700">Goals <span className="text-xs font-normal text-muted-foreground">(untick to leave one out)</span></p>
              {goals.map((g, i) => (
                <div key={i} className={`rounded-xl border p-3 space-y-2 ${g.include ? "border-emerald-100" : "border-slate-100 opacity-60"}`}>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={g.include} onCheckedChange={(v) => updateGoal(i, { include: v === true })} />
                    <Select value={g.domain} onValueChange={(v) => updateGoal(i, { domain: v })}>
                      <SelectTrigger className="h-8 w-[150px] text-xs rounded-lg"><SelectValue /></SelectTrigger>
                      <SelectContent>{IEP_DOMAINS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="date" className="h-8 text-xs rounded-lg ml-auto w-[150px]" value={g.target_date} onChange={(e) => updateGoal(i, { target_date: e.target.value })} />
                  </div>
                  <Textarea className="rounded-xl text-sm" rows={2} value={g.goal_description} onChange={(e) => updateGoal(i, { goal_description: e.target.value })} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><Label className="text-xs">Baseline</Label><Textarea className="rounded-xl text-xs mt-1" rows={2} value={g.baseline} onChange={(e) => updateGoal(i, { baseline: e.target.value })} /></div>
                    <div><Label className="text-xs">Target criteria</Label><Textarea className="rounded-xl text-xs mt-1" rows={2} value={g.target_criteria} onChange={(e) => updateGoal(i, { target_criteria: e.target.value })} /></div>
                  </div>
                </div>
              ))}
            </div>

            {accs.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">Suggested accommodations <span className="text-xs font-normal text-muted-foreground">(added to the Accommodations tab if ticked)</span></p>
                {accs.map((a, i) => (
                  <label key={i} className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-sm cursor-pointer">
                    <Checkbox className="mt-0.5" checked={a.include} onCheckedChange={(v) => updateAcc(i, { include: v === true })} />
                    <span className="min-w-0">
                      <span className="font-medium">{a.accommodation_type}</span>{" "}
                      <Badge variant="outline" className="font-normal text-xs ml-1">{a.applies_to}</Badge>
                      <span className="block text-xs text-muted-foreground mt-0.5">{a.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {result.draft.strategies.length > 0 && (
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm">
                <p className="font-semibold text-slate-700 mb-1">Teaching strategies</p>
                <ul className="list-disc pl-5 text-xs text-slate-600 space-y-0.5">{result.draft.strategies.map((s, n) => <li key={n}>{s}</li>)}</ul>
                <p className="text-[11px] text-muted-foreground mt-2">Strategies are not stored in the plan. Use Copy to keep them with the IEP document.</p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
              <Button variant="ghost" className="rounded-xl" onClick={() => setStep("options")} disabled={saving}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
              <Button variant="outline" className="rounded-xl" onClick={copyText} disabled={saving}><Copy className="h-4 w-4 mr-1" /> Copy full IEP</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 rounded-xl" onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving...</> : "Save as draft plan"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default IepGeneratorDialog;
