/**
 * SchoolBenchmarking.tsx
 *
 * Internal benchmarking, not cross-school comparison, per product decision:
 * School vs Targets, Grade vs Grade, Subject vs Subject, Teacher vs School
 * Average, This Month vs Last Month.
 *
 * Intentionally excluded:
 * - Attendance (no attendance module exists yet in this codebase)
 * - Academic Year / Term filter (no academic_year column on the tables
 *   being benchmarked — only the Semester Engine has that concept, and
 *   it isn't linked to test/homework rows)
 *
 * Data sources (all real, nothing fabricated):
 * - Homework completion   → homework_assignments + homework_submissions
 * - Assessment average    → academic_tests
 * - Dropout risk          → student_predictions
 * - Intervention success  → student_interventions
 * - Teacher performance   → homework grading + intervention load per teacher
 */
import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import { BarChart3, TrendingUp, TrendingDown, Sparkles, Target, Settings2 } from "lucide-react";
import { format, subMonths, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";

const DEFAULT_TARGETS: Record<string, number> = {
  homework_completion: 90,
  assessment_average: 80,
  dropout_risk: 2, // lower is better
  intervention_success: 75,
};

const METRIC_LABELS: Record<string, string> = {
  homework_completion: "Homework Completion",
  assessment_average: "Assessment Average",
  dropout_risk: "Dropout Risk",
  intervention_success: "Intervention Success Rate",
};

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

export function SchoolBenchmarkingContent() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const schoolId = profile?.school_id;

  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [editingTargets, setEditingTargets] = useState(false);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});

  const { data: raw, isLoading } = useQuery({
    queryKey: ["school-benchmark-raw-v2", schoolId],
    queryFn: async () => {
      if (!schoolId) return null;

      const { data: students } = await supabase
        .from("students")
        .select("id, profile_id, class, section")
        .eq("school_id", schoolId);
      const studentIds = (students || []).map((s: any) => s.id);

      const { data: studentProfiles } = await supabase
        .from("profiles")
        .select("id")
        .eq("school_id", schoolId)
        .eq("role", "student");
      const profileIds = (studentProfiles || []).map((p: any) => p.id);

      const { data: teachers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("school_id", schoolId)
        .eq("role", "teacher");
      const teacherIds = (teachers || []).map((t: any) => t.id);

        const { data: assignments } = teacherIds.length
        ? await supabase.from("homework_assignments").select("id, assigned_by, class_level, section, created_at").in("assigned_by", teacherIds)
        : { data: [] as any[] };
      const assignmentIds = (assignments || []).map((a: any) => a.id);

      const { data: submissions } = assignmentIds.length
        ? await supabase.from("homework_submissions").select("assignment_id, teacher_score, submitted_at").in("assignment_id", assignmentIds)
        : { data: [] as any[] };

      const { data: tests } = profileIds.length
        ? await supabase.from("academic_tests").select("student_id, subject, score, total_questions, student_class, completed_at").in("student_id", profileIds)
        : { data: [] as any[] };

      const { data: predictions } = studentIds.length
        ? await supabase.from("student_predictions").select("student_id, risk_level, dropout_risk_percentage").in("student_id", studentIds)
        : { data: [] as any[] };

      const { data: interventions } = teacherIds.length
        ? await supabase.from("student_interventions").select("teacher_id, status").in("teacher_id", teacherIds)
        : { data: [] as any[] };

      const { data: targetRows } = await supabase
        .from("school_benchmark_targets" as any)
        .select("metric_key, target_value")
        .eq("school_id", schoolId);

      return {
        students: students || [],
        teachers: teachers || [],
        assignments: assignments || [],
        submissions: submissions || [],
        tests: tests || [],
        predictions: predictions || [],
        interventions: interventions || [],
        targets: (targetRows || []) as any[],
      };
    },
    enabled: !!schoolId,
  });

  const targets = useMemo(() => {
    const t = { ...DEFAULT_TARGETS };
    (raw?.targets || []).forEach((r: any) => { t[r.metric_key] = Number(r.target_value); });
    return t;
  }, [raw?.targets]);

  const grades = useMemo(() => [...new Set((raw?.students || []).map((s: any) => s.class).filter(Boolean))].sort(), [raw]);
  const subjects = useMemo(() => [...new Set((raw?.tests || []).map((t: any) => t.subject).filter(Boolean))].sort(), [raw]);

  const filteredTests = useMemo(() => {
    return (raw?.tests || []).filter((t: any) => {
      if (gradeFilter !== "all" && t.student_class !== gradeFilter) return false;
      if (subjectFilter !== "all" && t.subject !== subjectFilter) return false;
      if (monthFilter !== "all" && t.completed_at && format(new Date(t.completed_at), "yyyy-MM") !== monthFilter) return false;
      return true;
    });
  }, [raw, gradeFilter, subjectFilter, monthFilter]);

  const assessmentAverage = useMemo(() => {
    const totalScore = filteredTests.reduce((s: number, t: any) => s + (t.score || 0), 0);
    const totalMax = filteredTests.reduce((s: number, t: any) => s + (t.total_questions || 0), 0);
    return pct(totalScore, totalMax);
  }, [filteredTests]);

  const filteredAssignments = useMemo(() => {
    return (raw?.assignments || []).filter((a: any) => gradeFilter === "all" || a.class_level === gradeFilter);
  }, [raw, gradeFilter]);

  const homeworkCompletion = useMemo(() => {
    const assignmentIds = new Set(filteredAssignments.map((a: any) => a.id));
    let submitted = (raw?.submissions || []).filter((s: any) => assignmentIds.has(s.assignment_id) && s.submitted_at);
    if (monthFilter !== "all") {
      submitted = submitted.filter((s: any) => format(new Date(s.submitted_at), "yyyy-MM") === monthFilter);
    }
    return pct(submitted.length, filteredAssignments.length);
  }, [raw, filteredAssignments, monthFilter]);

  const classByStudentId = useMemo(() => new Map((raw?.students || []).map((s: any) => [s.id, s.class])), [raw]);
  const filteredPredictions = useMemo(() => {
    return (raw?.predictions || []).filter((p: any) => gradeFilter === "all" || classByStudentId.get(p.student_id) === gradeFilter);
  }, [raw, gradeFilter, classByStudentId]);
  const avgDropoutRisk = useMemo(() => {
    if (filteredPredictions.length === 0) return 0;
    const sum = filteredPredictions.reduce((s: number, p: any) => s + (p.dropout_risk_percentage || 0), 0);
    return Math.round(sum / filteredPredictions.length);
  }, [filteredPredictions]);

  const interventionSuccess = useMemo(() => {
    const list = teacherFilter === "all" ? (raw?.interventions || []) : (raw?.interventions || []).filter((i: any) => i.teacher_id === teacherFilter);
    const completed = list.filter((i: any) => i.status === "completed").length;
    return pct(completed, list.length);
  }, [raw, teacherFilter]);

  const gradeRows = useMemo(() => {
    return grades.map((g) => {
      const gTests = (raw?.tests || []).filter((t: any) => t.student_class === g);
      const score = pct(gTests.reduce((s: number, t: any) => s + t.score, 0), gTests.reduce((s: number, t: any) => s + t.total_questions, 0));
      const gAssignments = (raw?.assignments || []).filter((a: any) => a.class_level === g);
      const ids = new Set(gAssignments.map((a: any) => a.id));
      const submitted = (raw?.submissions || []).filter((s: any) => ids.has(s.assignment_id) && s.submitted_at);
      const hw = pct(submitted.length, gAssignments.length);
      return { grade: g, score, homework: hw };
    });
  }, [raw, grades]);

  const subjectRows = useMemo(() => {
    return subjects.map((sub) => {
      const sTests = (raw?.tests || []).filter((t: any) => t.subject === sub);
      const score = pct(sTests.reduce((s: number, t: any) => s + t.score, 0), sTests.reduce((s: number, t: any) => s + t.total_questions, 0));
      return { subject: sub, score };
    });
  }, [raw, subjects]);

  const teacherRows = useMemo(() => {
    return (raw?.teachers || [])
      .filter((t: any) => teacherFilter === "all" || t.id === teacherFilter)
      .map((t: any) => {
        const myAssignments = (raw?.assignments || []).filter((a: any) => a.assigned_by === t.id);
        const ids = new Set(myAssignments.map((a: any) => a.id));
        const reviewed = (raw?.submissions || []).filter((s: any) => ids.has(s.assignment_id) && s.teacher_score !== null);
        const avgScore = reviewed.length > 0 ? Math.round(reviewed.reduce((s: number, r: any) => s + (r.teacher_score || 0), 0) / reviewed.length) : null;
        const activeInterventions = (raw?.interventions || []).filter((i: any) => i.teacher_id === t.id && i.status === "active").length;
        return {
          name: t.full_name || "Unnamed",
          homeworkReviewed: reviewed.length,
          avgScore,
          activeInterventions,
        };
      });
  }, [raw, teacherFilter]);

const trend = useMemo(() => {
    const thisMonthKey = format(new Date(), "yyyy-MM");
    const lastMonthKey = format(subMonths(new Date(), 1), "yyyy-MM");

    const hwFor = (key: string) => {
      // Only assignments created in that month
      const monthAssignments = (raw?.assignments || []).filter(
        (a: any) => a.created_at && format(new Date(a.created_at), "yyyy-MM") === key
      );
      const monthAssignmentIds = new Set(monthAssignments.map((a: any) => a.id));

      // Submissions for those specific assignments (regardless of when submitted)
      const subs = (raw?.submissions || []).filter(
        (s: any) => monthAssignmentIds.has(s.assignment_id) && s.submitted_at
      );

      return pct(subs.length, monthAssignments.length);
    };

    const assessFor = (key: string) => {
      const t = (raw?.tests || []).filter((x: any) => x.completed_at && format(new Date(x.completed_at), "yyyy-MM") === key);
      return pct(t.reduce((s: number, x: any) => s + x.score, 0), t.reduce((s: number, x: any) => s + x.total_questions, 0));
    };

    return {
      homework: { last: hwFor(lastMonthKey), current: hwFor(thisMonthKey) },
      assessment: { last: assessFor(lastMonthKey), current: assessFor(thisMonthKey) },
    };
  }, [raw]);

  const last6MonthsChart = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
    return months.map((m) => {
      const key = format(m, "yyyy-MM");
      const t = (raw?.tests || []).filter((x: any) => x.completed_at && format(new Date(x.completed_at), "yyyy-MM") === key);
      const score = pct(t.reduce((s: number, x: any) => s + x.score, 0), t.reduce((s: number, x: any) => s + x.total_questions, 0));
      return { month: format(m, "MMM"), score };
    });
  }, [raw]);

  const scoreOf = (actual: number, target: number, lowerIsBetter = false) => {
    if (target === 0) return 100;
    const ratio = lowerIsBetter ? target / Math.max(actual, 0.1) : actual / target;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  };
  const scorecard = useMemo(() => {
    const academic = scoreOf(assessmentAverage, targets.assessment_average);
    const homework = scoreOf(homeworkCompletion, targets.homework_completion);
    const risk = scoreOf(avgDropoutRisk, targets.dropout_risk, true);
    const teacherPerf = scoreOf(interventionSuccess, targets.intervention_success);
    const overall = Math.round((academic + homework + risk + teacherPerf) / 4);
    return { academic, homework, risk, teacherPerf, overall };
  }, [assessmentAverage, homeworkCompletion, avgDropoutRisk, interventionSuccess, targets]);

  const insight = useMemo(() => {
    if (gradeRows.length === 0 && subjectRows.length === 0) return null;
    const schoolAvg = assessmentAverage;
    const worstGrade = [...gradeRows].sort((a, b) => a.score - b.score)[0];
    const worstSubject = [...subjectRows].sort((a, b) => a.score - b.score)[0];
    const candidates = [
      worstGrade && schoolAvg - worstGrade.score >= 5
        ? { label: `${worstGrade.grade}`, gap: schoolAvg - worstGrade.score, kind: "grade" }
        : null,
      worstSubject && schoolAvg - worstSubject.score >= 5
        ? { label: `${worstSubject.subject}`, gap: schoolAvg - worstSubject.score, kind: "subject" }
        : null,
    ].filter(Boolean) as { label: string; gap: number; kind: string }[];
    if (candidates.length === 0) return null;
    const worst = candidates.sort((a, b) => b.gap - a.gap)[0];
    return {
      text: `${worst.label} is ${worst.gap}% below the school average in assessments.`,
      recommendation: worst.kind === "grade"
        ? `Conduct remedial sessions for ${worst.label} and review the current teaching pace.`
        : `Review the teaching approach for ${worst.label} — consider peer observation or a refresher workshop.`,
    };
  }, [gradeRows, subjectRows, assessmentAverage]);

  const openEditTargets = () => {
    const drafts: Record<string, string> = {};
    Object.keys(METRIC_LABELS).forEach((k) => { drafts[k] = String(targets[k]); });
    setTargetDrafts(drafts);
    setEditingTargets(true);
  };

  const saveTargets = async () => {
    if (!schoolId) return;
    try {
      for (const key of Object.keys(METRIC_LABELS)) {
        const value = Number(targetDrafts[key]);
        if (Number.isNaN(value)) continue;
        await supabase.from("school_benchmark_targets" as any).upsert(
          { school_id: schoolId, metric_key: key, target_value: value },
          { onConflict: "school_id,metric_key" }
        );
      }
      toast({ title: "Targets updated" });
      setEditingTargets(false);
      qc.invalidateQueries({ queryKey: ["school-benchmark-raw", schoolId] });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><LoadingSpinner /></div>;
  }

  return (
      <div className="space-y-6 pb-10">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">School Benchmarking</h1>
              <p className="text-sm text-muted-foreground">Compare academic, operational, and teaching performance across the school</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Grades</SelectItem>
              {grades.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={teacherFilter} onValueChange={setTeacherFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Teacher" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teachers</SelectItem>
              {(raw?.teachers || []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {Array.from({ length: 6 }, (_, i) => subMonths(new Date(), i)).map((m) => (
                <SelectItem key={format(m, "yyyy-MM")} value={format(m, "yyyy-MM")}>{format(m, "MMM yyyy")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        

        {insight && (
          <Card className="border border-blue-200/60 bg-blue-50/40">
            <CardContent className="p-4 flex items-start gap-3">
              <Sparkles className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">{insight.text}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium">Recommendation: </span>{insight.recommendation}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BenchmarkCard label="Homework Completion" value={homeworkCompletion} target={targets.homework_completion} />
          <BenchmarkCard label="Assessment Average" value={assessmentAverage} target={targets.assessment_average} />
          <BenchmarkCard label="Dropout Risk" value={avgDropoutRisk} target={targets.dropout_risk} lowerIsBetter />
        </div>

        <Card className="border border-border/60">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3">School Target vs Actual</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="pb-2">Metric</th><th className="pb-2">Target</th><th className="pb-2">Actual</th><th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                <TargetRow label="Homework Completion" target={targets.homework_completion} actual={homeworkCompletion} />
                <TargetRow label="Assessment Average" target={targets.assessment_average} actual={assessmentAverage} />
                <TargetRow label="Dropout Risk" target={targets.dropout_risk} actual={avgDropoutRisk} lowerIsBetter />
                <TargetRow label="Intervention Success Rate" target={targets.intervention_success} actual={interventionSuccess} />
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TrendCard label="Homework Completion" last={trend.homework.last} current={trend.homework.current} />
          <TrendCard label="Assessment Average" last={trend.assessment.last} current={trend.assessment.current} />
        </div>

        <Card className="border border-border/60">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3">Grade-wise Benchmark</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="pb-2">Grade</th><th className="pb-2">Average Score</th><th className="pb-2">Homework Completion</th>
                </tr>
              </thead>
              <tbody>
                {gradeRows.map((g) => (
                  <tr key={g.grade} className="border-b last:border-0">
                    <td className="py-2 font-medium">{g.grade}</td>
                    <td className="py-2">{g.score}%</td>
                    <td className="py-2">{g.homework}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-1">Teacher Performance Benchmark</h3>
            <p className="text-xs text-muted-foreground mb-3">A comparison to spot where support may help — not a ranking.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="pb-2">Teacher</th><th className="pb-2">Homework Reviewed</th><th className="pb-2">Avg Homework Score</th><th className="pb-2">Active Interventions</th>
                </tr>
              </thead>
              <tbody>
                {teacherRows.map((t) => (
                  <tr key={t.name} className="border-b last:border-0">
                    <td className="py-2 font-medium">{t.name}</td>
                    <td className="py-2">{t.homeworkReviewed}</td>
                    <td className="py-2">{t.avgScore ?? "—"}</td>
                    <td className="py-2">{t.activeInterventions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
  );
}

function ScoreItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold">{value}<span className="text-sm font-normal text-blue-200">/100</span></p>
      <p className="text-xs text-blue-200">{label}</p>
    </div>
  );
}

function BenchmarkCard({ label, value, target, lowerIsBetter }: { label: string; value: number; target: number; lowerIsBetter?: boolean }) {
  const onTarget = lowerIsBetter ? value <= target : value >= target;
  return (
    <Card className="border border-border/60">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={cn("text-2xl font-bold", onTarget ? "text-emerald-600" : "text-amber-600")}>{value}%</p>
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <Target className="h-3 w-3" /> Target: {lowerIsBetter ? "<" : ""}{target}%
        </p>
      </CardContent>
    </Card>
  );
}

function TargetRow({ label, target, actual, lowerIsBetter }: { label: string; target: number; actual: number; lowerIsBetter?: boolean }) {
  const onTarget = lowerIsBetter ? actual <= target : actual >= target;
  return (
    <tr className="border-b last:border-0">
      <td className="py-2">{label}</td>
      <td className="py-2">{lowerIsBetter ? "<" : ""}{target}%</td>
      <td className="py-2">{actual}%</td>
      <td className="py-2">
        <Badge className={onTarget ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
          {onTarget ? "✅ On Target" : "⚠️ Below Target"}
        </Badge>
      </td>
    </tr>
  );
}

function TrendCard({ label, last, current }: { label: string; last: number; current: number }) {
  const delta = current - last;
  const up = delta >= 0;
  return (
    <Card className="border border-border/60">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-2">{label}</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Last Month</p>
            <p className="text-lg font-semibold">{last}%</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">This Month</p>
            <p className="text-lg font-semibold">{current}%</p>
          </div>
        </div>
        <div className={cn("flex items-center gap-1 mt-2 text-xs font-medium", up ? "text-emerald-600" : "text-red-600")}>
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {up ? "+" : ""}{delta}%
        </div>
      </CardContent>
    </Card>
  );
}

export default function SchoolBenchmarking() {
  return (
    <AppLayout>
      <SchoolBenchmarkingContent />
    </AppLayout>
  );
}