// AI Feedback Learning Loop
// Captures user corrections and feedback to improve AI quality

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("authorization");
    const userIdMatch = authHeader?.match(/user_id=([^&]+)/);
    const userId = userIdMatch ? userIdMatch[1] : null;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action } = body;

    // SUBMIT FEEDBACK: Record user feedback on AI responses
    if (action === "submit_feedback") {
      const {
        ai_usage_log_id,
        task_type,
        confidence_score,
        is_accurate,
        teacher_feedback = "",
        correction_provided = "",
        value_rating = 3,
      } = body;

      if (!task_type) {
        return new Response(
          JSON.stringify({ error: "task_type is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (confidence_score < 0 || confidence_score > 1) {
        return new Response(
          JSON.stringify({ error: "confidence_score must be between 0 and 1" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: feedback, error: feedbackError } = await supabase
        .from("ai_response_feedback")
        .insert({
          ai_usage_log_id,
          user_id: userId,
          task_type,
          confidence_score,
          is_accurate,
          teacher_feedback,
          correction_provided,
          value_rating,
        })
        .select()
        .single();

      if (feedbackError) throw feedbackError;

      // If there's a correction, log it for learning
      if (correction_provided && is_accurate === false) {
        const { data: usageLog } = await supabase
          .from("ai_usage_logs")
          .select("*")
          .eq("id", ai_usage_log_id)
          .single();

        if (usageLog) {
          await supabase.from("ai_improvement_feedback").insert({
            ai_usage_log_id,
            task_type,
            model_used: usageLog.model_used,
            original_response: { confidence: confidence_score },
            user_correction: { correction: correction_provided, feedback: teacher_feedback },
            improvement_notes: `User corrected ${task_type} response. Rating: ${value_rating}/5`,
            impact_score: value_rating / 5,
          });
        }
      }

      return new Response(
        JSON.stringify({
          message: "Feedback recorded successfully",
          feedback_id: feedback.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET FEEDBACK ANALYTICS: Analyze feedback patterns
    if (action === "get_feedback_analytics") {
      const { task_type = null, days = 30 } = body;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      let query = supabase
        .from("ai_response_feedback")
        .select("*")
        .gte("created_at", startDate.toISOString());

      if (task_type) {
        query = query.eq("task_type", task_type);
      }

      const { data: allFeedback } = await query;

      if (!allFeedback || allFeedback.length === 0) {
        return new Response(
          JSON.stringify({
            total_feedback: 0,
            accuracy_rate: 0,
            avg_confidence: 0,
            avg_value_rating: 0,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const accurateCount = allFeedback.filter((f: any) => f.is_accurate === true).length;
      const avgConfidence =
        allFeedback.reduce((sum: number, f: any) => sum + (f.confidence_score || 0), 0) /
        allFeedback.length;
      const avgValue =
        allFeedback.reduce((sum: number, f: any) => sum + (f.value_rating || 0), 0) /
        allFeedback.length;

      // Group by task type
      const byTaskType: Record<string, any> = {};
      allFeedback.forEach((f: any) => {
        if (!byTaskType[f.task_type]) {
          byTaskType[f.task_type] = { count: 0, accurate: 0, avg_confidence: 0, avg_rating: 0 };
        }
        byTaskType[f.task_type].count += 1;
        if (f.is_accurate) byTaskType[f.task_type].accurate += 1;
        byTaskType[f.task_type].avg_confidence += f.confidence_score || 0;
        byTaskType[f.task_type].avg_rating += f.value_rating || 0;
      });

      // Calculate averages for each task
      for (const task in byTaskType) {
        const t = byTaskType[task];
        t.accuracy_rate = ((t.accurate / t.count) * 100).toFixed(1) + "%";
        t.avg_confidence = (t.avg_confidence / t.count).toFixed(3);
        t.avg_rating = (t.avg_rating / t.count).toFixed(2);
      }

      return new Response(
        JSON.stringify({
          period_days: days,
          total_feedback: allFeedback.length,
          accuracy_rate: ((accurateCount / allFeedback.length) * 100).toFixed(1) + "%",
          avg_confidence: avgConfidence.toFixed(3),
          avg_value_rating: avgValue.toFixed(2),
          by_task_type: byTaskType,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET IMPROVEMENT OPPORTUNITIES: Find patterns for AI improvement
    if (action === "get_improvement_opportunities") {
      const { limit = 10 } = body;

      const { data: improvements } = await supabase
        .from("ai_improvement_feedback")
        .select("*")
        .order("impact_score", { ascending: false })
        .limit(limit);

      if (!improvements || improvements.length === 0) {
        return new Response(
          JSON.stringify({
            opportunities: [],
            total_improvements: 0,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Group by task type to identify systemic issues
      const byTask: Record<string, any> = {};
      improvements.forEach((imp: any) => {
        if (!byTask[imp.task_type]) {
          byTask[imp.task_type] = { count: 0, avg_impact: 0, models: new Set() };
        }
        byTask[imp.task_type].count += 1;
        byTask[imp.task_type].avg_impact += imp.impact_score || 0;
        byTask[imp.task_type].models.add(imp.model_used);
      });

      for (const task in byTask) {
        const t = byTask[task];
        t.avg_impact = (t.avg_impact / t.count).toFixed(2);
        t.models = Array.from(t.models);
      }

      return new Response(
        JSON.stringify({
          improvement_opportunities: improvements,
          systemic_issues_by_task: byTask,
          recommendation:
            Object.keys(byTask).length > 0
              ? `Focus on improving ${Object.keys(byTask)[0]} task type - highest impact area`
              : "All systems performing well",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // RATE ACCURACY: Simple accuracy rating for past responses
    if (action === "rate_accuracy") {
      const { ai_usage_log_id, is_accurate, value_rating = 3 } = body;

      const { error } = await supabase
        .from("ai_response_feedback")
        .update({
          is_accurate,
          value_rating,
        })
        .eq("ai_usage_log_id", ai_usage_log_id)
        .eq("user_id", userId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ message: "Accuracy rating recorded" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Feedback learning error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
