// supabase/functions/get-prerequisite-readiness/index.ts
//
// Deploy with:
//   supabase functions deploy get-prerequisite-readiness
//
// Body: { subtopic_id, student_id? }
// Students: student_id is resolved from their own profile (any value they
// pass is ignored). Staff: may pass student_id explicitly.
//
// Returns each direct prerequisite's current mastery for that student and an
// overall readiness score/flag — call this before assigning or recommending
// a concept to check whether its prerequisites are actually in place.

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
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStaff = ["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role);
    const { subtopic_id, student_id } = await req.json();
    if (!subtopic_id) {
      return new Response(JSON.stringify({ error: "subtopic_id is required" }), {
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

    const { data, error } = await supabaseClient.rpc("get_prerequisite_readiness", {
      p_student_id: targetStudentId,
      p_subtopic_id: subtopic_id,
    });
    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-prerequisite-readiness error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
