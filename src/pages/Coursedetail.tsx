import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, CheckCircle2, Circle, CircleDot, Lock, PlayCircle } from "lucide-react";
import type { Course, StructureModule, StructureTopic, StudentCourseProgress } from "@/types/courseManagement";
import { sb, useStudentCourseStructure } from "@/hooks/useCourseStructure";
import { STATE_LABEL, percent } from "@/lib/courseStructure";

const STATE_ICON = {
  completed: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  in_progress: <CircleDot className="h-4 w-4 text-blue-600" />,
  available: <Circle className="h-4 w-4 text-muted-foreground" />,
  locked: <Lock className="h-4 w-4 text-amber-600" />,
} as const;

function TopicRow({ t, courseId }: { t: StructureTopic; courseId: string }) {
  const locked = t.state === "locked";
  const body = (
    <div className={`flex items-center gap-3 rounded-md border p-3 ${locked ? "opacity-70" : "hover:bg-muted/40"}`} data-testid={`topic-${t.id}`}>
      {STATE_ICON[t.state]}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{t.title}</div>
        {locked && t.locked_reason && <div className="text-xs text-amber-700 dark:text-amber-400">{t.locked_reason}</div>}
      </div>
      {t.topic_type === "practice" && <Badge variant="secondary">Practice</Badge>}
      <span className="text-xs text-muted-foreground hidden sm:inline">{STATE_LABEL[t.state]}</span>
    </div>
  );
  // Locked topics still open the page, which explains what is missing (the server never returns locked content).
  return <Link to={`/student/courses/${courseId}/topics/${t.id}`} aria-label={`${t.title} – ${STATE_LABEL[t.state]}`}>{body}</Link>;
}

function ModuleCard({ m, courseId, defaultOpen, locked, legacyDone, onLegacyToggle, saving }: {
  m: StructureModule; courseId: string; defaultOpen: boolean; locked: boolean;
  legacyDone: boolean; onLegacyToggle: (done: boolean) => void; saving: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasTopics = m.total_topics > 0;
  return (
    <Card className={locked ? "opacity-50 pointer-events-none" : ""}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="py-3">
          <div className="flex items-center gap-3">
            {/* Modules that have no topics (older courses) keep the original manual "done" checkbox. */}
            {!hasTopics && <Checkbox checked={legacyDone} disabled={locked || saving} onCheckedChange={(c) => onLegacyToggle(!!c)} aria-label={`Mark ${m.title} done`} />}
            <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-start min-w-0">
              {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <CardTitle className="text-base font-medium truncate">{m.title}</CardTitle>
            </CollapsibleTrigger>
            {hasTopics && <span className="text-xs text-muted-foreground">{m.completed_topics}/{m.total_topics} · {m.percent}%</span>}
            {!hasTopics && legacyDone && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          </div>
          {hasTopics && <Progress value={m.percent} className="h-1.5 mt-2" />}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {m.description && <p className="text-sm text-muted-foreground">{m.description}</p>}
            {m.content_body && !locked && (
              // Staff-authored module overview (existing behaviour).
              <div className="prose prose-sm max-w-none rounded-md border bg-muted/30 p-4" dangerouslySetInnerHTML={{ __html: m.content_body }} />
            )}
            {m.chapters.map((c) => (
              <div key={c.id} className="space-y-2" data-testid={`chapter-${c.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{c.title}</h3>
                  <span className="text-xs text-muted-foreground">{c.completed_topics}/{c.total_topics} · {c.percent}%</span>
                </div>
                <Progress value={c.percent} className="h-1" />
                {c.topics.length === 0 ? <p className="text-xs text-muted-foreground">No topics published in this chapter yet.</p>
                  : c.topics.map((t) => <TopicRow key={t.id} t={t} courseId={courseId} />)}
              </div>
            ))}
            {m.loose_topics.map((t) => <TopicRow key={t.id} t={t} courseId={courseId} />)}
            {m.chapters.length === 0 && m.loose_topics.length === 0 && hasTopics === false && (
              <p className="text-xs text-muted-foreground">No topics have been published in this module yet.</p>
            )}
            {m.content_url && !locked && (
              <Button variant="outline" size="sm" asChild><a href={m.content_url} target="_blank" rel="noreferrer noopener">Open attachment</a></Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  // Enrollment + course-level prerequisites (unchanged behaviour).
  const gate = useQuery({
    queryKey: ["course-detail", courseId, profile?.id],
    enabled: !!courseId && !!profile?.id,
    queryFn: async () => {
      const { data: course, error: courseErr } = await sb.from("courses").select("*").eq("id", courseId).single();
      if (courseErr) throw courseErr;
      const { data: enrollment, error: enrollErr } = await sb.rpc("ensure_course_enrollment", { p_course_id: courseId });
      if (enrollErr) throw enrollErr;
      const { data: moduleProgress } = await sb.from("student_module_progress").select("*").eq("student_id", profile!.id);
      let prerequisiteTitles: string[] = [];
      if (enrollment?.status === "locked") {
        const { data: prereqRows } = await sb
          .from("course_prerequisites").select("prerequisite_course_id, courses:prerequisite_course_id(title)").eq("course_id", courseId);
        prerequisiteTitles = ((prereqRows ?? []) as { courses?: { title?: string } | null }[]).map((r) => r.courses?.title).filter(Boolean);
      }
      return {
        course: course as Course, enrollment: enrollment as StudentCourseProgress, prerequisiteTitles,
        doneModules: new Set((moduleProgress ?? []).filter((m) => m.completed).map((m) => m.module_id as string)),
      };
    },
  });
  const isLocked = gate.data?.enrollment.status === "locked";
  const structure = useStudentCourseStructure(isLocked === false ? courseId : undefined);

  // Manual completion for legacy modules that have no topics (kept so older courses behave as before).
  const toggleLegacyModule = async (moduleId: string, completed: boolean) => {
    if (!profile?.id || !gate.data || !structure.data) return;
    setSaving(moduleId);
    await sb.from("student_module_progress").upsert(
      { student_id: profile.id, module_id: moduleId, completed, completed_at: completed ? new Date().toISOString() : null },
      { onConflict: "student_id,module_id" });
    queryClient.invalidateQueries({ queryKey: ["course-detail", courseId, profile.id] });
    queryClient.invalidateQueries({ queryKey: ["student-course-structure", courseId] });
    queryClient.invalidateQueries({ queryKey: ["course-catalog"] });
    setSaving(null);
  };

  if (gate.isLoading) {
    return <div className="p-6 max-w-3xl mx-auto space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-3" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  }
  if (gate.error || !gate.data) {
    return <div className="p-6 max-w-3xl mx-auto text-sm text-destructive">We couldn't load this subject. It may not be published yet or you may not have access.</div>;
  }

  const { course, enrollment, prerequisiteTitles, doneModules } = gate.data;
  const s = structure.data;
  const overall = s && s.total_topics > 0 ? percent(s.completed_topics, s.total_topics) : enrollment.progress_percent;
  const resumeId = s?.last_topic_id ?? s?.next_topic_id ?? null;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-muted-foreground mt-1">{course.description}</p>
      </div>

      {isLocked ? (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">This course is locked</p>
              <p className="text-sm mt-1">
                {prerequisiteTitles.length > 0
                  ? `Complete "${prerequisiteTitles.join('", "')}" first to unlock this course.`
                  : "Complete the required prerequisite course(s) first."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Progress value={overall} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {overall}% complete{s && s.total_topics > 0 ? ` · ${s.completed_topics} of ${s.total_topics} topics` : ""}
            </p>
          </div>
          {resumeId && (
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link to={`/student/courses/${courseId}/topics/${resumeId}`}>
                <PlayCircle className="h-4 w-4 me-1.5" />{s?.last_topic_id && s.last_topic_id !== s.next_topic_id ? "Continue where you left off" : "Start next topic"}
              </Link></Button>
              {s?.next_topic_id && s.next_topic_id !== resumeId && (
                <Button variant="outline" asChild><Link to={`/student/courses/${courseId}/topics/${s.next_topic_id}`}>Recommended next topic</Link></Button>
              )}
            </div>
          )}
        </div>
      )}

      {!isLocked && structure.isLoading && <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>}
      {!isLocked && structure.error && <p className="text-sm text-destructive">Couldn't load the lessons. Please refresh.</p>}
      {!isLocked && s && s.modules.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Your teacher hasn't published any modules for this subject yet.</p>
      )}
      {s && (
        <div className="space-y-3">
          {s.modules.map((m, i) => (
            <ModuleCard key={m.id} m={m} courseId={courseId!} defaultOpen={i === 0} locked={!!isLocked}
              legacyDone={doneModules.has(m.id)} saving={saving === m.id} onLegacyToggle={(d) => toggleLegacyModule(m.id, d)} />
          ))}
        </div>
      )}
    </div>
  );
}
