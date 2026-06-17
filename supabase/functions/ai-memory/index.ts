// Central AI Memory Layer — read/write context used by all AI features.
// Actions:
//  - get    { owner_id, types?, scope?, subject?, limit? }
//  - set    { owner_id, memory_type, key, value, scope?, summary?, subject?, class_level?, importance?, source?, expires_at? }
//  - delete { owner_id, id }
//  - context { owner_id, subject?, class_level?, limit? } -> compact block for prompt injection

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json();
    const action = body.action as string;

    if (action === "set") {
      const {
        owner_id, memory_type, key, value,
        scope = "global", summary = null, subject = null,
        class_level = null, importance = 5, source = null, expires_at = null,
      } = body;
      if (!owner_id || !memory_type || !key) {
        return json({ error: "owner_id, memory_type, key required" }, 400);
      }
      const { data, error } = await supabase
        .from("ai_memory")
        .upsert({
          owner_id, memory_type, key, value: value ?? {},
          scope, summary, subject, class_level, importance, source, expires_at,
        }, { onConflict: "owner_id,memory_type,scope,key" })
        .select()
        .maybeSingle();
      if (error) throw error;
      return json({ memory: data });
    }

    if (action === "get") {
      const { owner_id, types, scope, subject, limit = 50 } = body;
      if (!owner_id) return json({ error: "owner_id required" }, 400);
      let q = supabase.from("ai_memory").select("*").eq("owner_id", owner_id);
      if (Array.isArray(types) && types.length) q = q.in("memory_type", types);
      if (scope) q = q.eq("scope", scope);
      if (subject) q = q.eq("subject", subject);
      q = q.order("importance", { ascending: false })
           .order("updated_at", { ascending: false })
           .limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      // Filter out expired
      const now = Date.now();
      const fresh = (data || []).filter(m => !m.expires_at || new Date(m.expires_at).getTime() > now);
      return json({ memories: fresh });
    }

    if (action === "delete") {
      const { owner_id, id } = body;
      if (!owner_id || !id) return json({ error: "owner_id, id required" }, 400);
      const { error } = await supabase.from("ai_memory").delete().eq("id", id).eq("owner_id", owner_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "context") {
      // Build a compact context block for LLM prompt injection
      const { owner_id, subject, class_level, limit = 20 } = body;
      if (!owner_id) return json({ error: "owner_id required" }, 400);
      let q = supabase.from("ai_memory").select("memory_type,key,summary,value,subject,class_level,importance")
        .eq("owner_id", owner_id)
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (subject) q = q.or(`subject.eq.${subject},subject.is.null`);
      if (class_level) q = q.or(`class_level.eq.${class_level},class_level.is.null`);
      const { data, error } = await q;
      if (error) throw error;

      // Also pull global system rules
      const { data: rules } = await supabase
        .from("ai_memory").select("key,summary,value")
        .eq("memory_type", "system_rule")
        .order("importance", { ascending: false })
        .limit(10);

      const lines: string[] = [];
      if (rules?.length) {
        lines.push("## System Rules");
        for (const r of rules) lines.push(`- ${r.summary ?? r.key}`);
      }
      const byType: Record<string, any[]> = {};
      for (const m of data || []) {
        (byType[m.memory_type] ||= []).push(m);
      }
      const label: Record<string, string> = {
        student_profile: "Student Profile",
        learning_history: "Learning History",
        teacher_preference: "Teacher Preferences",
        interaction: "Recent Interactions",
        fact: "Known Facts",
      };
      for (const [t, items] of Object.entries(byType)) {
        if (t === "system_rule") continue;
        lines.push(`\n## ${label[t] ?? t}`);
        for (const m of items) {
          const s = m.summary ?? JSON.stringify(m.value).slice(0, 200);
          lines.push(`- [${m.key}] ${s}`);
        }
      }
      return json({ context: lines.join("\n"), count: (data?.length || 0) + (rules?.length || 0) });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("ai-memory error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
