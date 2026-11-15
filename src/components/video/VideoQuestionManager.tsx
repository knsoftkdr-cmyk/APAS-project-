// Teacher tools for one video, opened from the existing Marketplace video card (where teachers already upload and
// manage videos): add questions at timestamps (by hand or AI-drafted for review), edit / delete them, and choose
// whether students may skip ahead in the video or skip questions.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  addVideoQuestions, deleteVideoQuestion, fetchVideoConfig, formatTimestamp, generateVideoQuestions, parseTimestamp,
  saveVideoQuestion, saveVideoSettings, type QuestionDraft, type QuestionType, type StaffConfig, type StaffQuestion,
} from "@/lib/interactiveVideo";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listing: { id: string; title: string };
  /** Length of the video when the app can read it (uploaded files); otherwise the teacher types it. */
  detectedDuration?: number | null;
}

interface FormState { id?: string; time: string; type: QuestionType; text: string; options: string[]; correct: number; explanation: string }
const blankForm = (): FormState => ({ time: "", type: "mcq", text: "", options: ["", "", "", ""], correct: 0, explanation: "" });
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function VideoQuestionManager({ open, onOpenChange, listing, detectedDuration }: Props) {
  const qc = useQueryClient();
  const key = useMemo(() => ["video-staff-config", listing.id], [listing.id]);
  const cfgQ = useQuery({ queryKey: key, queryFn: () => fetchVideoConfig<StaffConfig>(listing.id), enabled: open, staleTime: 0 });
  const cfg = cfgQ.data;
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const [lengthText, setLengthText] = useState("");
  useEffect(() => {
    if (!cfg) return;
    const known = cfg.settings.duration_seconds ?? detectedDuration ?? null;
    setLengthText(known ? formatTimestamp(known) : "");
  }, [cfg, detectedDuration]);
  const lengthSeconds = parseTimestamp(lengthText);

  // Remember the length once the browser can read it, so the server can check timestamps and place AI questions.
  useEffect(() => {
    if (cfg && !cfg.settings.duration_seconds && detectedDuration && detectedDuration > 0) {
      saveVideoSettings(listing.id, { ...cfg.settings, duration_seconds: Math.round(detectedDuration) }).then(refresh).catch(() => undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.settings.duration_seconds, detectedDuration]);

  const settingsMut = useMutation({
    mutationFn: (s: Partial<StaffConfig["settings"]>) => saveVideoSettings(listing.id, { ...cfg!.settings, ...s }),
    onSuccess: () => { refresh(); toast.success("Playback rules saved"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't save the rules")),
  });

  // ── manual form ──────────────────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState | null>(null);
  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      const t = parseTimestamp(f.time);
      if (t === null) throw new Error("Enter the time as minutes:seconds, for example 2:30");
      // Blank option boxes are dropped; the "correct" marker must keep pointing at the same option afterwards.
      const keep = f.options.map((o, i) => ({ text: o.trim(), i })).filter((x) => x.text);
      const draft: QuestionDraft = {
        timestamp_seconds: t, question_text: f.text, question_type: f.type, explanation: f.explanation.trim() || null,
        options: f.type === "true_false" ? ["True", "False"] : keep.map((x) => x.text),
        correct_index: f.type === "true_false" ? f.correct : keep.findIndex((x) => x.i === f.correct),
      };
      if (lengthSeconds && !cfg?.settings.duration_seconds) await saveVideoSettings(listing.id, { ...cfg!.settings, duration_seconds: lengthSeconds });
      return saveVideoQuestion(listing.id, draft, f.id);
    },
    onSuccess: () => { setForm(null); refresh(); toast.success("Question saved"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't save the question")),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteVideoQuestion(listing.id, id),
    onSuccess: () => { refresh(); toast.success("Question removed"); },
    onError: (e) => toast.error(errMsg(e, "Couldn't remove the question")),
  });

  const edit = (q: StaffQuestion) => setForm({
    id: q.id, time: formatTimestamp(q.timestamp_seconds), type: q.question_type, text: q.question_text, correct: q.correct_index, explanation: q.explanation ?? "",
    options: q.question_type === "mcq" ? [...q.options, ...Array(Math.max(0, 4 - q.options.length)).fill("")] : ["", "", "", ""],
  });

  // ── AI ───────────────────────────────────────────────────────────────────────────────────────
  const [count, setCount] = useState(4);
  const [notes, setNotes] = useState("");
  const [suggestions, setSuggestions] = useState<(QuestionDraft & { checked: boolean })[]>([]);
  const genMut = useMutation({
    mutationFn: async () => {
      const dur = lengthSeconds ?? cfg?.settings.duration_seconds ?? null;
      return generateVideoQuestions(listing.id, { count, notes: notes.trim() || undefined, durationSeconds: dur });
    },
    onSuccess: (r) => {
      setSuggestions(r.questions.map((q) => ({ ...q, checked: true })));
      refresh();
      toast.success(`${r.questions.length} question${r.questions.length === 1 ? "" : "s"} drafted. Review them, then add.`);
    },
    onError: (e) => toast.error(errMsg(e, "Couldn't generate questions")),
  });
  const addSuggestedMut = useMutation({
    mutationFn: () => addVideoQuestions(listing.id, suggestions.filter((s) => s.checked).map(({ checked: _c, ...q }) => q), "ai"),
    onSuccess: (r) => { setSuggestions([]); refresh(); toast.success(`${r.added} question${r.added === 1 ? "" : "s"} added to the video`); },
    onError: (e) => toast.error(errMsg(e, "Couldn't add the questions")),
  });

  const questions = cfg?.questions ?? [];
  const unavailable = cfg?.persistence === "unavailable";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="pe-6 text-blue-950">Interactive questions · {listing.title}</DialogTitle>
          <DialogDescription>Students are asked these questions when the video reaches the time you choose.</DialogDescription>
        </DialogHeader>

        {cfgQ.isLoading ? <Skeleton className="h-40 w-full" /> : cfgQ.isError ? (
          <p className="text-sm text-red-600">{errMsg(cfgQ.error, "Couldn't load this video's questions.")}</p>
        ) : unavailable || !cfg ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Interactive videos are not set up on this database yet. Ask your administrator to apply the latest database update.</p>
        ) : (
          <div className="space-y-5">
            {/* rules */}
            <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-blue-950">Playback rules</h3>
              <RuleRow
                title="Let students skip ahead in the video" hint="Off: students can rewind, but cannot jump past what they have already watched."
                checked={cfg.settings.allow_video_skip} disabled={settingsMut.isPending} onChange={(v) => settingsMut.mutate({ allow_video_skip: v })}
              />
              <RuleRow
                title="Let students skip questions" hint="Off: students must answer each question before the video continues."
                checked={cfg.settings.allow_question_skip} disabled={settingsMut.isPending} onChange={(v) => settingsMut.mutate({ allow_question_skip: v })}
              />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor="video-length" className="text-muted-foreground">Video length (m:ss)</label>
                <Input id="video-length" value={lengthText} onChange={(e) => setLengthText(e.target.value)} placeholder="e.g. 12:40" className="h-8 w-28"
                  onBlur={() => { if (lengthSeconds && lengthSeconds !== cfg.settings.duration_seconds) settingsMut.mutate({ duration_seconds: lengthSeconds }); }} />
                {!lengthSeconds && !cfg.settings.duration_seconds && <span className="text-xs text-amber-700">Needed to place AI questions along the video.</span>}
              </div>
            </section>

            {/* list */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-blue-950">Questions ({questions.length})</h3>
                {!form && <Button size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700" onClick={() => setForm(blankForm())}><Plus className="me-1 h-3.5 w-3.5" />Add question</Button>}
              </div>
              {questions.length === 0 && !form && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No questions yet. Add one, or let AI draft some for you below.</p>}
              {questions.map((q) => (
                <div key={q.id} className="flex items-start gap-3 rounded-xl border bg-white p-3">
                  <span className="mt-0.5 shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{formatTimestamp(q.timestamp_seconds)}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="break-words font-medium text-slate-900">{q.question_text}</p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">Answer: {q.options[q.correct_index]}{q.source === "ai" && <Badge variant="outline" className="ms-2 rounded-full px-1.5 py-0 text-[10px]">AI</Badge>}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit question" onClick={() => edit(q)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:text-red-700" aria-label="Delete question" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(q.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </section>

            {/* form */}
            {form && (
              <section className="space-y-3 rounded-xl border-2 border-blue-200 p-3 sm:p-4">
                <h3 className="text-sm font-semibold text-blue-950">{form.id ? "Edit question" : "New question"}</h3>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground" htmlFor="q-time">Ask at (m:ss)</label>
                    <Input id="q-time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="2:30" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Type</label>
                    <div className="flex gap-2">
                      {(["mcq", "true_false"] as const).map((t) => (
                        <Button key={t} type="button" size="sm" variant={form.type === t ? "default" : "outline"} className="rounded-full"
                          onClick={() => setForm({ ...form, type: t, correct: 0 })}>{t === "mcq" ? "Multiple choice" : "True / False"}</Button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="q-text">Question</label>
                  <Textarea id="q-text" rows={2} maxLength={500} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{form.type === "mcq" ? "Options (tick the correct one)" : "Correct answer"}</label>
                  {form.type === "mcq" ? form.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="radio" name="correct" aria-label={`Option ${i + 1} is correct`} checked={form.correct === i} onChange={() => setForm({ ...form, correct: i })} className="h-4 w-4 accent-emerald-600" />
                      <Input value={o} maxLength={200} placeholder={`Option ${String.fromCharCode(65 + i)}`} onChange={(e) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                    </div>
                  )) : (
                    <div className="flex gap-2">
                      {["True", "False"].map((o, i) => (
                        <Button key={o} type="button" size="sm" variant="outline" className={cn("rounded-full", form.correct === i && "border-emerald-500 bg-emerald-50 text-emerald-800")} onClick={() => setForm({ ...form, correct: i })}>
                          {form.correct === i && <Check className="me-1 h-3.5 w-3.5" />}{o}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="q-exp">Explanation shown after answering (optional)</label>
                  <Textarea id="q-exp" rows={2} maxLength={1000} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)}><X className="me-1 h-3.5 w-3.5" />Cancel</Button>
                  <Button type="button" size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700" disabled={saveMut.isPending || !form.text.trim()} onClick={() => saveMut.mutate(form)}>
                    {saveMut.isPending ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Check className="me-1 h-3.5 w-3.5" />}Save question
                  </Button>
                </div>
              </section>
            )}

            {/* AI */}
            <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3 sm:p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-violet-950"><Sparkles className="h-4 w-4 text-violet-600" />Draft questions with AI</div>
              <p className="text-xs text-violet-900/80">AI reads the video's title and description, and any notes or transcript you paste below. It cannot watch the video itself, so pasting the lesson notes gives much better questions. You review everything before it reaches students.</p>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={12000} placeholder="Optional: paste the transcript or lesson notes for this video" className="bg-white text-sm" />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted-foreground" htmlFor="gen-count">How many</label>
                <select id="gen-count" value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-8 rounded-md border border-input bg-white px-2 text-sm">
                  {[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <Button size="sm" className="rounded-full bg-violet-600 hover:bg-violet-700" disabled={genMut.isPending} onClick={() => genMut.mutate()}>
                  {genMut.isPending ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="me-1 h-3.5 w-3.5" />}{genMut.isPending ? "Drafting..." : "Generate"}
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div className="space-y-2">
                  {suggestions.map((s, i) => (
                    <label key={i} className="flex cursor-pointer items-start gap-2 rounded-lg border bg-white p-2.5 text-sm">
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-violet-600" checked={s.checked} onChange={() => setSuggestions((l) => l.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))} />
                      <span className="min-w-0 flex-1">
                        <span className="me-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">{formatTimestamp(s.timestamp_seconds)}</span>
                        <span className="break-words font-medium">{s.question_text}</span>
                        <span className="mt-1 block break-words text-xs text-muted-foreground">Answer: {s.options[s.correct_index]}{s.explanation ? ` · ${s.explanation}` : ""}</span>
                      </span>
                    </label>
                  ))}
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSuggestions([])}>Discard</Button>
                    <Button size="sm" className="rounded-full bg-violet-600 hover:bg-violet-700" disabled={addSuggestedMut.isPending || !suggestions.some((s) => s.checked)} onClick={() => addSuggestedMut.mutate()}>
                      {addSuggestedMut.isPending && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />}Add {suggestions.filter((s) => s.checked).length} to video
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({ title, hint, checked, disabled, onChange }: { title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 text-sm"><p className="font-medium text-slate-900">{title}</p><p className="text-xs text-muted-foreground">{hint}</p></div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
