// ASSUMPTIONS — adjust if these don't match your project:
//   supabase client:  "@/integrations/supabase/client"
//   auth context:     "@/contexts/AuthContext" exposing useAuth() -> { profile }
//   shadcn Tabs component present at "@/components/ui/tabs"
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BookOpen, Layers, ListChecks, Lock, UserCircle2 } from "lucide-react";
import type {
  Course,
  CourseModule,
  CourseTopic,
  CoursePrerequisite,
  StudentCourseProgress,
  CourseWithProgress,
} from "@/types/courseManagement";

type Tab = "in_progress" | "completed" | "upcoming";

export default function CourseCatalog() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["course-catalog", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: courses, error: courseErr } = await supabase
        .from("courses")
        .select("*, mentor:mentor_id(id, full_name)")
        .eq("status", "published")
        .order("created_at", { ascending: false });
      if (courseErr) throw courseErr;

      const courseIds = (courses ?? []).map((c) => c.id);

      const { data: modules, error: modErr } = await supabase
        .from("course_modules")
        .select("id, course_id")
        .in("course_id", courseIds);
      if (modErr) throw modErr;

      const moduleIds = (modules ?? []).map((m) => m.id);

      const { data: topics, error: topicErr } = await supabase
        .from("course_topics")
        .select("id, module_id")
        .in("module_id", moduleIds);
      if (topicErr) throw topicErr;

      const { data: progressRows, error: progErr } = await supabase
        .from("student_course_progress")
        .select("*")
        .eq("student_id", profile!.id)
        .in("course_id", courseIds);
      if (progErr) throw progErr;

      const { data: prereqs, error: prereqErr } = await supabase
        .from("course_prerequisites")
        .select("*")
        .in("course_id", courseIds);
      if (prereqErr) throw prereqErr;

      return {
        courses: courses as Course[],
        modules: modules as CourseModule[],
        topics: topics as CourseTopic[],
        progressRows: progressRows as StudentCourseProgress[],
        prereqs: prereqs as CoursePrerequisite[],
      };
    },
  });

  const courses: CourseWithProgress[] = useMemo(() => {
    if (!data) return [];
    const { courses, modules, topics, progressRows, prereqs } = data;

    const moduleIdsByCourse = new Map<string, string[]>();
    modules.forEach((m) => {
      const list = moduleIdsByCourse.get(m.course_id) ?? [];
      list.push(m.id);
      moduleIdsByCourse.set(m.course_id, list);
    });

    const topicCountByModule = new Map<string, number>();
    topics.forEach((t) => {
      topicCountByModule.set(t.module_id, (topicCountByModule.get(t.module_id) ?? 0) + 1);
    });

    const progressByCourse = new Map(progressRows.map((p) => [p.course_id, p]));
    const completedCourseIds = new Set(
      progressRows.filter((p) => p.status === "completed").map((p) => p.course_id)
    );

    const prereqsByCourse = new Map<string, CoursePrerequisite[]>();
    prereqs.forEach((p) => {
      const list = prereqsByCourse.get(p.course_id) ?? [];
      list.push(p);
      prereqsByCourse.set(p.course_id, list);
    });

    return courses.map((course) => {
      const moduleIds = moduleIdsByCourse.get(course.id) ?? [];
      const topicCount = moduleIds.reduce((sum, mId) => sum + (topicCountByModule.get(mId) ?? 0), 0);
      const coursePrereqs = prereqsByCourse.get(course.id) ?? [];
      const isLocked = coursePrereqs.some((p) => !completedCourseIds.has(p.prerequisite_course_id));

      return {
        ...course,
        progress: progressByCourse.get(course.id),
        moduleCount: moduleIds.length,
        topicCount,
        isLocked,
      };
    });
  }, [data]);

  const grouped = useMemo(() => {
    const result: Record<Tab, CourseWithProgress[]> = {
      in_progress: [],
      completed: [],
      upcoming: [],
    };
    courses.forEach((c) => {
      if (c.progress?.status === "completed") result.completed.push(c);
      else if (c.isLocked) result.upcoming.push(c);
      else result.in_progress.push(c);
    });
    return result;
  }, [courses]);

  const openCourse = async (course: CourseWithProgress) => {
    if (course.isLocked) {
      navigate(`/student/courses/${course.id}`); // detail page explains what's missing
      return;
    }
    await supabase.rpc("ensure_course_enrollment", { p_course_id: course.id });
    navigate(`/student/courses/${course.id}`);
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading courses...</div>;
  if (error) return <div className="p-6 text-destructive">Couldn't load courses. Please try again.</div>;

  const renderCourseCard = (course: CourseWithProgress) => (
    <Card key={course.id} className={course.isLocked ? "opacity-70" : ""}>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <h3 className="text-lg font-semibold">{course.title}</h3>
          {course.subject && (
            <Badge variant="secondary" className="mt-1 text-xs">
              {course.subject}
            </Badge>
          )}
        </div>
        {course.isLocked ? (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Lock className="h-3 w-3" /> Locked
          </Badge>
        ) : course.progress?.status === "completed" ? (
          <Badge className="bg-green-600 hover:bg-green-600">Completed</Badge>
        ) : (
          <Badge className="bg-amber-500 hover:bg-amber-500">In Progress</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Layers className="h-4 w-4" /> {course.moduleCount ?? 0} Modules
          </span>
          <span className="flex items-center gap-1">
            <ListChecks className="h-4 w-4" /> {course.topicCount ?? 0} Topics
          </span>
        </div>

        {course.mentor?.full_name && (
          <div className="flex items-center gap-2 text-sm">
            <UserCircle2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Mentor:</span>
            <span className="font-medium">{course.mentor.full_name}</span>
          </div>
        )}

        {!course.isLocked && (
          <div className="space-y-1">
            <Progress value={course.progress?.progress_percent ?? 0} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {course.progress?.progress_percent ?? 0}% complete
            </p>
          </div>
        )}
        {course.isLocked && (
          <p className="text-xs text-muted-foreground">
            Complete the prerequisite course(s) to unlock this.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => openCourse(course)}>
            View Syllabus
          </Button>
          {!course.isLocked && (
            <Button size="sm" onClick={() => openCourse(course)}>
              {course.progress?.status === "completed" ? "Review" : "Continue"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5" />
        <h1 className="text-2xl font-semibold">My Courses</h1>
      </div>

      <Tabs defaultValue="in_progress">
        <TabsList>
          <TabsTrigger value="in_progress" className="gap-2">
            In Progress
            <Badge variant="secondary">{grouped.in_progress.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            Completed
            <Badge variant="secondary">{grouped.completed.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="gap-2">
            Upcoming
            <Badge variant="secondary">{grouped.upcoming.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {(["in_progress", "completed", "upcoming"] as Tab[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {grouped[tab].map(renderCourseCard)}
              {grouped[tab].length === 0 && (
                <p className="text-muted-foreground col-span-full">Nothing here yet.</p>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}