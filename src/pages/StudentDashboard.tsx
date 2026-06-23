import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import studentBanner from "@/assets/student-dashboard-banner.png";
import { BarChart3 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  PieChart,
  BarChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  ClipboardList, Download,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Target,
  Sparkles,
  Lightbulb,
  FileText,
  Brain,
  ImageIcon,
} from "lucide-react";
import { format, subDays, startOfDay, isAfter } from "date-fns";
import { ProfileCompletionBar } from "@/components/onboarding/ProfileCompletionBar";
import { useProfileCompletion } from "@/hooks/useProfileCompletion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudentReport } from "@/components/StudentReport";
import { analyzeResponses, getReportConfig } from "@/data/reportTheories";

const COMPLETION_COLORS = {
  completed: "hsl(142, 71%, 45%)",
  pending: "hsl(43, 96%, 56%)",
  overdue: "hsl(0, 84%, 60%)",
};

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

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { percent: profilePct, missing: profileMissing } = useProfileCompletion();
  const [showReport, setShowReport] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedWorksheet, setSelectedWorksheet] = useState<any>(null);

  // ── Homework assignments + own submissions
  const { data: hwData, isLoading: hwLoading } = useQuery({
    queryKey: ["student-dashboard-homework", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: assignments }, { data: submissions }] = await Promise.all([
(() => {
          let q = supabase
            .from("homework_assignments")
            .select("id, period_title, topic, subject, class_level, section, assigned_at, due_date, exit_ticket_content")
            .order("assigned_at", { ascending: false })
            .limit(50);
          if (profile?.school_id) q = q.eq("school_id", profile.school_id);
          if (profile?.class_grade) q = q.eq("class_level", `Class ${profile.class_grade}`);
          if (profile?.section)    q = q.eq("section", profile.section);
          return q;
        })(),
        supabase
          .from("homework_submissions")
          .select("id, assignment_id, completed, submitted_at, teacher_score, submission_percentage")
          .eq("student_id", user!.id),
      ]);
      return { assignments: assignments || [], submissions: submissions || [] };
    },
  });

  // ── Assigned Worksheets
  const { data: assignedWorksheets = [], isLoading: worksheetsLoading } = useQuery({
    queryKey: ["student-assigned-worksheets", user?.id, profile?.school_id, profile?.class_grade, profile?.section],
    enabled: !!user?.id && !!profile?.school_id && !!profile?.class_grade,
    queryFn: async () => {
      // Guard: ensure class_grade exists before proceeding
      if (!profile?.class_grade) return [];
      
      // Convert class_grade to class_level format (e.g., "1" -> "Class 1")
      if (!profile?.class_grade) return [];
      const classLevelFormatted = `Class ${profile?.class_grade}`;
      
      let query = supabase
        .from("worksheet_assignments")
        .select("id, worksheet_id, class_level, section, assigned_at, due_date, status, worksheets(id, worksheet_content, image_url, page_count, chapter, topic, subtopic, academic_year, subject)")
        .eq("school_id", profile?.school_id!)
        .eq("class_level", classLevelFormatted)
        .eq("status", "active");
      
      // If student has a section, filter where section matches OR section is null/unset
      if (profile?.section) {
        query = query.or(`section.eq.${profile.section},section.is.null`);
      }
      // If student has no section, don't filter by section at all — show all class worksheets
      
      const { data, error } = await query.order("assigned_at", { ascending: false });
      
      if (error) {
        console.error("Error fetching assigned worksheets:", error);
        return [];
      }
      return data || [];
    },
  });

  // ── Academic tests (last 30 days) for daily/weekly score
  const { data: tests, isLoading: testsLoading } = useQuery({
    queryKey: ["student-dashboard-tests", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const since = subDays(new Date(), 30).toISOString();
      const { data } = await supabase
        .from("academic_tests")
        .select("id, score, total_questions, completed_at, subject")
        .eq("student_id", user!.id)
        .gte("completed_at", since)
        .order("completed_at", { ascending: true });
      return data || [];
    },
  });

  // ── Assessment data
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

  const reportConfig = myAssessment ? getReportConfig(myAssessment.age_group) : null;
  const scores = myAssessment ? analyzeResponses(myAssessment.age_group, myAssessment.responses as Record<string, number>) : null;

  // ── Compute homework breakdown
  const breakdown = useMemo(() => {
    if (!hwData) return { completed: 0, pending: 0, overdue: 0, total: 0, pendingList: [] as any[] };
    const subMap = new Map(hwData.submissions.map((s) => [s.assignment_id, s]));
    const now = new Date();
    let completed = 0,
      pending = 0,
      overdue = 0;
    const pendingList: any[] = [];

    for (const a of hwData.assignments) {
      const sub = subMap.get(a.id);
      if (sub?.completed) {
        completed++;
      } else {
        const due = a.due_date ? new Date(a.due_date) : null;
        if (due && isAfter(now, due)) {
          overdue++;
          pendingList.push({ ...a, status: "overdue" });
        } else {
          pending++;
          pendingList.push({ ...a, status: "pending" });
        }
      }
    }
    return { completed, pending, overdue, total: hwData.assignments.length, pendingList: pendingList.slice(0, 5) };
  }, [hwData]);

  const completionPct = breakdown.total > 0 ? Math.round((breakdown.completed / breakdown.total) * 100) : 0;

  const pieData = [
    { name: "Completed", value: breakdown.completed, color: COMPLETION_COLORS.completed },
    { name: "Pending", value: breakdown.pending, color: COMPLETION_COLORS.pending },
    { name: "Overdue", value: breakdown.overdue, color: COMPLETION_COLORS.overdue },
  ].filter((d) => d.value > 0);

  // ── Daily Performance: today's tests average + 7-day trend
  const { todayScore, last7Days } = useMemo(() => {
    if (!tests || tests.length === 0) return { todayScore: null as number | null, last7Days: [] as any[] };
    const today = startOfDay(new Date());
    const buckets: Record<string, { sum: number; count: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(today, i), "yyyy-MM-dd");
      buckets[d] = { sum: 0, count: 0 };
    }
    let todaySum = 0,
      todayCount = 0;
    for (const t of tests) {
      const day = format(new Date(t.completed_at), "yyyy-MM-dd");
      const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0;
      if (buckets[day]) {
        buckets[day].sum += pct;
        buckets[day].count += 1;
      }
      if (day === format(today, "yyyy-MM-dd")) {
        todaySum += pct;
        todayCount += 1;
      }
    }
    const last7Days = Object.entries(buckets).map(([date, v]) => ({
      day: format(new Date(date), "EEE"),
      score: v.count > 0 ? Math.round(v.sum / v.count) : 0,
    }));
    return {
      todayScore: todayCount > 0 ? Math.round(todaySum / todayCount) : null,
      last7Days,
    };
  }, [tests]);

  // ── Weekly Improvement: last 4 weeks average
  const weeklyData = useMemo(() => {
    if (!tests) return [];
    const weeks: { sum: number; count: number }[] = [
      { sum: 0, count: 0 },
      { sum: 0, count: 0 },
      { sum: 0, count: 0 },
      { sum: 0, count: 0 },
    ];
    const now = new Date();
    for (const t of tests) {
      const daysAgo = Math.floor((now.getTime() - new Date(t.completed_at).getTime()) / (1000 * 60 * 60 * 24));
      const weekIdx = 3 - Math.min(3, Math.floor(daysAgo / 7));
      if (weekIdx < 0) continue;
      const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0;
      weeks[weekIdx].sum += pct;
      weeks[weekIdx].count += 1;
    }
    return weeks.map((w, i) => ({
      week: `Week ${i + 1}`,
      score: w.count > 0 ? Math.round(w.sum / w.count) : 0,
    }));
  }, [tests]);

  if (hwLoading || testsLoading || worksheetsLoading) {
    return (
      <AppLayout>
        <div className="flex h-96 items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppLayout>
    );
  }

  const firstName = profile?.full_name?.split(" ")[0] || "Student";
const subjectColors: Record<string, string> = {
  Math: "bg-blue-500 text-white",
  Science: "bg-green-500 text-white",
  English: "bg-purple-500 text-white",
  Social: "bg-orange-500 text-white",
  Telugu: "bg-pink-500 text-white",
  Hindi: "bg-red-500 text-white",
  Computer: "bg-cyan-500 text-white",
  Physics: "bg-indigo-500 text-white",
  Chemistry: "bg-emerald-500 text-white",
  Biology: "bg-lime-500 text-white",
};
  return (
    <AppLayout>
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-400 p-8 relative min-h-[220px]">

  {/* Decorative circles */}
<div className="hidden md:block">
  <div className="absolute top-8 right-20 w-16 h-16 rounded-full border border-white/40"></div>
  <div className="absolute bottom-10 right-40 w-10 h-10 rounded-full border border-white/60"></div>
  <div className="absolute top-20 left-[45%] w-8 h-8 rounded-full border border-white/60"></div>

          <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>

          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>
  <div className="max-w-xl">
    <h1 className="text-4xl font-bold">
      Welcome Back, {firstName} 👋
    </h1>

    <p className="mt-5 text-slate-650">
      Your personal learning dashboard - track homework, scores and weekly progress
    </p>
  </div>

  <img
    src={studentBanner}
    alt="Student Learning"
    /* className="absolute right-10 bottom-[-15px] h-[340px] object-contain" */
    className="hidden md:block absolute right-10 bottom-3 w-80"
  />
</div>

      <ProfileCompletionBar percent={profilePct} missing={profileMissing} />

      {/* Diagnostic Assessment CTA */}
      <Card className="mb-6 border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent hover:border-primary/40 transition-all">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              
                <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white">
                  <Lightbulb className="h-6 w-6" />
                </div>
              
              <div>
                <h3 className="font-semibold text-foreground">Write Your Diagnostic Assessment</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Take the diagnostic test to help us understand your learning needs better
                </p>
              </div>
            </div>
            <Button 
              onClick={() => navigate("/diagnostic")}
              className="flex-shrink-0 bg-blue-500 hover:bg-blue-700 text-white"
            >
              Start Assessment <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Your Assessment Results */}
      {assessmentLoading ? (
        <LoadingSpinner className="mb-6" />
      ) : myAssessment && reportConfig && scores ? (
        <div className="mb-8">
{/*           <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Your Assessment Results</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setReportOpen(true)} className="gap-1.5">
                <FileText className="h-4 w-4" /> View Full Report
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowReport(!showReport)}>
                {showReport ? "Hide Details" : "Show Details"}
              </Button>
            </div>
          </div> */}

<div className="grid lg:grid-cols-2 gap-6 mb-6">

  {/* Assessment Results */}
  <Card>
    <CardHeader>
      <div className="flex items-center gap-3">
  <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
    <BarChart3 className="h-5 w-5 text-emerald-600" />
  </div>

  <div>
    <h3 className="text-xl font-bold text-slate-800">
      Assessment Results
    </h3>
  </div>
</div>
        <div className="flex gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={() => setReportOpen(true)}
      className="gap-1.5"
    >
      <FileText className="h-4 w-4" />
      Report
    </Button>

    <Button
      variant="outline"
      size="sm"
      onClick={() => setShowReport(!showReport)}
    >
      {showReport ? "Hide" : "Details"}
    </Button>
  </div>
    </CardHeader>

    <CardContent className="space-y-3">
<div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 border border-emerald-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
      <TrendingUp className="h-7 w-7 text-emerald-600" />
    </div>
    <div>
      <p className="font-semibold text-emerald-700">
        Strong Areas
      </p>
    </div>
  </div>
        <span className="text-2xl font-bold text-emerald-600">
          {scores.filter(s => s.level === "High").length}
        </span>
      </div>

<div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 border border-amber-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">

    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center ">
      <Brain className="h-5 w-5 text-amber-600" />
    </div>
    <div>
      <p className="font-semibold text-amber-700">
        Moderate Areas
      </p>
    </div>
  </div>
        <span className="text-2xl font-bold text-amber-600">
          {scores.filter(s => s.level === "Moderate").length}
        </span>
</div>

<div className="flex items-center justify-between p-4 rounded-xl bg-red-50 border border-red-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">

    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
      <AlertCircle className="h-5 w-5 text-red-600" />
    </div>

    <div>
      <p className="font-semibold text-red-700">
        Needs Attention
      </p>
    </div>
  </div>
        <span className="text-2xl font-bold text-red-600">
          {scores.filter(s => s.level === "Developing").length}
        </span>
</div>
    </CardContent>
  </Card>

  {/* Homework Overview */}
  <Card>
    <CardHeader>
      <div className="flex items-center gap-3 ">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <ClipboardList className="h-7 w-7 text-blue-600" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-800">
            Homework Overview
          </h3>
        </div>
      </div>
    </CardHeader>

    <CardContent className="space-y-3">
<div className="flex items-center justify-between p-4 rounded-xl bg-blue-50 border border-blue-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">

    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
      <ClipboardList className="h-5 w-5 text-blue-600" />
    </div>

    <div>
      <p className="font-semibold text-blue-700">
        Pending Homework
      </p>
    </div>

  </div>

  <span className="text-3xl font-bold text-blue-600">
    {breakdown.pending + breakdown.overdue}
  </span>
</div>

<div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 border border-emerald-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">

    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
    </div>

    <div>
      <p className="font-semibold text-emerald-700">
        Completed
      </p>
    </div>

  </div>

  <span className="text-3xl font-bold text-emerald-600">
    {breakdown.completed}
  </span>
</div>

<div className="flex items-center justify-between p-4 rounded-xl bg-red-50 border border-red-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">

    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
      <AlertCircle className="h-5 w-5 text-red-600" />
    </div>

    <div>
      <p className="font-semibold text-red-700">
        Overdue
      </p>
    </div>

  </div>

  <span className="text-3xl font-bold text-red-600">
    {breakdown.overdue}
  </span>
</div>

<div className="flex items-center justify-between p-4 rounded-xl bg-purple-50 border border-purple-100 hover:-translate-y-1 hover:shadow-xl transition-all duration-300 cursor-pointer">
  <div className="flex items-center gap-3">

    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
      <Target className="h-5 w-5 text-purple-600" />
    </div>

    <div>
      <p className="font-semibold text-purple-700">
        Today's Score
      </p>
    </div>
  </div>
  <span className="text-2xl font-bold text-purple-600">
    {todayScore !== null ? `${todayScore}%` : "--"}
  </span>
</div>
    </CardContent>
  </Card>

</div>

          {showReport && (
            <div className="space-y-3 animate-fade-in">
              <div className="flex flex-wrap gap-1.5 mb-3">
                {reportConfig.theories.map((theory) => (
                  <Badge key={theory} className="bg-primary/10 text-primary border-primary/20 text-xs">
                    {theory}
                  </Badge>
                ))}
              </div>
              {scores.map((score, index) => (
                <Card key={index}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm font-semibold">{score.dimension}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">{score.theory}</p>
                      </div>
                      <Badge className={`${getLevelColor(score.level)} text-xs`}>{score.level}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Progress value={score.percentage} className={`h-2 flex-1 ${getProgressColor(score.percentage)}`} />
                      <span className="text-sm font-semibold text-foreground w-12 text-right">{score.percentage}%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{score.description}</p>
                    <p className="text-xs text-foreground/80 leading-relaxed">{score.interpretation}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}


      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Homework list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
              <ClipboardList className="h-7 w-7 text-red-600" />
            </div>
              Pending Homework
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                View All <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {breakdown.pendingList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Sparkles className="h-10 w-10 text-emerald-500 mb-2" />
                <p className="text-sm font-medium">All caught up!</p>
                <p className="text-xs text-muted-foreground">No pending homework right now.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {breakdown.pendingList.map((hw) => (
                  <div
                    key={hw.id}
                      className={`
    flex
    items-center
    justify-between
    rounded-xl
    p-4
    text-white
    bg-gradient-to-r
    ${subjectColors[hw.subject] || "from-slate-600 to-slate-700"}
    hover:shadow-xl
    hover:-translate-y-1
    hover:scale-[1.02]
    transition-all
    duration-300
    cursor-pointer
  `}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {hw.period_title || hw.topic || "Homework"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate text-white">
                        {hw.subject || "—"} · Class {hw.class_level}
                        {hw.section ? `-${hw.section}` : ""}
                        {hw.due_date && (
                          <>
                            {" "}
                            · Due {format(new Date(hw.due_date), "MMM d")}
                          </>
                        )}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        hw.status === "overdue"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-amber-300 bg-amber-50 text-amber-700"
                      }
                    >
                      {hw.status === "overdue" ? (
                        <>
                          <AlertCircle className="h-3 w-3 mr-1" /> Overdue
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3 mr-1" /> Pending
                        </>
                      )}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assigned Worksheets */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                <FileText className="h-7 w-7 text-purple-600" />
              </div>
              Your Worksheets
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignedWorksheets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Sparkles className="h-10 w-10 text-purple-500 mb-2" />
                <p className="text-sm font-medium">No worksheets assigned yet</p>
                <p className="text-xs text-muted-foreground">Worksheets assigned by your teacher will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignedWorksheets.slice(0, 5).map((ws: any) => (
                  <div
                    key={ws.id} onClick={() => setSelectedWorksheet(ws)} style={{cursor:"pointer"}}
                    className={`
                      flex
                      items-center
                      justify-between
                      rounded-xl
                      p-4
                      text-white
                      bg-gradient-to-r
                      from-purple-600
                      to-purple-700
                      hover:shadow-xl
                      hover:-translate-y-1
                      hover:scale-[1.02]
                      transition-all
                      duration-300
                    `}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {ws.worksheets?.topic || ws.worksheets?.chapter || "Practice Worksheet"}
                      </p>
                      <p className="text-xs text-purple-100 truncate">
                        {ws.worksheets?.subject || "—"} · {ws.worksheets?.page_count || 5} pages
                        {ws.due_date && (
                          <>
                            {" "}
                            · Due {format(new Date(ws.due_date), "MMM d")}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Badge className="bg-purple-900 text-white border-purple-400 cursor-pointer">
                        <FileText className="h-3 w-3 mr-1" /> View
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Daily Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Target className="h-7 w-7 text-blue-600" />
            </div>
              Daily Performance Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {last7Days.length === 0 || last7Days.every((d) => d.score === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                Complete academic tests to see your daily scores.
              </p>
            ) : (
              <ChartContainer config={{ score: { label: "Score %", color: "#2563EB" } }} className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={last7Days}>
                    <defs>
                      <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="#2563EB"
                      strokeWidth={3}
                      fill="url(#scoreGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Homework Completion Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
              Homework Completion
            </CardTitle>
          </CardHeader>
          <CardContent>
            {breakdown.total === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                No homework assigned yet.
              </p>
            ) : (
              <div className="flex items-center gap-6">
                <ChartContainer config={{}} className="h-56 w-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {pieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <div className="flex-1 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: COMPLETION_COLORS.completed }} />
                        Completed
                      </span>
                      <span className="font-medium">{breakdown.completed}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: COMPLETION_COLORS.pending }} />
                        Pending
                      </span>
                      <span className="font-medium">{breakdown.pending}</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: COMPLETION_COLORS.overdue }} />
                        Overdue
                      </span>
                      <span className="font-medium">{breakdown.overdue}</span>
                    </div>
                  </div>
                  <div className="pt-2">
                    <p className="text-xs text-muted-foreground mb-1">Overall completion</p>
                    <Progress value={completionPct} className="h-2" />
                    <p className="text-xs text-right mt-1 font-medium">{completionPct}%</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Weekly Improvement */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <TrendingUp className="h-7 w-7 text-amber-600" />
            </div>
              Weekly Improvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weeklyData.every((w) => w.score === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                Take more tests across weeks to see your improvement.
              </p>
            ) : (
              <ChartContainer
                config={{ score: { label: "Avg Score %", color: "hsl(142, 71%, 45%)" } }}
                className="h-56"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(142, 71%, 45%)"
                      strokeWidth={3}
                      dot={{ r: 5, fill: "hsl(142, 71%, 45%)" }}
                      activeDot={{ r: 7 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
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
        />
      )}

      {/* Worksheet Viewer Dialog */}
      {selectedWorksheet && (
        <Dialog open={!!selectedWorksheet} onOpenChange={() => setSelectedWorksheet(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-purple-600" />
                {selectedWorksheet.worksheets?.topic || selectedWorksheet.worksheets?.chapter || "Worksheet"}
              </DialogTitle>
            </DialogHeader>
            <div className="flex gap-2 mb-4">
              <Button
                size="sm"
                className="gap-2 bg-green-600 hover:bg-green-700"
                onClick={async () => {
                  const content = selectedWorksheet.worksheets?.worksheet_content || "";
                  const topic = selectedWorksheet.worksheets?.topic || "Worksheet";
                  let html = content
                    .replace(/^#### (.*?)$/gm, "<h4></h4>")
                    .replace(/^### (.*?)$/gm, "<h3></h3>")
                    .replace(/^## (.*?)$/gm, "<h2></h2>")
                    .replace(/^# (.*?)$/gm, "<h1></h1>")
                    .replace(/\*\*(.*?)\*\*/g, "<strong></strong>")
                    .replace(/^---$/gm, "<hr>")
                    .replace(/^- (.*?)$/gm, "<li></li>")
                    .replace(/((?:<li>.*?<\/li>\n?)+)/g, "<ul></ul>");
                  html = html.split("\n\n").map((p: string) => {
                    const t = p.trim();
                    if (!t || t.startsWith("<h") || t.startsWith("<ul") || t.startsWith("<hr")) return t;
                    return "<p>" + t.replace(/\n/g, "<br>") + "</p>";
                  }).join("\n");
                  const tempDiv = document.createElement("div");
                  tempDiv.innerHTML = `<div class="report"><div class="header"><div class="header-left"><div class="brand">APAS <span>Worksheet</span></div><div class="report-label">Practice Worksheet</div></div><div class="header-right"><div class="report-date">${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div><div class="status-badge">AI Generated</div></div></div><div class="learner-card"><div class="lc-field"><label>Class</label><value>Class ${profile?.class_grade || ""}</value><small>Section ${profile?.section || ""}</small></div><div class="lc-field"><label>Subject</label><value>${selectedWorksheet.worksheets?.subject || ""}</value><small>${topic}</small></div><div class="lc-field"><label>Report Type</label><value>Worksheet</value><small>Practice Activities</small></div></div><div class="content">${html}</div><div class="footer"><div class="footer-note">This worksheet is auto-generated by the APAS AI engine. For academic use only.</div><div class="footer-apas">APAS � ${new Date().getFullYear()}</div></div></div>`;
                  const styleEl = document.createElement("style");
                  styleEl.textContent = "* { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; } .report { max-width: 780px; margin: 0 auto; padding: 28px 24px; color: #1a1a2e; font-size: 12px; line-height: 1.6; } .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 2px solid #1a1a2e; } .brand { font-size: 24px; color: #1a1a2e; font-weight: bold; } .brand span { color: #0e9a7b; font-style: italic; } .report-label { font-size: 10px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #6b6b8a; margin-top: 4px; } .header-right { text-align: right; } .report-date { font-size: 12px; color: #3a3a5c; } .status-badge { display: inline-block; background: #0e9a7b; color: white; font-size: 9px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; margin-top: 4px; } .learner-card { background: #1a1a2e; color: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; } .lc-field label { font-size: 9px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.45); display: block; margin-bottom: 3px; } .lc-field value { font-size: 16px; color: white; display: block; font-weight: bold; } .lc-field small { font-size: 11px; color: rgba(255,255,255,0.55); } .content h1 { font-size: 18px; color: #1a1a2e; margin: 24px 0 10px 0; padding-bottom: 6px; border-bottom: 2px solid #0e9a7b; } .content h2 { font-size: 15px; color: #1a1a2e; margin: 20px 0 8px 0; padding-left: 12px; border-left: 4px solid #0e9a7b; } .content h3 { font-size: 13px; font-weight: 600; color: #3a3a5c; margin: 16px 0 6px 0; } .content p { margin: 6px 0; color: #3a3a5c; } .content strong { color: #1a1a2e; font-weight: 600; } .content ul { list-style: none; margin: 6px 0; padding: 0; } .content ul li { position: relative; padding: 3px 0 3px 18px; color: #3a3a5c; } .content hr { border: none; border-top: 1px solid #e2e0d8; margin: 16px 0; } .footer { border-top: 1px solid #e2e0d8; padding-top: 12px; margin-top: 20px; display: flex; justify-content: space-between; } .footer-note { font-size: 10px; color: #6b6b8a; } .footer-apas { font-size: 13px; color: #3a3a5c; font-style: italic; }";
                  tempDiv.appendChild(styleEl);
                  const html2pdf = (await import("html2pdf.js")).default;
                  html2pdf().set({
                    margin: [10,10,10,10],
                    filename: "Worksheet-" + topic + ".pdf",
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#f7f5f0" },
                    jsPDF: { orientation: "portrait", unit: "mm", format: "a4" }
                  }).from(tempDiv).save();
                }}
              >
                <Download className="h-4 w-4" /> Download PDF
              </Button>
              {selectedWorksheet.worksheets?.image_url && (
                <Button
                  size="sm"
                  className="gap-2 bg-purple-600 hover:bg-purple-700"
                  onClick={async () => {
                    try {
                      const imageUrl = selectedWorksheet.worksheets.image_url;
                      const topic = selectedWorksheet.worksheets?.topic || "Worksheet";
                      const ext = imageUrl.split(".").pop()?.split("?")[0] ?? "jpg";
                      const response = await fetch(imageUrl);
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `Illustrated-Worksheet-${topic}.${ext}`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      console.error("Failed to download image", err);
                    }
                  }}
                >
                  <ImageIcon className="h-4 w-4" /> Download Image
                </Button>
              )}
            </div>
            {selectedWorksheet.worksheets?.image_url && (
              <div className="mb-4 flex justify-center">
                <img
                  src={selectedWorksheet.worksheets.image_url}
                  alt="Illustrated worksheet"
                  className="rounded-xl border max-h-[400px] object-contain"
                />
              </div>
            )}
            <div className="prose prose-sm max-w-none border rounded-xl p-6 bg-muted/20">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {selectedWorksheet.worksheets?.worksheet_content || "No content available"}
              </ReactMarkdown>
            </div>
          </DialogContent>
        </Dialog>
      )}

    </AppLayout>
  );
}
