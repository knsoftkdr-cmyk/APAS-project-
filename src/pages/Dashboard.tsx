import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { GettingStartedBanner } from "@/components/GettingStartedBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { Users, CheckCircle, Book, AlertTriangle, Target, BookOpen, Clock, Dumbbell, ClipboardCheck, TrendingUp, Brain, FileText, BarChart3, ArrowRight, Sparkles, GraduationCap, Lightbulb, LineChart, PenLine, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentReport } from "@/components/StudentReport";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from "@/components/ui/chart";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Link, Navigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import type { Json } from "@/integrations/supabase/types";
import { analyzeResponses, getReportConfig } from "@/data/reportTheories";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentHomework from "@/components/StudentHomework";
import teacherHeroBg from "@/assets/teacher-hero-bg.jpg";
import studentBanner from "@/assets/student-home-banner.png";
import teacherhomebanner from "@/assets/teacherhome-banner.png";

interface LessonContent {
  lesson_objectives?: string[];
  activity_plan?: { title: string; description: string; duration_minutes: number; materials: string }[];
  practice_exercises?: { title: string; description: string; type: string }[];
  assessment_checkpoints?: { checkpoint: string; criteria: string; method: string }[];
  framework_summary?: string;
  student_name?: string;
  age_group?: number;
}

function parseLessonContent(content: Json | null): LessonContent | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  return content as unknown as LessonContent;
}

const getLevelColor = (level: string) => {
  switch (level) {
    case "High": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
    case "Moderate": return "bg-amber-500/15 text-amber-700 border-amber-200";
    case "Developing": return "bg-red-500/15 text-red-700 border-red-200";
    default: return "bg-muted text-muted-foreground";
  }
};

const getProgressColor = (percentage: number) => {
  if (percentage >= 70) return "[&>div]:bg-emerald-500";
  if (percentage >= 40) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-red-400";
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ STUDENT DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const StudentDashboard = () => {
  const { profile, user } = useAuth();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["student-assignments", user?.id],
    queryFn: async () => {
      const { data: studentRows } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", user!.id)
        .limit(1);

      let studentRecord = studentRows?.[0] ?? null;

      if (!studentRecord) {
        const { data: newStudent } = await supabase
          .from("students")
          .insert([{ profile_id: user!.id }])
          .select("id")
          .single();
        studentRecord = newStudent ?? null;
      }

      if (!studentRecord) return [];

      const { data, error } = await supabase
        .from("lesson_assignments")
        .select("id, status, assigned_at, lesson_id, lessons(id, title, approach, duration_minutes, content, curriculum, subject)")
        .eq("student_id", studentRecord.id)
        .order("assigned_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: myAssessment, isLoading: assessmentLoading } = useQuery({
    queryKey: ["my-assessment", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_assessments")
        .select("*")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const { data: teacherProfile } = useQuery({
    queryKey: ["teacher-profile", myAssessment?.teacher_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", myAssessment!.teacher_id)
        .maybeSingle();
      return data;
    },
    enabled: !!myAssessment?.teacher_id,
  });

  const reportConfig = myAssessment ? getReportConfig(myAssessment.age_group) : null;
  const scores = myAssessment ? analyzeResponses(myAssessment.age_group, myAssessment.responses as Record<string, number>) : null;

  return (
    <AppLayout>
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-400 p-8 relative min-h-[220px]">

          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/80"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
<div className="hidden md:block">
  <div className="absolute top-12 left-[45%] text-white/80 text-xl">âœ¦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">âœ¦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">âœ¦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">âœ¦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">âœ¦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">âœ¦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">âœ¦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
    
  <h1 className="text-4xl font-bold">
    Welcome Back, {profile?.full_name}
  </h1>

  <p className="mt-2 text-black/80">
    {today}
  </p>

  <p className="mt-6 text-lg text-black/90">
    Continue your learning journey and complete today's homework.
  </p>
   <img
    src={studentBanner}
    alt="Student Learning"
    className="hidden md:block absolute right-0 bottom-0 w-80"
  />
</div>

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <PenLine className="h-5 w-5 text-primary" /> Your Homework
        </h2>
        <StudentHomework />
      </div>

      {myAssessment && (
        <StudentReport
          open={reportOpen}
          onOpenChange={setReportOpen}
          studentName={myAssessment.student_name}
          studentAge={myAssessment.student_age}
          ageGroup={myAssessment.age_group}
          responses={myAssessment.responses as Record<string, any>}
          submittedAt={myAssessment.created_at}
          studentClass={myAssessment.student_class || undefined}
          teacherName={teacherProfile?.full_name || undefined}
        />
      )}
    </AppLayout>
  );
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ TEACHER HOME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const featureCards = [
  {
    icon: Users,
    title: "Student Reports",
    glow: "bg-red-400/80",
    description: "View detailed diagnostic reports for every student â€” learning styles, multiple intelligences, and cognitive profiles all in one place.",
    path: "/teacher",
    color: "from-red-500/20 to-red-600/10",
    iconColor: "text-blue-600",
  },
  {
    icon: BookOpen,
    title: "AI Lesson Plan Generator",
    glow: "bg-green-400/80",
    description: "Generate personalised, curriculum-aligned lesson plans powered by AI. Tailored to each student's VARK type and learning needs.",
    path: "/curative",
    color: "from-emerald-500/20 to-emerald-600/10",
    iconColor: "text-emerald-600",
  },
  {
    icon: BarChart3,
    title: "Analytics & Insights",
    glow: "bg-purple-400/80",
    description: "Track normalised learning gains, class-wide performance trends, and identify mismatch alerts before they become problems.",
    path: "/analytics",
    color: "from-violet-500/20 to-violet-600/10",
    iconColor: "text-violet-600",
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Assess Students",
    description: "Run diagnostic assessments to map each student's learning style, intelligence type, and cognitive profile.",
    icon: Brain,
  },
  {
    step: "02",
    title: "Review Reports",
    description: "Analyse detailed reports with VARK profiles, MI scores, and ZPD levels for every student.",
    icon: FileText,
  },
  {
    step: "03",
    title: "Generate Lesson Plans",
    description: "Use AI to create personalised lesson plans matched to each student's unique learning profile.",
    icon: Sparkles,
  },
  {
    step: "04",
    title: "Track Progress",
    description: "Monitor normalised gains and learning outcomes to continuously refine your teaching approach.",
    icon: LineChart,
  },
];

const TeacherHome = () => {
  const { profile, user } = useAuth();
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const { data: assessmentCount, isLoading: countLoading } = useQuery({
    queryKey: ["student-assessments-count", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_assessments")
        .select("id")
        .eq("teacher_id", user!.id);
      if (error) throw error;
      return data?.length || 0;
    },
    enabled: !!user?.id,
  });

  const { data: lessonCount } = useQuery({
    queryKey: ["teacher-lesson-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("teacher_id", user!.id)
        .eq("ai_generated", true);
      if (error) throw error;
      return count || 0;
    },
  });

  return (
    <AppLayout>
      {/* Hero Section */}
      <div className="relative -mx-6 -mt-6 mb-8 overflow-hidden rounded-b-2xl">
        <div
          className="relative px-8 py-12 md:py-16"
          style={{
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
<div
  className="absolute inset-0 bg-gradient-to-r
  from-[#2563EB]/80
  to-[#60A5FA]/100"
/>
<div className="hidden md:block">
          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/50"></div>
    {/* Stars */}
          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/40"></div>
</div>
             <img
    src={teacherhomebanner}
    alt="Teacher Home Dashboard"
    /* className="absolute right-8 -bottom-14 h-[405px] object-contain" */
    className="hidden md:block absolute right-0 bottom-6 w-[450px]"
  />
          <div className="relative z-10 max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
              <GraduationCap className="h-7 w-7 text-black/80" />
              <span className="text-sm font-medium text-black/70 uppercase tracking-wider">{profile?.role === "school_admin" ? "APAS School Admin Portal" : profile?.role === "knsoft_admin" ? "APAS Platform Admin" : "APAS Teacher Portal"}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-black mb-2">
              Welcome back, {profile?.full_name || (profile?.role === "school_admin" ? "School Admin" : profile?.role === "knsoft_admin" ? "KNSoft Admin" : "Teacher")}
            </h1>
            <p className="text-base text-black/90 mb-1">{today}</p>
            <p className="text-sm text-black/80 max-w-lg mt-3 leading-relaxed">
              {profile?.role === "school_admin" ? "Manage your school â€” create accounts, monitor student and teacher performance, and oversee school-wide operations." : profile?.role === "knsoft_admin" ? "KNSOFT Platform Admin â€” manage all schools, assign school admins, monitor platform-wide usage and billing." : "Adaptive Personalised Assessment System â€” empowering you with AI-driven diagnostics, personalised lesson plans, and actionable learning analytics."}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-amber-500 to-amber-500 hover:shadow-2xl hover:-translate-y-2 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 shadow-lg shadow-blue-300/50">
              <CheckCircle className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {countLoading ? "â€”" : assessmentCount}
              </p>
              <p className="text-sm text-white text-muted-foreground">Assessments Completed</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-green-600 to-green-600 hover:shadow-2xl hover:-translate-y-2 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 shadow-lg shadow-blue-300/50">
              <BookOpen className="h-7 w-7 text-emerald-600" />
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">{lessonCount ?? "â€”"}</p>
              <p className="text-sm text-white text-muted-foreground">Lesson Plans Created</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-violet-500 to-purple-500 hover:shadow-2xl hover:-translate-y-2 transition-all duration-300">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 shadow-lg shadow-blue-300/50">
              <Lightbulb className="h-7 w-7 text-violet-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">AI-Powered</p>
              <p className="text-sm text-white text-muted-foreground">Personalised Learning</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* What You Can Do */}
      <div className="mb-10">
        <h2 className="text-xl font-bold text-foreground mb-1">What You Can Do</h2>
        <p className="text-sm text-muted-foreground mb-6">Explore the core tools designed to enhance your teaching effectiveness.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {featureCards.map((feature) => (
            <Link key={feature.path} to={feature.path} className="group">
              <Card className="h-full border-0 shadow-md hover:shadow-2xl hover:-translate-y-3 transition-all duration-500 overflow-hidden relative bg-white group">
                <div className={`h-1 w-full bg-gradient-to-r ${feature.color}`}></div>
                <div className={`absolute left-0 top-0 h-full w-1 bg-gradient-to-b ${feature.color}`}></div>
                <div className={`absolute right-0 top-0 h-full w-1 bg-gradient-to-b ${feature.color}`}></div>
                <CardContent className="p-6">
                  <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-500 ${feature.glow}`}/>
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${feature.color} mb-4`}>
                    <feature.icon className={`h-8 w-8 ${feature.iconColor}`} />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {feature.description}
                  </p>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-primary mt-3 opacity-0 max-h-0 overflow-hidden group-hover:max-h-10 group-hover:opacity-100 transition-all duration-500 ">
                    Explore <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-2" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground mb-1">How APAS Works</h2>
        <p className="text-sm text-muted-foreground mb-6">A simple four-step workflow to personalise every student's learning journey.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {workflowSteps.map((step, i) => (
            <div key={i} className="relative">
              <Card className="h-full border-0 shadow-md bg-gradient-to-br from-blue-200 to-blue-200 transition-all duration-500 hover:-translate-y-3 hover:shadow-2xl hover:rotate-1 group">
                <CardContent className="p-5">
                  <span className="text-3xl font-black text-primary/15 absolute top-3 right-4">{step.step}</span>
                  <div
  className="
  flex h-12 w-12
  items-center justify-center
  rounded-xl
  bg-primary/10
  mb-3
  transition-all
  duration-500
  group-hover:rotate-12
  group-hover:scale-110
"
>
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-1.5">{step.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ADMIN HOME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const adminFeatureCards = [
  {
    icon: Users,
    title: "Student Reports",
    description: "View detailed diagnostic reports for every student across all classes â€” learning styles, multiple intelligences, and cognitive profiles.",
    path: "/teacher",
    color: "from-blue-500/20 to-blue-600/10",
    glow: "bg-blue-600/30",
    iconColor: "text-blue-600",
  },
  {
    icon: AlertTriangle,
    title: "Real-time Alerts",
    description: "Monitor system-wide mismatch alerts, flagged performance issues, and intervention recommendations across all classes.",
    path: "/alerts",
    color: "from-amber-500/20 to-amber-600/10",
    glow: "bg-amber-600/30",
    iconColor: "text-amber-600",
  },
  {
    icon: GraduationCap,
    title: "Master User Panel",
    description: "Manage classes, allot students and teachers, configure diagnostic questions, and import students via Excel.",
    path: "/admin",
    color: "from-violet-500/20 to-violet-600/10",
    glow: "bg-purple-600/30",
    iconColor: "text-violet-600",
  },
];

const AdminHome = () => {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-dashboard-stats", schoolId],
    queryFn: async () => {
      const [classesRes, studentsRes, teachersRes, assessmentsRes, alertsRes] = await Promise.all([
        supabase.from("classes").select("id", { count: "exact", head: true }).eq("school_id", schoolId!),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId!),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher").eq("school_id", schoolId!),
        supabase.from("student_assessments").select("id", { count: "exact", head: true }).eq("school_id", schoolId!),
        supabase.from("mismatch_alerts").select("id", { count: "exact", head: true }).eq("status", "flagged").eq("school_id", schoolId!),
      ]);
      return {
        classes: classesRes.count ?? 0,
        students: studentsRes.count ?? 0,
        teachers: teachersRes.count ?? 0,
        assessments: assessmentsRes.count ?? 0,
        activeAlerts: alertsRes.count ?? 0,
      };
    },
    enabled: !!schoolId,
  });

  const { data: atRiskStudents } = useQuery({
    queryKey: ["at-risk-students-dashboard", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_predictions")
        .select("student_id, subject, predicted_score_next_test, risk_level, dropout_risk_percentage, contributing_factors")
        .eq("risk_level", "high")
        .eq("school_id", schoolId!)
        .order("dropout_risk_percentage", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!schoolId,
  });

  return (
    <AppLayout>
      {/* Hero Section */}
{/* Hero Section */}
<div className="relative -mx-6 -mt-6 mb-8 overflow-hidden rounded-b-2xl">
  <div className="relative px-8 py-12 md:py-16 min-h-[300px]">

    {/* Background Gradient */}
<div
  className="absolute inset-0 bg-gradient-to-r
  from-[#2563EB]/80
  to-[#60A5FA]/100"
/>
    {/* Decorative Circles */}
    <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/40"></div>
    <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/40"></div>
    <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>
<div className="hidden md:block">
    {/* Stars */}
          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

    {/* Triangles */}
    <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

    <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

    <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
    {/* Banner Image */}
    <img
      src={teacherhomebanner}
      alt="Teacher Home Dashboard"
      /* className="absolute right-8 bottom-0 h-[320px] object-contain z-10" */
      className="hidden md:block absolute right-0 bottom-0 w-[500px] z-10"
    />

    {/* Content */}
    <div className="relative z-20 max-w-2xl">
      <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-3">
        Welcome, {profile?.full_name || "Master User"}
      </h1>

      <p className="text-bold text-slate-900 mb-2">
        {today}
      </p>

      <p className="text-lg text-slate-800 leading-relaxed max-w-xl">
        APAS (Adaptive Pedagogy & Analytics System) is a futuristic AI
        Operating System designed to personalise learning at scale. As an
        admin, you oversee classes, teachers, students, diagnostics, and
        system-wide analytics from one place.
      </p>
    </div>

  </div>
</div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        {[
  {
    label: "Classes",
    value: stats?.classes,
    icon: Book,
    bg: "from-blue-500 to-cyan-500",
    iconBg: "bg-white/20",
  },
  {
    label: "Students",
    value: stats?.students,
    icon: Users,
    bg: "from-purple-500 to-pink-500",
    iconBg: "bg-white/20",
  },
  {
    label: "Teachers",
    value: stats?.teachers,
    icon: GraduationCap,
    bg: "from-emerald-500 to-green-500",
    iconBg: "bg-white/20",
  },
  {
    label: "Assessments",
    value: stats?.assessments,
    icon: CheckCircle,
    bg: "from-orange-500 to-red-500",
    iconBg: "bg-white/20",
  },
  {
    label: "Active Alerts",
    value: stats?.activeAlerts,
    icon: AlertTriangle,
    bg: "from-yellow-500 to-amber-500",
    iconBg: "bg-white/20",
  },
].map((stat) => (
                    <Card key={stat.label} className={`bg-gradient-to-r ${stat.bg} border-0 shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 overflow-hidden relative`}>
            <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-white/10 blur-2xl" />
            <CardContent className="flex items-center justify-between p-5 relative z-10">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${stat.iconBg} backdrop-blur-sm`}>
                <stat.icon className="h-8 w-8 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{isLoading ? "â€”" : stat.value}</p>
                <p className="text-xs text-white">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* At-Risk Students Widget */}
      {atRiskStudents && atRiskStudents.length > 0 && (
        <div className="mb-10">
          <h2 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2">
            <AlertTriangle className="h-8 w-8 text-red-600 text-destructive" />
            Students At Risk
          </h2>
          <p className="text-sm text-muted-foreground mb-4">AI-predicted high-risk students requiring immediate attention.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {atRiskStudents.map((s, i) => (
              <Card key={i} className="group overflow-hidden border-0 bg-gradient-to-br from-red-50 via-white to-orange-50 shadow-md hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 relative">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-500" />
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge className="bg-red-500 text-white animate-pulse shadow-lg shadow-red-100">HIGH RISK</Badge>
                    <span className="text-semibold text-black-700">{s.subject}</span>
                  </div>
                <div className="flex items-center justify-between mt-4">
                  <div>
                  <p className="text-xs text-muted-foreground">
                    Predicted:<p className="text-xl font-semibold text-red-600">{Number(s.predicted_score_next_test).toFixed(0)}%</p>
                  </p>
                  </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    Dropout Risk: <p className="text-xl font-semibold text-orange-600">{Number(s.dropout_risk_percentage).toFixed(0)}%</p>
                  </p>
                </div>
                </div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(Array.isArray(s.contributing_factors) ? s.contributing_factors : typeof s.contributing_factors === "string" ? JSON.parse(s.contributing_factors || "[]") : []).slice(0, 2).map((f, j) => (
                      <Badge key={j} variant="outline" className="bg-white text-red-600 border border-red-200 hover:bg-red-50">{f}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Link to="/school-analytics" className="inline-flex items-center gap-1 mt-3 text-semibold text-primary hover:underline">
            View Full Analytics <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      )}

      {/* About APAS */}
      <div className="mb-10">
        <h2 className="text-xl font-bold text-foreground mb-1">About APAS</h2>
        <p className="text-sm text-muted-foreground mb-4">Understanding the system you manage.</p>
        <Card className="border-border/60">
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-foreground leading-relaxed">
              <strong>APAS</strong> (Adaptive Pedagogy & Analytics System) is a next-generation AI-powered educational platform that personalises learning for every student. It uses a collaborative network of AI agents” Planner, Executor, Analyst, Tutor, and Creator” to provide a highly individualised experience across CBSE, IB, and Cambridge curricula.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="group rounded-2xl border border-yellow-200 p-5 bg-gradient-to-br from-yellow-100 to-orange-50 hover:shadow-xl hover:-translate-y-2 hover:border-yellow-400 transition-all duration-500">
                <Brain className="h-7 w-7 text-yellow-600 mb-3 group-hover:scale-125 group-hover:rotate-6 transition-all duration-500" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Diagnostic Intelligence</h4>
                <p className="text-sm text-muted-foreground">Maps every student's VARK learning style, multiple intelligences, and Zone of Proximal Development using research-backed assessments.</p>
              </div>
              <div className="group rounded-2xl border border-emerald-200 p-5 bg-gradient-to-br from-emerald-100 to-teal-50 hover:shadow-xl hover:-translate-y-2 hover:border-emerald-400 transition-all duration-500">
                <Sparkles className="h-7 w-7 text-emerald-600 mb-3 group-hover:scale-125 group-hover:rotate-12 transition-all duration-500" />
                <h4 className="text-sm font-semibold text-foreground mb-1">AI Lesson Generation</h4>
                <p className="text-sm text-muted-foreground">Generates curriculum-aligned, personalised lesson plans tailored to each student's unique cognitive profile and learning needs.</p>
              </div>
              <div className="group rounded-2xl border border-violet-200 p-5 bg-gradient-to-br from-violet-100 to-indigo-50 hover:shadow-xl hover:-translate-y-2 hover:border-violet-400 transition-all duration-500">
                <LineChart className="h-7 w-7 text-violet-600 mb-3 group-hover:scale-125 transition-all duration-500" />
                <h4 className="text-sm font-semibold text-foreground mb-1">Analytics & Tracking</h4>
                <p className="text-sm text-muted-foreground">Tracks normalised learning gains, identifies performance mismatches, and provides real-time alerts for proactive intervention.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* What You Can Do */}
      <div className="mb-10">
        <h2 className="text-xl font-bold text-foreground mb-1">Admin Capabilities</h2>
        <p className="text-sm text-muted-foreground mb-6">Your tools for overseeing and managing the entire APAS ecosystem.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {adminFeatureCards.map((feature) => (
            <Link key={feature.path} to={feature.path} className="group">
              <Card className="h-full border-0 shadow-md hover:shadow-2xl hover:-translate-y-3 transition-all duration-500 relative overflow-hidden bg-white">
                <CardContent className="p-6">
                  <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-500  ${feature.glow}`}/>
                    <div className={`relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br ${feature.color} mb-4 shadow-lg group-hover:scale-125 group-hover:rotate-12 transition-all duration-500`}>
                      <feature.icon className={`h-7 w-7 ${feature.iconColor} group-hover:scale-110 transition-all duration-500`}/>
                    </div>
                  <h3 className="text-base font-bold text-foreground mb-2 group-hover:text-blue-600 transition-all duration-500">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {feature.description}
                  </p>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-primary opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500">
                      Open
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-2 transition-transform duration-500" />
                    </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Admin Workflow */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-foreground mb-1">Admin Workflow</h2>
        <p className="text-sm text-muted-foreground mb-6">Your role in the APAS ecosystem.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              step: "01",
              title: "Setup Classes",
              description: "Create classes with sections, or bulk import students via Excel.",
              icon: Book,
              bg: "from-blue-500 to-cyan-500",
              glow: "bg-blue-700/70"
            },
            {
              step: "02",
              title: "Assign Teachers",
              description: "Allot teachers to classes and assign diagnostic sets.",
              icon: GraduationCap,
              bg: "from-emerald-500 to-green-500",
              glow: "bg-green-700/70"
            },
            {
              step: "03",
              title: "Monitor Reports",
              description: "Review student diagnostic reports.",
              icon: FileText,
              bg: "from-purple-500 to-violet-500",
              glow: "bg-purple-700/70"
            },
            {
              step: "04",
              title: "Manage Alerts",
              description: "Handle mismatch alerts and interventions.",
              icon: AlertTriangle,
              bg: "from-orange-500 to-red-500",
              glow: "bg-orange-700/70"
            }
            ].map((step, i) => (
            <div key={i} className="relative">
              <Card className="h-full border-0 shadow-md hover:shadow-2xl hover:-translate-y-3 transition-all duration-500 overflow-hidden relative group">
                <CardContent className="p-5">
                  <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-all duration-500 ${step.glow}`}/>
                  <span className="text-5xl font-black text-slate-200 absolute top-2 right-3 group-hover:scale-125 transition-all duration-500">
                  {step.step}</span>
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${step.bg} mb-4 shadow-lg group-hover:scale-125 group-hover:rotate-12 transition-all duration-500`}>
                    <step.icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-base font-bold text-foreground mb-2 group-hover:text-blue-600 transition-all duration-300">{step.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ROUTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const Dashboard = () => {
  const { profile } = useAuth();


  if (profile?.role === "parent") {
    return <Navigate to="/parent-dashboard" replace />;
  }
  if (profile?.role === "knsoft_admin") {
    return <Navigate to="/knsoft-admin" replace />;
  }
  if (profile?.role === "school_admin") {
    return <Navigate to="/super-admin" replace />;
  }
  if (profile?.role === "student") {
    return <StudentDashboard />;
  }

  if (profile?.role === "admin" || profile?.role === "principal") {
    return <AdminHome />;
  }

  return <TeacherHome />;
};

export default Dashboard;


