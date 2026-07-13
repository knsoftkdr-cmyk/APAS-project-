import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, CheckCircle2 } from "lucide-react";
import type { Course, CourseModule, StudentCourseProgress, StudentModuleProgress } from "@/types/courseManagement";

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["course-detail", courseId, profile?.id],
    enabled: !!courseId && !!profile?.id,
    queryFn: async () => {
      const { data: course, error: courseErr } = await supabase
        .from("courses")
        .select("*")
        .eq("id", courseId)
        .single();
      if (courseErr) throw courseErr;

      const { data: modules, error: modulesErr } = await supabase
        .from("course_modules")
        .select("*")
        .eq("course_id", courseId)
        .order("order_index");
      if (modulesErr) throw modulesErr;

      const { data: enrollment, error: enrollErr } = await supabase.rpc(
        "ensure_course_enrollment",
        { p_course_id: courseId }
      );
      if (enrollErr) throw enrollErr;

      const { data: moduleProgress, error: mpErr } = await supabase
        .from("student_module_progress")
        .select("*")
        .eq("student_id", profile!.id)
        .in("module_id", (modules ?? []).map((m) => m.id));
      if (mpErr) throw mpErr;

      // Prerequisite titles for a friendly locked message
      let prerequisiteTitles: string[] = [];
      if (enrollment?.status === "locked") {
        const { data: prereqRows } = await supabase
          .from("course_prerequisites")
          .select("prerequisite_course_id, courses:prerequisite_course_id(title)")
          .eq("course_id", courseId);
        prerequisiteTitles = (prereqRows ?? []).map((r: any) => r.courses?.title).filter(Boolean);
      }

      return {
        course: course as Course,
        modules: modules as CourseModule[],
        enrollment: enrollment as StudentCourseProgress,
        moduleProgress: (moduleProgress ?? []) as StudentModuleProgress[],
        prerequisiteTitles,
      };
    },
  });

  const toggleModule = async (moduleId: string, completed: boolean) => {
    if (!profile?.id || !data) return;
    setSaving(moduleId);

    await supabase.from("student_module_progress").upsert(
      {
        student_id: profile.id,
        module_id: moduleId,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      },
      { onConflict: "student_id,module_id" }
    );

    const total = data.modules.length;
    const doneIds = new Set(
      data.moduleProgress.filter((mp) => mp.completed).map((mp) => mp.module_id)
    );
    if (completed) doneIds.add(moduleId);
    else doneIds.delete(moduleId);

    const percent = total > 0 ? Math.round((doneIds.size / total) * 100) : 0;
    const allDone = total > 0 && doneIds.size === total;

    await supabase
      .from("student_course_progress")
      .update({
        progress_percent: percent,
        status: allDone ? "completed" : "in_progress",
        started_at: data.enrollment.started_at ?? new Date().toISOString(),
        completed_at: allDone ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("student_id", profile.id)
      .eq("course_id", courseId);

    setSaving(null);
    queryClient.invalidateQueries({ queryKey: ["course-detail", courseId, profile.id] });
    queryClient.invalidateQueries({ queryKey: ["course-catalog"] });
  };

  if (isLoading || !data) {
    return <div className="p-6 text-muted-foreground">Loading course...</div>;
  }

  const { course, modules, enrollment, moduleProgress, prerequisiteTitles } = data;
  const isLocked = enrollment.status === "locked";
  const doneIds = new Set(moduleProgress.filter((mp) => mp.completed).map((mp) => mp.module_id));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <p className="text-muted-foreground mt-1">{course.description}</p>
      </div>

      {isLocked ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900">This course is locked</p>
              <p className="text-sm text-amber-800 mt-1">
                {prerequisiteTitles.length > 0
                  ? `Complete "${prerequisiteTitles.join('", "')}" first to unlock this course.`
                  : "Complete the required prerequisite course(s) first."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          <Progress value={enrollment.progress_percent} className="h-2" />
          <p className="text-sm text-muted-foreground">{enrollment.progress_percent}% complete</p>
        </div>
      )}

      <div className="space-y-3">
        {modules.map((module, idx) => {
          const done = doneIds.has(module.id);
          return (
            <Card key={module.id} className={isLocked ? "opacity-50 pointer-events-none" : ""}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={done}
                    disabled={isLocked || saving === module.id}
                    onCheckedChange={(checked) => toggleModule(module.id, !!checked)}
                  />
                  <CardTitle className="text-base font-medium">
                    {idx + 1}. {module.title}
                  </CardTitle>
                </div>
                {done && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              </CardHeader>
              {module.description && (
                <CardContent className="pt-0 pb-3 text-sm text-muted-foreground">
                  {module.description}
                </CardContent>
              )}
              {module.content_body && !isLocked && (
                <CardContent className="pt-0 pb-3">
                  <div
                    className="prose prose-sm max-w-none rounded-md border bg-muted/30 p-4"
                    // Content is authored by teachers/admins (RLS-restricted write access),
                    // not arbitrary end users, so this is trusted rich-text lesson content.
                    dangerouslySetInnerHTML={{ __html: module.content_body }}
                  />
                </CardContent>
              )}
              {module.content_url && !isLocked && (
                <CardContent className="pt-0 pb-3">
                  <Button variant="outline" size="sm" asChild>
                    <a href={module.content_url} target="_blank" rel="noreferrer">
                      Open attachment
                    </a>
                  </Button>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}