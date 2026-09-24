// supabase/functions/get-class-forgetting-risk/index.ts
//
// Deploy with:
//   supabase functions deploy get-class-forgetting-risk
//
// Teacher/admin only. Aggregates every student in a class's roster
// (class_students) against one subject/book and flags topics where many
// students are about to forget them, via get_class_forgetting_risk().
// Mirrors get-class-mastery's roster resolution exactly.
//
// Body: { class_id, book_id, threshold?, horizon_days? }

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
      return new Response(JSON.stringify({ error: "Not permitted" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { class_id, book_id, threshold, horizon_days } = await req.json().catch(() => ({}));
    if (!class_id || !book_id) {
      return new Response(JSON.stringify({ error: "class_id and book_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Teachers may only pull classes they're assigned to; admins/principal/hod see any class.
    if (profile.role === "teacher") {
      const { data: assignment } = await supabaseAdmin
        .from("class_teachers")
        .select("id").eq("class_id", class_id).eq("teacher_id", user.id).maybeSingle();
      if (!assignment) {
        return new Response(JSON.stringify({ error: "You are not assigned to this class" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: roster, error: rosterError } = await supabaseAdmin
      .from("class_students").select("student_id").eq("class_id", class_id);
    if (rosterError) throw rosterError;

    const studentIds = (roster ?? []).map((r) => r.student_id);
    if (studentIds.length === 0) {
      return new Response(JSON.stringify({ class_id, book_id, topics: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseClient.rpc("get_class_forgetting_risk", {
      p_student_ids: studentIds,
      p_book_id: book_id,
      p_threshold: threshold ?? 0.5,
      p_horizon_days: horizon_days ?? 14,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ class_id, book_id, roster_size: studentIds.length, topics: data ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-class-forgetting-risk error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
