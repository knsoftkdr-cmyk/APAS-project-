// Enhanced AI Router with Token Tracking & Confidence Scoring
// Routes AI requests to optimal models and tracks usage for analytics

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface AIResponse {
  content: string;
  tokens?: TokenUsage;
  confidence_score?: number;
  model_used?: string;
  task_type?: string;
}

const MODEL_RULES: Record<string, string> = {
  classify: "google/gemini-2.5-flash-lite",
  summarize_short: "google/gemini-2.5-flash-lite",
  extract: "google/gemini-2.5-flash-lite",
  chat: "google/gemini-3-flash-preview",
  tutor: "google/gemini-3-flash-preview",
  hint: "google/gemini-3-flash-preview",
  feedback: "google/gemini-3-flash-preview",
  generate_mcq: "google/gemini-2.5-flash",
  generate_homework: "google/gemini-2.5-flash",
  analyze_results: "google/gemini-2.5-flash",
  generate_lesson: "google/gemini-2.5-pro",
  generate_period_plan: "google/gemini-2.5-pro",
  curriculum_align: "google/gemini-2.5-pro",
  predict_performance: "google/gemini-2.5-pro",
};

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

function pickModel(task?: string, override?: string): string {
  if (override && override.includes("/")) return override;
  if (task && MODEL_RULES[task]) return MODEL_RULES[task];
  return DEFAULT_MODEL;
}

// Calculate confidence based on response metadata
function calculateConfidence(response: any, inputLength: number): number {
  if (!response) return 0.5;
  
  const baseConfidence = 0.75;
  const finishReasonBonus = response.choices?.[0]?.finish_reason === "stop" ? 0.15 : 0;
  const tokenPenalty = (response.usage?.output_tokens || 0) > (inputLength * 5) ? 0.1 : 0;
  
  return Math.min(1.0, Math.max(0.3, baseConfidence + finishReasonBonus - tokenPenalty));
}

// Log usage to Supabase
async function logUsage(
  supabase: any,
  userId: string,
  taskType: string,
  model: string,
  tokens: TokenUsage,
  responseTime: number,
  status: "success" | "error" | "rate_limited",
  errorMessage?: string
) {
  try {
    // Get model cost
    const { data: costData } = await supabase
      .from("ai_model_costs")
      .select("input_cost_per_1k_tokens,output_cost_per_1k_tokens")
      .eq("model_name", model)
      .single();

    const inputCost = costData ? (tokens.input_tokens / 1000) * costData.input_cost_per_1k_tokens : 0;
    const outputCost = costData ? (tokens.output_tokens / 1000) * costData.output_cost_per_1k_tokens : 0;
    const totalCost = inputCost + outputCost;

    await supabase.from("ai_usage_logs").insert({
      user_id: userId,
      task_type: taskType,
      model_used: model,
      input_tokens: tokens.input_tokens,
      output_tokens: tokens.output_tokens,
      cost_usd: totalCost,
      response_time_ms: responseTime,
      status: status,
      error_message: errorMessage,
      metadata: {
        input_cost_usd: inputCost,
        output_cost_usd: outputCost,
      },
    });
  } catch (e) {
    console.error("Failed to log usage:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    const authHeader = req.headers.get("authorization");
    const userIdMatch = authHeader?.match(/user_id=([^&]+)/);
    const userId = userIdMatch ? userIdMatch[1] : "anonymous";

    const body = await req.json();
    const {
      task,
      model: modelOverride,
      messages,
      stream = false,
      temperature,
      tools,
      tool_choice,
      response_format,
      reasoning,
    } = body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const model = pickModel(task, modelOverride);
    const startTime = Date.now();

    const payload: Record<string, unknown> = { model, messages, stream };
    if (temperature !== undefined) payload.temperature = temperature;
    if (tools) payload.tools = tools;
    if (tool_choice) payload.tool_choice = tool_choice;
    if (response_format) payload.response_format = response_format;
    if (reasoning) payload.reasoning = reasoning;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseTime = Date.now() - startTime;

    if (!aiResp.ok) {
      const status = aiResp.status === 429 ? "rate_limited" : "error";
      const errorText = await aiResp.text();

      // Log failed request
      if (userId !== "anonymous") {
        await logUsage(supabase, userId, task || "unknown", model, { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, responseTime, status, errorText.slice(0, 200));
      }

      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error ${aiResp.status}: ${errorText.slice(0, 200)}`);
    }

    if (stream) {
      // For streaming, we'll log after stream completes (handled by client or separate endpoint)
      return new Response(aiResp.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "x-router-model": model,
        },
      });
    }

    const data = await aiResp.json();
    const tokens: TokenUsage = {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      total_tokens: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0),
    };

    const confidence = calculateConfidence(data, JSON.stringify(messages).length);

    // Log successful request
    if (userId !== "anonymous") {
      await logUsage(supabase, userId, task || "unknown", model, tokens, responseTime, "success");
    }

    return new Response(
      JSON.stringify({
        ...data,
        _router: {
          model,
          task: task ?? null,
          tokens,
          confidence_score: confidence,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ai-router error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
