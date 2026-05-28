import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { trigger_event, trigger_data } = await req.json();
    if (!trigger_event) {
      return new Response(JSON.stringify({ error: "trigger_event required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch active rules matching this trigger
    const { data: rules, error: rulesErr } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("trigger_event", trigger_event)
      .eq("is_active", true);

    if (rulesErr) throw rulesErr;
    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ message: "No matching rules", executed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = [];

    for (const rule of rules) {
      try {
        // Check conditions
        const conditions = rule.condition_json as Record<string, unknown>;
        let conditionsMet = true;

        if (conditions && Object.keys(conditions).length > 0) {
          for (const [key, value] of Object.entries(conditions)) {
            if (trigger_data?.[key] !== value) {
              conditionsMet = false;
              break;
            }
          }
        }

        if (!conditionsMet) {
          results.push({ rule_id: rule.id, status: "skipped", reason: "conditions_not_met" });
          continue;
        }

        // Execute action
        const action = rule.action_json as { type: string; params?: Record<string, unknown> };
        let actionResult: Record<string, unknown> = {};

        switch (action.type) {
          case "generate_lesson": {
            const { data } = await supabase.functions.invoke("generate-lessons", {
              body: { ...trigger_data, ...(action.params || {}) },
            });
            actionResult = { type: "generate_lesson", result: data };
            break;
          }
          case "run_predictions": {
            const { data } = await supabase.functions.invoke("predict-performance", {
              body: { ...trigger_data, ...(action.params || {}) },
            });
            actionResult = { type: "run_predictions", result: data };
            break;
          }
          case "detect_issues": {
            const { data } = await supabase.functions.invoke("detect-learning-issues", {
              body: {},
            });
            actionResult = { type: "detect_issues", result: data };
            break;
          }
          case "notify": {
            const notification = {
              user_id: trigger_data?.teacher_id || trigger_data?.user_id,
              event_type: `automation_${trigger_event}`,
              title: action.params?.title || "Automation Triggered",
              message: action.params?.message || `Automation rule "${rule.name}" was triggered.`,
              reference_id: trigger_data?.id,
              reference_type: "automation",
            };
            if (notification.user_id) {
              await supabase.from("governance_notifications").insert(notification);
            }
            actionResult = { type: "notify", sent: true };
            break;
          }
          default:
            actionResult = { type: action.type, status: "unknown_action" };
        }

        // Log execution
        await supabase.from("automation_logs").insert({
          rule_id: rule.id,
          trigger_data: trigger_data || {},
          result: actionResult,
          status: "success",
        });

        results.push({ rule_id: rule.id, status: "success", result: actionResult });
      } catch (err) {
        await supabase.from("automation_logs").insert({
          rule_id: rule.id,
          trigger_data: trigger_data || {},
          result: {},
          status: "error",
          error_message: err.message,
        });
        results.push({ rule_id: rule.id, status: "error", error: err.message });
      }
    }

    return new Response(JSON.stringify({ executed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
