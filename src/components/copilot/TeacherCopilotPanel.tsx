// src/components/copilot/TeacherCopilotPanel.tsx
// Teacher Copilot: one assistant for lesson planning, assessment design, remediation and student analysis,
// grounded in the class's mastery, peer groups, learning groups and risk data.
// Data: ai-teacher-assistant { action: "copilot" }.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Info, Send, Sparkles, Trash2, Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTeacherCopilot, type CopilotResponse, type CopilotTask } from "@/hooks/useLearningGroups";

interface Option { id: string; label: string }
interface ClassTeacherRow { class_id: string; classes: { id: string; name: string; section: string | null } | null }
interface BookRow { id: number; subject: string; class_name: string | null }
// `books` is missing from the generated Supabase types (src/integrations/supabase/types.ts), so type this one query by hand.
interface UntypedBooksClient {
  from: (t: "books") => { select: (c: string) => { eq: (c: string, v: boolean) => { order: (c: string) => PromiseLike<{ data: BookRow[] | null }> } } };
}
interface RosterRow { student_id: string; students: { id: string; full_name: string | null } | null }
interface Turn { role: "user" | "assistant"; content: string; meta?: CopilotResponse; error?: boolean }

const NONE = "none";
const TASKS: Array<{ value: CopilotTask; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "lesson_plan", label: "Lesson plan" },
  { value: "assessment", label: "Assessment" },
  { value: "remediation", label: "Remediation" },
  { value: "student_analysis", label: "Student analysis" },
  { value: "general", label: "General" },
];
const TASK_LABEL = Object.fromEntries(TASKS.map((t) => [t.value, t.label])) as Record<string, string>;

const STARTERS: Array<{ label: string; task: CopilotTask; text: string; needs?: "class" | "student" }> = [
  { label: "Plan a lesson on our weakest topic", task: "lesson_plan", text: "Plan a 40-minute lesson on this class's weakest topic, with support, core and extension tasks for each group.", needs: "class" },
  { label: "Build a diagnostic quiz", task: "assessment", text: "Design a 10-question diagnostic quiz that targets the topics this class finds hardest, with a marking scheme.", needs: "class" },
  { label: "Remedial plan for the support groups", task: "remediation", text: "Write a two-week remediation plan for the remedial group, addressing their shared misconceptions.", needs: "class" },
  { label: "Analyse this student", task: "student_analysis", text: "Analyse this student's strengths, gaps and risk signals, and suggest next steps and parent talking points.", needs: "student" },
];

export function TeacherCopilotPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const copilot = useTeacherCopilot();

  const [classes, setClasses] = useState<Option[]>([]);
  const [books, setBooks] = useState<Option[]>([]);
  const [students, setStudents] = useState<Option[]>([]);
  const [classId, setClassId] = useState(NONE);
  const [bookId, setBookId] = useState(NONE);
  const [studentId, setStudentId] = useState(NONE);
  const [task, setTask] = useState<CopilotTask>("auto");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const [{ data: ct }, { data: bk }] = await Promise.all([
        supabase.from("class_teachers").select("class_id, classes(id, name, section)").eq("teacher_id", user.id),
        (supabase as unknown as UntypedBooksClient).from("books").select("id, subject, class_name").eq("is_active", true).order("subject"),
      ]);
      setClasses(((ct as unknown as ClassTeacherRow[]) ?? []).filter((c) => c.classes).map((c) => ({ id: c.classes!.id, label: `${c.classes!.name}${c.classes!.section ? " - " + c.classes!.section : ""}` })));
      setBooks((bk ?? []).map((b) => ({ id: String(b.id), label: `${b.subject}${b.class_name ? ` (${b.class_name})` : ""}` })));
    })();
  }, [user?.id]);

  useEffect(() => {
    setStudentId(NONE);
    setStudents([]);
    if (classId === NONE) return;
    (async () => {
      const { data } = await supabase.from("class_students").select("student_id, students(id, full_name)").eq("class_id", classId);
      setStudents(((data as unknown as RosterRow[]) ?? []).map((r) => ({ id: r.student_id, label: r.students?.full_name ?? "Student" })).sort((a, b) => a.label.localeCompare(b.label)));
    })();
  }, [classId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length, copilot.isPending]);

  const send = async (text = input, forcedTask = task) => {
    const message = text.trim();
    if (!message || copilot.isPending) return;
    const history = turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: message }]);
    setInput("");
    try {
      const res = await copilot.mutateAsync({
        message, task: forcedTask,
        classId: classId === NONE ? undefined : classId,
        bookId: bookId === NONE ? undefined : Number(bookId),
        studentId: studentId === NONE ? undefined : studentId,
        history,
      });
      setTurns((t) => [...t, { role: "assistant", content: res.reply, meta: res }]);
    } catch (e) {
      const msg = (e as Error).message;
      setTurns((t) => [...t, { role: "assistant", content: msg, error: true }]);
      toast({ title: "Copilot couldn't answer", description: msg, variant: "destructive" });
    }
  };

  const starter = (s: (typeof STARTERS)[number]) => {
    if (s.needs === "class" && classId === NONE) { toast({ title: "Pick a class first", description: "The Copilot grounds its answer in your class's data." }); return; }
    if (s.needs === "student" && studentId === NONE) { toast({ title: "Pick a student first" }); return; }
    setTask(s.task);
    send(s.text, s.task);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No class selected</SelectItem>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bookId} onValueChange={setBookId}>
              <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All subjects</SelectItem>
                {books.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={studentId} onValueChange={setStudentId} disabled={classId === NONE}>
              <SelectTrigger><SelectValue placeholder="Student (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Whole class</SelectItem>
                {students.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={task} onValueChange={(v) => setTask(v as CopilotTask)}>
              <SelectTrigger><SelectValue placeholder="Task" /></SelectTrigger>
              <SelectContent>{TASKS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            Pick a class to ground answers in its mastery, groups and risk data. Student names are replaced with codes before anything is sent to the AI model.
          </p>
        </CardContent>
      </Card>

      {turns.length === 0 ? (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-600" /> What would you like help with?</p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <Button key={s.label} size="sm" variant="outline" onClick={() => starter(s)} disabled={copilot.isPending}>{s.label}</Button>
            ))}
          </div>
        </CardContent></Card>
      ) : (
        <div className="space-y-3" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={[
                "rounded-xl px-4 py-3 max-w-[92%] text-sm",
                t.role === "user" ? "bg-blue-600 text-white" : t.error ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-muted",
              ].join(" ")}>
                {t.role === "user" || t.error ? <p className="whitespace-pre-wrap">{t.content}</p> : (
                  <>
                    <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{t.content}</ReactMarkdown></div>
                    {t.meta && (
                      <div className="mt-3 pt-2 border-t space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{TASK_LABEL[t.meta.task]}</Badge>
                          {t.meta.grounded_in.length > 0 && (
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Database className="h-3 w-3" /> Based on: {t.meta.grounded_in.join(", ")}
                            </span>
                          )}
                        </div>
                        {t.meta.warnings.map((w, k) => <p key={k} className="text-[11px] text-amber-700">{w}</p>)}
                        {t.meta.suggested_actions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {t.meta.suggested_actions.map((a) => (
                              <Button key={a.route} size="sm" variant="secondary" className="h-7 text-xs" onClick={() => navigate(a.route)}>{a.label}</Button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {copilot.isPending && <p className="text-xs text-muted-foreground animate-pulse">Copilot is working on it…</p>}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="flex gap-2 items-end">
        <Textarea
          value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={4000}
          placeholder="Ask for a lesson plan, a quiz, a remediation plan, or an analysis of a student…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="resize-none"
        />
        <div className="flex flex-col gap-1.5">
          <Button onClick={() => send()} disabled={copilot.isPending || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          {turns.length > 0 && (
            <Button variant="ghost" size="icon" onClick={() => setTurns([])} aria-label="Clear conversation" title="Clear conversation"><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}
