import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { BookOpen, CheckCircle2, ExternalLink, FileText, Lock, MessageCircle, Sparkles, ArrowRight, Undo2 } from "lucide-react";
import {
  signedMaterialUrl, useStudentCourseStructure, useStudentProgressActions, useStudentTopic,
} from "@/hooks/useCourseStructure";
import {
  MATERIAL_TYPE_LABEL, formatDuration, friendlyCourseError, safeExternalUrl, videoEmbedUrl,
} from "@/lib/courseStructure";
import type { StudentTopicView } from "@/types/courseManagement";

type Material = NonNullable<StudentTopicView["materials"]>[number];

/** Resolves a stored file (private bucket -> short-lived signed URL) or an external link for one material. */
function MaterialCard({ m, onOpen }: { m: Material; onOpen: (m: Material, done?: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(safeExternalUrl(m.file_url));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (m.storage_path) {
      signedMaterialUrl(m.storage_path).then((u) => live && setUrl(u)).catch((e) => live && setErr(e.message));
    }
    return () => { live = false; };
  }, [m.storage_path]);

  const embed = m.material_type === "video" && m.file_url ? videoEmbedUrl(m.file_url) : null;
  return (
    <Card data-testid={`material-${m.id}`}>
      <CardHeader className="py-3 flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <CardTitle className="text-sm font-medium truncate">{m.title}</CardTitle>
          <Badge variant="outline">{MATERIAL_TYPE_LABEL[m.material_type]}</Badge>
        </div>
        {m.completed && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" aria-label="Viewed" />}
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {m.material_type === "notes" && m.content_body && (
          <div className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{m.content_body}</div>
        )}
        {embed && <div className="aspect-video"><iframe src={embed} title={m.title} className="h-full w-full rounded-md" allowFullScreen onLoad={() => onOpen(m)} /></div>}
        {!embed && url && m.material_type === "video" && m.storage_path && (
          <video src={url} controls className="w-full rounded-md" onPlay={() => onOpen(m)} onEnded={() => onOpen(m, true)} />
        )}
        {!embed && url && m.material_type === "image" && <img src={url} alt={m.title} className="max-h-96 rounded-md" onLoad={() => onOpen(m, true)} />}
        {url && !["notes"].includes(m.material_type) && (
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer noopener" onClick={() => onOpen(m, m.material_type !== "video")}>
              <ExternalLink className="h-4 w-4 me-1.5" />Open {m.file_name ?? "material"}
            </a>
          </Button>
        )}
        {err && <p className="text-sm text-destructive">{friendlyCourseError(err)}</p>}
        {!url && !err && m.material_type !== "notes" && <p className="text-sm text-muted-foreground">Loading…</p>}
      </CardContent>
    </Card>
  );
}

export default function StudentTopic() {
  const { courseId, topicId } = useParams<{ courseId: string; topicId: string }>();
  const navigate = useNavigate();
  const topicQ = useStudentTopic(topicId);
  const structQ = useStudentCourseStructure(courseId);
  const { complete, track } = useStudentProgressActions(courseId, topicId);

  // Time spent: ping every 60s while the tab is visible, and once when leaving. Locked topics are never pinged.
  const startedAt = useRef(Date.now());
  const unlocked = topicQ.data && !topicQ.data.locked;
  useEffect(() => {
    if (!unlocked) return;
    startedAt.current = Date.now();
    track(0); // records "last position" immediately
    const flush = () => {
      const secs = (Date.now() - startedAt.current) / 1000;
      startedAt.current = Date.now();
      if (secs > 1 && document.visibilityState === "visible") void track(secs).catch(() => undefined);
    };
    const id = window.setInterval(flush, 60_000);
    return () => { window.clearInterval(id); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, topicId]);

  if (topicQ.isLoading) {
    return <div className="p-6 max-w-3xl mx-auto space-y-4"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-32" /><Skeleton className="h-48" /></div>;
  }
  if (topicQ.error || !topicQ.data) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card><CardContent className="pt-6 space-y-3">
          <p className="font-medium">We couldn't open this topic.</p>
          <p className="text-sm text-muted-foreground">{friendlyCourseError((topicQ.error as Error | null)?.message)}</p>
          <Button variant="outline" onClick={() => navigate(`/student/courses/${courseId}`)}>Back to subject</Button>
        </CardContent></Card>
      </div>
    );
  }

  const d = topicQ.data;
  const course = structQ.data?.course;
  const crumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink asChild><Link to="/student/courses">Courses</Link></BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink asChild><Link to={`/student/courses/${courseId}`}>{course?.title ?? "Subject"}</Link></BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{d.topic.title}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  // Locked: explain exactly what is missing instead of showing content.
  if (d.locked) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        {crumb}
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-medium">"{d.topic.title}" is locked</p>
              <p className="text-sm text-muted-foreground">Finish these topics first to unlock it:</p>
              <ul className="space-y-1">
                {(d.missing_prerequisites ?? []).map((p) => (
                  <li key={p.id}><Link className="text-sm text-primary underline" to={`/student/courses/${courseId}/topics/${p.id}`}>{p.title}</Link></li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const markDone = (done: boolean) =>
    complete.mutate(done, {
      onError: (e) => toast.error(friendlyCourseError(e.message)),
      onSuccess: (r) => {
        if (done) toast.success(`Topic completed · subject ${r.course_percent}% done`);
      },
    });
  const trackMaterial = (m: Material, done?: boolean) => {
    if (m.completed && !done) return;
    void track(0, { id: m.id, percent: done ? 100 : undefined, completed: done }).then(() => topicQ.refetch()).catch(() => undefined);
  };

  const materials = d.materials ?? [];
  const html = d.topic.content_body;
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      {crumb}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{d.topic.title}</h1>
          {d.completed && <Badge className="bg-green-600 hover:bg-green-600">Completed</Badge>}
          {d.topic.topic_type === "practice" && <Badge variant="secondary">Practice</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {[d.topic.estimated_minutes ? `~${d.topic.estimated_minutes} min` : null,
            d.time_spent_seconds ? `${formatDuration(d.time_spent_seconds)} spent` : null].filter(Boolean).join(" · ")}
        </p>
        {d.topic.description && <p>{d.topic.description}</p>}
      </div>

      {d.topic.learning_objectives && (
        <Card><CardHeader className="py-3"><CardTitle className="text-sm">Learning objectives</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm whitespace-pre-wrap">{d.topic.learning_objectives}</CardContent></Card>
      )}

      {html && (
        // Authored by staff (write access is RLS-restricted), same trust level as the existing lesson content.
        <div className="prose prose-sm max-w-none rounded-md border bg-card p-4" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {d.topic.content_url && safeExternalUrl(d.topic.content_url) && (
        <Button variant="outline" size="sm" asChild><a href={safeExternalUrl(d.topic.content_url)!} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4 me-1.5" />Open attachment</a></Button>
      )}

      <section className="space-y-3">
        <h2 className="font-medium flex items-center gap-2"><BookOpen className="h-4 w-4" />Learning materials</h2>
        {materials.length === 0
          ? <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">No materials have been added to this topic yet.</p>
          : materials.map((m) => <MaterialCard key={m.id} m={m} onOpen={trackMaterial} />)}
      </section>

      {(d.linked_work ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Related work</h2>
          {d.linked_work!.map((w) => (
            <Link key={w.id} to={w.link_type === "worksheet" ? "/worksheets" : w.link_type === "assessment" ? "/my-exams" : "/dashboard"}
              className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/40">
              <span className="text-sm"><Badge variant="outline" className="me-2 capitalize">{w.link_type}</Badge>{w.title ?? "Untitled"}</span>
              <span className="text-xs text-muted-foreground">{w.due_date ? `Due ${new Date(w.due_date).toLocaleDateString()}` : ""}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {!d.completed ? (
          <Button onClick={() => markDone(true)} disabled={complete.isPending}><CheckCircle2 className="h-4 w-4 me-1.5" />Mark topic complete</Button>
        ) : (
          <Button variant="outline" onClick={() => markDone(false)} disabled={complete.isPending}><Undo2 className="h-4 w-4 me-1.5" />Mark as not done</Button>
        )}
        <Button variant="outline" asChild><Link to={`/ai-tutor?topic=${d.topic.id}`}><MessageCircle className="h-4 w-4 me-1.5" />Ask the AI Tutor</Link></Button>
        {d.next_topic_id && (
          <Button variant="secondary" className="ms-auto" onClick={() => navigate(`/student/courses/${courseId}/topics/${d.next_topic_id}`)}>
            <Sparkles className="h-4 w-4 me-1.5" />Next topic<ArrowRight className="h-4 w-4 ms-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
