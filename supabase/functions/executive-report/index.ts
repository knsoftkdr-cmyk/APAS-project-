import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ error: "school_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Students & teachers ──────────────────────────────────────────────────
    const { data: students } = await supabase
      .from("students").select("id, profile_id, class, section").eq("school_id", school_id);
    const { count: teacherCount } = await supabase
      .from("profiles").select("*", { count: "exact", head: true }).eq("role", "teacher").eq("school_id", school_id);

    const studentIds = (students || []).map((s) => s.id);
    const profileIds = (students || []).map((s) => s.profile_id).filter(Boolean);

    // ── At-risk breakdown ─────────────────────────────────────────────────────
    const { data: preds } = studentIds.length
      ? await supabase.from("student_predictions").select("student_id, risk_level, dropout_risk_percentage").in("student_id", studentIds)
      : { data: [] as any[] };
    const highRisk = (preds || []).filter((p: any) => p.risk_level === "high").length;
    const medRisk = (preds || []).filter((p: any) => p.risk_level === "medium").length;
    const lowRisk = (preds || []).filter((p: any) => p.risk_level === "low").length;

    // ── Academic performance (real, from academic_tests.student_class) ──────
    const { data: tests } = profileIds.length
      ? await supabase.from("academic_tests").select("student_class, score, total_questions").in("student_id", profileIds)
      : { data: [] as any[] };
    const byGrade: Record<string, number[]> = {};
    (tests || []).forEach((t: any) => {
      const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : null;
      if (pct === null) return;
      (byGrade[t.student_class] ||= []).push(pct);
    });
    const gradeAverages = Object.entries(byGrade).map(([grade, scores]) => ({
      grade, avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), test_count: scores.length,
    })).sort((a, b) => b.avg_score - a.avg_score);
    const overallAvgScore = (tests || []).length
      ? Math.round((tests as any[]).reduce((sum, t) => sum + (t.total_questions > 0 ? (t.score / t.total_questions) * 100 : 0), 0) / (tests as any[]).length)
      : null;

    // ── Homework summary ──────────────────────────────────────────────────────
    const { data: assignments } = await supabase
      .from("homework_assignments").select("id, class_level, section").eq("school_id", school_id);
    const assignmentIds = (assignments || []).map((a: any) => a.id);
    const { count: submittedCount } = assignmentIds.length
      ? await supabase.from("homework_submissions").select("id", { count: "exact", head: true }).in("assignment_id", assignmentIds).not("submitted_at", "is", null)
      : { count: 0 };
    const { count: pendingEvalCount } = assignmentIds.length
      ? await supabase.from("homework_submissions").select("id", { count: "exact", head: true }).in("assignment_id", assignmentIds).is("teacher_score", null).not("submitted_at", "is", null)
      : { count: 0 };
    const expectedSubmissions = (assignments || []).length * Math.max((students || []).length, 1);
    const homeworkCompletionPct = expectedSubmissions > 0 ? Math.round(((submittedCount || 0) / expectedSubmissions) * 100) : null;

    // ── Assessment summary (from academic_tests — auto-evaluated, no pending concept) ──
    const passCount = (tests || []).filter((t: any) => t.total_questions > 0 && (t.score / t.total_questions) >= 0.4).length;
    const passRate = (tests || []).length ? Math.round((passCount / (tests || []).length) * 100) : null;

    // ── Behaviour summary (from teacher_notes, school-wide) ──────────────────
    const { data: teacherProfiles } = await supabase.from("profiles").select("id").eq("role", "teacher").eq("school_id", school_id);
    const teacherIds = (teacherProfiles || []).map((t: any) => t.id);
    const { data: notes } = teacherIds.length
      ? await supabase.from("teacher_notes").select("note_type, follow_up_completed").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const positiveCount = (notes || []).filter((n: any) => n.note_type === "positive").length;
    const concernCount = (notes || []).filter((n: any) => n.note_type === "concern").length;
    const incidentCount = (notes || []).filter((n: any) => n.note_type === "incident").length;
    const resolvedCount = (notes || []).filter((n: any) => n.follow_up_completed).length;

    // ── Intervention summary ──────────────────────────────────────────────────
    const { data: interventions } = teacherIds.length
      ? await supabase.from("student_interventions").select("status").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const ivCreated = (interventions || []).length;
    const ivCompleted = (interventions || []).filter((i: any) => i.status === "completed").length;
    const ivActive = (interventions || []).filter((i: any) => i.status === "active").length;
    const ivSuccessRate = ivCreated > 0 ? Math.round((ivCompleted / ivCreated) * 100) : null;

    // ── Teacher workload summary (class_teachers count as proxy — no timetable exists) ──
    const { data: classTeacherRows } = teacherIds.length
      ? await supabase.from("class_teachers").select("teacher_id").in("teacher_id", teacherIds)
      : { data: [] as any[] };
    const classCountByTeacher = new Map<string, number>();
    (classTeacherRows || []).forEach((c: any) => classCountByTeacher.set(c.teacher_id, (classCountByTeacher.get(c.teacher_id) || 0) + 1));

    const { data: teacherNames } = teacherIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", teacherIds)
      : { data: [] as any[] };

    const teacherSummary = (teacherNames || []).map((t: any) => {
      const classAssignments = classCountByTeacher.get(t.id) || 0;
      const workload: "Low" | "Medium" | "High" = classAssignments >= 6 ? "High" : classAssignments >= 3 ? "Medium" : "Low";
      return { teacher_name: t.full_name, class_assignments: classAssignments, workload };
    }).sort((a, b) => b.class_assignments - a.class_assignments);

    const highWorkloadTeachers = teacherSummary.filter((t) => t.workload === "High");

    // ── Grade-wise report ──────────────────────────────────────────────────────
    const gradeWise = gradeAverages.map((g) => {
      const gradeStudentIds = (students || []).filter((s: any) => s.class === g.grade).map((s: any) => s.id);
      const gradeRisk = (preds || []).filter((p: any) => gradeStudentIds.includes(p.student_id));
      const gHigh = gradeRisk.filter((p: any) => p.risk_level === "high").length;
      const riskLabel = gHigh > 0 ? "High" : gradeRisk.some((p: any) => p.risk_level === "medium") ? "Medium" : "Low";
      return { grade: g.grade, avg_score: g.avg_score, risk: riskLabel };
    });

    // ── School Health Score (weighted across AVAILABLE signals only — no attendance data exists) ──
    const components: { label: string; value: number; weight: number }[] = [];
    if (overallAvgScore !== null) components.push({ label: "Academic Performance", value: overallAvgScore, weight: 0.35 });
    if (homeworkCompletionPct !== null) components.push({ label: "Homework Completion", value: homeworkCompletionPct, weight: 0.25 });
    if (studentIds.length > 0) {
      const riskHealthPct = Math.round(((studentIds.length - highRisk - medRisk * 0.5) / studentIds.length) * 100);
      components.push({ label: "At-Risk Ratio", value: Math.max(0, riskHealthPct), weight: 0.25 });
    }
    if (ivSuccessRate !== null) components.push({ label: "Intervention Success", value: ivSuccessRate, weight: 0.15 });
    const totalWeight = components.reduce((s, c) => s + c.weight, 0);
    const healthScore = totalWeight > 0
      ? Math.round(components.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight)
      : null;

    // ── Rule-based Action Items (no AI needed for these — deterministic thresholds) ──
    const actionItems: { priority: "red" | "orange" | "yellow" | "green"; text: string }[] = [];
    if (gradeWise.length > 0) {
      const worst = [...gradeWise].sort((a, b) => a.avg_score - b.avg_score)[0];
      if (worst.avg_score < 60) actionItems.push({ priority: "red", text: `${worst.grade} average score (${worst.avg_score}%) is below target.` });
    }
    if (highRisk > 0) actionItems.push({ priority: "orange", text: `${highRisk} student${highRisk === 1 ? "" : "s"} are at high risk.` });
    if (highWorkloadTeachers.length > 0) actionItems.push({ priority: "yellow", text: `${highWorkloadTeachers.length} teacher${highWorkloadTeachers.length === 1 ? "" : "s"} have a high class-assignment load: ${highWorkloadTeachers.map(t => t.teacher_name).join(", ")}.` });
    if (homeworkCompletionPct !== null && homeworkCompletionPct >= 90) actionItems.push({ priority: "green", text: `Homework completion is strong at ${homeworkCompletionPct}%.` });

    // ── One AI call for narrative insights (optional — degrades gracefully) ──
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || Deno.env.get("GROK_API_KEY");
    let aiInsights: string[] = [];
    if (GROQ_KEY) {
      try {
        const aiResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: `You are helping a school principal understand their school's current status. Given structured data, return ONLY a JSON array of 2-4 short, one-sentence insight strings (no markdown, no preamble). Base every insight strictly on the numbers given — never invent a comparison to a prior period unless the data explicitly includes one.`,
              },
              { role: "user", content: JSON.stringify({ overallAvgScore, homeworkCompletionPct, highRisk, medRisk, lowRisk, gradeWise, ivSuccessRate, highWorkloadTeachers: highWorkloadTeachers.map(t => t.teacher_name) }) },
            ],
          }),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          let content = aiData.choices?.[0]?.message?.content || "[]";
          content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          aiInsights = JSON.parse(content);
        }
      } catch (e) {
        console.error("AI insights failed:", e);
      }
    }

    return new Response(JSON.stringify({
      summary: {
        total_students: (students || []).length,
        total_teachers: teacherCount || 0,
        average_performance: overallAvgScore,
        at_risk_count: highRisk + medRisk,
        homework_completion_pct: homeworkCompletionPct,
        student_attendance: null, // no attendance module exists yet
        teacher_attendance: null,
      },
      academic: { average_score: overallAvgScore, grade_averages: gradeAverages },
      at_risk: { high: highRisk, medium: medRisk, low: lowRisk },
      teacher_performance: {
        teacher_count: teacherCount || 0,
        homework_pending_evaluation: pendingEvalCount || 0,
        teacher_summary: teacherSummary,
      },
      behaviour: { positive: positiveCount, concern: concernCount, incident: incidentCount, resolved: resolvedCount },
      interventions: { created: ivCreated, completed: ivCompleted, active: ivActive, success_rate: ivSuccessRate },
      homework: { assigned: (assignments || []).length, submitted: submittedCount || 0, completion_rate: homeworkCompletionPct },
      assessment: { conducted: (tests || []).length, average_score: overallAvgScore, pass_rate: passRate },
      grade_wise: gradeWise,
      health_score: healthScore,
      health_components: components,
      action_items: actionItems,
      ai_insights: aiInsights,
      unavailable: ["Student attendance", "Teacher attendance", "Most Improved Grade (no historical baseline)", "Classes/day (no timetable data — showing class assignment count instead)"],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("executive-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
