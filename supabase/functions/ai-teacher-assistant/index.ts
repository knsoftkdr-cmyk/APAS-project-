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

    const { teacher_id, school_id } = await req.json();
    if (!teacher_id || !school_id) {
      return new Response(JSON.stringify({ error: "teacher_id and school_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Resolve this teacher's classes and students ──────────────────────
    const { data: assignedClasses } = await supabase
      .from("class_teachers").select("class_id").eq("teacher_id", teacher_id);
    const classIds = [...new Set((assignedClasses || []).map((c: any) => c.class_id))];

    const { data: classRows } = classIds.length
      ? await supabase.from("classes").select("id, name, section").in("id", classIds)
      : { data: [] };

    let students: any[] = [];
    if (classRows?.length) {
      const orFilter = classRows.map((c: any) => `and(class.eq.${c.name},section.eq.${c.section})`).join(",");
      const { data } = await supabase
        .from("students").select("id, profile_id, full_name, class, section")
        .or(orFilter).eq("school_id", school_id);
      students = data || [];
    }
    const studentIds = students.map((s) => s.id);
    const studentMap = new Map(students.map((s) => [s.id, s]));

    // ── 2. At-risk students + their AI-explained contributing factors ───────
    let atRiskList: any[] = [];
    if (studentIds.length) {
      const { data: preds } = await supabase
        .from("student_predictions")
        .select("student_id, subject, risk_level, dropout_risk_percentage, contributing_factors")
        .in("student_id", studentIds)
        .in("risk_level", ["high", "medium"])
        .order("dropout_risk_percentage", { ascending: false })
        .limit(10);

      atRiskList = (preds || []).map((p: any) => ({
        student_id: p.student_id,
        student_name: studentMap.get(p.student_id)?.full_name || "Unknown",
        subject: p.subject,
        risk_level: p.risk_level,
        factors: p.contributing_factors || [],
      }));
    }

    // ── 3. Homework workload: pending count + which class has an exam soon ──
    const { data: assignments } = await supabase
      .from("homework_assignments").select("id, class_level, section").eq("assigned_by", teacher_id);
    const assignmentIds = (assignments || []).map((a: any) => a.id);
    let pendingHomeworkCount = 0;
    if (assignmentIds.length) {
      const { count } = await supabase
        .from("homework_submissions").select("id", { count: "exact", head: true })
        .in("assignment_id", assignmentIds).is("teacher_score", null).not("submitted_at", "is", null);
      pendingHomeworkCount = count || 0;
    }

    // ── 4. Upcoming exams (next 3 days) for this school ──────────────────────
    const in3Days = new Date(); in3Days.setDate(in3Days.getDate() + 3);
    const { data: upcomingExams } = await supabase
      .from("academic_calendar_events")
      .select("title, start_date, event_type")
      .eq("school_id", school_id)
      .eq("event_type", "exam")
      .gte("start_date", new Date().toISOString().split("T")[0])
      .lte("start_date", in3Days.toISOString().split("T")[0])
      .order("start_date");

    // ── 5. Class-level homework completion this week, per assigned class ────
    const classInsightsRaw: any[] = [];
    for (const c of classRows || []) {
      const classAssignmentIds = (assignments || [])
        .filter((a: any) => a.class_level === c.name && a.section === c.section)
        .map((a: any) => a.id);
      if (!classAssignmentIds.length) continue;
      const { count: submitted } = await supabase
        .from("homework_submissions").select("id", { count: "exact", head: true })
        .in("assignment_id", classAssignmentIds).not("submitted_at", "is", null);
      const classStudentCount = students.filter((s) => s.class === c.name && s.section === c.section).length;
      const expectedTotal = classAssignmentIds.length * Math.max(classStudentCount, 1);
      const completionPct = expectedTotal > 0 ? Math.round(((submitted || 0) / expectedTotal) * 100) : null;
      if (completionPct !== null) {
        classInsightsRaw.push({ class: `${c.name} - ${c.section}`, homework_completion_pct: completionPct });
      }
    }

    // ── 6. Behaviour: students with repeated "concern" notes this month ─────
    const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
    const { data: concernNotes } = await supabase
      .from("teacher_notes")
      .select("student_id, note")
      .eq("teacher_id", teacher_id)
      .eq("note_type", "concern")
      .gte("created_at", monthAgo.toISOString());

    const concernCounts = new Map<string, number>();
    (concernNotes || []).forEach((n: any) => concernCounts.set(n.student_id, (concernCounts.get(n.student_id) || 0) + 1));
    const repeatedConcernStudents = [...concernCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([sid, count]) => ({ name: studentMap.get(sid)?.full_name || "Unknown", count }));

    // ── 7. Smart Teaching Tip (rule-based, no AI needed) ─────────────────────
    let teachingTip: { observation: string; suggestion: string } | null = null;
    if (studentIds.length) {
      const profileIds = students.map((s) => s.profile_id).filter(Boolean);
      const { data: recentTests } = await supabase
        .from("academic_tests")
        .select("subject, score, total_questions")
        .in("student_id", profileIds) // academic_tests.student_id references profiles/auth.users, not students.id
        .order("completed_at", { ascending: false })
        .limit(50);
      const bySubject: Record<string, number[]> = {};
      (recentTests || []).forEach((t: any) => {
        const pct = t.total_questions > 0 ? (t.score / t.total_questions) * 100 : null;
        if (pct === null) return;
        (bySubject[t.subject] ||= []).push(pct);
      });
      const weakest = Object.entries(bySubject)
        .map(([subject, scores]) => ({ subject, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
        .sort((a, b) => a.avg - b.avg)[0];
      const TIP_LIBRARY: Record<string, string> = {
        Mathematics: "Use visual/manipulative aids before introducing abstract equations.",
        Science: "Try a short hands-on demo before the theory portion of the lesson.",
        English: "Use group reading with peer discussion to build comprehension.",
        "Social studies": "Use timelines or maps to anchor abstract concepts.",
      };
      if (weakest && weakest.avg < 60) {
        teachingTip = {
          observation: `Students struggled with ${weakest.subject} recently (avg ${Math.round(weakest.avg)}%).`,
          suggestion: TIP_LIBRARY[weakest.subject] || `Consider a revision session focused on ${weakest.subject}.`,
        };
      }
    }

    // ── 8. One consolidated AI call for all narrative text ───────────────────
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY") || Deno.env.get("GROK_API_KEY");
    let aiOutput: any = { remedial_activities: [], workload_suggestion: null, class_insights: [], behaviour_insight: null, calendar_suggestion: null };

    if (GROQ_KEY && (atRiskList.length || classInsightsRaw.length || pendingHomeworkCount > 0 || repeatedConcernStudents.length || upcomingExams?.length)) {
      const contextPayload = {
        at_risk_students: atRiskList.slice(0, 5),
        pending_homework_count: pendingHomeworkCount,
        upcoming_exams: upcomingExams || [],
        class_homework_completion: classInsightsRaw,
        repeated_concern_students: repeatedConcernStudents,
      };

      try {
        const aiResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: `You are an assistant helping a teacher plan their day. Given structured data, return ONLY valid JSON (no markdown fences) matching exactly this shape:
{
  "remedial_activities": [{"student_name": string, "subject": string, "activity": string, "estimated_minutes": number}],
  "workload_suggestion": {"text": string, "estimated_minutes": number} | null,
  "class_insights": [{"class": string, "homework_completion_pct": number, "observation": string, "recommendation": string}],
  "behaviour_insight": {"text": string, "suggested_action": string} | null,
  "calendar_suggestion": {"text": string} | null
}
Keep every string short and concrete (one sentence). Base remedial_activities only on the at_risk_students provided, one activity per student max. If a list is empty, return an empty array; if there's nothing to say for a null-able field, return null. Never invent students or data not present in the input.`,
              },
              { role: "user", content: JSON.stringify(contextPayload) },
            ],
          }),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          let content = aiData.choices?.[0]?.message?.content || "{}";
          content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          aiOutput = JSON.parse(content);
        }
      } catch (e) {
        console.error("AI synthesis failed:", e);
      }
    }

    return new Response(JSON.stringify({
      at_risk_students: atRiskList,
      pending_homework_count: pendingHomeworkCount,
      upcoming_exams: upcomingExams || [],
      repeated_concern_students: repeatedConcernStudents,
      teaching_tip: teachingTip,
      ...aiOutput,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-teacher-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
