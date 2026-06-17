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
    const GROK_KEY = Deno.env.get("GROK_API_KEY");
    if (!GROK_KEY) throw new Error("GROK_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Get all students with recent performance
    const { data: students } = await supabase
      .from("students")
      .select("id, profile_id, grade");

    if (!students?.length) {
      return new Response(JSON.stringify({ alerts_created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const issues: Array<{
      student_group: string;
      trigger_condition: string;
      lesson_type: string;
      fail_rate: number;
      recommendation: string;
    }> = [];

    // 2. Detect falling performance trends
    for (const student of students) {
      const { data: perf } = await supabase
        .from("performance_records")
        .select("posttest_score, normalized_gain, recorded_at")
        .eq("student_id", student.id)
        .order("recorded_at", { ascending: false })
        .limit(5);

      if (perf && perf.length >= 3) {
        const scores = perf.map(p => p.posttest_score).filter(Boolean);
        if (scores.length >= 3) {
          const isDecl = scores[0] < scores[1] && scores[1] < scores[2];
          if (isDecl) {
            const { data: profile } = await supabase
              .from("profiles").select("full_name").eq("id", student.profile_id).single();
            issues.push({
              student_group: `${profile?.full_name || student.id} (Grade ${student.grade || "?"})`,
              trigger_condition: `Performance declining: ${scores[2]}→${scores[1]}→${scores[0]}`,
              lesson_type: "Performance Trend",
              fail_rate: Math.round(100 - scores[0]),
              recommendation: `Review teaching approach. Student scores dropped from ${scores[2]} to ${scores[0]} over last 3 assessments.`,
            });
          }
        }

        // Low normalized gain
        const gains = perf.map(p => Number(p.normalized_gain)).filter(g => !isNaN(g));
        if (gains.length >= 2) {
          const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
          if (avgGain < 0.3) {
            const { data: profile } = await supabase
              .from("profiles").select("full_name").eq("id", student.profile_id).single();
            issues.push({
              student_group: `${profile?.full_name || student.id} (Grade ${student.grade || "?"})`,
              trigger_condition: `Low avg normalized gain: ${avgGain.toFixed(2)}`,
              lesson_type: "Learning Gain",
              fail_rate: Math.round((1 - avgGain) * 100),
              recommendation: `Average learning gain is ${avgGain.toFixed(2)} (<0.3 threshold). Consider changing teaching methodology or VARK approach.`,
            });
          }
        }
      }

      // 3. Homework completion drop
      const { data: hwAssignments } = await supabase
        .from("homework_assignments")
        .select("id")
        .limit(20);

      if (hwAssignments?.length) {
        const { data: hwSubs } = await supabase
          .from("homework_submissions")
          .select("assignment_id")
          .eq("student_id", student.profile_id);

        const completionRate = hwAssignments.length > 0
          ? ((hwSubs?.length || 0) / hwAssignments.length) * 100
          : 100;

        if (completionRate < 50 && hwAssignments.length >= 3) {
          const { data: profile } = await supabase
            .from("profiles").select("full_name").eq("id", student.profile_id).single();
          issues.push({
            student_group: `${profile?.full_name || student.id} (Grade ${student.grade || "?"})`,
            trigger_condition: `Homework completion: ${completionRate.toFixed(0)}%`,
            lesson_type: "Engagement",
            fail_rate: Math.round(100 - completionRate),
            recommendation: `Only ${completionRate.toFixed(0)}% homework completion. Engage parents and consider gamified homework approach.`,
          });
        }
      }
    }

    // 4. Use AI to generate smart recommendations for grouped issues
    let aiEnhancedIssues = issues;
    if (issues.length > 0 && issues.length <= 20) {
      try {
        const aiResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROK_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: "You are an educational analyst. Given a list of detected learning issues, enhance the recommendations with specific, actionable strategies. Return ONLY a JSON array with the same structure but improved recommendations.",
              },
              {
                role: "user",
                content: `Enhance these detected issues with better recommendations:\n${JSON.stringify(issues)}`,
              },
            ],
          }),
        });

        if (aiResp.ok) {
          const aiData = await aiResp.json();
          let content = aiData.choices?.[0]?.message?.content || "";
          content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          try {
            aiEnhancedIssues = JSON.parse(content);
          } catch { /* use original issues */ }
        }
      } catch (e) {
        console.error("AI enhancement failed:", e);
      }
    }

    // 5. Insert alerts
    let alertsCreated = 0;
    for (const issue of aiEnhancedIssues) {
      const { error } = await supabase.from("mismatch_alerts").insert({
        student_group: issue.student_group,
        trigger_condition: issue.trigger_condition,
        lesson_type: issue.lesson_type,
        fail_rate: issue.fail_rate,
        recommendation: issue.recommendation,
        status: "flagged",
      });
      if (!error) alertsCreated++;
    }

    // 6. Also compute and store school metrics
    const { count: totalStudents } = await supabase
      .from("students").select("*", { count: "exact", head: true });
    const { count: totalTeachers } = await supabase
      .from("profiles").select("*", { count: "exact", head: true }).eq("role", "teacher");

    const { data: allPerf } = await supabase
      .from("performance_records")
      .select("normalized_gain")
      .not("normalized_gain", "is", null);

    const gains = (allPerf || []).map(p => Number(p.normalized_gain)).filter(g => !isNaN(g));
    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;

    const { count: aiUsage } = await supabase
      .from("lessons").select("*", { count: "exact", head: true }).eq("ai_generated", true);

    const highRisk = aiEnhancedIssues.filter(i => i.fail_rate >= 70).length;
    const medRisk = aiEnhancedIssues.filter(i => i.fail_rate >= 40 && i.fail_rate < 70).length;

    await supabase.from("school_metrics").upsert({
      snapshot_date: new Date().toISOString().split("T")[0],
      learning_gain_index: Number(avgGain.toFixed(3)),
      teaching_effectiveness_score: Number((avgGain * 100).toFixed(1)),
      ai_usage_count: aiUsage || 0,
      total_students: totalStudents || 0,
      total_teachers: totalTeachers || 0,
      risk_summary: { high: highRisk, medium: medRisk, low: aiEnhancedIssues.length - highRisk - medRisk, total: aiEnhancedIssues.length },
    }, { onConflict: "snapshot_date" });

    return new Response(JSON.stringify({
      alerts_created: alertsCreated,
      issues_detected: aiEnhancedIssues.length,
      school_metrics_updated: true,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("detect-learning-issues error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
