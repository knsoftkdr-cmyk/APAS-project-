// src/pages/InterventionBoard.tsx  (staff, route /intervention-board)
//
// Student intervention board (sheet row 47): every support plan on one board, from "active" to its ACTUAL outcome.
//   Columns   On track · Review due / overdue · Completed - improved · Completed - needs another look
//   Cards     student, reason, tier, priority, review date, plan progress, last check-in, measured outcome
//   Detail    tick off plan steps, add dated check-in notes, compare baseline vs follow-up metrics
// Outcomes are measured, not self-reported: the intervention-effectiveness DB triggers snapshot mastery / accuracy /
// risk signals when a plan starts and again when it is completed, and set `effectiveness`.
// Data: student_interventions directly (existing RLS) + InterventionDrawer for create / edit / complete.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Loader2, MessageSquarePlus, Plus, Search, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { format, isBefore, parseISO, addDays, startOfDay } from "date-fns";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchClassOptions } from "@/lib/Classsubjects";
import { InterventionDrawer, type Intervention } from "@/components/InterventionDrawer";
import { cn } from "@/lib/utils";

// deno-lint-ignore no-explicit-any
const db = supabase as any;
const STAFF_ADMINS = ["admin", "principal", "school_admin", "hod"];

type BoardIntervention = Intervention & {
  action_progress?: Record<string, { done: boolean; at: string }>;
  check_ins?: Array<{ at: string; by: string; note: string }>;
};
interface StudentLite { id: string; full_name: string; class: string; section: string }
type Column = "on_track" | "review" | "improved" | "relook";

const COLUMNS: Array<{ key: Column; title: string; hint: string; tone: string }> = [
  { key: "on_track", title: "Active · on track", hint: "Plan running, review not due yet", tone: "border-t-blue-500" },
  { key: "review", title: "Review due / overdue", hint: "Review date within 3 days or passed", tone: "border-t-amber-500" },
  { key: "improved", title: "Completed · improved", hint: "Measured improvement after the plan", tone: "border-t-emerald-500" },
  { key: "relook", title: "Completed · needs another look", hint: "No change, worse, or not enough data", tone: "border-t-rose-500" },
];
const PRIORITY: Record<string, string> = { low: "bg-green-100 text-green-700", medium: "bg-amber-100 text-amber-700", high: "bg-red-100 text-red-700" };
const OUTCOME: Record<string, { label: string; cls: string; icon: typeof TrendingUp }> = {
  improved: { label: "Improved", cls: "bg-emerald-100 text-emerald-800", icon: TrendingUp },
  no_change: { label: "No change", cls: "bg-slate-100 text-slate-700", icon: Minus },
  worsened: { label: "Worsened", cls: "bg-red-100 text-red-800", icon: TrendingDown },
  insufficient_data: { label: "Not enough data", cls: "bg-slate-100 text-slate-600", icon: Minus },
};

function columnOf(iv: BoardIntervention, today: Date): Column | null {
  if (iv.status === "cancelled") return null;
  if (iv.status === "completed") return iv.effectiveness === "improved" ? "improved" : "relook";
  if (iv.review_date && isBefore(parseISO(iv.review_date), addDays(today, 3))) return "review";
  return "on_track";
}
const progressOf = (iv: BoardIntervention) => {
  const total = iv.action_plan?.length ?? 0;
  const done = (iv.action_plan ?? []).filter((a) => iv.action_progress?.[a]?.done).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
};
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);

export default function InterventionBoard() {
  const { user, profile } = useAuth();
  const isAdmin = STAFF_ADMINS.includes(profile?.role ?? "");
  const [rows, setRows] = useState<BoardIntervention[] | null>(null);
  const [students, setStudents] = useState<Map<string, StudentLite>>(new Map());
  const [classFilter, setClassFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ student: StudentLite; history: Intervention[] } | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    let q = db.from("student_interventions").select("*").order("updated_at", { ascending: false }).limit(500);
    q = isAdmin && profile?.school_id ? q.eq("school_id", profile.school_id) : q.eq("teacher_id", user.id);
    const { data, error } = await q;
    if (error) { toast.error(`Couldn't load interventions: ${error.message}`); setRows([]); return; }
    const list = (data ?? []) as BoardIntervention[];
    const ids = [...new Set(list.map((r) => r.student_id))];
    const map = new Map<string, StudentLite>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: st } = await db.from("students").select("id, full_name, class, section").in("id", ids.slice(i, i + 200));
      for (const s of st ?? []) map.set(s.id, { id: s.id, full_name: s.full_name ?? "Student", class: s.class ?? "", section: s.section ?? "" });
    }
    setStudents(map);
    setRows(list);
  }, [user?.id, isAdmin, profile?.school_id]);
  useEffect(() => { load(); }, [load]);

  const today = startOfDay(new Date());
  const classLabels = useMemo(() => [...new Set([...students.values()].map((s) => `${s.class}${s.section ? " - " + s.section : ""}`).filter((l) => l.trim()))].sort(), [students]);
  const filtered = useMemo(() => (rows ?? []).filter((iv) => {
    const s = students.get(iv.student_id);
    const label = s ? `${s.class}${s.section ? " - " + s.section : ""}` : "";
    const q = search.trim().toLowerCase();
    return (classFilter === "all" || label === classFilter) && (tierFilter === "all" || String(iv.tier) === tierFilter) &&
      (priorityFilter === "all" || iv.priority === priorityFilter) &&
      (!q || `${s?.full_name ?? ""} ${iv.reason}`.toLowerCase().includes(q));
  }), [rows, students, classFilter, tierFilter, priorityFilter, search]);

  const byColumn = useMemo(() => {
    const m: Record<Column, BoardIntervention[]> = { on_track: [], review: [], improved: [], relook: [] };
    for (const iv of filtered) { const c = columnOf(iv, today); if (c) m[c].push(iv); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const completed = byColumn.improved.length + byColumn.relook.length;
  const measured = filtered.filter((iv) => iv.status === "completed" && iv.effectiveness && iv.effectiveness !== "insufficient_data").length;
  const improvedPct = measured ? Math.round((byColumn.improved.length / measured) * 100) : null;
  const open = rows?.find((r) => r.id === openId) ?? null;

  const update = async (id: string, patch: Partial<BoardIntervention>) => {
    const { error } = await db.from("student_interventions").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
    return true;
  };

  const openDrawer = async (studentId: string) => {
    const s = students.get(studentId);
    if (!s) return;
    const { data } = await db.from("student_interventions").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
    setDrawer({ student: s, history: (data ?? []) as Intervention[] });
  };

  return (
    <AppLayout>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto pb-24 md:pb-6">
        <div className="rounded-2xl p-5 bg-gradient-to-r from-cyan-600 to-blue-600 shadow-lg text-white flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><ClipboardList className="h-5 w-5" /></div>
          <div className="flex-1 min-w-[12rem]">
            <h1 className="text-xl md:text-2xl font-bold">Student Intervention Board</h1>
            <p className="text-cyan-50 text-xs md:text-sm">Every support plan, its progress, and its measured outcome.</p>
          </div>
          <Button variant="secondary" className="gap-1.5" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New intervention</Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Active plans" value={byColumn.on_track.length + byColumn.review.length} />
          <StatCard label="Review due / overdue" value={byColumn.review.length} tone={byColumn.review.length ? "text-amber-700" : ""} />
          <StatCard label="Completed" value={completed} />
          <StatCard label="Improved (of measured)" value={improvedPct == null ? "–" : `${improvedPct}%`} tone="text-emerald-700" />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[12rem]"><Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search student or reason" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All classes</SelectItem>{classLabels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All tiers</SelectItem><SelectItem value="2">Tier 2</SelectItem><SelectItem value="3">Tier 3</SelectItem></SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All priorities</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
          </Select>
        </div>

        {rows === null ? <div className="grid md:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.key} className={cn("rounded-xl border border-t-4 bg-muted/30 p-2.5 space-y-2 min-h-[12rem]", col.tone)}>
                <div className="px-1">
                  <p className="text-sm font-semibold">{col.title} <span className="text-muted-foreground font-normal">({byColumn[col.key].length})</span></p>
                  <p className="text-[11px] text-muted-foreground">{col.hint}</p>
                </div>
                {byColumn[col.key].length === 0 && <p className="text-xs text-muted-foreground px-1 py-4 text-center">Nothing here</p>}
                {byColumn[col.key].map((iv) => {
                  const s = students.get(iv.student_id);
                  const p = progressOf(iv);
                  const overdue = iv.status === "active" && iv.review_date && isBefore(parseISO(iv.review_date), today);
                  const lastCheck = iv.check_ins?.[iv.check_ins.length - 1];
                  const out = iv.effectiveness ? OUTCOME[iv.effectiveness] : null;
                  return (
                    <button key={iv.id} type="button" onClick={() => setOpenId(iv.id)}
                      className="w-full text-left rounded-lg border bg-background p-3 space-y-2 hover:border-primary/50 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s?.full_name ?? "Student"}</p>
                          <p className="text-[11px] text-muted-foreground">{s ? `${s.class}${s.section ? " - " + s.section : ""}` : ""}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Badge variant="outline" className="text-[10px]">Tier {iv.tier}</Badge>
                          <Badge className={cn("text-[10px] border-0 hover:opacity-100", PRIORITY[iv.priority])}>{iv.priority}</Badge>
                        </div>
                      </div>
                      <p className="text-xs line-clamp-2">{iv.reason}</p>
                      {p.total > 0 && (
                        <div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${p.pct}%` }} /></div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{p.done}/{p.total} plan steps done</p>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {iv.review_date && iv.status === "active" && (
                          <span className={cn("inline-flex items-center gap-1", overdue ? "text-red-600 font-medium" : "text-muted-foreground")}>
                            <CalendarClock className="h-3 w-3" />{overdue ? "Overdue " : "Review "}{format(parseISO(iv.review_date), "d MMM")}
                          </span>
                        )}
                        {out && <Badge className={cn("text-[10px] border-0 gap-1 hover:opacity-100", out.cls)}><out.icon className="h-3 w-3" />{out.label}</Badge>}
                        {lastCheck && <span className="text-muted-foreground truncate">· “{lastCheck.note}”</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <InterventionDetail
          iv={open} student={students.get(open.student_id)} authorName={profile?.full_name ?? "Teacher"}
          onClose={() => setOpenId(null)} onUpdate={update}
          onEdit={() => { const id = open.student_id; setOpenId(null); openDrawer(id); }}
        />
      )}

      <NewInterventionPicker open={newOpen} onOpenChange={setNewOpen} onPick={async (s) => {
        setNewOpen(false);
        setStudents((m) => new Map(m).set(s.id, s));
        const { data } = await db.from("student_interventions").select("*").eq("student_id", s.id).order("created_at", { ascending: false });
        setDrawer({ student: s, history: (data ?? []) as Intervention[] });
      }} />

      <InterventionDrawer
        open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}
        student={drawer?.student ?? null} interventions={drawer?.history ?? []}
        onSaved={() => { setDrawer(null); load(); }}
      />
    </AppLayout>
  );
}

function StatCard({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("text-2xl font-semibold", tone)}>{value}</p></CardContent></Card>;
}

function InterventionDetail({ iv, student, authorName, onClose, onUpdate, onEdit }: {
  iv: BoardIntervention; student?: StudentLite; authorName: string;
  onClose: () => void; onUpdate: (id: string, patch: Partial<BoardIntervention>) => Promise<boolean>; onEdit: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const active = iv.status === "active";
  const b = iv.baseline_metrics, f = iv.followup_metrics;

  const toggleStep = (action: string, done: boolean) =>
    onUpdate(iv.id, { action_progress: { ...(iv.action_progress ?? {}), [action]: { done, at: new Date().toISOString() } } });

  const addCheckIn = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const ok = await onUpdate(iv.id, { check_ins: [...(iv.check_ins ?? []), { at: new Date().toISOString(), by: authorName, note: note.trim().slice(0, 1000) }] });
    setSaving(false);
    if (ok) { setNote(""); toast.success("Check-in added"); }
  };

  const metricRows: Array<[string, string, string]> = [
    ["Average mastery", pct(b?.avg_mastery), pct(f?.avg_mastery)],
    ["Accuracy (last 14 days)", pct(b?.correctness_rate_14d), pct(f?.correctness_rate_14d)],
    ["Practice attempts (14 days)", String(b?.attempts_14d ?? "–"), String(f?.attempts_14d ?? "–")],
    ["Risk signals", String(b?.risk_signal_count ?? "–"), String(f?.risk_signal_count ?? "–")],
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{student?.full_name ?? "Student"} <span className="text-sm font-normal text-muted-foreground">· {student ? `${student.class}${student.section ? " - " + student.section : ""}` : ""}</span></DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">Tier {iv.tier}</Badge>
            <Badge className={cn("border-0 hover:opacity-100", PRIORITY[iv.priority])}>{iv.priority} priority</Badge>
            <Badge variant="secondary" className="capitalize">{iv.status}</Badge>
            {iv.review_date && <Badge variant="outline">Review {format(parseISO(iv.review_date), "d MMM yyyy")}</Badge>}
            <span className="text-xs text-muted-foreground self-center">Started {format(parseISO(iv.created_at), "d MMM yyyy")}</span>
          </div>
          <div><p className="text-xs font-medium text-muted-foreground">Reason</p><p>{iv.reason}</p></div>
          {iv.expected_outcome && <div><p className="text-xs font-medium text-muted-foreground">Expected outcome</p><p>{iv.expected_outcome}</p></div>}

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Support plan</p>
            {!iv.action_plan?.length ? <p className="text-muted-foreground">No plan steps yet - use Edit to add some.</p> : (
              <div className="space-y-1">
                {iv.action_plan.map((a) => {
                  const st = iv.action_progress?.[a];
                  return (
                    <label key={a} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                      <Checkbox checked={!!st?.done} disabled={!active} onCheckedChange={(c) => toggleStep(a, c === true)} />
                      <span className={cn("flex-1", st?.done && "line-through text-muted-foreground")}>{a}</span>
                      {st?.done && <span className="text-[11px] text-muted-foreground">{format(parseISO(st.at), "d MMM")}</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Check-ins</p>
            <div className="space-y-1.5">
              {(iv.check_ins ?? []).slice().reverse().map((c, i) => (
                <div key={i} className="rounded-md bg-muted/40 px-2.5 py-1.5"><p>{c.note}</p><p className="text-[11px] text-muted-foreground">{c.by} · {format(parseISO(c.at), "d MMM yyyy, HH:mm")}</p></div>
              ))}
              {!iv.check_ins?.length && <p className="text-muted-foreground text-xs">No check-ins yet.</p>}
            </div>
            {active && (
              <div className="flex gap-2 mt-2">
                <Textarea rows={2} placeholder="What happened this week? (e.g. completed 2 remedial sheets, more confident in class)" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button onClick={addCheckIn} disabled={!note.trim() || saving} className="gap-1 self-end">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}Add
                </Button>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Measured outcome</p>
            {iv.effectiveness ? (
              <div className="flex items-center gap-2 mb-2">
                {(() => { const o = OUTCOME[iv.effectiveness]; return <Badge className={cn("border-0 gap-1 hover:opacity-100", o.cls)}><o.icon className="h-3 w-3" />{o.label}</Badge>; })()}
                {iv.outcome && <span className="text-xs text-muted-foreground">Teacher's note: {iv.outcome}</span>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                {active ? <><AlertTriangle className="h-3 w-3" />The outcome is measured automatically when you mark this plan completed.</> : "No measurement recorded."}
              </p>
            )}
            <div className="rounded-md border overflow-hidden">
              <div className="grid grid-cols-3 bg-muted/50 px-2.5 py-1 text-[11px] font-medium"><span>Signal</span><span>At start</span><span>At completion</span></div>
              {metricRows.map(([k, x, y]) => <div key={k} className="grid grid-cols-3 px-2.5 py-1 text-xs border-t"><span>{k}</span><span>{x}</span><span>{y}</span></div>)}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onEdit} className="gap-1">{active ? <><CheckCircle2 className="h-4 w-4" />Edit / complete</> : "Open history"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pick a class, then a student, to start a new intervention. */
function NewInterventionPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (s: StudentLite) => void }) {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<Array<{ id: string; label: string; name: string }>>([]);
  const [classId, setClassId] = useState("");
  const [roster, setRoster] = useState<StudentLite[] | null>(null);
  useEffect(() => { if (open && profile) fetchClassOptions(profile).then(setClasses).catch(() => setClasses([])); }, [open, profile]);
  useEffect(() => {
    setRoster(null);
    if (!classId) return;
    (async () => {
      const { data: links } = await db.from("class_students").select("student_id").eq("class_id", classId);
      const ids = (links ?? []).map((l: { student_id: string }) => l.student_id);
      const { data } = ids.length ? await db.from("students").select("id, full_name, class, section").in("id", ids).order("full_name") : { data: [] };
      setRoster((data ?? []).map((s: StudentLite) => ({ id: s.id, full_name: s.full_name ?? "Student", class: s.class ?? "", section: s.section ?? "" })));
    })();
  }, [classId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New intervention</DialogTitle></DialogHeader>
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger><SelectValue placeholder="Choose a class" /></SelectTrigger>
          <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {classId && roster === null && <Loader2 className="h-4 w-4 animate-spin" />}
          {roster?.length === 0 && <p className="text-sm text-muted-foreground">No students on this class roster.</p>}
          {roster?.map((s) => (
            <button key={s.id} type="button" className="w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-muted" onClick={() => onPick(s)}>{s.full_name}</button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
