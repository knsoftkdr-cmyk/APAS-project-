// src/components/copilot/PaperRefineChat.tsx
// Chat to Refine Questions - the paper-aware mode of the Teacher Copilot (rendered by TeacherCopilotPanel when it is given a `paper`).
// Same endpoint as the rest of the Copilot (ai-teacher-assistant { action: "copilot", paper }). The AI only proposes; each change is
// shown as original-vs-revised and is applied to the paper only when the teacher accepts it.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCheck, Loader2, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { usePaperRefine, type PaperRefineResponse } from "@/hooks/useLearningGroups";
import { editSuggestion, fillPrompt, QUICK_PROMPTS, sumMarks, totalAfter, type PaperContext, type PaperQuestion, type Suggestion } from "@/lib/paperRefine";
import { PaperQuestionEditor } from "./PaperQuestionEditor";
import { SuggestionCard, type SuggestionStatus } from "./SuggestionCard";

export interface PaperRefineApply { applied: number; skipped: Array<{ id: string; error: string }> }
export interface PaperRefineProps {
  getPaper: () => PaperContext;
  questions: PaperQuestion[];
  selectedNumber: number | null;
  onClearSelection: () => void;
  onApply: (list: Suggestion[], label: string) => PaperRefineApply;
  className?: string;
}

interface Turn { role: "user" | "assistant"; content: string; res?: PaperRefineResponse; originals?: Record<string, PaperQuestion | null>; error?: boolean; retry?: string }

const FINDING_LABEL: Record<string, string> = {
  duplicate: "Duplicate", coverage: "Coverage", balance: "Balance", quality: "Quality", difficulty: "Difficulty", marks: "Marks", other: "Note",
};

export function PaperRefineChat({ getPaper, questions, selectedNumber, onClearSelection, onApply, className }: PaperRefineProps) {
  const refine = usePaperRefine();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Record<string, SuggestionStatus>>({});
  const [edits, setEdits] = useState<Record<string, Suggestion>>({});
  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [confirmAll, setConfirmAll] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [turns.length, refine.isPending]);

  const target = useMemo(() => getPaper().target_total_marks, [getPaper, questions]); // eslint-disable-line react-hooks/exhaustive-deps
  const effective = (s: Suggestion) => edits[s.id] ?? s;
  const statusOf = (s: Suggestion): SuggestionStatus => {
    const st = status[s.id] ?? "pending";
    if (st === "pending" && s.target_key && !questions.some((q) => q.key === s.target_key)) return "stale";
    return st;
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || refine.isPending) return;
    const history = turns.filter((t) => !t.error).map((t) => ({
      role: t.role,
      content: t.role === "assistant" && t.res
        ? [t.res.reply, ...t.res.suggestions.map((s) => `[${s.action}${s.target_number ? ` Q${s.target_number}` : ""}: ${s.reason}] (${status[s.id] ?? "pending"})`)].join("\n").slice(0, 3900)
        : t.content,
    }));
    const paper = getPaper();
    setTurns((t) => [...t, { role: "user", content: message }]);
    setInput("");
    try {
      const res = await refine.mutateAsync({ message, history, paper });
      const originals = Object.fromEntries(res.suggestions.map((s) => [s.id, paper.questions.find((q) => q.key === s.target_key) ?? null]));
      setTurns((t) => [...t, { role: "assistant", content: res.reply, res, originals }]);
    } catch (e) {
      const msg = (e as Error).message || "The AI could not answer.";
      setTurns((t) => [...t, { role: "assistant", content: msg, error: true, retry: message }]);
    }
  };

  const quick = (q: (typeof QUICK_PROMPTS)[number]) => {
    if (q.needsQuestion && !selectedNumber) { toast.info("Select a question first - use the ✨ button on a question in your test."); return; }
    send(fillPrompt(q.text, selectedNumber));
  };

  const decide = (s: Suggestion, d: SuggestionStatus) => setStatus((m) => ({ ...m, [s.id]: d }));

  const accept = (s: Suggestion) => {
    const r = onApply([effective(s)], s.action === "add" ? "Added AI question" : s.action === "marks" ? `Changed marks of Q${s.target_number}` : `Revised Q${s.target_number}`);
    if (r.applied) { decide(s, "accepted"); toast.success("Change applied to your paper. You can restore the previous version from Revision history."); }
    else { decide(s, "stale"); toast.error(r.skipped[0]?.error ?? "That change could not be applied."); }
  };

  const reject = (s: Suggestion) => { decide(s, "rejected"); };

  const regenerate = (s: Suggestion) => {
    decide(s, "superseded");
    send(`Regenerate your suggestion for ${s.target_number ? `question ${s.target_number}` : "this new question"} (${s.action}). Give a clearly different version. The earlier reason was: "${s.reason.slice(0, 200)}".`);
  };

  const pendingOf = (res: PaperRefineResponse) => res.suggestions.filter((s) => statusOf(s) === "pending");

  const acceptAll = (res: PaperRefineResponse, turnIdx: number) => {
    const list = pendingOf(res).map(effective);
    if (!list.length) return;
    const t = totalAfter(questions, list, target);
    const id = `t${turnIdx}`;
    if ((t.changes) && confirmAll !== id) { setConfirmAll(id); return; }
    setConfirmAll(null);
    const r = onApply(list, `Accepted ${list.length} AI suggestion${list.length > 1 ? "s" : ""}`);
    const skipped = new Set(r.skipped.map((x) => x.id));
    setStatus((m) => { const n = { ...m }; for (const s of list) n[s.id] = skipped.has(s.id) ? "stale" : "accepted"; return n; });
    if (r.skipped.length) toast.warning(`${r.applied} applied, ${r.skipped.length} skipped because the paper changed.`);
    else toast.success(`${r.applied} change${r.applied > 1 ? "s" : ""} applied.`);
  };

  const totalWarningFor = (s: Suggestion): string | null => {
    const e = effective(s);
    const t = totalAfter(questions, [e], target);
    if (!t.changes) return null;
    return target !== null && t.breaksTarget
      ? `Accepting this changes the total from ${t.current} to ${t.projected} marks; the required total is ${target}.`
      : `Accepting this changes the total from ${t.current} to ${t.projected} marks.`;
  };

  const total = sumMarks(questions);

  return (
    <div className={`flex flex-col min-h-0 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 pb-2">
        <Badge variant="outline" className="text-[10px]">{questions.length} question{questions.length === 1 ? "" : "s"} · {total} marks{target !== null ? ` / required ${target}` : ""}</Badge>
        {selectedNumber && (
          <Badge className="text-[10px] gap-1">Question {selectedNumber} selected
            <button type="button" aria-label="Clear selected question" onClick={onClearSelection}><X className="h-3 w-3" /></button></Badge>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pe-1 min-h-[12rem]" aria-live="polite">
        {turns.length === 0 && (
          <div className="rounded-lg border border-dashed p-3 text-sm space-y-2">
            <p className="font-medium flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-600" />Refine this paper by chatting</p>
            <p className="text-xs text-muted-foreground">I can see the questions in your test, their types, difficulty and marks. Ask for changes in plain words, e.g. “Make Question 3 harder” or “Change the last three questions into MCQs”. I only suggest - nothing changes until you accept.</p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "space-y-2"}>
            {t.role === "user" ? (
              <div className="rounded-xl px-3 py-2 max-w-[92%] text-sm bg-blue-600 text-white whitespace-pre-wrap">{t.content}</div>
            ) : t.error ? (
              <div role="alert" className="rounded-xl px-3 py-2 text-sm bg-rose-50 text-rose-700 border border-rose-200 flex gap-2 items-start dark:bg-rose-950/30 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1.5"><p>{t.content}</p><p className="text-xs opacity-80">Your paper was not changed.</p>
                  {t.retry && <Button size="sm" variant="outline" className="h-7 gap-1" disabled={refine.isPending} onClick={() => send(t.retry!)}><RotateCcw className="h-3 w-3" />Try again</Button>}</div>
              </div>
            ) : t.res && (
              <>
                {t.res.reply && <div className="rounded-xl px-3 py-2 text-sm bg-muted whitespace-pre-wrap">{t.res.reply}</div>}
                {t.res.clarification && (
                  <div className="rounded-xl px-3 py-2 text-sm border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    <p className="font-medium text-xs mb-0.5">I need one thing cleared up first</p>{t.res.clarification}</div>
                )}
                {t.res.findings.length > 0 && (
                  <ul className="space-y-1">
                    {t.res.findings.map((f, k) => (
                      <li key={k} className="text-xs rounded border px-2 py-1.5 flex gap-2">
                        <Badge variant="outline" className="text-[10px] shrink-0 h-5">{FINDING_LABEL[f.type] ?? "Note"}</Badge>
                        <span>{f.text}{f.question_numbers.length > 0 && <span className="text-muted-foreground"> (Q{f.question_numbers.join(", Q")})</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.res.warnings.map((w, k) => <p key={k} className="text-[11px] text-amber-700">{w}</p>)}
                {t.res.suggestions.length > 0 && (
                  <div className="space-y-2">
                    {pendingOf(t.res).length > 1 && (
                      <Button size="sm" variant="secondary" className="gap-1" onClick={() => acceptAll(t.res!, i)}>
                        <CheckCheck className="h-3.5 w-3.5" />{confirmAll === `t${i}` ? `Confirm: accept all ${pendingOf(t.res).length}` : `Accept all (${pendingOf(t.res).length})`}
                      </Button>
                    )}
                    {confirmAll === `t${i}` && (() => { const tt = totalAfter(questions, pendingOf(t.res).map(effective), target); return (
                      <p className="text-[11px] text-amber-700">Accepting all changes the total from {tt.current} to {tt.projected} marks{tt.target !== null ? ` (required ${tt.target})` : ""}. Press again to confirm.</p>); })()}
                    {t.res.suggestions.map((s) => (
                      <SuggestionCard key={s.id} suggestion={effective(s)} original={t.originals?.[s.id] ?? null} status={statusOf(s)}
                        totalWarning={totalWarningFor(s)} busy={refine.isPending}
                        onAccept={() => accept(s)} onReject={() => reject(s)} onEdit={() => setEditing(effective(s))} onRegenerate={() => regenerate(s)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {refine.isPending && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading your paper and working on it…</p>}
        <div ref={bottomRef} />
      </div>

      <div className="pt-2 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Quick prompts">
          {QUICK_PROMPTS.map((q) => (
            <Button key={q.label} size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={refine.isPending} onClick={() => quick(q)}>{q.label}</Button>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={4000} aria-label="Message to the AI"
            placeholder="e.g. Make Question 3 harder, or Generate 5 more questions from this chapter"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} className="resize-none" />
          <div className="flex flex-col gap-1.5">
            <Button onClick={() => send(input)} disabled={refine.isPending || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
            {turns.length > 0 && <Button variant="ghost" size="icon" onClick={() => { setTurns([]); setStatus({}); setEdits({}); }} aria-label="Clear conversation" title="Clear conversation"><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
      </div>

      <PaperQuestionEditor open={!!editing} initial={editing?.proposed ?? null} title="Edit the suggested question" onClose={() => setEditing(null)}
        onSave={(draft) => {
          if (!editing) return;
          const r = editSuggestion(editing, draft);
          if (!r.ok) { toast.error(r.errors[0]); return; }
          setEdits((m) => ({ ...m, [editing.id]: r.suggestion })); setEditing(null);
          toast.success("Your edit is saved on the suggestion. Press Accept to add it to the paper.");
        }} />
    </div>
  );
}
