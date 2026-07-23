import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PlanContent {
  summary: string;
  strengths: string[];
  focus_areas: string[];
  goals: { title: string; description: string; timeframe: string }[];
  action_items: { item: string; category: "academic" | "attendance" | "behavioural" }[];
}

function buildPlan(d: {
  student_name: string;
  academic_predictions: any[];
  gpa: any;
  attendance: any;
  competency_gaps: any[];
  competency_strengths: any[];
}): PlanContent {
  const strengths: string[] = [];
  const focus_areas: string[] = [];
  const goals: PlanContent["goals"] = [];
  const action_items: PlanContent["action_items"] = [];

  // ---- Academic ----
  const riskySubjects = d.academic_predictions.filter((p: any) => p.risk_level === "high" || p.risk_level === "medium");
  const strongSubjects = d.academic_predictions.filter((p: any) => p.risk_level === "low");

  strongSubjects.forEach((s: any) => {
    strengths.push(`Performing well in ${s.subject} (predicted next score: ${Math.round(s.predicted_score_next_test)}%)`);
  });

  riskySubjects.forEach((s: any) => {
    focus_areas.push(`${s.subject} needs attention (predicted next score: ${Math.round(s.predicted_score_next_test)}%, risk: ${s.risk_level})`);
    goals.push({
      title: `Improve ${s.subject} performance`,
      description: `Target a stronger score in the next ${s.subject} assessment through focused revision on recent weak areas.`,
      timeframe: "Next 3-4 weeks",
    });
    action_items.push({
      item: `Schedule 2-3 extra practice sessions per week in ${s.subject}`,
      category: "academic",
    });
    if (Array.isArray(s.contributing_factors)) {
      s.contributing_factors.forEach((f: string) => {
        if (f.toLowerCase().includes("declining")) {
          action_items.push({ item: `Review recent ${s.subject} test mistakes with the teacher to identify the pattern`, category: "academic" });
        }
        if (f.toLowerCase().includes("homework")) {
          action_items.push({ item: `Improve homework completion consistency in ${s.subject}`, category: "academic" });
        }
      });
    }
  });

  // ---- GPA ----
  if (d.gpa) {
    if (d.gpa.result_status && d.gpa.result_status.toLowerCase().includes("fail")) {
      focus_areas.push("Overall semester result needs improvement");
      goals.push({
        title: "Bring overall result above passing threshold",
        description: "Focus on the lowest-scoring subjects with structured revision and regular check-ins.",
        timeframe: "This semester",
      });
    } else if (d.gpa.cgpa && d.gpa.cgpa >= 8) {
      strengths.push(`Strong overall academic record (CGPA ${d.gpa.cgpa})`);
    }
  }

  // ---- Attendance ----
  if (d.attendance) {
    if (d.attendance.risk_level === "high" || d.attendance.risk_level === "medium") {
      focus_areas.push(`Attendance needs improvement (${d.attendance.last_30_day_pct}% in the last 30 days)`);
      goals.push({
        title: "Improve attendance consistency",
        description: `Raise attendance above 90% over the coming weeks${d.attendance.current_absence_streak > 0 ? `, and break the current ${d.attendance.current_absence_streak}-day absence streak` : ""}.`,
        timeframe: "Next 30 days",
      });
      action_items.push({ item: "Identify and address the reason behind recent absences with parent/guardian", category: "attendance" });
      if (d.attendance.trend === "worsening") {
        action_items.push({ item: "Weekly attendance check-in with class teacher until trend improves", category: "attendance" });
      }
    } else {
      strengths.push(`Consistent attendance (${d.attendance.last_30_day_pct}% in the last 30 days)`);
    }
  }

  // ---- Competency ----
  d.competency_strengths.forEach((c: any) => {
    strengths.push(`Strong ${c.competency ?? "competency"}${c.subject ? ` in ${c.subject}` : ""} (${c.proficiency})`);
  });

  d.competency_gaps.forEach((c: any) => {
    focus_areas.push(`${c.competency ?? "Competency gap"}${c.subject ? ` in ${c.subject}` : ""} — currently ${c.proficiency}`);
    action_items.push({
      item: `Targeted practice to build ${c.competency ?? "this competency"}${c.subject ? ` in ${c.subject}` : ""} from ${c.proficiency} to proficient`,
      category: "academic",
    });
  });

  // ---- Fallbacks so the plan never renders empty ----
  if (strengths.length === 0) strengths.push("Consistent engagement with schoolwork — keep building from here");
  if (focus_areas.length === 0) focus_areas.push("No major concerns detected — focus on maintaining current performance");
  if (goals.length === 0) {
    goals.push({
      title: "Maintain current performance",
      description: "Continue current study habits and attendance while looking for opportunities to go from good to great.",
      timeframe: "Ongoing",
    });
  }
  if (action_items.length === 0) {
    action_items.push({ item: "Keep up with regular homework and class participation", category: "academic" });
  }

  // ---- Summary ----
  const riskCount = riskySubjects.length;
  const attendanceNote = d.attendance
    ? d.attendance.risk_level === "low"
      ? "attendance is healthy"
      : "attendance needs attention"
    : "attendance data isn't available yet";
  const summary =
    riskCount > 0
      ? `${d.student_name} shows risk in ${riskCount} subject${riskCount > 1 ? "s" : ""} that need${riskCount === 1 ? "s" : ""} focused support, while ${attendanceNote}. Below is a personalized plan to help close these gaps.`
      : `${d.student_name} is performing steadily across subjects, and ${attendanceNote}. This plan highlights ways to keep building on that momentum.`;

  return {
    summary,
    strengths: [...new Set(strengths)].slice(0, 6),
    focus_areas: [...new Set(focus_areas)].slice(0, 6),
    goals: goals.slice(0, 4),
    action_items: action_items.slice(0, 6),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const { student_id } = body;
    // student_id here = students.id (the row id, not profile_id)

    if (!student_id) {
      return new Response(
        JSON.stringify({ error: "student_id is required (students.id)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: studentRow, error: studentErr } = await supabase
      .from("students")
      .select("id, profile_id, full_name, class, section, school_id")
      .eq("id", student_id)
      .maybeSingle();

    if (studentErr || !studentRow) {
      return new Response(
        JSON.stringify({ error: "Student not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const schoolId = studentRow.school_id;

    // ---- 1. Academic: pull from student_predictions ----
    const { data: predictions } = await supabase
      .from("student_predictions")
      .select("subject, predicted_score_next_test, risk_level, dropout_risk_percentage, contributing_factors")
      .eq("student_id", student_id);

    // ---- 2. GPA snapshot ----
    const { data: gpaRows } = await supabase
      .from("student_gpa")
      .select("gpa, cgpa, assessment_score, marks_score, combined_score, result_status")
      .eq("student_id", student_id)
      .order("generated_at", { ascending: false })
      .limit(1);

    // ---- 3. Attendance risk ----
    const { data: attRecent } = await supabase
      .from("attendance_records")
      .select("class_id")
      .eq("student_id", student_id)
      .order("date", { ascending: false })
      .limit(1);

    let attendanceRow: any = null;
    if (attRecent && attRecent.length > 0) {
      const classId = attRecent[0].class_id;
      const { data: riskRows } = await supabase.rpc("calculate_attendance_risk", {
        p_school_id: schoolId,
        p_class_ids: [classId],
      });
      attendanceRow = (riskRows || []).find((r: any) => r.student_id === student_id) ?? null;
    }

    // ---- 4. Competency gaps + strengths ----
    const { data: competencyRows } = await supabase
      .from("competency_assessments")
      .select("proficiency, notes, assessed_date, competencies(name, subject)")
      .eq("student_id", student_id)
      .order("assessed_date", { ascending: false })
      .limit(30);

    const gaps = (competencyRows || []).filter(
      (c: any) => c.proficiency === "beginner" || c.proficiency === "developing"
    );
    const strengthsRows = (competencyRows || []).filter(
      (c: any) => c.proficiency === "proficient" || c.proficiency === "advanced"
    );

    const planContent = buildPlan({
      student_name: studentRow.full_name,
      academic_predictions: predictions ?? [],
      gpa: gpaRows?.[0] ?? null,
      attendance: attendanceRow
        ? {
            last_30_day_pct: attendanceRow.last_30_pct,
            trend: attendanceRow.trend,
            current_absence_streak: attendanceRow.current_streak,
            risk_level: attendanceRow.risk_level,
          }
        : null,
      competency_gaps: gaps.map((g: any) => ({
        competency: g.competencies?.name,
        subject: g.competencies?.subject,
        proficiency: g.proficiency,
      })),
      competency_strengths: strengthsRows.map((s: any) => ({
        competency: s.competencies?.name,
        subject: s.competencies?.subject,
        proficiency: s.proficiency,
      })),
    });

    // ---- Upsert: only touch content/generated_at, preserve teacher_notes & visibility if row exists ----
    const { data: existing } = await supabase
      .from("student_improvement_plans")
      .select("id")
      .eq("student_id", student_id)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("student_improvement_plans")
        .update({
          content: planContent,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("student_improvement_plans").insert({
        student_id,
        school_id: schoolId,
        content: planContent,
        generated_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ student_id, content: planContent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-improvement-plan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});