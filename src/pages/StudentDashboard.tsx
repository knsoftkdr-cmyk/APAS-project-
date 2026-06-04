import { useMemo } from "react";
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  PieChart,
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
  ClipboardList,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Target,
  Sparkles,
  Lightbulb,
} from "lucide-react";
import { format, subDays, startOfDay, isAfter } from "date-fns";
import { ProfileCompletionBar } from "@/components/onboarding/ProfileCompletionBar";
import { useProfileCompletion } from "@/hooks/useProfileCompletion";

const COMPLETION_COLORS = {
  completed: "hsl(142, 71%, 45%)",
  pending: "hsl(43, 96%, 56%)",
  overdue: "hsl(0, 84%, 60%)",
};

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { percent: profilePct, missing: profileMissing } = useProfileCompletion();

  // ── Homework assignments + own submissions
  const { data: hwData, isLoading: hwLoading } = useQuery({
    queryKey: ["student-dashboard-homework", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: assignments }, { data: submissions }] = await Promise.all([
        supabase
          .from("homework_assignments")
          .select("id, period_title, topic, subject, class_level, section, assigned_at, due_date, exit_ticket_content")
          .order("assigned_at", { ascending: false })
          .limit(50),
        supabase
          .from("homework_submissions")
          .select("id, assignment_id, completed, submitted_at, teacher_score, submission_percentage")
          .eq("student_id", user!.id),
      ]);
      return { assignments: assignments || [], submissions: submissions || [] };
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

  if (hwLoading || testsLoading) {
    return (
      <AppLayout>
        <div className="flex h-96 items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppLayout>
    );
  }

  const firstName = profile?.full_name?.split(" ")[0] || "Student";

  return (
    <AppLayout>
<div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-[#D8B4FE] via-[#C4B5FD] to-[#A5B4FC] p-8 text-slate-800 relative min-h-[320px]">

  {/* Decorative circles */}
  <div className="absolute top-8 right-20 w-16 h-16 rounded-full border border-white/40"></div>
  <div className="absolute bottom-10 right-40 w-10 h-10 rounded-full border border-white/40"></div>
  <div className="absolute top-20 left-[45%] w-8 h-8 rounded-full border border-white/30"></div>

  <div className="max-w-xl">
    <h1 className="text-5xl font-bold">
      Welcome Back, {firstName} 👋
    </h1>

    <p className="mt-5 text-slate-650">
      Your personal learning dashboard - track homework, scores and weekly progress
    </p>
  </div>

  <img
    src={studentBanner}
    alt="Student Learning"
    className="absolute right-10 bottom-[-15px] h-[340px] object-contain"
  />
</div>

      <ProfileCompletionBar percent={profilePct} missing={profileMissing} />

      {/* Diagnostic Assessment CTA */}
      <Card className="mb-6 border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent hover:border-primary/40 transition-all">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-primary/10 p-3">
                <Lightbulb className="h-6 w-6 text-primary" />
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
              className="flex-shrink-0"
            >
              Start Assessment <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Top row: KPI strip */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Pending Homework</p>
                <p className="text-3xl font-bold text-foreground">{breakdown.pending + breakdown.overdue}</p>
              </div>
              <ClipboardList className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-3xl font-bold text-emerald-600">{breakdown.completed}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className="text-3xl font-bold text-red-600">{breakdown.overdue}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Today's Score</p>
                <p className="text-3xl font-bold text-foreground">
                  {todayScore !== null ? `${todayScore}%` : "—"}
                </p>
              </div>
              <Target className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Homework list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
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
                    className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {hw.period_title || hw.topic || "Homework"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
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

        {/* Daily Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Daily Performance Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {last7Days.length === 0 || last7Days.every((d) => d.score === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                Complete academic tests to see your daily scores.
              </p>
            ) : (
              <ChartContainer config={{ score: { label: "Score %", color: "hsl(var(--primary))" } }} className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={last7Days}>
                    <defs>
                      <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
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
              <CheckCircle2 className="h-5 w-5 text-primary" />
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
              <TrendingUp className="h-5 w-5 text-primary" />
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
    </AppLayout>
  );
}
