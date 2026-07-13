import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, CheckCircle2, Circle, PlayCircle } from "lucide-react";
import type { LearningPath, LearningPathCourse, StudentCourseProgress } from "@/types/courseManagement";

export default function LearningPathView() {
  const { pathId } = useParams<{ pathId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["learning-path", pathId, profile?.id],
    enabled: !!pathId && !!profile?.id,
    queryFn: async () => {
      const { data: path, error: pathErr } = await supabase
        .from("learning_paths")
        .select("*")
        .eq("id", pathId)
        .single();
      if (pathErr) throw pathErr;

      const { data: pathCourses, error: pcErr } = await supabase
        .from("learning_path_courses")
        .select("*, course:course_id(*)")
        .eq("path_id", pathId)
        .order("order_index");
      if (pcErr) throw pcErr;

      const courseIds = (pathCourses ?? []).map((pc: any) => pc.course_id);
      const { data: progressRows, error: progErr } = await supabase
        .from("student_course_progress")
        .select("*")
        .eq("student_id", profile!.id)
        .in("course_id", courseIds);
      if (progErr) throw progErr;

      const progressByCourse = new Map<string, StudentCourseProgress>(
        (progressRows ?? []).map((p) => [p.course_id, p])
      );

      return {
        path: path as LearningPath,
        steps: (pathCourses as LearningPathCourse[]).map((pc) => ({
          ...pc,
          progress: progressByCourse.get(pc.course_id),
        })),
      };
    },
  });

  if (isLoading || !data) {
    return <div className="p-6 text-muted-foreground">Loading learning path...</div>;
  }

  const { path, steps } = data;
  const completedCount = steps.filter((s) => s.progress?.status === "completed").length;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{path.title}</h1>
        <p className="text-muted-foreground mt-1">{path.description}</p>
        <Badge variant="secondary" className="mt-2">
          {completedCount} / {steps.length} completed
        </Badge>
      </div>

      <div className="relative pl-6 space-y-4">
        <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
        {steps.map((step) => {
          const status = step.progress?.status ?? (step.is_required ? "locked" : "available");
          const isLocked = status === "locked";
          const isCompleted = status === "completed";
          const isInProgress = status === "in_progress";

          const Icon = isCompleted
            ? CheckCircle2
            : isLocked
            ? Lock
            : isInProgress
            ? PlayCircle
            : Circle;

          return (
            <div key={step.id} className="relative flex items-start gap-3">
              <div
                className={`absolute -left-6 rounded-full bg-background ${
                  isCompleted ? "text-green-600" : isLocked ? "text-muted-foreground" : "text-blue-600"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <Card
                className={`flex-1 ml-2 ${isLocked ? "opacity-60" : "cursor-pointer hover:shadow-md"}`}
                onClick={() => !isLocked && step.course && navigate(`/student/courses/${step.course.id}`)}
              >
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{step.course?.title}</p>
                    {!step.is_required && (
                      <span className="text-xs text-muted-foreground">Optional</span>
                    )}
                  </div>
                  {!isLocked && step.progress && (
                    <span className="text-xs text-muted-foreground">
                      {step.progress.progress_percent}%
                    </span>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}