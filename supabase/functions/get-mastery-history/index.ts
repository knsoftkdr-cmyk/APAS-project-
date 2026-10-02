// supabase/functions/get-mastery-history/index.ts
//
// Deploy with:
//   supabase functions deploy get-mastery-history
//
// Body: { learning_objective_id, student_id? } -> raw event history for one objective
// Body: { subtopic_id, student_id? }           -> concept-level running-average trend
//
// Students: resolved to their own record. Staff: may pass student_id.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

import { routeMerged, type RouteTable } from "../_shared/mergedRouter.ts";
import { handleRootCauseAnalysis } from "../_shared/handlers/rootCauseAnalysis.ts";
import { handleLearningVelocity } from "../_shared/handlers/learningVelocity.ts";
import { handleStudentMisconceptions } from "../_shared/handlers/studentMisconceptions.ts";
import { handleStudentTwin } from "../_shared/handlers/studentTwin.ts";
import { handleAccessibility } from "../_shared/handlers/accessibility.ts";
import { handlePronunciation } from "../_shared/handlers/pronunciation.ts";

// Features merged in from former standalone functions (Edge Function limit) - see _shared/mergedRouter.ts.
const MERGED_ROUTES: RouteTable = {
  student_velocity: { handler: handleLearningVelocity },
  student_misconceptions: { handler: handleStudentMisconceptions },
  root_cause: { handler: handleRootCauseAnalysis },
  student_twin: { handler: handleStudentTwin },
  // Accessibility Engine preferences (any signed-in user, own row only) - see handlers/accessibility.ts.
  accessibility_get: { handler: handleAccessibility, action: "get" },
  accessibility_save: { handler: handleAccessibility, action: "save" },
  // Pronunciation Assessment (students, own attempts only) - see handlers/pronunciation.ts.
  pronunciation_assess: { handler: handlePronunciation, action: "assess" },
  pronunciation_history: { handler: handlePronunciation, action: "history" },
  pronunciation_passage: { handler: handlePronunciation, action: "passage" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Merged features are routed before this function's own auth/parsing; unmatched requests fall through.
  const merged = await routeMerged(req, MERGED_ROUTES);
  if (merged) return merged;

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
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStaff = ["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role);
    const { learning_objective_id, subtopic_id, student_id } = await req.json();

    if (!learning_objective_id && !subtopic_id) {
      return new Response(JSON.stringify({ error: "learning_objective_id or subtopic_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetStudentId: string | null = null;
    if (profile.role === "student") {
      const { data: studentRow } = await supabaseAdmin.from("students").select("id").eq("profile_id", user.id).single();
      targetStudentId = studentRow?.id ?? null;
    } else if (isStaff) {
      if (!student_id) {
        return new Response(JSON.stringify({ error: "student_id is required for staff requests" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetStudentId = student_id;
    } else {
      return new Response(JSON.stringify({ error: "Not permitted" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetStudentId) {
      return new Response(JSON.stringify({ error: "Student record not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (learning_objective_id) {
      const { data, error } = await supabaseClient.rpc("get_mastery_history", {
        p_student_id: targetStudentId,
        p_learning_objective_id: learning_objective_id,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ scope: "objective", learning_objective_id, history: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseClient.rpc("get_concept_mastery_trend", {
      p_student_id: targetStudentId,
      p_subtopic_id: subtopic_id,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ scope: "concept", subtopic_id, trend: data ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-mastery-history error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
