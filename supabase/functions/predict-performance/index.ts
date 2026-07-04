import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
 
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
 
interface SubjectMetrics {
  subject: string;
  avgScorePct: number;
  latestPct: number;
  trend: number; // latest - oldest
  testCount: number;
}
 
interface StudentPredictionResult {
  student_id: string; // students.id (not profiles.id)
  subject: string;
  predicted_score_next_test: number;
  risk_level: "low" | "medium" | "high";
  dropout_risk_percentage: number;
  confidence_score: number; // 0-1
  contributing_factors: string[];
}
 
// ---- Core calculation for one student (identified by their profile_id / auth uid) ----
async function computeForStudent(
  supabase: any,
  profileId: string,
  studentsRowId: string,
  schoolId: string | null
): Promise<StudentPredictionResult[]> {
  // Academic test scores (academic_tests.student_id references auth.users/profiles, not students.id)
  const { data: tests } = await supabase
    .from("academic_tests")
    .select("subject, score, total_questions, completed_at")
    .eq("student_id", profileId)
    .order("completed_at", { ascending: false })
    .limit(50);
 
  // Homework engagement (homework_submissions.student_id also references profiles, not students.id)
  const { data: submissions } = await supabase
    .from("homework_submissions")
    .select("completed, submission_percentage, teacher_score, submitted_at")
    .eq("student_id", profileId)
    .order("submitted_at", { ascending: false })
    .limit(30);
 
  const hwCount = submissions?.length ?? 0;
  const hwCompletedCount = (submissions || []).filter((s: any) => s.completed).length;
  const hwCompletionPct = hwCount > 0 ? (hwCompletedCount / hwCount) * 100 : null;
 
  // Group tests by subject
  const bySubject: Record<string, SubjectMetrics> = {};
  (tests || []).forEach((t: any) => {
    const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0;
    if (!bySubject[t.subject]) {
      bySubject[t.subject] = { subject: t.subject, avgScorePct: 0, latestPct: pct, trend: 0, testCount: 0 };
    }
    const s = bySubject[t.subject];
    s.testCount += 1;
    s.avgScorePct += pct;
    // tests are ordered desc by completed_at; first seen per subject = latest
  });
  Object.values(bySubject).forEach((s) => {
    s.avgScorePct = s.avgScorePct / s.testCount;
  });
 
  // Compute trend (latest vs oldest) per subject
  const subjectTestLists: Record<string, number[]> = {};
  (tests || []).forEach((t: any) => {
    const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0;
    if (!subjectTestLists[t.subject]) subjectTestLists[t.subject] = [];
    subjectTestLists[t.subject].push(pct); // desc order (latest first)
  });
  Object.entries(subjectTestLists).forEach(([subject, scores]) => {
    if (scores.length >= 2) {
      bySubject[subject].trend = scores[0] - scores[scores.length - 1];
      bySubject[subject].latestPct = scores[0];
    }
  });
 
  const subjects = Object.keys(bySubject);
 
  // No data at all for this student -> skip, don't fabricate a prediction
  if (subjects.length === 0 && hwCount === 0) {
    return [];
  }
 
  // If no subject-level test data, still produce one "General" row driven by homework alone
  const subjectKeys = subjects.length > 0 ? subjects : ["General"];
 
  const results: StudentPredictionResult[] = [];
 
  for (const subject of subjectKeys) {
    const s = bySubject[subject];
    const factors: string[] = [];
 
    let testComponent: number | null = null;
    if (s) {
      testComponent = Math.min(100, Math.max(0, s.avgScorePct + s.trend * 0.3));
      if (s.trend < -5) factors.push(`${subject} test scores declining (${Math.round(s.trend)}% over recent tests)`);
      else if (s.trend > 5) factors.push(`${subject} test scores improving (+${Math.round(s.trend)}% over recent tests)`);
      if (s.testCount < 3) factors.push(`Only ${s.testCount} test${s.testCount === 1 ? "" : "s"} recorded — limited data`);
    } else {
      factors.push("No test data recorded yet for this subject");
    }
 
    if (hwCompletionPct !== null) {
      if (hwCompletionPct < 50) factors.push(`Homework completion is low (${Math.round(hwCompletionPct)}%)`);
      else if (hwCompletionPct >= 90) factors.push(`Strong homework completion (${Math.round(hwCompletionPct)}%)`);
    } else {
      factors.push("No homework submission history yet");
    }
 
    // Weighted blend: prefer test data, fall back to homework-only when no tests exist
    let overallHealth: number;
    if (testComponent !== null && hwCompletionPct !== null) {
      overallHealth = testComponent * 0.65 + hwCompletionPct * 0.35;
    } else if (testComponent !== null) {
      overallHealth = testComponent;
    } else {
      overallHealth = hwCompletionPct ?? 50;
    }
 
    const riskLevel: "low" | "medium" | "high" =
      overallHealth >= 70 ? "low" : overallHealth >= 50 ? "medium" : "high";
 
    const dataPoints = (s?.testCount ?? 0) + hwCount;
    const confidence = Math.min(1, Math.max(0.2, dataPoints / 15)); // more data -> higher confidence, capped at 1
 
    results.push({
      student_id: studentsRowId,
      subject,
      predicted_score_next_test: Math.round(testComponent ?? overallHealth),
      risk_level: riskLevel,
      dropout_risk_percentage: Math.round(100 - overallHealth),
      confidence_score: Math.round(confidence * 100) / 100,
      contributing_factors: factors,
    });
  }
 
  return results;
}
 
async function saveResults(supabase: any, results: StudentPredictionResult[], schoolId: string | null) {
  for (const r of results) {
    const { data: existing } = await supabase
      .from("student_predictions")
      .select("id")
      .eq("student_id", r.student_id)
      .eq("subject", r.subject)
      .maybeSingle();
 
    const row = {
      student_id: r.student_id,
      subject: r.subject,
      predicted_score_next_test: r.predicted_score_next_test,
      risk_level: r.risk_level,
      dropout_risk_percentage: r.dropout_risk_percentage,
      confidence_score: r.confidence_score,
      contributing_factors: r.contributing_factors,
      school_id: schoolId,
      updated_at: new Date().toISOString(),
    };
 
    if (existing?.id) {
      await supabase.from("student_predictions").update(row).eq("id", existing.id);
    } else {
      await supabase.from("student_predictions").insert(row);
    }
  }
}
 
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
 
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
 
    let body: any = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const { student_id, school_id } = body; // student_id here = profiles.id (auth uid), matching how callers already use it elsewhere
 
    // ---- Single-student mode ----
    if (student_id) {
      const { data: studentRow } = await supabase
        .from("students")
        .select("id, school_id")
        .eq("profile_id", student_id)
        .maybeSingle();
 
      if (!studentRow) {
        return new Response(
          JSON.stringify({ error: "No students row found for this profile_id" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
 
      const results = await computeForStudent(supabase, student_id, studentRow.id, studentRow.school_id);
      await saveResults(supabase, results, studentRow.school_id);
 
      return new Response(
        JSON.stringify({ student_id, predictions: results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
 
    // ---- Bulk mode: run for every student (optionally scoped to one school) ----
    let query = supabase.from("students").select("id, profile_id, school_id");
    if (school_id) query = query.eq("school_id", school_id);
    const { data: allStudents, error: studentsError } = await query;
    if (studentsError) throw studentsError;
 
    let totalAnalyzed = 0;
    let highRisk = 0, mediumRisk = 0, lowRisk = 0;
 
    for (const student of allStudents || []) {
      if (!student.profile_id) continue;
      const results = await computeForStudent(supabase, student.profile_id, student.id, student.school_id);
      if (results.length === 0) continue;
 
      await saveResults(supabase, results, student.school_id);
      totalAnalyzed++;
 
      // Count the student once using their highest-risk subject
      const worst = results.reduce((acc, r) => {
        const rank = { high: 3, medium: 2, low: 1 } as const;
        return rank[r.risk_level] > rank[acc.risk_level] ? r : acc;
      });
      if (worst.risk_level === "high") highRisk++;
      else if (worst.risk_level === "medium") mediumRisk++;
      else lowRisk++;
    }
 
    return new Response(
      JSON.stringify({
        summary: {
          total_analyzed: totalAnalyzed,
          high_risk: highRisk,
          medium_risk: mediumRisk,
          low_risk: lowRisk,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("predict-performance error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});