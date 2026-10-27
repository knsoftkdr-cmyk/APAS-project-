// src/pages/DigitalClassroom.tsx  (routes /classroom for staff, /my-classroom for students)
//
// Digital classroom workspace (sheet row 43): one class, one place -
//   Stream      announcements, discussion and questions with replies
//   Materials   files and links shared with the class
//   Assignments homework and tests set for the class (students see their own status)
//   Attendance  today's register for the teacher; the student's own record for students
//   Live        upcoming virtual classroom sessions with their join link
// Data: ai-teacher-assistant { action: "classroom" } (see useDigitalClassroom).
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BookOpen, ClipboardList, ExternalLink, FileText, Link2, Loader2, Megaphone, MessageCircle, MessagesSquare, Pin, PinOff,
  School, Send, Trash2, Upload, UserCheck, Video,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { fetchClassOptions } from "@/lib/Classsubjects";
import {
  uploadClassroomFile, useClassroomAction, useClassroomOverview,
  type AttendanceStatus, type ClassroomOverview, type ClassroomPost,
} from "@/hooks/useDigitalClassroom";

const STAFF_ADMINS = ["admin", "principal", "hod", "school_admin"];
const KIND_STYLE: Record<ClassroomPost["kind"], { label: string; cls: string; icon: typeof Megaphone }> = {
  announcement: { label: "Announcement", cls: "bg-indigo-100 text-indigo-800", icon: Megaphone },
  discussion: { label: "Discussion", cls: "bg-slate-100 text-slate-700", icon: MessagesSquare },
  question: { label: "Question", cls: "bg-amber-100 text-amber-800", icon: MessageCircle },
};
const ATT: Array<{ v: AttendanceStatus; label: string; cls: string }> = [
  { v: "present", label: "P", cls: "data-[on=true]:bg-emerald-600" },
  { v: "absent", label: "A", cls: "data-[on=true]:bg-red-600" },
  { v: "late", label: "L", cls: "data-[on=true]:bg-amber-500" },
  { v: "excused", label: "E", cls: "data-[on=true]:bg-slate-500" },
];

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const fmtSize = (b: number | null) => (b == null ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export default function DigitalClassroom() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const classParam = params.get("class");
  const isStaffAdmin = STAFF_ADMINS.includes(profile?.role ?? "");

  // Staff admins pick from their school's classes; teachers and students get their own list from the server.
  const [adminClasses, setAdminClasses] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    if (!isStaffAdmin || !profile) return;
    fetchClassOptions(profile).then((c) => setAdminClasses(c.map((x) => ({ id: x.id, label: x.label })))).catch(() => setAdminClasses([]));
  }, [isStaffAdmin, profile]);
  const effectiveClass = classParam ?? (isStaffAdmin ? adminClasses[0]?.id ?? null : null);

  const { data, isLoading, error } = useClassroomOverview(isStaffAdmin && !effectiveClass ? null : effectiveClass);
  const classOptions = isStaffAdmin ? adminClasses : data?.classes ?? [];
  const moderator = data?.role === "teacher" || data?.role === "staff";

  return (
    <AppLayout>
      <div className="p-3 sm:p-4 md:p-6 space-y-4 max-w-6xl mx-auto pb-24 md:pb-6">
        <div className="rounded-2xl p-5 bg-gradient-to-r from-sky-600 to-indigo-600 shadow-lg text-white">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><School className="h-5 w-5" /></div>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-bold truncate">{data?.class?.label ?? "Classroom"}</h1>
                <p className="text-sky-50 text-xs md:text-sm">Materials, discussion, assignments and attendance in one place{data?.class ? ` · ${data.class.roster_size} students` : ""}</p>
              </div>
            </div>
            {classOptions.length > 1 && (
              <Select value={data?.class?.id ?? effectiveClass ?? ""} onValueChange={(v) => setParams({ class: v })}>
                <SelectTrigger className="sm:w-56 bg-white/10 border-white/30 text-white"><SelectValue placeholder="Choose class" /></SelectTrigger>
                <SelectContent>{classOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>

        {isLoading ? <Skeleton className="h-64" />
          : error ? <Card><CardContent className="p-6 text-sm text-destructive">{errMsg(error)}</CardContent></Card>
          : !data?.class ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              {isStaffAdmin ? "Choose a class to open its classroom." : "You are not part of any class yet. Ask your school admin to add you to a class."}
            </CardContent></Card>
          ) : (
            <Tabs defaultValue="stream">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="stream" className="gap-1.5"><MessagesSquare className="h-4 w-4" />Stream</TabsTrigger>
                <TabsTrigger value="materials" className="gap-1.5"><BookOpen className="h-4 w-4" />Materials</TabsTrigger>
                <TabsTrigger value="assignments" className="gap-1.5"><ClipboardList className="h-4 w-4" />Assignments</TabsTrigger>
                <TabsTrigger value="attendance" className="gap-1.5"><UserCheck className="h-4 w-4" />Attendance</TabsTrigger>
                <TabsTrigger value="live" className="gap-1.5"><Video className="h-4 w-4" />Live</TabsTrigger>
              </TabsList>
              <TabsContent value="stream"><StreamTab data={data} moderator={moderator} /></TabsContent>
              <TabsContent value="materials"><MaterialsTab data={data} moderator={moderator} /></TabsContent>
              <TabsContent value="assignments"><AssignmentsTab data={data} moderator={moderator} /></TabsContent>
              <TabsContent value="attendance"><AttendanceTab data={data} moderator={moderator} /></TabsContent>
              <TabsContent value="live"><LiveTab data={data} moderator={moderator} /></TabsContent>
            </Tabs>
          )}
      </div>
    </AppLayout>
  );
}

interface TabProps { data: ClassroomOverview; moderator: boolean }

function StreamTab({ data, moderator }: TabProps) {
  const act = useClassroomAction();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<ClassroomPost["kind"]>(moderator ? "announcement" : "question");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const run = (args: Record<string, unknown> & { op: string }, ok?: string, after?: () => void) =>
    act.mutate(args, { onSuccess: () => { if (ok) toast.success(ok); after?.(); }, onError: (e) => toast.error(errMsg(e)) });

  return (
    <div className="space-y-3">
      <Card><CardContent className="p-4 space-y-2">
        <Textarea rows={3} maxLength={5000} placeholder={moderator ? "Share an announcement or start a discussion with your class…" : "Ask a question or share something with your class…"} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as ClassroomPost["kind"])}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {moderator && <SelectItem value="announcement">Announcement</SelectItem>}
              <SelectItem value="discussion">Discussion</SelectItem>
              <SelectItem value="question">Question</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="ml-auto gap-1" disabled={!body.trim() || act.isPending}
            onClick={() => run({ op: "post", class_id: data.class!.id, body: body.trim(), kind }, "Posted", () => setBody(""))}>
            <Send className="h-3.5 w-3.5" />Post
          </Button>
        </div>
      </CardContent></Card>

      {!data.posts?.length && <p className="text-sm text-muted-foreground px-1">Nothing here yet. Start the conversation!</p>}
      {data.posts?.map((p) => {
        const k = KIND_STYLE[p.kind];
        return (
          <Card key={p.id} className={p.pinned ? "border-indigo-300" : ""}>
            <CardContent className="p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className={`gap-1 border-0 ${k.cls}`}><k.icon className="h-3 w-3" />{k.label}</Badge>
                {p.pinned && <Badge variant="secondary" className="gap-1"><Pin className="h-3 w-3" />Pinned</Badge>}
                <span className="font-medium">{p.author.name}</span>
                {p.author.role && p.author.role !== "student" && <span className="text-muted-foreground capitalize">({p.author.role.replace("_", " ")})</span>}
                <span className="text-muted-foreground">{fmt(p.created_at)}</span>
                <div className="ml-auto flex gap-1">
                  {moderator && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" title={p.pinned ? "Unpin" : "Pin"} onClick={() => run({ op: "pin_post", post_id: p.id, pinned: !p.pinned })}>
                      {p.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  {p.can_delete && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete"
                      onClick={() => { if (window.confirm("Delete this post and its replies?")) run({ op: "delete_post", post_id: p.id }, "Deleted"); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap">{p.body}</p>
              {p.comments.length > 0 && (
                <div className="border-l-2 pl-3 space-y-1.5">
                  {p.comments.map((c) => (
                    <div key={c.id} className="text-sm">
                      <span className="font-medium text-xs">{c.author.name}</span> <span className="text-[11px] text-muted-foreground">{fmt(c.created_at)}</span>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input className="h-8 text-sm" placeholder="Write a reply…" maxLength={2000} value={replies[p.id] ?? ""}
                  onChange={(e) => setReplies((r) => ({ ...r, [p.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && replies[p.id]?.trim()) run({ op: "comment", post_id: p.id, body: replies[p.id].trim() }, undefined, () => setReplies((r) => ({ ...r, [p.id]: "" }))); }} />
                <Button size="sm" variant="outline" className="h-8" disabled={!replies[p.id]?.trim() || act.isPending}
                  onClick={() => run({ op: "comment", post_id: p.id, body: replies[p.id].trim() }, undefined, () => setReplies((r) => ({ ...r, [p.id]: "" })))}>Reply</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MaterialsTab({ data, moderator }: TabProps) {
  const act = useClassroomAction();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState<{ title: string; body: string } | null>(null);

  const byTopic = useMemo(() => {
    const m = new Map<string, NonNullable<ClassroomOverview["materials"]>>();
    for (const x of data.materials ?? []) m.set(x.topic || "General", [...(m.get(x.topic || "General") ?? []), x]);
    return [...m.entries()];
  }, [data.materials]);

  async function add() {
    if (!title.trim()) return;
    setUploading(true);
    try {
      if (mode === "file") {
        if (!file) return;
        if (file.size > 25 * 1024 * 1024) { toast.error("Files must be 25 MB or smaller"); return; }
        await uploadClassroomFile(data.class!.id, file, { title: title.trim(), topic: topic.trim() || undefined, description: description.trim() || undefined });
        await qc.invalidateQueries({ queryKey: ["classroom"] });
      } else {
        await act.mutateAsync({ op: "material_add", class_id: data.class!.id, kind: "link", url: url.trim(), title: title.trim(), topic: topic.trim() || undefined, description: description.trim() || undefined });
      }
      toast.success("Material shared");
      setTitle(""); setTopic(""); setDescription(""); setUrl(""); setFile(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {moderator && (
        <Card><CardContent className="p-4 space-y-2">
          <div className="flex gap-2">
            <Button size="sm" variant={mode === "file" ? "default" : "outline"} onClick={() => setMode("file")} className="gap-1"><Upload className="h-3.5 w-3.5" />File</Button>
            <Button size="sm" variant={mode === "link" ? "default" : "outline"} onClick={() => setMode("link")} className="gap-1"><Link2 className="h-3.5 w-3.5" />Link</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Title *" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Topic / chapter (optional)" value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} />
            {mode === "file"
              ? <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sm:col-span-2" />
              : <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} className="sm:col-span-2" />}
            <Textarea rows={2} placeholder="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} className="sm:col-span-2" />
          </div>
          <Button size="sm" onClick={add} className="gap-1" disabled={uploading || !title.trim() || (mode === "file" ? !file : !/^https?:\/\//i.test(url.trim()))}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}Share with class
          </Button>
        </CardContent></Card>
      )}
      {!byTopic.length && <p className="text-sm text-muted-foreground px-1">No materials shared yet.</p>}
      {byTopic.map(([topicName, items]) => (
        <Card key={topicName}>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{topicName}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {items.map((m) => (
              <div key={m.id} className="flex items-start gap-3 rounded-lg border p-2.5">
                <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">{m.kind === "link" ? <Link2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{m.title}</p>
                  {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                  <p className="text-[11px] text-muted-foreground">{m.uploaded_by} · {fmt(m.created_at)}{m.file_name ? ` · ${m.file_name} ${fmtSize(m.size_bytes)}` : ""}</p>
                </div>
                {m.url && <Button asChild size="sm" variant="outline" className="h-8 gap-1"><a href={m.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />Open</a></Button>}
                {m.kind === "text" && m.body && (
                  <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setReading({ title: m.title, body: m.body! })}><BookOpen className="h-3.5 w-3.5" />Open</Button>
                )}
                {moderator && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Delete"
                    onClick={() => { if (window.confirm("Delete this material?")) act.mutate({ op: "material_delete", id: m.id }, { onError: (e) => toast.error(errMsg(e)) }); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!reading} onOpenChange={(o) => !o && setReading(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{reading?.title}</DialogTitle></DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown>{reading?.body ?? ""}</ReactMarkdown></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignmentsTab({ data, moderator }: TabProps) {
  const items = data.assignments ?? [];
  const label = (t: string) => (t === "mock_exam" ? "Mock exam" : t === "test" ? "Test" : "Homework");
  return (
    <div className="space-y-3">
      {moderator && (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="gap-1"><Link to="/assessment-builder"><ClipboardList className="h-3.5 w-3.5" />Create a test</Link></Button>
          <Button asChild size="sm" variant="outline" className="gap-1"><Link to="/curative"><BookOpen className="h-3.5 w-3.5" />Create homework</Link></Button>
        </div>
      )}
      {!items.length && <p className="text-sm text-muted-foreground px-1">No assignments yet.</p>}
      {items.map((a) => {
        const overdue = a.due && new Date(a.due) < new Date() && !["submitted", "graded"].includes(a.status ?? "");
        return (
          <Card key={`${a.type}:${a.id}`}><CardContent className="p-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{label(a.type)}</Badge>
            <span className="text-sm font-medium flex-1 min-w-[10rem]">{a.title}</span>
            {a.subject && <span className="text-xs text-muted-foreground">{a.subject}</span>}
            {a.due && <span className={`text-xs ${overdue ? "text-red-600" : "text-muted-foreground"}`}>Due {fmt(a.due)}</span>}
            {a.status && <Badge variant="secondary" className="capitalize">{a.status.replace("_", " ")}</Badge>}
            {!moderator && a.type !== "homework" && a.status !== "graded" && a.status !== "submitted" && (
              <Button asChild size="sm" className="h-8"><Link to={`/exam/${a.id}`}>Start</Link></Button>
            )}
            {!moderator && a.type === "homework" && <Button asChild size="sm" variant="outline" className="h-8"><Link to="/dashboard">Open</Link></Button>}
          </CardContent></Card>
        );
      })}
    </div>
  );
}

function AttendanceTab({ data, moderator }: TabProps) {
  const act = useClassroomAction();
  const roster = data.attendance?.roster;
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  useEffect(() => {
    setMarks(Object.fromEntries((roster ?? []).filter((r) => r.status).map((r) => [r.student_id, r.status as AttendanceStatus])));
  }, [roster]);

  if (!moderator) {
    const a = data.attendance;
    return (
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm">Attendance over your last {a?.recent?.length ?? 0} records: <span className="font-semibold">{a?.present_pct ?? "–"}%</span></p>
        <div className="flex flex-wrap gap-1.5">
          {(a?.recent ?? []).map((r) => <Badge key={r.date} variant="outline" className="capitalize">{r.date}: {r.status.replace("_", " ")}</Badge>)}
        </div>
      </CardContent></Card>
    );
  }

  const unmarked = (roster ?? []).filter((r) => !marks[r.student_id]).length;
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Today ({data.attendance?.date}) · {unmarked} unmarked</p>
        <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => setMarks(Object.fromEntries((roster ?? []).map((r) => [r.student_id, "present" as AttendanceStatus])))}>All present</Button>
        <Button size="sm" className="h-8" disabled={act.isPending || !Object.keys(marks).length}
          onClick={() => act.mutate({ op: "attendance_save", class_id: data.class!.id, date: data.attendance?.date, marks },
            { onSuccess: (r) => toast.success(`Saved ${(r as { saved?: number }).saved ?? ""} records`), onError: (e) => toast.error(errMsg(e)) })}>
          {act.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
      {!roster?.length ? <p className="text-sm text-muted-foreground">No students on this class roster.</p> : (
        <div className="divide-y">
          {roster.map((r) => (
            <div key={r.student_id} className="flex items-center gap-2 py-1.5">
              <span className="text-sm flex-1 truncate">{r.name}</span>
              {ATT.map((o) => (
                <button key={o.v} type="button" data-on={marks[r.student_id] === o.v}
                  className={`h-7 w-7 rounded-md border text-xs font-semibold data-[on=true]:text-white data-[on=true]:border-transparent ${o.cls}`}
                  title={o.v} aria-pressed={marks[r.student_id] === o.v}
                  onClick={() => setMarks((m) => ({ ...m, [r.student_id]: o.v }))}>{o.label}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">For period-wise attendance and parent notifications use the full <Link to="/attendance" className="underline">Attendance</Link> page.</p>
    </CardContent></Card>
  );
}

function LiveTab({ data, moderator }: TabProps) {
  const sessions = data.sessions ?? [];
  return (
    <div className="space-y-3">
      {moderator && <Button asChild size="sm" className="gap-1"><Link to="/virtual-classrooms"><Video className="h-3.5 w-3.5" />Schedule / open whiteboard</Link></Button>}
      {!sessions.length && <p className="text-sm text-muted-foreground px-1">No upcoming live sessions.</p>}
      {sessions.map((s) => {
        const live = new Date(s.scheduled_start) <= new Date() && new Date(s.scheduled_end) >= new Date();
        return (
          <Card key={s.id}><CardContent className="p-3 flex flex-wrap items-center gap-2">
            {live && <Badge className="bg-red-600">Live now</Badge>}
            <span className="text-sm font-medium flex-1">{s.title || s.subject || "Live class"}</span>
            <span className="text-xs text-muted-foreground">{fmt(s.scheduled_start)}</span>
            {s.meet_link && <Button asChild size="sm" className="h-8 gap-1"><a href={s.meet_link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />Join</a></Button>}
          </CardContent></Card>
        );
      })}
    </div>
  );
}
