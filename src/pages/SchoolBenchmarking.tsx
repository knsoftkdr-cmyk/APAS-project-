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
import { BarChart3, TrendingUp, TrendingDown, Sparkles, Target, Settings2, Users } from "lucide-react";
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

// Averages test scores per student first, then averages those student
// averages together — so a student who took many tests doesn't outweigh
// a student who took only one or two.
function perStudentAverage(tests: { student_id: string; score: number; total_questions: number }[]): number {
  const byStudent: Record<string, number[]> = {};
  tests.forEach((t) => {
    if (t.total_questions > 0) {
      const p = (t.score / t.total_questions) * 100;
      (byStudent[t.student_id] ||= []).push(p);
    }
  });
  const studentAverages = Object.values(byStudent).map((scores) => scores.reduce((a, b) => a + b, 0) / scores.length);
  if (studentAverages.length === 0) return 0;
  return Math.round(studentAverages.reduce((a, b) => a + b, 0) / studentAverages.length);
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
        ? await supabase.from("homework_assignments").select("id, assigned_by, class_level, section, created_at, assigned_student_count").in("assigned_by", teacherIds)
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

const assessmentAverage = useMemo(() => perStudentAverage(filteredTests), [filteredTests]);

  const filteredAssignments = useMemo(() => {
    return (raw?.assignments || []).filter((a: any) => gradeFilter === "all" || a.class_level === gradeFilter);
  }, [raw, gradeFilter]);

const homeworkCompletion = useMemo(() => {
    const assignmentIds = new Set(filteredAssignments.map((a: any) => a.id));
    let submitted = (raw?.submissions || []).filter((s: any) => assignmentIds.has(s.assignment_id) && s.submitted_at);
    if (monthFilter !== "all") {
      submitted = submitted.filter((s: any) => format(new Date(s.submitted_at), "yyyy-MM") === monthFilter);
    }
    // Expected submissions = sum of how many students each assignment actually
    // targeted, not the number of assignments — an assignment sent to 30
    // students should count as 30 expected submissions, not 1.
    const expectedSubmissions = filteredAssignments.reduce(
      (sum: number, a: any) => sum + (a.assigned_student_count || 0), 0
    );
    return pct(submitted.length, expectedSubmissions);
  }, [raw, filteredAssignments, monthFilter]);

  const classByStudentId = useMemo(() => new Map((raw?.students || []).map((s: any) => [s.id, s.class])), [raw]);
  const filteredPredictions = useMemo(() => {
    return (raw?.predictions || []).filter((p: any) => gradeFilter === "all" || classByStudentId.get(p.student_id) === gradeFilter);
  }, [raw, gradeFilter, classByStudentId]);
const avgDropoutRisk = useMemo(() => {
    if (filteredPredictions.length === 0) return 0;
    // Average per-student first (a student with predictions for 3 subjects
    // shouldn't count 3x as much as a student with only 1), then average
    // those student-level averages together.
    const byStudent: Record<string, number[]> = {};
    filteredPredictions.forEach((p: any) => {
      (byStudent[p.student_id] ||= []).push(Number(p.dropout_risk_percentage) || 0);
    });
    const studentAverages = Object.values(byStudent).map((scores) => scores.reduce((a, b) => a + b, 0) / scores.length);
    return Math.round(studentAverages.reduce((a, b) => a + b, 0) / studentAverages.length);
  }, [filteredPredictions]);

  const interventionSuccess = useMemo(() => {
    const list = teacherFilter === "all" ? (raw?.interventions || []) : (raw?.interventions || []).filter((i: any) => i.teacher_id === teacherFilter);
    const completed = list.filter((i: any) => i.status === "completed").length;
    return pct(completed, list.length);
  }, [raw, teacherFilter]);

const gradeRows = useMemo(() => {
    return grades.map((g) => {
      const gTests = (raw?.tests || []).filter((t: any) => t.student_class === g);
      const score = perStudentAverage(gTests);
      const gAssignments = (raw?.assignments || []).filter((a: any) => a.class_level === g);
      const ids = new Set(gAssignments.map((a: any) => a.id));
      const submitted = (raw?.submissions || []).filter((s: any) => ids.has(s.assignment_id) && s.submitted_at);
      const expected = gAssignments.reduce((sum: number, a: any) => sum + (a.assigned_student_count || 0), 0);
      const hw = pct(submitted.length, expected);
      return { grade: g, score, homework: hw };
    });
  }, [raw, grades]);

const subjectRows = useMemo(() => {
    return subjects.map((sub) => {
      const sTests = (raw?.tests || []).filter((t: any) => t.subject === sub);
      const score = perStudentAverage(sTests);
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
      return perStudentAverage(t);
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
      const score = perStudentAverage(t);
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
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-200">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BenchmarkCard label="Homework Completion" value={homeworkCompletion} target={targets.homework_completion} />
          <BenchmarkCard label="Assessment Average" value={assessmentAverage} target={targets.assessment_average} />
          <BenchmarkCard label="Dropout Risk" value={avgDropoutRisk} target={targets.dropout_risk} lowerIsBetter />
        </div>

        <Card className="relative overflow-hidden border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-emerald-400/10 blur-3xl" />
          <CardContent className="p-5 relative">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-200"><Target className="h-3.5 w-3.5" /></div>School Target vs Actual</h3>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="pb-2 pr-3">Metric</th><th className="pb-2 pr-3">Target</th><th className="pb-2 pr-3">Actual</th><th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <TargetRow label="Homework Completion" target={targets.homework_completion} actual={homeworkCompletion} />
                  <TargetRow label="Assessment Average" target={targets.assessment_average} actual={assessmentAverage} />
                  <TargetRow label="Dropout Risk" target={targets.dropout_risk} actual={avgDropoutRisk} lowerIsBetter />
                  <TargetRow label="Intervention Success Rate" target={targets.intervention_success} actual={interventionSuccess} />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TrendCard label="Homework Completion" last={trend.homework.last} current={trend.homework.current} />
          <TrendCard label="Assessment Average" last={trend.assessment.last} current={trend.assessment.current} />
        </div>

        <Card className="relative overflow-hidden border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-emerald-400/10 blur-3xl" />
          <CardContent className="p-5 relative">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-200"><BarChart3 className="h-3.5 w-3.5" /></div>Grade-wise Benchmark</h3>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="pb-2 pr-3 whitespace-nowrap">Grade</th><th className="pb-2 pr-3 whitespace-nowrap">Average Score</th><th className="pb-2 whitespace-nowrap">Homework Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {gradeRows.map((g) => (
                    <tr key={g.grade} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{g.grade}</td>
                      <td className="py-2 pr-3">{g.score}%</td>
                      <td className="py-2">{g.homework}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white shadow-sm hover:shadow-lg transition-all duration-300">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-emerald-400/10 blur-3xl" />
          <CardContent className="p-5 relative">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2"><div className="rounded-lg p-1.5 bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-200"><Users className="h-3.5 w-3.5" /></div>Teacher Performance Benchmark</h3>
            <p className="text-xs text-muted-foreground mb-3">A comparison to spot where support may help — not a ranking.</p>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="pb-2 pr-3 whitespace-nowrap">Teacher</th><th className="pb-2 pr-3 whitespace-nowrap">Homework Reviewed</th><th className="pb-2 pr-3 whitespace-nowrap">Avg Homework Score</th><th className="pb-2 whitespace-nowrap">Active Interventions</th>
                  </tr>
                </thead>
                <tbody>
                  {teacherRows.map((t) => (
                    <tr key={t.name} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{t.name}</td>
                      <td className="py-2 pr-3">{t.homeworkReviewed}</td>
                      <td className="py-2 pr-3">{t.avgScore ?? "—"}</td>
                      <td className="py-2">{t.activeInterventions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
    <Card className="group relative overflow-hidden border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-emerald-400/10 blur-3xl transition-transform duration-500 group-hover:scale-125" />
      <CardContent className="p-4 relative">
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
    <Card className="group relative overflow-hidden border-2 border-emerald-200 hover:border-emerald-300 rounded-2xl bg-gradient-to-br from-emerald-50/60 via-white to-white shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-emerald-400/10 blur-3xl transition-transform duration-500 group-hover:scale-125" />
      <CardContent className="p-4 relative">
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