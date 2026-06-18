// AI Hooks (Guardrail Layer) — validates AI outputs against safety, curriculum
// alignment, quality, schema, relevance, and moderation rules.
//
// Usage:
//   POST { action: "validate", output: string|object, stage?: "post",
//          skill_key?: string, context?: { subject?, class?, topic?, keywords?[] },
//          expect_json?: boolean }
//   POST { action: "list" }
//
// Response: { passed: boolean, action: "pass"|"regenerate"|"block"|"warn",
//             violations: [{ hook_key, severity, reason, action }], sanitized? }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Hook = {
  hook_key: string;
  name: string;
  stage: string;
  category: string;
  severity: string;
  action_on_fail: string;
  config: Record<string, any>;
  is_active: boolean;
  applies_to: string[];
};

function toText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function runHook(
  hook: Hook,
  text: string,
  ctx: { subject?: string; class?: string; topic?: string; keywords?: string[] },
  expectJson: boolean,
  rawOutput: unknown,
): { passed: boolean; reason?: string } {
  const cfg = hook.config || {};
  const lower = text.toLowerCase();

  switch (hook.category) {
    case "safety": {
      const banned: string[] = cfg.banned_terms || [];
      for (const term of banned) {
        if (lower.includes(String(term).toLowerCase()))
          return { passed: false, reason: `Contains banned term: "${term}"` };
      }
      const patterns: string[] = cfg.patterns || [];
      for (const p of patterns) {
        try {
          if (new RegExp(p, "i").test(text))
            return { passed: false, reason: `Matches unsafe pattern: ${p}` };
        } catch { /* bad regex — skip */ }
      }
      return { passed: true };
    }
    case "moderation": {
      const patterns: string[] = cfg.patterns || [];
      for (const p of patterns) {
        try {
          if (new RegExp(p).test(text))
            return { passed: false, reason: `PII/moderation pattern matched: ${p}` };
        } catch { /* skip */ }
      }
      return { passed: true };
    }
    case "quality": {
      const min = Number(cfg.min_chars ?? 100);
      if (text.trim().length < min)
        return { passed: false, reason: `Output too short (<${min} chars)` };
      return { passed: true };
    }
    case "schema": {
      if (!expectJson) return { passed: true };
      if (typeof rawOutput === "object" && rawOutput !== null) return { passed: true };
      try {
        JSON.parse(typeof rawOutput === "string" ? rawOutput : text);
        return { passed: true };
      } catch {
        return { passed: false, reason: "Expected valid JSON output" };
      }
    }
    case "curriculum_alignment": {
      const minMatches = Number(cfg.min_keyword_matches ?? 1);
      const keywords = [
        ctx.subject,
        ctx.class,
        ctx.topic,
        ...(ctx.keywords ?? []),
      ].filter(Boolean).map((k) => String(k).toLowerCase());
      if (keywords.length === 0) return { passed: true }; // no context supplied
      const matches = keywords.filter((k) => lower.includes(k)).length;
      if (matches < minMatches)
        return {
          passed: false,
          reason: `Curriculum alignment failed (${matches}/${minMatches} keyword matches)`,
        };
      return { passed: true };
    }
    case "relevance": {
      const minOverlap = Number(cfg.min_topic_overlap ?? 0.15);
      const topicWords = `${ctx.subject ?? ""} ${ctx.topic ?? ""} ${(ctx.keywords ?? []).join(" ")}`
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3);
      if (topicWords.length === 0) return { passed: true };
      const unique = Array.from(new Set(topicWords));
      const hits = unique.filter((w) => lower.includes(w)).length;
      const overlap = hits / unique.length;
      if (overlap < minOverlap)
        return {
          passed: false,
          reason: `Low topic overlap (${overlap.toFixed(2)} < ${minOverlap})`,
        };
      return { passed: true };
    }
    default:
      return { passed: true };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { action = "validate", output, stage = "post", skill_key, context = {}, expect_json = false } = body ?? {};

    if (action === "list") {
      const { data, error } = await supabase
        .from("ai_hooks")
        .select("hook_key,name,description,stage,category,severity,action_on_fail,is_active,applies_to")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return new Response(JSON.stringify({ hooks: data ?? [] }), {
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

    // Load applicable hooks
    const { data: hooks, error: hooksErr } = await supabase
      .from("ai_hooks")
      .select("hook_key,name,stage,category,severity,action_on_fail,config,is_active,applies_to")
      .eq("is_active", true)
      .eq("stage", stage);
    if (hooksErr) throw hooksErr;

    const applicable = (hooks ?? []).filter((h: Hook) =>
      h.applies_to?.includes("*") || (skill_key && h.applies_to?.includes(skill_key))
    );

    const text = toText(output);
    const violations: Array<{ hook_key: string; severity: string; reason: string; action: string; category: string }> = [];
    let finalAction: "pass" | "regenerate" | "block" | "warn" = "pass";

    for (const h of applicable) {
      const res = runHook(h as Hook, text, context, expect_json, output);
      if (!res.passed) {
        violations.push({
          hook_key: h.hook_key,
          severity: h.severity,
          reason: res.reason ?? "Failed",
          action: h.action_on_fail,
          category: h.category,
        });
        // escalate action: block > regenerate > warn
        if (h.action_on_fail === "block") finalAction = "block";
        else if (h.action_on_fail === "regenerate" && finalAction !== "block") finalAction = "regenerate";
        else if (h.action_on_fail === "warn" && finalAction === "pass") finalAction = "warn";
      }
    }

    // Log violations (best-effort)
    if (violations.length > 0) {
      await supabase.from("ai_hook_violations").insert(
        violations.map((v) => ({
          hook_key: v.hook_key,
          skill_key: skill_key ?? null,
          stage,
          severity: v.severity,
          action_taken: finalAction,
          caller_id: callerId,
          details: { reason: v.reason, category: v.category, context },
        })),
      );
    }

    return new Response(
      JSON.stringify({
        passed: violations.length === 0,
        action: finalAction,
        violations,
        checked: applicable.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ai-hooks error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
