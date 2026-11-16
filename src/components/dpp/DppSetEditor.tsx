import { useState } from "react";
import { Library, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { blankEditorItem, friendlyDppError, QUESTION_TYPE_LABEL, toRpcItem, validateEditorItem, type DppEditorItem, type DppQuestionType } from "@/lib/dpp";
import { pickBankItems, useDppSetDetail, useDppStaffMutations, useDppStaffOptions } from "@/hooks/useDpp";

interface Props { setId: string | null; onClose: () => void }

export function DppSetEditor({ setId, onClose }: Props) {
  const detail = useDppSetDetail(setId);
  if (setId && detail.isLoading) return <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin" />;
  if (setId && detail.error) return <p className="text-sm text-red-600">{friendlyDppError(detail.error)}</p>;
  return <EditorBody key={setId ?? "new"} setId={setId} initial={detail.data} onClose={onClose} />;
}

function EditorBody({ setId, initial, onClose }: { setId: string | null; initial?: ReturnType<typeof useDppSetDetail>["data"]; onClose: () => void }) {
  const opts = useDppStaffOptions();
  const { saveSet } = useDppStaffMutations();
  const [title, setTitle] = useState(initial?.set.title ?? "");
  const [subject, setSubject] = useState(initial?.set.subject ?? "");
  const [classLevel, setClassLevel] = useState(initial?.set.class_level ?? "");
  const [chapter, setChapter] = useState(initial?.set.chapter ?? "");
  const [description, setDescription] = useState(initial?.set.description ?? "");
  const [difficulty, setDifficulty] = useState(initial?.set.difficulty ?? "mixed");
  const [limit, setLimit] = useState(initial?.set.time_limit_minutes ? String(initial.set.time_limit_minutes) : "");
  const [items, setItems] = useState<DppEditorItem[]>(
    initial?.items.map((i) => ({ ...i, options: i.options ?? undefined, accepted_answers: i.accepted_answers?.length ? i.accepted_answers : i.question_type === "short_answer" ? [""] : undefined })) ?? [blankEditorItem()]);
  const [bank, setBank] = useState<Awaited<ReturnType<typeof pickBankItems>> | null>(null);
  const [bankBusy, setBankBusy] = useState(false);
  const classes = Array.from(new Set((opts.data?.classes ?? []).map((c) => c.class_level)));

  const patch = (i: number, p: Partial<DppEditorItem>) => setItems((arr) => arr.map((it, k) => (k === i ? { ...it, ...p } : it)));
  const changeType = (i: number, t: DppQuestionType) => setItems((arr) => arr.map((it, k) => (k === i ? { ...blankEditorItem(t), stem: it.stem, marks: it.marks, difficulty: it.difficulty, explanation: it.explanation } : it)));

  const loadBank = async () => {
    if (!subject.trim()) { toast.error("Enter the subject first."); return; }
    setBankBusy(true);
    try { setBank(await pickBankItems(subject, classLevel, chapter)); } catch (e) { toast.error(friendlyDppError(e)); } finally { setBankBusy(false); }
  };
  const addFromBank = (b: NonNullable<typeof bank>[number]) => {
    setItems((arr) => [...arr.filter((x) => x.stem.trim() || x.bank_item_id), {
      question_type: "mcq", stem: b.stem, options: { A: "", B: "", C: "", D: "", ...b.options }, correct_answer: b.correct_answer, explanation: b.explanation ?? "",
      marks: 1, difficulty: b.difficulty, bank_item_id: b.bank_item_id, learning_objective_id: b.learning_objective_id, subtopic_id: b.subtopic_id, chapter: b.chapter,
    }]);
    setBank((x) => x?.filter((y) => y.bank_item_id !== b.bank_item_id) ?? null);
  };

  const save = async () => {
    if (!title.trim()) return toast.error("Give the set a title.");
    if (!subject.trim()) return toast.error("Enter the subject.");
    for (let i = 0; i < items.length; i++) { const err = validateEditorItem(items[i], i + 1); if (err) return toast.error(err); }
    try {
      await saveSet.mutateAsync({
        setId, set: { title, subject, class_level: classLevel || null, chapter: chapter || null, description: description || null, difficulty, time_limit_minutes: limit ? Number(limit) : null },
        items: items.map(toRpcItem),
      });
      toast.success("Set saved. Assign it to a class or students from the list.");
      onClose();
    } catch (e) { toast.error(friendlyDppError(e)); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">{setId ? "Edit practice set" : "New practice set"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="dpp-title">Title</Label><Input id="dpp-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Algebra basics - Day 3" /></div>
          <div className="space-y-1"><Label htmlFor="dpp-subject">Subject</Label>
            <Input id="dpp-subject" list="dpp-subjects" value={subject} maxLength={100} onChange={(e) => setSubject(e.target.value)} />
            <datalist id="dpp-subjects">{(opts.data?.subjects ?? []).map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="space-y-1"><Label htmlFor="dpp-class">Class</Label>
            <Input id="dpp-class" list="dpp-classes" value={classLevel} onChange={(e) => setClassLevel(e.target.value)} placeholder="e.g. Class 5" />
            <datalist id="dpp-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="space-y-1"><Label htmlFor="dpp-chapter">Chapter (optional)</Label><Input id="dpp-chapter" value={chapter} onChange={(e) => setChapter(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["mixed", "easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label htmlFor="dpp-limit">Time limit (min)</Label><Input id="dpp-limit" type="number" min={1} max={240} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="none" /></div>
          </div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="dpp-desc">Instructions (optional)</Label><Textarea id="dpp-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Question bank</CardTitle>
          <Button size="sm" variant="outline" onClick={() => void loadBank()} disabled={bankBusy}>{bankBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Library className="mr-1 h-4 w-4" />}Find reviewed questions</Button></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Only teacher-reviewed (active) questions from your school's item bank appear here, matched to the subject, class and chapter above.</p>
          {bank?.length === 0 && <p className="text-sm text-muted-foreground">No reviewed questions match. Write your own below.</p>}
          {bank?.map((b) => (
            <div key={b.bank_item_id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
              <div><p>{b.stem}</p><p className="text-xs text-muted-foreground">{b.chapter} · {b.difficulty}</p></div>
              <Button size="sm" variant="secondary" onClick={() => addFromBank(b)}><Plus className="mr-1 h-3 w-3" />Add</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {items.map((it, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Badge variant="secondary">Q{i + 1}</Badge>{it.bank_item_id && <Badge variant="outline">From item bank</Badge>}</div>
              <Button size="icon" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setItems((a) => a.filter((_, k) => k !== i))} disabled={items.length === 1}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label>Type</Label>
                <Select value={it.question_type} onValueChange={(v) => changeType(i, v as DppQuestionType)} disabled={!!it.bank_item_id}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(QUESTION_TYPE_LABEL) as DppQuestionType[]).map((t) => <SelectItem key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Difficulty</Label>
                <Select value={it.difficulty} onValueChange={(v) => patch(i, { difficulty: v as DppEditorItem["difficulty"] })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Marks</Label><Input type="number" min={0.5} max={100} step={0.5} value={it.marks} onChange={(e) => patch(i, { marks: Number(e.target.value) })} /></div>
            </div>
            <div className="space-y-1"><Label>Question</Label><Textarea rows={2} value={it.stem} maxLength={2000} onChange={(e) => patch(i, { stem: e.target.value })} /></div>

            {it.question_type === "mcq" && (
              <div className="space-y-2">
                {["A", "B", "C", "D"].map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <input type="radio" name={`correct-${i}`} aria-label={`Option ${k} is correct`} checked={it.correct_answer === k} onChange={() => patch(i, { correct_answer: k })} />
                    <span className="w-5 text-sm font-medium">{k}</span>
                    <Input value={it.options?.[k] ?? ""} placeholder={`Option ${k}${k > "B" ? " (optional)" : ""}`} onChange={(e) => patch(i, { options: { ...(it.options ?? {}), [k]: e.target.value } })} />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Select the radio button next to the correct option.</p>
              </div>
            )}
            {it.question_type === "true_false" && (
              <Select value={it.correct_answer ?? "A"} onValueChange={(v) => patch(i, { correct_answer: v })}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="A">Correct answer: True</SelectItem><SelectItem value="B">Correct answer: False</SelectItem></SelectContent></Select>
            )}
            {it.question_type === "short_answer" && (
              <div className="space-y-1"><Label>Accepted answers (one per line; case and punctuation are ignored)</Label>
                <Textarea rows={2} value={(it.accepted_answers ?? []).join("\n")} onChange={(e) => patch(i, { accepted_answers: e.target.value.split("\n") })} /></div>
            )}
            {it.question_type === "numeric" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Correct value</Label><Input type="number" step="any" value={it.numeric_answer ?? ""} onChange={(e) => patch(i, { numeric_answer: e.target.value === "" ? null : Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Allowed difference (±)</Label><Input type="number" min={0} step="any" value={it.tolerance ?? 0} onChange={(e) => patch(i, { tolerance: Math.max(0, Number(e.target.value)) })} /></div>
              </div>
            )}
            {it.question_type === "open_ended" && <p className="text-xs text-muted-foreground">Not auto-graded: you mark it from the "To mark" tab after students submit.</p>}
            <div className="space-y-1"><Label>Explanation shown after submitting (optional)</Label><Textarea rows={2} value={it.explanation ?? ""} onChange={(e) => patch(i, { explanation: e.target.value })} /></div>
          </CardContent>
        </Card>
      ))}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={() => setItems((a) => [...a, blankEditorItem()])} disabled={items.length >= 50}><Plus className="mr-1 h-4 w-4" />Add question</Button>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saveSet.isPending}>{saveSet.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save set</Button></div>
      </div>
    </div>
  );
}
