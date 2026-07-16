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
import { BookOpen, Layers, ListChecks, Lock, UserCircle2, Loader2, Sparkles } from "lucide-react";
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-emerald-600">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading courses...
      </div>
    );
  }
  if (error) {
    return <div className="p-6 text-destructive">Couldn't load courses. Please try again.</div>;
  }

  const renderCourseCard = (course: CourseWithProgress) => (
    <Card
      key={course.id}
      className={`overflow-hidden border-emerald-100 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow duration-300 ${course.isLocked ? "opacity-70" : ""}`}
    >
      <div className="h-1 bg-gradient-to-r from-emerald-400 to-green-500" />
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="min-w-0">
          <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <BookOpen className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600" />
            </div>
            <span className="truncate">{course.title}</span>
          </h3>
          {course.subject && (
            <Badge variant="secondary" className="mt-1.5 ml-9 md:ml-10 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border border-emerald-100">
              {course.subject}
            </Badge>
          )}
        </div>
        {course.isLocked ? (
          <Badge variant="outline" className="gap-1 text-muted-foreground shrink-0">
            <Lock className="h-3 w-3" /> Locked
          </Badge>
        ) : course.progress?.status === "completed" ? (
          <Badge className="shrink-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Completed</Badge>
        ) : (
          <Badge className="shrink-0 bg-amber-100 text-amber-700 hover:bg-amber-100">In Progress</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground ml-9 md:ml-10">
          <span className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-emerald-400" /> {course.moduleCount ?? 0} Modules
          </span>
          <span className="flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5 text-green-400" /> {course.topicCount ?? 0} Topics
          </span>
        </div>

        {course.mentor?.full_name && (
          <div className="flex items-center gap-2 text-sm ml-9 md:ml-10">
            <UserCircle2 className="h-4 w-4 text-emerald-400" />
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
          <Button variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => openCourse(course)}>
            View Syllabus
          </Button>
          {!course.isLocked && (
            <Button
              size="sm"
              className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white"
              onClick={() => openCourse(course)}
            >
              {course.progress?.status === "completed" ? "Review" : "Continue"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* Layered waves at top */}
      <svg className="absolute top-0 left-0 w-full h-48 opacity-[0.07]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,90 C240,150 480,30 720,70 C960,110 1200,30 1440,80 L1440,0 L0,0 Z" fill="#10b981" />
      </svg>
      <svg className="absolute top-0 left-0 w-full h-36 opacity-[0.06]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,50 C320,120 720,10 1440,60 L1440,0 L0,0 Z" fill="#22c55e" />
      </svg>

      <div className="relative z-10 p-4 md:p-6 space-y-4 md:space-y-6 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-500 to-green-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-start md:items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">My Courses</h1>
              <p className="text-emerald-100 text-xs md:text-sm mt-0.5">Track your modules, topics, and progress across every course.</p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="in_progress">
          <TabsList className="bg-white border border-emerald-100 shadow-sm">
            <TabsTrigger value="in_progress" className="gap-2 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-700">
              In Progress
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">{grouped.in_progress.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-2 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-700">
              Completed
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">{grouped.completed.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="gap-2 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-700">
              Upcoming
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">{grouped.upcoming.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {(["in_progress", "completed", "upcoming"] as Tab[]).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {grouped[tab].map(renderCourseCard)}
                {grouped[tab].length === 0 && (
                  <Card className="col-span-full border-emerald-100 bg-white/70 backdrop-blur-sm">
                    <CardContent className="py-12 text-center">
                      <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                        <BookOpen className="h-6 w-6 text-emerald-500" />
                      </div>
                      <p className="text-muted-foreground text-sm">Nothing here yet.</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
