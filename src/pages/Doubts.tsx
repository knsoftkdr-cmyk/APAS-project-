// src/pages/Doubts.tsx  (route /doubts)
//
// Doubt tickets. Students ask a teacher and follow the replies; teachers work the doubts assigned to them; school
// managers see the whole school with response-time numbers. Reads use RLS, writes go through ask_doubt / reply_doubt /
// set_doubt_status (migration 20261106000000), so what each person can do is decided on the server.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, HelpCircle, Inbox, Loader2, MessageSquare, Plus, RotateCcw, Search, Send, Timer } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { displayLocale } from "@/i18n/runtime";
import { supabase } from "@/integrations/supabase/client";
import { getTeachersForChild } from "@/lib/appointments";
import { doubtStatusLabel, doubtStats, formatDuration, type Doubt, type DoubtReply, type DoubtStatus } from "@/lib/doubts";
import { cn } from "@/lib/utils";
import { localizeServerMessage } from "@/lib/serverMessages";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

const STATUS_STYLE: Record<DoubtStatus, string> = {
  new: "bg-sky-100 text-sky-800 border-sky-200",
  in_progress: "bg-amber-100 text-amber-800 border-amber-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const when = (iso: string) => new Date(iso).toLocaleString(displayLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function AskDoubtDialog({ open, onOpenChange, initialQuestion, source }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialQuestion: string; source: "manual" | "ai_tutor";
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [teacherId, setTeacherId] = useState("");
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState(initialQuestion);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setQuestion(initialQuestion); }, [open, initialQuestion]);

  const { data: teachers = [], isLoading } = useQuery({
    queryKey: ["doubt-teachers", user?.id],
    enabled: open && !!user?.id,
    queryFn: async () => {
      const { data: me } = await supabase.from("profiles").select("class_grade, section, school_id").eq("id", user!.id).maybeSingle();
      if (!me?.class_grade || !me?.school_id) return [];
      return getTeachersForChild(me.class_grade, me.section || "", me.school_id);
    },
  });

  // A teacher can appear once per subject they teach this class, so each option is one teacher + subject pair.
  const options = teachers.map((t, i) => ({ key: `${t.teacherId}:${i}`, teacherId: t.teacherId, subject: t.subject ?? "", label: t.subject ? `${t.fullName} · ${t.subject}` : t.fullName }));
  const selectedKey = options.find((o) => o.teacherId === teacherId && o.subject === subject)?.key ?? "";

  const submit = async () => {
    if (!teacherId || !subject.trim() || !question.trim()) {
      toast.error("Please choose a teacher, add the subject and type your doubt.");
      return;
    }
    setSaving(true);
    const { error } = await db.rpc("ask_doubt", { p_teacher: teacherId, p_subject: subject.trim(), p_question: question.trim(), p_source: source });
    setSaving(false);
    if (error) { toast.error(localizeServerMessage(error.message)); return; }
    toast.success("Your doubt was sent to your teacher");
    setTeacherId(""); setSubject(""); setQuestion("");
    onOpenChange(false);
    queryClient.invalidateQueries({ queryKey: ["doubts"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)]">
        <DialogHeader><DialogTitle>Ask a doubt</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Teacher</Label>
            <Select value={selectedKey} onValueChange={(key) => {
              const o = options.find((x) => x.key === key);
              if (o) { setTeacherId(o.teacherId); setSubject(o.subject); }
            }}>
              <SelectTrigger><SelectValue placeholder={isLoading ? "Loading your teachers..." : "Choose a teacher"} /></SelectTrigger>
              <SelectContent>
                {!isLoading && options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No teachers are assigned to your class yet</div>}
                {options.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doubt-subject">Subject</Label>
            <Input id="doubt-subject" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Mathematics" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doubt-question">Your doubt</Label>
            <Textarea id="doubt-question" value={question} maxLength={4000} rows={5} onChange={(e) => setQuestion(e.target.value)} placeholder="Explain what you didn't understand" />
          </div>
          <Button onClick={submit} disabled={saving} className="w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin me-1.5" /> : <Send className="h-4 w-4 me-1.5" />}
            Send to teacher
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DoubtThread({ doubt, isStudent, onBack }: { doubt: Doubt; isStudent: boolean; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: replies = [], isLoading } = useQuery({
    queryKey: ["doubt-replies", doubt.id],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db.from("doubt_replies").select("*").eq("doubt_id", doubt.id).order("created_at");
      if (error) throw error;
      return data as DoubtReply[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["doubts"] });
    queryClient.invalidateQueries({ queryKey: ["doubt-replies", doubt.id] });
  };

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    const { error } = await db.rpc("reply_doubt", { p_doubt: doubt.id, p_body: reply.trim() });
    setBusy(false);
    if (error) { toast.error(localizeServerMessage(error.message)); return; }
    setReply("");
    refresh();
  };

  const setStatus = async (status: DoubtStatus) => {
    setBusy(true);
    const { error } = await db.rpc("set_doubt_status", { p_doubt: doubt.id, p_status: status });
    setBusy(false);
    if (error) { toast.error(localizeServerMessage(error.message)); return; }
    refresh();
  };

  return (
    <Card className="min-w-0">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <button type="button" onClick={onBack} className="text-xs text-primary mb-1 lg:hidden">Back to list</button>
            <p className="font-semibold">{doubt.subject}</p>
            <p className="text-xs text-muted-foreground">
              {isStudent ? `To ${doubt.teacher_name}` : `${doubt.student_name}${doubt.class_label ? ` · ${doubt.class_label}` : ""}`} · {when(doubt.created_at)}
              {doubt.source === "ai_tutor" && " · from AI Tutor"}
            </p>
          </div>
          <Badge variant="outline" className={STATUS_STYLE[doubt.status]}>{doubtStatusLabel(doubt.status)}</Badge>
        </div>

        <p className="text-sm whitespace-pre-wrap break-words rounded-lg bg-muted p-3">{doubt.question}</p>

        <div className="space-y-2">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {replies.map((r) => (
            <div key={r.id} className={cn("rounded-lg border p-3 text-sm", r.is_student ? "bg-background" : "bg-primary/5 border-primary/20")}>
              <p className="text-xs text-muted-foreground mb-1">{r.author_name} · {when(r.created_at)}</p>
              <p className="whitespace-pre-wrap break-words">{r.body}</p>
            </div>
          ))}
        </div>

        <Textarea value={reply} maxLength={4000} rows={3} onChange={(e) => setReply(e.target.value)} placeholder={isStudent ? "Add more detail or ask a follow-up" : "Write your answer"} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={send} disabled={busy || !reply.trim()} size="sm"><Send className="h-4 w-4 me-1.5" />Send reply</Button>
          {doubt.status !== "resolved"
            ? <Button onClick={() => setStatus("resolved")} disabled={busy} size="sm" variant="outline"><CheckCircle2 className="h-4 w-4 me-1.5" />Mark resolved</Button>
            : <Button onClick={() => setStatus("in_progress")} disabled={busy} size="sm" variant="outline"><RotateCcw className="h-4 w-4 me-1.5" />Reopen</Button>}
          {!isStudent && doubt.status === "new" && (
            <Button onClick={() => setStatus("in_progress")} disabled={busy} size="sm" variant="outline"><Clock className="h-4 w-4 me-1.5" />Mark in progress</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Doubts() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isStudent = profile?.role === "student";

  const handoff = (location.state as { askDoubt?: string } | null)?.askDoubt ?? "";
  const [askOpen, setAskOpen] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState("");
  const [askSource, setAskSource] = useState<"manual" | "ai_tutor">("manual");
  const [statusFilter, setStatusFilter] = useState<DoubtStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Arriving from the AI Tutor's "Ask my teacher": open the form once, then clear the state so a refresh doesn't reopen it.
  useEffect(() => {
    if (!handoff) return;
    setInitialQuestion(handoff);
    setAskSource("ai_tutor");
    setAskOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [handoff, location.pathname, navigate]);

  const { data: doubts = [], isLoading, error } = useQuery({
    queryKey: ["doubts"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db.from("doubts").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as Doubt[];
    },
  });

  const stats = useMemo(() => doubtStats(doubts), [doubts]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return doubts.filter((d) => (statusFilter === "all" || d.status === statusFilter)
      && (!q || [d.subject, d.question, d.student_name, d.teacher_name].some((v) => v.toLowerCase().includes(q))));
  }, [doubts, statusFilter, search]);
  const selected = doubts.find((d) => d.id === selectedId) ?? null;

  const tiles = [
    { label: "New", value: stats.new, icon: Inbox },
    { label: "In Progress", value: stats.inProgress, icon: Clock },
    { label: "Resolved", value: stats.resolved, icon: CheckCircle2 },
    ...(isStudent ? [] : [
      { label: "Avg. first response", value: localizeServerMessage(formatDuration(stats.avgFirstResponseMinutes)), icon: MessageSquare },
      { label: "Avg. time to resolve", value: localizeServerMessage(formatDuration(stats.avgResolutionMinutes)), icon: Timer },
    ]),
  ];

  return (
    <AppLayout>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
        <div className="rounded-2xl p-5 bg-gradient-to-r from-sky-600 to-indigo-600 shadow-lg flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><HelpCircle className="h-5 w-5 text-white" /></div>
            <div>
              <h1 className="text-xl font-bold text-white">{isStudent ? "My Doubts" : "Student Doubts"}</h1>
              <p className="text-sky-100 text-xs mt-0.5">{isStudent ? "Ask your teachers and follow their answers here." : "Answer doubts and track each one until it is resolved."}</p>
            </div>
          </div>
          {isStudent && (
            <Button className="bg-white text-indigo-700 hover:bg-indigo-50" onClick={() => { setInitialQuestion(""); setAskSource("manual"); setAskOpen(true); }}>
              <Plus className="h-4 w-4 me-1.5" />Ask a doubt
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <Card key={t.label}>
              <CardContent className="p-3 flex items-center gap-3">
                <t.icon className="h-5 w-5 text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-tight">{t.value}</p>
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search doubts" className="ps-9" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DoubtStatus | "all")}>
            <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">Couldn't load doubts: {(error as Error).message}</p>}

        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">
          <div className={cn("space-y-2 min-w-0", selected && "hidden lg:block")}>
            {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
            {!isLoading && visible.length === 0 && (
              <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
                {doubts.length === 0 ? (isStudent ? "You haven't asked any doubts yet." : "No doubts have been asked yet.") : "No doubts match these filters."}
              </CardContent></Card>
            )}
            {visible.map((d) => (
              <button key={d.id} type="button" onClick={() => setSelectedId(d.id)}
                className={cn("w-full text-start rounded-xl border bg-card p-3 hover:bg-accent/50 transition-colors", selectedId === d.id && "border-primary ring-1 ring-primary")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm truncate">{isStudent ? d.subject : `${d.student_name} · ${d.subject}`}</p>
                  <Badge variant="outline" className={cn("shrink-0", STATUS_STYLE[d.status])}>{doubtStatusLabel(d.status)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{d.question}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{when(d.updated_at)}{isStudent ? ` · ${d.teacher_name}` : ""}</p>
              </button>
            ))}
          </div>
          <div className={cn("min-w-0", !selected && "hidden lg:block")}>
            {selected
              ? <DoubtThread key={selected.id} doubt={selected} isStudent={isStudent} onBack={() => setSelectedId(null)} />
              : <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Select a doubt to see the conversation.</CardContent></Card>}
          </div>
        </div>
      </div>
      {isStudent && <AskDoubtDialog open={askOpen} onOpenChange={setAskOpen} initialQuestion={initialQuestion} source={askSource} />}
    </AppLayout>
  );
}
