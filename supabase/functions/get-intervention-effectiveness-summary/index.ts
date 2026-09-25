// supabase/functions/get-intervention-effectiveness-summary/index.ts
//
// Deploy with:
//   supabase functions deploy get-intervention-effectiveness-summary
//
// INTERVENTION EFFECTIVENESS TRACKING (module 15)
// "Checks whether an intervention actually improved the student's outcome."
//
// This is the aggregate half of module 15. The per-intervention half (the
// baseline/follow-up snapshot and improved/no_change/worsened verdict) is
// computed entirely in Postgres by triggers on student_interventions - see
// 20260926000000_intervention_effectiveness_engine.sql - so every existing
// `.select("*")` on that table (InterventionDrawer's history list included)
// already returns baseline_metrics / followup_metrics / effectiveness for
// free, with no new fetch required.
//
// What this function adds is the roll-up: which actions, tiers and
// priorities actually correlate with "improved" outcomes, scoped to what
// the caller is allowed to see - a teacher's own interventions, or a
// school-wide view for hod/principal/school_admin/admin. This replaces the
// raw `status = 'completed'` proxy SchoolBenchmarking.tsx and the
// executive-report edge function currently use for "intervention success".
//
// Body: { class_id?: string }
//   - teacher                          -> scoped to their own interventions
//                                         (optionally further narrowed to a
//                                         class they're assigned to)
//   - hod/principal/school_admin/admin -> scoped to their whole school
//                                         (optionally narrowed to any class
//                                         in that school)
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

    const { data: profile } = await supabaseAdmin.from("profiles").select("role, school_id").eq("id", user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSchoolWide = ["hod", "principal", "school_admin", "admin", "knsoft_admin"].includes(profile.role);
    const isTeacher = profile.role === "teacher";
    if (!isSchoolWide && !isTeacher) {
      return new Response(JSON.stringify({ error: "Not permitted" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { class_id } = await req.json().catch(() => ({}));

    // A teacher narrowing to a class must actually be assigned to it; a
    // school-wide viewer just needs the class to belong to their own school
    // (matches the same check get-intervention-recommendations already does).
    if (class_id) {
      if (isTeacher) {
        const { data: assignment } = await supabaseAdmin
          .from("class_teachers").select("id").eq("class_id", class_id).eq("teacher_id", user.id).maybeSingle();
        if (!assignment) {
          return new Response(JSON.stringify({ error: "You are not assigned to this class" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const { data: classRow } = await supabaseAdmin.from("classes").select("school_id").eq("id", class_id).single();
        if (!classRow || classRow.school_id !== profile.school_id) {
          return new Response(JSON.stringify({ error: "Class not found in your school" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const rpcArgs = {
      p_teacher_id: isTeacher ? user.id : null,
      p_school_id: isSchoolWide ? profile.school_id : null,
      p_class_id: class_id ?? null,
    };

    const { data, error } = await supabaseClient.rpc("get_intervention_effectiveness_summary", rpcArgs);
    if (error) throw error;

    return new Response(JSON.stringify({ scope: isTeacher ? "teacher" : "school", class_id: class_id ?? null, ...data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-intervention-effectiveness-summary error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
