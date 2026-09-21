// supabase/functions/calibrate-bkt-params/index.ts
//
// Deploy with:
//   supabase functions deploy calibrate-bkt-params
//
// Admin/teacher only. Body: { learning_objective_id } for one objective, or
// { subtopic_id } / { topic_id } to batch-calibrate every active objective
// under that concept/topic. Each objective needs real evidence (>=5
// students, >=20 attempts) or it's skipped with a reason rather than
// overwriting good defaults with a noisy fit.
//
// This can take a few seconds per objective (grid search over ~400
// parameter combinations) — call it from an admin action, not on a hot path.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Not permitted to calibrate BKT parameters" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { learning_objective_id, subtopic_id, topic_id } = await req.json();
    if (!learning_objective_id && !subtopic_id && !topic_id) {
      return new Response(JSON.stringify({ error: "learning_objective_id, subtopic_id or topic_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let objectiveIds: number[] = [];
    if (learning_objective_id) {
      objectiveIds = [learning_objective_id];
    } else if (subtopic_id) {
      const { data } = await supabaseAdmin
        .from("learning_objectives").select("id").eq("subtopic_id", subtopic_id).eq("status", "active");
      objectiveIds = (data ?? []).map((r) => r.id);
    } else {
      const { data: subtopics } = await supabaseAdmin.from("subtopics").select("id").eq("topic_id", topic_id);
      const subtopicIds = (subtopics ?? []).map((s) => s.id);
      if (subtopicIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("learning_objectives").select("id").in("subtopic_id", subtopicIds).eq("status", "active");
        objectiveIds = (data ?? []).map((r) => r.id);
      }
    }

    if (objectiveIds.length === 0) {
      return new Response(JSON.stringify({ error: "No active learning objectives found for that scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: unknown[] = [];
    for (const id of objectiveIds) {
      const { data, error } = await supabaseAdmin.rpc("calibrate_bkt_params", { p_learning_objective_id: id });
      if (error) results.push({ learning_objective_id: id, error: error.message });
      else results.push(data);
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("calibrate-bkt-params error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
