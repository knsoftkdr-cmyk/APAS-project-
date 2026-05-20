// AI Token Analytics Aggregator
// Processes daily AI usage logs and generates analytics summaries

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

    const { action, date_range = 1 } = await req.json();

    if (action === "aggregate_daily") {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - date_range);
      const dateStr = targetDate.toISOString().split("T")[0];

      // Get all usage logs for the date range
      const { data: logs, error: logsError } = await supabase
        .from("ai_usage_logs")
        .select("*")
        .gte("created_at", new Date(dateStr).toISOString())
        .lt("created_at", new Date(new Date(dateStr).getTime() + 86400000).toISOString());

      if (logsError) throw logsError;
      if (!logs || logs.length === 0) {
        return new Response(
          JSON.stringify({ message: "No logs found for date range", logs_processed: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate aggregates
      const totalCalls = logs.length;
      const totalInputTokens = logs.reduce((sum: number, log: any) => sum + (log.input_tokens || 0), 0);
      const totalOutputTokens = logs.reduce((sum: number, log: any) => sum + (log.output_tokens || 0), 0);
      const totalCost = logs.reduce((sum: number, log: any) => sum + (log.cost_usd || 0), 0);
      const errorCount = logs.filter((l: any) => l.status === "error").length;
      const errorRate = (errorCount / totalCalls) * 100;
      const avgResponseTime = Math.round(
        logs.reduce((sum: number, log: any) => sum + (log.response_time_ms || 0), 0) / totalCalls
      );

      // Group by model
      const byModel: Record<string, any> = {};
      logs.forEach((log: any) => {
        if (!byModel[log.model_used]) {
          byModel[log.model_used] = { calls: 0, tokens: 0, cost: 0 };
        }
        byModel[log.model_used].calls += 1;
        byModel[log.model_used].tokens += log.total_tokens || 0;
        byModel[log.model_used].cost += log.cost_usd || 0;
      });

      // Group by task
      const byTask: Record<string, any> = {};
      logs.forEach((log: any) => {
        if (!byTask[log.task_type]) {
          byTask[log.task_type] = { calls: 0, tokens: 0, cost: 0 };
        }
        byTask[log.task_type].calls += 1;
        byTask[log.task_type].tokens += log.total_tokens || 0;
        byTask[log.task_type].cost += log.cost_usd || 0;
      });

      // Upsert daily summary
      const { error: upsertError } = await supabase
        .from("ai_usage_daily_summary")
        .upsert(
          {
            summary_date: dateStr,
            total_calls: totalCalls,
            total_input_tokens: totalInputTokens,
            total_output_tokens: totalOutputTokens,
            total_cost_usd: totalCost,
            by_model: byModel,
            by_task: byTask,
            error_rate: errorRate,
            avg_response_time_ms: avgResponseTime,
          },
          { onConflict: "summary_date" }
        );

      if (upsertError) throw upsertError;

      return new Response(
        JSON.stringify({
          message: "Daily analytics aggregated successfully",
          logs_processed: totalCalls,
          date: dateStr,
          summary: {
            total_calls: totalCalls,
            total_cost_usd: totalCost.toFixed(6),
            error_rate: errorRate.toFixed(2) + "%",
            avg_response_time_ms: avgResponseTime,
            by_model: byModel,
            by_task: byTask,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_analytics") {
      const { days = 30 } = await req.json();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data: summaries, error: summError } = await supabase
        .from("ai_usage_daily_summary")
        .select("*")
        .gte("summary_date", startDate.toISOString().split("T")[0])
        .order("summary_date", { ascending: false });

      if (summError) throw summError;

      // Calculate totals
      const totals = summaries.reduce(
        (acc: any, s: any) => ({
          total_calls: acc.total_calls + s.total_calls,
          total_cost_usd: acc.total_cost_usd + s.total_cost_usd,
          total_tokens: acc.total_tokens + s.total_input_tokens + s.total_output_tokens,
          avg_error_rate: acc.avg_error_rate + s.error_rate,
        }),
        { total_calls: 0, total_cost_usd: 0, total_tokens: 0, avg_error_rate: 0 }
      );

      return new Response(
        JSON.stringify({
          period_days: days,
          totals: {
            ...totals,
            avg_error_rate: (totals.avg_error_rate / summaries.length).toFixed(2) + "%",
          },
          daily_summaries: summaries,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Analytics error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
