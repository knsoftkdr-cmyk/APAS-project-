import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  HeartPulse, BookOpen, Users, Lightbulb, Minus,
} from "lucide-react";

// ---------- Types ----------
interface PredictionRow {
  id: string;
  student_id: string;
  subject: string;
  predicted_score_next_test: number;
  risk_level: "low" | "medium" | "high";
  dropout_risk_percentage: number;
  confidence_score: number;
  contributing_factors: string[];
}

interface StudentRow {
  id: string;
  full_name: string;
  class: string;
  section: string;
}

const RISK_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

export function PredictiveAnalyticsContent() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id;

  // ---------- Fetch predictions ----------
  const { data: predictions, isLoading: loadingPredictions } = useQuery({
    queryKey: ["predictive-analytics-predictions", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_predictions")
        .select("id, student_id, subject, predicted_score_next_test, risk_level, dropout_risk_percentage, confidence_score, contributing_factors")
        .eq("school_id", schoolId);
      if (error) throw error;
      return (data || []) as PredictionRow[];
    },
    enabled: !!schoolId,
  });

  // ---------- Fetch students referenced by predictions ----------
  const studentIds = useMemo(
    () => [...new Set((predictions || []).map((p) => p.student_id))],
    [predictions]
  );

  const { data: students, isLoading: loadingStudents } = useQuery({
    queryKey: ["predictive-analytics-students", studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class, section")
        .in("id", studentIds);
      if (error) throw error;
      return (data || []) as StudentRow[];
    },
    enabled: studentIds.length > 0,
  });

  const studentMap = useMemo(() => {
    const map = new Map<string, StudentRow>();
    (students || []).forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  // ---------- Homework completion data ----------
  const { data: homeworkData } = useQuery({
    queryKey: ["predictive-analytics-homework", schoolId],
    queryFn: async () => {
      const { data: assignments, error: aErr } = await supabase
        .from("homework_assignments")
        .select("id, assigned_student_count, created_at")
        .eq("school_id", schoolId);
      if (aErr) throw aErr;

      const assignmentIds = (assignments || []).map((a) => a.id);
      let submissions: { assignment_id: string; submitted_at: string }[] = [];
      if (assignmentIds.length > 0) {
        const { data: subs, error: sErr } = await supabase
          .from("homework_submissions")
          .select("assignment_id, submitted_at")
          .in("assignment_id", assignmentIds);
        if (sErr) throw sErr;
        submissions = subs || [];
      }
      return { assignments: assignments || [], submissions };
    },
    enabled: !!schoolId,
  });

  // ---------- Per-student aggregation ----------
  const studentAggregates = useMemo(() => {
    if (!predictions) return [];
    const byStudent = new Map<string, PredictionRow[]>();
    predictions.forEach((p) => {
      const list = byStudent.get(p.student_id) || [];
      list.push(p);
      byStudent.set(p.student_id, list);
    });

    return Array.from(byStudent.entries()).map(([studentId, rows]) => {
      const worstRisk = rows.reduce((worst, r) => {
        return RISK_RANK[r.risk_level] > RISK_RANK[worst] ? r.risk_level : worst;
      }, "low" as "low" | "medium" | "high");

      const maxDropout = Math.max(...rows.map((r) => Number(r.dropout_risk_percentage)));
      const avgPredictedScore =
        rows.reduce((sum, r) => sum + Number(r.predicted_score_next_test), 0) / rows.length;

      const student = studentMap.get(studentId);

      let performanceBucket: "excellent" | "improve" | "decline" | "high-risk";
      if (worstRisk === "high") performanceBucket = "high-risk";
      else if (worstRisk === "medium") performanceBucket = "decline";
      else performanceBucket = avgPredictedScore >= 75 ? "excellent" : "improve";

      let dropoutBucket: "low" | "medium" | "high";
      if (maxDropout >= 60) dropoutBucket = "high";
      else if (maxDropout >= 30) dropoutBucket = "medium";
      else dropoutBucket = "low";

      return {
        studentId,
        name: student?.full_name || "Unknown",
        classLabel: student ? `${student.class}${student.section ? " - " + student.section : ""}` : "",
        rows,
        worstRisk,
        maxDropout,
        avgPredictedScore,
        performanceBucket,
        dropoutBucket,
      };
    });
  }, [predictions, studentMap]);

  // ---------- Performance forecast counts ----------
  const performanceCounts = useMemo(() => {
    const counts = { excellent: 0, improve: 0, decline: 0, "high-risk": 0 };
    studentAggregates.forEach((s) => counts[s.performanceBucket]++);
    return counts;
  }, [studentAggregates]);

  // ---------- Dropout risk counts ----------
  const dropoutCounts = useMemo(() => {
    const counts = { low: 0, medium: 0, high: 0 };
    studentAggregates.forEach((s) => counts[s.dropoutBucket]++);
    return counts;
  }, [studentAggregates]);

  const highRiskStudents = useMemo(
    () => studentAggregates.filter((s) => s.dropoutBucket === "high"),
    [studentAggregates]
  );

  // ---------- Subject-wise forecast ----------
  const subjectForecast = useMemo(() => {
    if (!predictions) return [];
    const bySubject = new Map<string, PredictionRow[]>();
    predictions.forEach((p) => {
      const list = bySubject.get(p.subject) || [];
      list.push(p);
      bySubject.set(p.subject, list);
    });

    return Array.from(bySubject.entries()).map(([subject, rows]) => {
      const avgPredicted = rows.reduce((s, r) => s + Number(r.predicted_score_next_test), 0) / rows.length;
      const avgDropout = rows.reduce((s, r) => s + Number(r.dropout_risk_percentage), 0) / rows.length;

      let trend: "improving" | "stable" | "declining";
      if (avgDropout >= 50 || avgPredicted < 50) trend = "declining";
      else if (avgPredicted >= 70) trend = "improving";
      else trend = "stable";

      const highRiskCount = rows.filter((r) => r.risk_level === "high").length;

      return { subject, avgPredicted, avgDropout, trend, studentCount: rows.length, highRiskCount };
    }).sort((a, b) => a.avgPredicted - b.avgPredicted);
  }, [predictions]);

  // ---------- School Health Score ----------
  const schoolHealth = useMemo(() => {
    if (!predictions || predictions.length === 0) return null;
    const avgPredicted = predictions.reduce((s, r) => s + Number(r.predicted_score_next_test), 0) / predictions.length;
    const avgDropout = predictions.reduce((s, r) => s + Number(r.dropout_risk_percentage), 0) / predictions.length;
    const score = Math.round(0.5 * avgPredicted + 0.5 * (100 - avgDropout));

    let label: string;
    let color: string;
    if (score >= 85) { label = "Excellent"; color = "text-emerald-600"; }
    else if (score >= 70) { label = "Good"; color = "text-blue-600"; }
    else if (score >= 50) { label = "Needs Attention"; color = "text-amber-600"; }
    else { label = "Critical"; color = "text-red-600"; }

    return { score: Math.max(0, Math.min(100, score)), label, color, avgPredicted, avgDropout };
  }, [predictions]);

  // ---------- Homework completion forecast ----------
  const homeworkForecast = useMemo(() => {
    if (!homeworkData) return null;
    const { assignments, submissions } = homeworkData;
    if (assignments.length === 0) return null;

    const totalAssigned = assignments.reduce((s, a) => s + (a.assigned_student_count || 0), 0);
    const totalSubmitted = submissions.length;
    const currentCompletion = totalAssigned > 0 ? Math.round((totalSubmitted / totalAssigned) * 100) : 0;

    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const last7 = submissions.filter((s) => now - new Date(s.submitted_at).getTime() <= sevenDays).length;
    const prev7 = submissions.filter((s) => {
      const t = now - new Date(s.submitted_at).getTime();
      return t > sevenDays && t <= sevenDays * 2;
    }).length;

    let projected = currentCompletion;
    let trend: "up" | "down" | "flat" = "flat";
    if (prev7 > 0) {
      const ratio = last7 / prev7;
      projected = Math.round(currentCompletion * ratio);
      if (ratio > 1.05) trend = "up";
      else if (ratio < 0.95) trend = "down";
    }

    return { currentCompletion, projected: Math.max(0, Math.min(100, projected)), trend, last7, prev7 };
  }, [homeworkData]);

  // ---------- AI Recommendations ----------
  const recommendations = useMemo(() => {
    const recs: { text: string; action: string }[] = [];

    subjectForecast.forEach((s) => {
      if (s.trend === "declining" && s.highRiskCount > 0) {
        recs.push({
          text: `${s.subject}: ${s.highRiskCount} student${s.highRiskCount > 1 ? "s" : ""} at high risk, average predicted score ${Math.round(s.avgPredicted)}%.`,
          action: "Schedule remedial sessions and notify parents.",
        });
      }
    });

    if (highRiskStudents.length > 0) {
      recs.push({
        text: `${highRiskStudents.length} student${highRiskStudents.length > 1 ? "s" : ""} showing high dropout risk (≥60%) across one or more subjects.`,
        action: "Prioritize for intervention plans and parent meetings.",
      });
    }

    if (homeworkForecast && homeworkForecast.trend === "down") {
      recs.push({
        text: `Homework completion trending down — ${homeworkForecast.last7} submissions this week vs ${homeworkForecast.prev7} last week.`,
        action: "Consider shorter assignments or a parent reminder push.",
      });
    }

    if (schoolHealth && schoolHealth.score < 70) {
      recs.push({
        text: `School Health Score is ${schoolHealth.score}/100 (${schoolHealth.label}).`,
        action: "Review subject-wise forecasts below to identify the biggest driver.",
      });
    }

    return recs;
  }, [subjectForecast, highRiskStudents, homeworkForecast, schoolHealth]);

  const isLoading = loadingPredictions || loadingStudents;

if (isLoading) {
    return <div className="flex justify-center py-20"><LoadingSpinner /></div>;
  }

if (!predictions || predictions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Brain className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Predictions Yet</h3>
          <p className="text-muted-foreground max-w-md">
            Predictions will appear here once students have test scores and homework history recorded.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-8 shadow-xl mb-6">
        <div className="absolute top-6 right-10 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute bottom-5 right-40 h-14 w-14 rounded-full bg-white/10" />
        <div className="relative z-10 flex items-center gap-5">
          <div className="h-16 w-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Brain className="h-9 w-9 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Predictive Analytics</h1>
            <p className="mt-1 text-indigo-100">
              Forecast student, subject, and school performance using your assessment data.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Student Performance Forecast */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Student Performance Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox icon={<CheckCircle2 className="h-5 w-5" />} label="Excellent Progress" value={performanceCounts.excellent} color="emerald" />
              <StatBox icon={<TrendingUp className="h-5 w-5" />} label="Likely to Improve" value={performanceCounts.improve} color="blue" />
              <StatBox icon={<TrendingDown className="h-5 w-5" />} label="Likely to Decline" value={performanceCounts.decline} color="amber" />
              <StatBox icon={<AlertTriangle className="h-5 w-5" />} label="High Risk" value={performanceCounts["high-risk"]} color="red" />
            </div>
          </CardContent>
        </Card>

        {/* Dropout Risk */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" /> Dropout Risk Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <StatBox label="Low Risk" value={dropoutCounts.low} color="emerald" />
              <StatBox label="Medium Risk" value={dropoutCounts.medium} color="amber" />
              <StatBox label="High Risk" value={dropoutCounts.high} color="red" />
            </div>
            {highRiskStudents.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">High Risk Students</p>
                {highRiskStudents.map((s) => (
                  <div key={s.studentId} className="flex items-center justify-between text-sm p-2 rounded-lg bg-red-50">
                    <span>{s.name} {s.classLabel && <span className="text-muted-foreground">· {s.classLabel}</span>}</span>
                    <Badge variant="destructive">{Math.round(s.maxDropout)}% risk</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Homework Completion Forecast */}
        {homeworkForecast && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" /> Homework Completion Forecast
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-8">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Current</p>
                  <p className="text-3xl font-bold">{homeworkForecast.currentCompletion}%</p>
                </div>
                <div className="text-muted-foreground">→</div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Projected (next period)</p>
                  <p className="text-3xl font-bold flex items-center gap-2">
                    {homeworkForecast.projected}%
                    {homeworkForecast.trend === "up" && <TrendingUp className="h-5 w-5 text-emerald-600" />}
                    {homeworkForecast.trend === "down" && <TrendingDown className="h-5 w-5 text-red-600" />}
                    {homeworkForecast.trend === "flat" && <Minus className="h-5 w-5 text-muted-foreground" />}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Based on {homeworkForecast.last7} submission{homeworkForecast.last7 !== 1 ? "s" : ""} this week vs {homeworkForecast.prev7} last week.
              </p>
            </CardContent>
          </Card>
        )}

        {/* AI Recommendations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" /> AI Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No urgent recommendations right now.</p>
            ) : (
              recommendations.map((r, i) => (
                <div key={i} className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <p className="text-sm">{r.text}</p>
                  <p className="text-xs text-primary font-medium mt-1">→ {r.action}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ---------- Small components ----------
function StatBox({ icon, label, value, color }: { icon?: React.ReactNode; label: string; value: number; color: "emerald" | "blue" | "amber" | "red" }) {
  const colorMap = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <div className={`p-4 rounded-xl border ${colorMap[color]}`}>
      {icon && <div className="mb-1">{icon}</div>}
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium">{label}</p>
    </div>
  );
}

function TrendBadge({ trend }: { trend: "improving" | "stable" | "declining" }) {
  if (trend === "improving") return <Badge className="bg-emerald-100 text-emerald-700 gap-1"><TrendingUp className="h-3 w-3" /> Improving</Badge>;
  if (trend === "declining") return <Badge className="bg-red-100 text-red-700 gap-1"><TrendingDown className="h-3 w-3" /> Declining</Badge>;
  return <Badge variant="secondary" className="gap-1"><Minus className="h-3 w-3" /> Stable</Badge>;
}

export default function PredictiveAnalytics() {
  return (
    <AppLayout>
      <PredictiveAnalyticsContent />
    </AppLayout>
  );
}