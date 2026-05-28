import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { BookOpen, Calendar, Clock, Download, FileText, GraduationCap, Printer, Search, User } from "lucide-react";
import { format } from "date-fns";

interface TeacherOpt {
  id: string;
  full_name: string | null;
  lesson_count: number;
}

interface Lesson {
  id: string;
  title: string;
  subject: string | null;
  topic: string | null;
  curriculum: string | null;
  class_level: string | null;
  section: string | null;
  vark_target: string | null;
  approach: string | null;
  delivery_method: string | null;
  duration_minutes: number | null;
  periods_count: number | null;
  learning_outcomes: string | null;
  lesson_content: string | null;
  content: any;
  ai_generated: boolean | null;
  created_at: string;
  teacher_id: string | null;
}

function buildMarkdown(l: Lesson, teacherName: string): string {
  const meta = [
    l.subject && `**Subject:** ${l.subject}`,
    l.class_level && `**Class:** ${l.class_level}${l.section ? `-${l.section}` : ""}`,
    l.curriculum && `**Curriculum:** ${l.curriculum}`,
    l.vark_target && `**VARK:** ${l.vark_target}`,
    l.approach && `**Approach:** ${l.approach}`,
    l.delivery_method && `**Delivery:** ${l.delivery_method}`,
    l.duration_minutes && `**Duration:** ${l.duration_minutes} min`,
    l.periods_count && `**Periods:** ${l.periods_count}`,
  ].filter(Boolean).join(" · ");
  return [
    `# ${l.title}`,
    "",
    meta,
    "",
    `_By ${teacherName} · Created ${format(new Date(l.created_at), "PPP p")}_`,
    "",
    l.topic ? `## Topic\n\n${l.topic}\n` : "",
    l.learning_outcomes ? `## Learning Outcomes\n\n${l.learning_outcomes}\n` : "",
    l.lesson_content ? `## Lesson Plan\n\n${l.lesson_content}\n` : "",
    l.content ? `## Structured Content\n\n\`\`\`json\n${JSON.stringify(l.content, null, 2)}\n\`\`\`\n` : "",
  ].filter(Boolean).join("\n");
}

function safeFile(s: string) {
  return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 80);
}

function downloadMarkdown(l: Lesson, teacherName: string) {
  const md = buildMarkdown(l, teacherName);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${safeFile(l.title)}.md`; a.click();
  URL.revokeObjectURL(url);
}

function buildHtml(l: Lesson, teacherName: string): string {
  const md = buildMarkdown(l, teacherName);
  // very light markdown -> html
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = esc(md)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)(?!\n<li>)/gs, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(l.title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#1f2937;line-height:1.6}h1{color:#1E2761;border-bottom:2px solid #2563EB;padding-bottom:8px}h2{color:#1E2761;margin-top:28px}h3{color:#374151}code,pre{background:#f3f4f6;border-radius:6px}pre{padding:12px;overflow:auto;white-space:pre-wrap}ul{padding-left:22px}@media print{body{margin:0}}</style>
</head><body><p>${html}</p></body></html>`;
}

function downloadHtml(l: Lesson, teacherName: string) {
  const blob = new Blob([buildHtml(l, teacherName)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${safeFile(l.title)}.html`; a.click();
  URL.revokeObjectURL(url);
}

function printLesson(l: Lesson, teacherName: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(buildHtml(l, teacherName));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

export const AdminLessonPlansView = () => {
  const [teachers, setTeachers] = useState<TeacherOpt[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<string>("");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [search, setSearch] = useState("");
  const [openLesson, setOpenLesson] = useState<Lesson | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingTeachers(true);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "teacher")
        .order("full_name");
      const { data: counts } = await supabase
        .from("lessons")
        .select("teacher_id");
      const countMap = new Map<string, number>();
      (counts || []).forEach((r: any) => {
        if (!r.teacher_id) return;
        countMap.set(r.teacher_id, (countMap.get(r.teacher_id) || 0) + 1);
      });
      const list = (profs || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        lesson_count: countMap.get(p.id) || 0,
      }));
      setTeachers(list);
      setLoadingTeachers(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedTeacher) {
      setLessons([]);
      return;
    }
    (async () => {
      setLoadingLessons(true);
      const { data } = await supabase
        .from("lessons")
        .select("*")
        .eq("teacher_id", selectedTeacher)
        .order("created_at", { ascending: false });
      setLessons((data as Lesson[]) || []);
      setLoadingLessons(false);
    })();
  }, [selectedTeacher]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lessons;
    return lessons.filter((l) =>
      [l.title, l.subject, l.topic, l.class_level, l.section]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [lessons, search]);

  const teacherName = teachers.find((t) => t.id === selectedTeacher)?.full_name || "Teacher";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" /> Lesson Plans
        </CardTitle>
        <CardDescription>
          View all lesson plans generated by teachers. Select a teacher to see their plans.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Teacher</label>
            <Select value={selectedTeacher} onValueChange={setSelectedTeacher}>
              <SelectTrigger>
                <SelectValue placeholder={loadingTeachers ? "Loading teachers..." : "Choose a teacher"} />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      {t.full_name || "Unnamed"}
                      <Badge variant="secondary" className="ml-1">
                        {t.lesson_count} plan{t.lesson_count === 1 ? "" : "s"}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, subject, class..."
                className="pl-9"
                disabled={!selectedTeacher}
              />
            </div>
          </div>
        </div>

        {!selectedTeacher && (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            Select a teacher to view their generated lesson plans.
          </div>
        )}

        {selectedTeacher && loadingLessons && (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        )}

        {selectedTeacher && !loadingLessons && filtered.length === 0 && (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            No lesson plans found for {teacherName}.
          </div>
        )}

        {selectedTeacher && !loadingLessons && filtered.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((l) => (
              <button
                key={l.id}
                onClick={() => setOpenLesson(l)}
                className="group rounded-lg border bg-card p-4 text-left transition hover:border-primary/50 hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-foreground group-hover:text-primary line-clamp-2">{l.title}</h4>
                  {l.ai_generated && <Badge variant="secondary" className="shrink-0">AI</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {l.subject && <Badge variant="outline">{l.subject}</Badge>}
                  {l.class_level && <Badge variant="outline"><GraduationCap className="mr-1 h-3 w-3" />Class {l.class_level}{l.section ? `-${l.section}` : ""}</Badge>}
                  {l.vark_target && <Badge variant="outline">{l.vark_target}</Badge>}
                  {l.periods_count && l.periods_count > 1 && <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />{l.periods_count} periods</Badge>}
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(l.created_at), "MMM d, yyyy")}
                </p>
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!openLesson} onOpenChange={(o) => !o && setOpenLesson(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl">{openLesson?.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-1.5 pt-1">
              {openLesson?.subject && <Badge variant="outline">{openLesson.subject}</Badge>}
              {openLesson?.class_level && <Badge variant="outline">Class {openLesson.class_level}{openLesson.section ? `-${openLesson.section}` : ""}</Badge>}
              {openLesson?.curriculum && <Badge variant="outline">{openLesson.curriculum}</Badge>}
              {openLesson?.vark_target && <Badge variant="outline">VARK: {openLesson.vark_target}</Badge>}
              {openLesson?.approach && <Badge variant="outline">{openLesson.approach}</Badge>}
              {openLesson?.delivery_method && <Badge variant="outline">{openLesson.delivery_method}</Badge>}
              {openLesson?.duration_minutes && <Badge variant="outline">{openLesson.duration_minutes} min</Badge>}
              {openLesson?.periods_count && <Badge variant="outline">{openLesson.periods_count} periods</Badge>}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 pr-4 -mr-4">
            <div className="space-y-4 pb-4">
              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                <span className="font-medium">By:</span> {teacherName}
                {openLesson && <> &middot; <span className="font-medium">Created:</span> {format(new Date(openLesson.created_at), "PPP p")}</>}
              </div>

              {openLesson?.topic && (
                <section>
                  <h4 className="mb-1 text-sm font-semibold text-foreground">Topic</h4>
                  <p className="text-sm text-muted-foreground">{openLesson.topic}</p>
                </section>
              )}

              {openLesson?.learning_outcomes && (
                <section>
                  <h4 className="mb-1 text-sm font-semibold text-foreground">Learning Outcomes</h4>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{openLesson.learning_outcomes}</p>
                </section>
              )}

              {openLesson?.lesson_content && (
                <section>
                  <h4 className="mb-2 text-sm font-semibold text-foreground">Lesson Plan</h4>
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-li:text-muted-foreground">
                    <ReactMarkdown>{openLesson.lesson_content}</ReactMarkdown>
                  </div>
                </section>
              )}

              {openLesson?.content && (
                <section>
                  <h4 className="mb-2 text-sm font-semibold text-foreground">Structured Content</h4>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">{JSON.stringify(openLesson.content, null, 2)}</pre>
                </section>
              )}

              {!openLesson?.lesson_content && !openLesson?.content && !openLesson?.learning_outcomes && (
                <p className="text-sm text-muted-foreground">No detailed content available for this lesson plan.</p>
              )}
            </div>
          </ScrollArea>
          <div className="flex flex-wrap justify-end gap-2 pt-3 border-t">
            <Button variant="outline" size="sm" onClick={() => openLesson && downloadMarkdown(openLesson, teacherName)}>
              <FileText className="mr-1.5 h-4 w-4" /> Markdown
            </Button>
            <Button variant="outline" size="sm" onClick={() => openLesson && downloadHtml(openLesson, teacherName)}>
              <Download className="mr-1.5 h-4 w-4" /> HTML
            </Button>
            <Button variant="outline" size="sm" onClick={() => openLesson && printLesson(openLesson, teacherName)}>
              <Printer className="mr-1.5 h-4 w-4" /> Print / PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpenLesson(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
