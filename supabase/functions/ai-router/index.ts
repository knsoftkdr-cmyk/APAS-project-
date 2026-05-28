// AI Router — selects the best Lovable AI model for a given task type
// and proxies the chat completion (streaming or non-streaming) to the
// Lovable AI Gateway. Centralises model choice so callers don't hard-code
// model names and so we can tune cost/performance in one place.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Task-type → model rules. Tune here, not in callers.
// Tiers:
//   FAST   = gemini-2.5-flash-lite  (cheapest, classification/short)
//   BALANCED = gemini-3-flash-preview (default)
//   DEEP   = gemini-2.5-pro         (long reasoning / large lesson plans)
const MODEL_RULES: Record<string, string> = {
  // Classification / short utility
  classify: "google/gemini-2.5-flash-lite",
  summarize_short: "google/gemini-2.5-flash-lite",
  extract: "google/gemini-2.5-flash-lite",

  // Conversational / tutoring (balanced)
  chat: "google/gemini-3-flash-preview",
  tutor: "google/gemini-3-flash-preview",
  hint: "google/gemini-3-flash-preview",
  feedback: "google/gemini-3-flash-preview",

  // Generation tasks needing depth
  generate_mcq: "google/gemini-2.5-flash",
  generate_homework: "google/gemini-2.5-flash",
  analyze_results: "google/gemini-2.5-flash",

  // Heavy reasoning / long-form authoring
  generate_lesson: "google/gemini-2.5-pro",
  generate_period_plan: "google/gemini-2.5-pro",
  curriculum_align: "google/gemini-2.5-pro",
  predict_performance: "google/gemini-2.5-pro",
};

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

function pickModel(task?: string, override?: string): string {
  if (override && override.includes("/")) return override; // explicit full id wins
  if (task && MODEL_RULES[task]) return MODEL_RULES[task];
  return DEFAULT_MODEL;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const {
      task,                // e.g. "tutor", "generate_lesson", "classify"
      model: modelOverride,// optional explicit model id
      messages,            // OpenAI-style messages
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const model = pickModel(task, modelOverride);

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

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await aiResp.text();
      console.error("AI gateway error", aiResp.status, errText);
      return new Response(
        JSON.stringify({ error: "AI gateway error", status: aiResp.status }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (stream) {
      return new Response(aiResp.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "x-router-model": model,
        },
      });
    }

    const data = await aiResp.json();
    return new Response(
      JSON.stringify({ ...data, _router: { model, task: task ?? null } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ai-router error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
