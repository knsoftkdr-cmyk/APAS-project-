// AI Skills Dispatcher — routes requests to modular AI skills.
// Usage: POST { skill_key: "homework_generator", input: {...} }
// Optional: { action: "list" } to list active skills.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const { action, skill_key, input, auto_route } = body ?? {};

    // List available skills
    if (action === "list") {
      const { data, error } = await supabase
        .from("ai_skills")
        .select("skill_key,name,description,category,target_function,default_model,is_active,version")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return new Response(JSON.stringify({ skills: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-routing: pick a skill based on user_action keyword
    let resolvedKey = skill_key as string | undefined;
    if (!resolvedKey && auto_route?.user_action) {
      const a = String(auto_route.user_action).toLowerCase();
      if (a.includes("homework")) resolvedKey = "homework_generator";
      else if (a.includes("lesson")) resolvedKey = "lesson_plan_generator";
      else if (a.includes("doubt") || a.includes("tutor")) resolvedKey = "doubt_solver";
      else if (a.includes("weak") || a.includes("issue")) resolvedKey = "weakness_detector";
      else if (a.includes("predict") || a.includes("exam")) resolvedKey = "exam_predictor";
    }
    // Rule-based routing: low score triggers weakness analyzer
    if (!resolvedKey && typeof auto_route?.student_score === "number" && typeof auto_route?.threshold === "number") {
      if (auto_route.student_score < auto_route.threshold) resolvedKey = "weakness_detector";
    }

    if (!resolvedKey) {
      return new Response(JSON.stringify({ error: "skill_key or auto_route required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up skill
    const { data: skill, error: skillErr } = await supabase
      .from("ai_skills")
      .select("skill_key,target_function,default_model,is_active")
      .eq("skill_key", resolvedKey)
      .maybeSingle();
    if (skillErr) throw skillErr;
    if (!skill || !skill.is_active) {
      return new Response(JSON.stringify({ error: `Skill not found or inactive: ${resolvedKey}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identify caller (best-effort)
    let callerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      callerId = userData?.user?.id ?? null;
    }

    // Invoke the target function
    const payload = { ...(input ?? {}) };
    if (skill.default_model && !payload.model) payload.model = skill.default_model;

    let { data: result, error: invokeErr } = await supabase.functions.invoke(skill.target_function, {
      body: payload,
    });

    // 🛡️ HOOKS / GUARDRAIL LAYER — validate output, regenerate once on failure
    let guardrail: any = null;
    if (!invokeErr && result) {
      const ctx = input?.guardrail_context ?? {
        subject: input?.subject,
        class: input?.class_name ?? input?.grade,
        topic: input?.topic ?? input?.lesson_topic,
        keywords: input?.keywords,
      };
      const { data: hookRes } = await supabase.functions.invoke("ai-hooks", {
        body: {
          action: "validate",
          output: result,
          stage: "post",
          skill_key: resolvedKey,
          context: ctx,
          expect_json: true,
        },
      });
      guardrail = hookRes;

      if (hookRes?.action === "regenerate") {
        const retry = await supabase.functions.invoke(skill.target_function, {
          body: { ...payload, _guardrail_retry: true, _guardrail_reasons: hookRes.violations },
        });
        if (!retry.error) {
          result = retry.data;
          const { data: recheck } = await supabase.functions.invoke("ai-hooks", {
            body: { action: "validate", output: result, stage: "post", skill_key: resolvedKey, context: ctx, expect_json: true },
          });
          guardrail = { ...recheck, regenerated: true, original_violations: hookRes.violations };
        }
      } else if (hookRes?.action === "block") {
        invokeErr = { message: `Output blocked by guardrails: ${hookRes.violations?.map((v: any) => v.hook_key).join(", ")}` } as any;
      }
    }

    const duration = Date.now() - started;
    const status = invokeErr ? "error" : "success";

    await supabase.from("ai_skill_invocations").insert({
      skill_key: resolvedKey,
      caller_id: callerId,
      input_summary: { keys: Object.keys(payload).slice(0, 20) },
      output_summary: invokeErr ? {} : { ok: true },
      status,
      duration_ms: duration,
      error_message: invokeErr?.message ?? null,
    });

    if (invokeErr) {
      return new Response(JSON.stringify({ error: invokeErr.message, skill: resolvedKey }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ skill: resolvedKey, result, guardrail, duration_ms: duration }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-skills error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
