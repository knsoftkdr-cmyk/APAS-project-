import { useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Users, BookOpen, ClipboardCheck, Brain,
  AlertTriangle, Bell, MessageSquare, CheckSquare,
  Calendar, ArrowRight, Clock, TrendingUp,
  ChevronRight, Sparkles, GraduationCap,
  CheckCircle2, Circle, CalendarDays,
} from "lucide-react";
import { format, isToday, isTomorrow, parseISO, isAfter } from "date-fns";
import { MyTasksWidget } from "@/components/MyTasksWidget";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AtRiskStudent {
  student_id: string;
  student_name: string | null;
  risk_level: string;
  subject: string;
  dropout_risk_percentage: number;
}

interface BehaviourAlert {
  id: string;
  student_group: string | null;
  trigger_condition: string | null;
  recommendation: string | null;
  created_at: string;
  status: string;
}

interface PendingEval {
  id: string;
  student_name: string | null;
  submitted_at: string | null;
  assignment_id: string;
}

interface UpcomingEvent {
  id: string;
  title: string;
  start_date: string;
  event_type: string;
}

interface AIRec {
  text: string;
  icon: "warning" | "idea" | "trend";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const riskColor = (level: string) => {
  if (level === "high" || level === "critical") return { badge: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500", solid: "bg-red-500" };
  if (level === "medium") return { badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500", solid: "bg-amber-500" };
  return { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", solid: "bg-emerald-500" };
};

const riskLabel = (level: string) => {
  if (level === "high" || level === "critical") return "High Risk";
  if (level === "medium") return "Medium Risk";
  return "Low Risk";
};

const eventDotColor: Record<string, string> = {
  holiday: "bg-red-400",
  exam: "bg-blue-400",
  class_period: "bg-emerald-400",
  event: "bg-amber-400",
};

const formatEventDate = (dateStr: string) => {
  const d = parseISO(dateStr);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "d MMM yyyy");
};

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

// ─── Elevated Stat Card ─────────────────────────────────────────────────────
// A quiet accent bar + icon chip replaces the generic "icon top-left, number
// below" template — the color does the signalling, the number stays the hero.

const DashStatCard = ({
  label, value, icon: Icon, accent, linkTo, linkLabel, loading,
}: {
  label: string; value: number | string; icon: any; accent: "blue" | "orange" | "purple";
  linkTo: string; linkLabel: string; loading?: boolean;
}) => {
  const tones = {
    blue: { bar: "bg-blue-500", chip: "bg-blue-50 text-blue-600", link: "text-blue-600" },
    orange: { bar: "bg-orange-500", chip: "bg-orange-50 text-orange-600", link: "text-orange-600" },
    purple: { bar: "bg-purple-500", chip: "bg-purple-50 text-purple-600", link: "text-purple-600" },
  }[accent];

  return (
    <Card className="relative overflow-hidden border border-border/60 shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-300">
      <div className={cn("absolute inset-y-0 left-0 w-1", tones.bar)} />
      <CardContent className="p-5 pl-6">
        <div className="flex items-start justify-between mb-4">
          <div className={cn("rounded-xl p-2.5", tones.chip)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="text-3xl font-bold tracking-tight text-foreground mb-1">
          {loading ? <LoadingSpinner size="sm" /> : value}
        </p>
        <p className="text-xs text-muted-foreground mb-3">{label}</p>
        {linkTo ? (
          <Link
            to={linkTo}
            className={cn("text-xs font-medium inline-flex items-center gap-1 hover:gap-1.5 transition-all", tones.link)}
          >
            {linkLabel} <ArrowRight className="h-3 w-3" />
          </Link>
        ) : (
          <span className={cn("text-xs font-medium inline-flex items-center gap-1 opacity-70", tones.link)}>
            {linkLabel} <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Section Header ───────────────────────────────────────────────────────────

const SectionHeader = ({
  title, linkTo, linkLabel = "View All", icon: Icon, iconClass,
}: { title: string; linkTo: string; linkLabel?: string; icon: any; iconClass: string }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2">
      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:rotate-12 group-hover:scale-110 group-hover:-translate-y-1", iconClass)}>
        <Icon className="h-7 w-7 transition-all duration-300" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
    <Link to={linkTo} className="text-xs text-muted-foreground hover:text-blue-600 font-medium inline-flex items-center gap-0.5 transition-colors">
      {linkLabel} <ChevronRight className="h-3 w-3" />
    </Link>
  </div>
);

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = ({ text }: { text: string }) => (
  <div className="py-8 text-center">
    <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
    <p className="text-xs text-muted-foreground">{text}</p>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const TeacherWorkspaceDashboard = () => {
  const { user, profile } = useAuth();
  const today = format(new Date(), "d MMM yyyy, EEEE");

  // ── Today's classes count ──────────────────────────────────────────────────
  const { data: classCount, isLoading: classLoading } = useQuery({
    queryKey: ["teacher-class-count", user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("class_teachers")
        .select("id", { count: "exact", head: true })
        .eq("teacher_id", user!.id);
      return count || 0;
    },
    enabled: !!user?.id,
  });

  // ── Attendance pending (students in teacher's classes without attendance today) ─
  const { data: attendancePending, isLoading: attLoading } = useQuery({
    queryKey: ["attendance-pending", user?.id],
    queryFn: async () => {
      const { data: classTeachers } = await supabase
        .from("class_teachers")
        .select("class_id")
        .eq("teacher_id", user!.id);
      const classIds = (classTeachers || []).map((c: any) => c.class_id);
      if (!classIds.length) return 0;
      const { count } = await supabase
        .from("class_students")
        .select("id", { count: "exact", head: true })
        .in("class_id", classIds);
      return count || 0;
    },
    enabled: !!user?.id,
  });

  // ── Homework pending evaluation ─────────────────────────────────────────────
  const { data: pendingEvals, isLoading: evalLoading } = useQuery({
    queryKey: ["pending-evals", user?.id],
    queryFn: async () => {
      const { data: assignments } = await supabase
        .from("homework_assignments")
        .select("id")
        .eq("assigned_by", user!.id);
      const assignmentIds = (assignments || []).map((a: any) => a.id);
      if (!assignmentIds.length) return { count: 0, list: [] };
      const { data, count } = await supabase
        .from("homework_submissions")
        .select("id, student_name, submitted_at, assignment_id", { count: "exact" })
        .in("assignment_id", assignmentIds)
        .is("teacher_score", null)
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: false })
        .limit(4);
      return { count: count || 0, list: (data || []) as PendingEval[] };
    },
    enabled: !!user?.id,
  });


  // ── At-risk students (scoped to this teacher's assigned classes) ───────────
  const { data: atRiskStudents, isLoading: riskLoading } = useQuery({
    queryKey: ["at-risk-students-workspace", user?.id, profile?.school_id],
    queryFn: async () => {
      // 1. Which classes does this teacher teach?
      const { data: assignedClasses } = await supabase
        .from("class_teachers")
        .select("class_id")
        .eq("teacher_id", user!.id);
      const classIds = [...new Set((assignedClasses || []).map((c: any) => c.class_id))];
      if (classIds.length === 0) return [];

      // 2. Resolve class_id -> { name, section } (students table stores class/section as text)
      const { data: classRows } = await supabase
        .from("classes")
        .select("name, section")
        .in("id", classIds);
      if (!classRows || classRows.length === 0) return [];

      // 3. Find students in those class/section combos
      const orFilter = classRows
        .map((c: any) => `and(class.eq.${c.name},section.eq.${c.section})`)
        .join(",");
      const { data: students } = await supabase
        .from("students")
        .select("id, full_name")
        .or(orFilter)
        .eq("school_id", profile?.school_id);
      if (!students || students.length === 0) return [];

      const studentIds = [...new Set(students.map((s: any) => s.id))];
      const nameMap = new Map(students.map((s: any) => [s.id, s.full_name]));

      // 4. Pull predictions for exactly those students (student_predictions.student_id = students.id)
      const { data: preds } = await supabase
        .from("student_predictions")
        .select("student_id, risk_level, subject, dropout_risk_percentage")
        .in("student_id", studentIds)
        .in("risk_level", ["high", "medium"])
        .order("dropout_risk_percentage", { ascending: false })
        .limit(4);
      if (!preds || preds.length === 0) return [];

      return preds.map((p: any) => ({
        student_id: p.student_id,
        student_name: nameMap.get(p.student_id) || "Unknown Student",
        risk_level: p.risk_level,
        subject: p.subject,
        dropout_risk_percentage: p.dropout_risk_percentage,
      })) as AtRiskStudent[];
    },
    enabled: !!user?.id && !!profile?.school_id,
  });

  // ── Behaviour alerts (scoped to this teacher's classes) + follow-ups due ───
  const { data: behaviourAlerts, isLoading: alertLoading } = useQuery({
    queryKey: ["behaviour-alerts-workspace", user?.id, profile?.school_id],
    queryFn: async () => {
      // --- System-generated alerts, scoped to this teacher's assigned classes ---
      let scopedAlerts: any[] = [];
      const { data: assignedClasses } = await supabase
        .from("class_teachers")
        .select("class_id")
        .eq("teacher_id", user!.id);
      const classIds = [...new Set((assignedClasses || []).map((c: any) => c.class_id))];

      if (classIds.length > 0) {
        const { data: classRows } = await supabase
          .from("classes")
          .select("name, section")
          .in("id", classIds);

        if (classRows?.length) {
          const { data: myStudents } = await supabase
            .from("students")
            .select("full_name")
            .or(classRows.map((c: any) => `and(class.eq.${c.name},section.eq.${c.section})`).join(","))
            .eq("school_id", profile?.school_id ?? "");
          const myNames = new Set((myStudents || []).map((s: any) => s.full_name));

          if (myNames.size > 0) {
            const { data: allAlerts } = await supabase
              .from("mismatch_alerts")
              .select("id, student_group, trigger_condition, created_at")
              .eq("status", "flagged")
              .eq("school_id", profile?.school_id ?? "")
              .order("created_at", { ascending: false });

            scopedAlerts = (allAlerts || [])
              .filter((a: any) => [...myNames].some(name => a.student_group?.startsWith(name)))
              .map((a: any) => ({
                id: `alert-${a.id}`,
                kind: "alert" as const,
                title: a.student_group,
                subtitle: a.trigger_condition,
                date: a.created_at,
              }));
          }
        }
      }

      // --- This teacher's own pending follow-ups (from confidential notes) ---
      const { data: followUps } = await supabase
        .from("teacher_notes")
        .select("id, note, follow_up_date, students(full_name, class, section)")
        .eq("teacher_id", user!.id)
        .eq("follow_up_completed", false)
        .not("follow_up_date", "is", null)
        .order("follow_up_date", { ascending: true });

      const scopedFollowUps = (followUps || []).map((f: any) => ({
        id: `followup-${f.id}`,
        kind: "followup" as const,
        title: f.students?.full_name || "Unknown Student",
        classInfo: f.students?.class ? `${f.students.class}${f.students.section ? ` - ${f.students.section}` : ""}` : "",
        subtitle: `Follow-up: ${f.note}`,
        date: f.follow_up_date,
      }));

      // Follow-ups first (most actionable/time-sensitive), then recent alerts
      return [...scopedFollowUps, ...scopedAlerts].slice(0, 4);
    },
    enabled: !!user?.id && !!profile?.school_id,
  });


  // ── Upcoming events ─────────────────────────────────────────────────────────
  const { data: upcomingEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ["upcoming-events-workspace", profile?.school_id],
    queryFn: async () => {
      if (!profile?.school_id) return [];
      const { data } = await supabase
        .from("academic_calendar_events")
        .select("id, title, start_date, event_type")
        .eq("school_id", profile.school_id)
        .gte("start_date", new Date().toISOString().split("T")[0])
        .order("start_date")
        .limit(4);
      return (data || []) as UpcomingEvent[];
    },
    enabled: !!profile?.school_id,
  });

  // ── AI recommendations (generated from risk + alert data) ──────────────────
  const aiRecs: AIRec[] = [];
  if (atRiskStudents && atRiskStudents.length > 0) {
    const highRisk = atRiskStudents.filter(s => s.risk_level === "high" || s.risk_level === "critical");
    if (highRisk.length > 0) {
      aiRecs.push({
        text: `${highRisk.length} student${highRisk.length > 1 ? "s" : ""} flagged as high academic risk — review intervention plans.`,
        icon: "warning",
      });
    }
  }
  if (pendingEvals && pendingEvals.count > 5) {
    aiRecs.push({
      text: `${pendingEvals.count} homework submissions are awaiting evaluation. Timely feedback improves retention.`,
      icon: "idea",
    });
  }
  if (behaviourAlerts && behaviourAlerts.length > 0) {
    aiRecs.push({
      text: `${behaviourAlerts.length} behaviour alert${behaviourAlerts.length > 1 ? "s" : ""} detected. Review learning support cases.`,
      icon: "trend",
    });
  }
  if (aiRecs.length === 0) {
    aiRecs.push({ text: "All students are on track. Consider assigning enrichment activities for high performers.", icon: "idea" });
  }

  const recIconMap = {
    warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />,
    idea: <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />,
    trend: <TrendingUp className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />,
  };

  // ── Plain-language briefing line (the hero's signature element) ────────────
  // Built from the same numbers as the stat cards, so it never contradicts them.
  const briefingParts: string[] = [];
  if (classCount) briefingParts.push(`${classCount} ${classCount === 1 ? "class" : "classes"}`);
  if (pendingEvals?.count) briefingParts.push(`${pendingEvals.count} submission${pendingEvals.count > 1 ? "s" : ""} waiting for feedback`);
  if (atRiskStudents?.length) briefingParts.push(`${atRiskStudents.length} student${atRiskStudents.length > 1 ? "s" : ""} needing attention`);
  const briefing = briefingParts.length > 0
    ? `You have ${briefingParts.join(", ")} today.`
    : "Nothing urgent on your plate today — a good day to get ahead.";

  return (
    <AppLayout>
      <div className="space-y-6 pb-10">

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-cyan-500 to-emerald-500 px-7 py-8 md:px-9 md:py-10 text-white shadow-elevated">
          {/* decorative constellation, echoes the banner motif used elsewhere in the app */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-90">
            <div className="absolute -top-10 -right-10 h-56 w-56 rounded-full bg-blue-400/10 blur-2xl" />
            <div className="absolute bottom-0 right-24 h-32 w-32 rounded-full bg-indigo-300/10 blur-xl" />
            <div className="absolute top-10 right-72 h-2 w-2 rounded-full bg-white/40" />
            <div className="absolute top-24 right-52 h-1.5 w-1.5 rounded-full bg-white/30" />
            <div className="absolute bottom-14 right-96 h-1.5 w-1.5 rounded-full bg-white/30" />
          </div>

          <div className="relative flex items-start justify-between flex-wrap gap-6">
            <div className="max-w-xl">
              <div className="flex items-center gap-2 mb-3">
                <GraduationCap className="h-4 w-4 text-blue-300" />
                <span className="text-[11px] font-semibold text-blue-200 uppercase tracking-[0.15em]">
                  Teacher Workspace
                </span>
              </div>
              <h1 className="text-3xl md:text-[2.25rem] font-bold tracking-tight leading-tight">
                {getGreeting()}, {profile?.full_name?.split(" ")[0] || "Teacher"}
              </h1>
              <p className="text-sm text-blue-100/80 mt-1.5">{today}</p>

            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Link to="/academic-calendar">
                <Button variant="secondary" size="sm" className="gap-1.5 bg-white/10 text-white border border-white/20 hover:bg-white/20">
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </Button>
              </Link>
              <Link to="/curative">
                <Button size="sm" className="gap-1.5 bg-white text-[hsl(213,38%,26%)] hover:bg-blue-50">
                  <Sparkles className="h-4 w-4" />
                  Generate Lesson
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* ── At a Glance Stats ──────────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            At a Glance
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <DashStatCard
              label="Today's Classes"
              value={classCount ?? 0}
              icon={Users}
              accent="blue"
              linkTo="/timetable"
              linkLabel="View Schedule"
              loading={classLoading}
            />
            <DashStatCard
              label="Attendance Pending"
              value={attendancePending ?? 0}
              icon={ClipboardCheck}
              accent="orange"
              linkTo=""
              linkLabel="Mark Attendance"
              loading={attLoading}
            />
            <DashStatCard
              label="Homework Pending Evaluation"
              value={pendingEvals?.count ?? 0}
              icon={BookOpen}
              accent="purple"
              linkTo="/analytics"
              linkLabel="Evaluate Now"
              loading={evalLoading}
            />
          </div>
        </div>

        {/* ── My Tasks ───────────────────────────────────────────────────── */}
        <MyTasksWidget />

        {/* ── Main Grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left column: At-Risk + Behaviour */}
          <div className="lg:col-span-1 space-y-5">

            {/* At-Risk Students */}
            <Card className="group relative overflow-hidden border border-red-400 shadow-elevated transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ">
              <CardContent className="p-5">
                <SectionHeader
                  title="At-Risk Students"
                  linkTo="/teacher-at-risk"
                  icon={AlertTriangle}
                  iconClass="bg-red-50 text-red-600"
                />
                {riskLoading ? (
                  <div className="flex justify-center py-6"><LoadingSpinner /></div>
                ) : !atRiskStudents?.length ? (
                  <EmptyState text="No at-risk students — great work!" />
                ) : (
                  <div className="space-y-2">
                    {atRiskStudents.map((s) => {
                      const colors = riskColor(s.risk_level);
                      return (
                        <div
                          key={s.student_id}
                          className="flex items-center justify-between rounded-xl bg-white border border-red-100 shadow-sm px-4 py-3 hover:shadow-md hover:border-red-300 transition-all duration-300"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0",
                                colors.solid
                              )}
                            >
                              {(s.student_name || "?")[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {s.student_name}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {s.subject}
                              </p>
                            </div>
                          </div>
                          <Badge
                            className={cn(
                              "text-xs font-medium px-3 py-1 rounded-full border shrink-0",
                              colors.badge
                            )}
                          >
                            {riskLabel(s.risk_level)}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Behaviour Alerts */}
            <Card className="group border border-cyan-400 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ">
              <CardContent className="p-5">
                <SectionHeader
                  title="Behaviour Alerts" 
                  linkTo="/teacher-behaviour"
                  icon={Bell}
                  iconClass="bg-cyan-100 text-cyan-500"
                />
                {alertLoading ? (
                  <div className="flex justify-center py-6"><LoadingSpinner /></div>
                ) : !behaviourAlerts?.length ? (
                  <EmptyState text="No behaviour alerts" />
                ) : (
                <div className="space-y-3">
                  {behaviourAlerts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between rounded-xl bg-white border border-cyan-100 shadow-sm px-4 py-3 hover:shadow-md hover:border-cyan-300 transition-all duration-300"
                    >
                      {/* Left Side */}
                      <div className="flex items-center gap-3">

                        <div
                          className={cn(
                            "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
                            a.kind === "followup"
                              ? "bg-cyan-100"
                              : "bg-orange-100"
                          )}
                        >
                          {a.kind === "followup" ? (
                            <Clock className="h-5 w-5 text-cyan-600" />
                          ) : (
                            <Bell className="h-5 w-5 text-orange-600" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {a.title}
                            {(a as any).classInfo && (
                              <span className="font-normal text-muted-foreground">
                                {" "}· {(a as any).classInfo}
                              </span>
                            )}
                          </p>

                          <p className="text-xs text-muted-foreground truncate">
                            {a.subtitle}
                          </p>
                        </div>

                      </div>

                      {/* Right Side */}
                      <span className="text-xs font-medium text-cyan-600 shrink-0">
                        {isToday(new Date(a.date))
                          ? "Today"
                          : isTomorrow(new Date(a.date))
                          ? "Tomorrow"
                          : format(new Date(a.date), "d MMM")}
                      </span>
                    </div>
                  ))}
                </div>
                )}
              </CardContent>
            </Card>

          </div>

          {/* Middle column: AI Recommendations + Pending Evaluations */}
          <div className="lg:col-span-1 space-y-5">

            {/* AI Recommendations */}
            <Card className="group relative overflow-hidden border border-blue-300 shadow-elevated transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-gradient-to-br from-[hsl(217,91%,53%)]/[0.08] to-[hsl(217,91%,53%)]/[0.02]">
              <div className="absolute inset-0 border border-blue-200/50 rounded-xl pointer-events-none" />
              <CardContent className="p-5 relative">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center">
                      <Sparkles className="h-3.5 w-3.5 text-white" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">AI Recommendations</h3>
                  </div>
                  <Link to="/ai-teacher-assistant" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    View All
                  </Link>
                </div>
                <div className="space-y-2.5">
                  {aiRecs.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2 bg-white/90 rounded-xl p-3 border border-blue-100/70 shadow-sm">
                      {recIconMap[rec.icon]}
                      <p className="text-xs text-foreground leading-relaxed">{rec.text}</p>
                    </div>
                  ))}
                </div>
                <Link to="/ai-teacher-assistant">
                  <Button size="sm" className="w-full mt-3.5 gap-1.5 bg-blue-600 hover:bg-blue-700">
                    <Sparkles className="h-3.5 w-3.5" />
                    View AI Suggestions
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Pending Evaluations */}
            <Card className="group border border-purple-400 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ">
              <CardContent className="p-5">
                <SectionHeader
                  title="Recent Submissions"
                  linkTo="/analytics"
                  linkLabel="Evaluate All"
                  icon={BookOpen}
                  iconClass="bg-purple-50 text-purple-600"
                />
                {evalLoading ? (
                  <div className="flex justify-center py-6"><LoadingSpinner /></div>
                ) : !pendingEvals?.list?.length ? (
                  <EmptyState text="All caught up on evaluations!" />
                ) : (
<div className="space-y-3">
  {pendingEvals.list.map((ev) => (
    <div
      key={ev.id}
      className="flex items-center justify-between rounded-xl bg-white border border-purple-100 shadow-sm px-4 py-3 hover:shadow-md hover:border-purple-300 transition-all duration-300"
    >
      {/* Left Side */}
      <div className="flex items-center gap-3">

        <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-700 shrink-0">
          {(ev.student_name || "?")[0]}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {ev.student_name || "Unknown"}
          </p>

          <p className="text-xs text-muted-foreground">
            Submitted{" "}
            {ev.submitted_at
              ? format(new Date(ev.submitted_at), "d MMM, h:mm a")
              : "—"}
          </p>
        </div>

      </div>

      {/* Right Side */}
      <Badge
        className="bg-purple-100 text-purple-700 border border-purple-200 px-3 py-1 rounded-full text-xs font-medium"
      >
        Pending
      </Badge>
    </div>
  ))}
</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column: Upcoming Events */}
          <div className="lg:col-span-1 space-y-5">

            <Card className="group border border-green-400 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ">
              <CardContent className="p-5">
                <SectionHeader
                  title="Upcoming Events"
                  linkTo="/academic-calendar"
                  linkLabel="View Calendar"
                  icon={CalendarDays}
                  iconClass="bg-emerald-50 text-emerald-600"
                />
                {eventsLoading ? (
                  <div className="flex justify-center py-6"><LoadingSpinner /></div>
                ) : !upcomingEvents?.length ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No upcoming events</p>
                ) : (
                  <div className="space-y-3">
                    {upcomingEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between rounded-xl bg-white border shadow-sm px-4 py-3 transition-all duration-300 hover:shadow-md hover:border-emerald-300">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center",
                              eventDotColor[ev.event_type]
                                ? `${eventDotColor[ev.event_type]}/10`
                                : "bg-gray-100"
                            )}
                          >
                            <div
                              className={cn(
                                "h-3 w-3 rounded-full",
                                eventDotColor[ev.event_type] || "bg-gray-400"
                              )}
                            />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {ev.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {ev.event_type}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-emerald-600">
                            {formatEventDate(ev.start_date)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default TeacherWorkspaceDashboard;
