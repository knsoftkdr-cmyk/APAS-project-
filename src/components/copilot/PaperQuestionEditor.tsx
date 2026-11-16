// src/components/copilot/PaperQuestionEditor.tsx
// Edit one question by hand (Question Paper Builder + "Edit manually" on an AI suggestion). Whatever is typed here goes through the
// same validateQuestionDraft() the AI output and the server use, so a hand edit can't produce a question the paper would reject.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DIFFICULTIES, QUESTION_TYPES, TYPE_LABEL, validateQuestionDraft, type QuestionDraft } from "@/lib/paperRefine";

const KEYS = ["A", "B", "C", "D"] as const;

interface Props {
  open: boolean; title?: string; initial: QuestionDraft | null;
  onSave: (draft: QuestionDraft) => void; onClose: () => void;
}

export function PaperQuestionEditor({ open, title = "Edit question", initial, onSave, onClose }: Props) {
  const [d, setD] = useState<QuestionDraft | null>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => { setD(initial); setErrors([]); }, [initial, open]);
  if (!d) return null;

  const set = (patch: Partial<QuestionDraft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));
  const setOption = (k: string, v: string) => set({ options: { ...(d.options ?? {}), [k]: v } });
  const isMcq = d.type === "mcq";

  const save = () => {
    // Blank options are dropped so a 2-option true/false (or 3-option) question is allowed.
    const options = isMcq ? Object.fromEntries(Object.entries(d.options ?? {}).filter(([, v]) => v.trim())) : undefined;
    const r = validateQuestionDraft({ ...d, options }, { fallbackObjectiveId: d.learning_objective_id });
    if (!r.ok) { setErrors(r.errors); return; }
    onSave(r.value);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label className="text-xs">Type</Label>
              <Select value={d.type} onValueChange={(v) => set({ type: v as QuestionDraft["type"] })}>
                <SelectTrigger aria-label="Question type"><SelectValue /></SelectTrigger>
                <SelectContent>{QUESTION_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1"><Label className="text-xs">Difficulty</Label>
              <Select value={d.difficulty} onValueChange={(v) => set({ difficulty: v as QuestionDraft["difficulty"] })}>
                <SelectTrigger aria-label="Difficulty"><SelectValue /></SelectTrigger>
                <SelectContent>{DIFFICULTIES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1"><Label htmlFor="pq-marks" className="text-xs">Marks</Label>
              <Input id="pq-marks" type="number" min={0.5} max={100} step={0.5} value={d.marks} onChange={(e) => set({ marks: Number(e.target.value) })} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="pq-stem" className="text-xs">Question</Label>
            <Textarea id="pq-stem" rows={3} value={d.stem} maxLength={2000} onChange={(e) => set({ stem: e.target.value })} /></div>
          {!isMcq && (d.type === "case_based" || d.type === "scenario" || d.context_passage) && (
            <div className="space-y-1"><Label htmlFor="pq-ctx" className="text-xs">Passage / scenario (optional)</Label>
              <Textarea id="pq-ctx" rows={3} value={d.context_passage ?? ""} onChange={(e) => set({ context_passage: e.target.value })} /></div>
          )}
          {isMcq ? (
            <div className="space-y-2">
              <Label className="text-xs">Options - pick the correct one</Label>
              {KEYS.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <input type="radio" name="pq-correct" aria-label={`Option ${k} is correct`} checked={d.correct_option === k} onChange={() => set({ correct_option: k })} />
                  <span className="w-4 text-sm font-medium">{k}</span>
                  <Input aria-label={`Option ${k}`} value={d.options?.[k] ?? ""} maxLength={500} onChange={(e) => setOption(k, e.target.value)} />
                </div>
              ))}
              <div className="space-y-1"><Label htmlFor="pq-exp" className="text-xs">Explanation of the correct answer</Label>
                <Textarea id="pq-exp" rows={2} value={d.explanation ?? ""} onChange={(e) => set({ explanation: e.target.value })} /></div>
            </div>
          ) : (
            <div className="space-y-1"><Label htmlFor="pq-ans" className="text-xs">Suggested answer / marking guidance</Label>
              <Textarea id="pq-ans" rows={4} value={d.model_answer ?? ""} onChange={(e) => set({ model_answer: e.target.value })} />
              <p className="text-[11px] text-muted-foreground">Written answers are marked by a teacher or with AI assistance - this is the reference, not an auto-grade.</p></div>
          )}
          {!!d.sub_questions?.length && (
            <p className="text-[11px] text-muted-foreground">This question has {d.sub_questions.length} sub-parts; their marks must add up to the question's marks.</p>
          )}
          {errors.length > 0 && (
            <ul role="alert" className="text-xs text-destructive list-disc ps-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save question</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
