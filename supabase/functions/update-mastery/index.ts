// supabase/functions/update-mastery/index.ts
//
// Deploy with:
//   supabase functions deploy update-mastery
//
// The single entry point every grading flow (MCQ engine, worksheet/homework
// evaluation, AI tutor, diagnostic assessment) should call after grading one
// question against one learning objective. Wraps record_mastery_evidence(),
// the atomic Bayesian Knowledge Tracing update in the DB.
//
// Body: { learning_objective_id, is_correct, source, source_id?, student_id? }
// - Students: student_id is resolved from their own profile; any student_id
//   they pass is ignored, so a student can never write another student's
//   mastery state.
// - Teachers/admins: may pass student_id explicitly (grading someone else's
//   submission).
//
// Can also be called as a batch: { items: [ {...}, {...} ] } to record
// several answers from one submission (e.g. a 10-question worksheet) in a
// single round trip.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EvidenceItem {
  learning_objective_id: number;
  is_correct: boolean;
  source: "mcq" | "homework" | "worksheet" | "ai_tutor" | "diagnostic" | "manual";
  source_id?: string | null;
  student_id?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStaff = ["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role);

    // Resolve the caller's own student_id (used when they're a student, and
    // as the fallback ownership check for anything they submit themselves)
    let ownStudentId: string | null = null;
    if (profile.role === "student") {
      const { data: studentRow } = await supabaseAdmin
        .from("students").select("id").eq("profile_id", user.id).single();
      ownStudentId = studentRow?.id ?? null;
      if (!ownStudentId) {
        return new Response(JSON.stringify({ error: "Student record not found" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json();
    const items: EvidenceItem[] = Array.isArray(body.items) ? body.items : [body];

    if (items.length === 0) {
      return new Response(JSON.stringify({ error: "No evidence items provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown>[] = [];

    for (const item of items) {
      if (!item.learning_objective_id || typeof item.is_correct !== "boolean" || !item.source) {
        results.push({ error: "learning_objective_id, is_correct and source are required", item });
        continue;
      }

      const studentId = isStaff && item.student_id ? item.student_id : ownStudentId;
      if (!studentId) {
        results.push({ error: "Could not resolve student_id", item });
        continue;
      }

      const { data, error } = await supabaseClient.rpc("record_mastery_evidence", {
        p_student_id: studentId,
        p_learning_objective_id: item.learning_objective_id,
        p_is_correct: item.is_correct,
        p_source: item.source,
        p_source_id: item.source_id ?? null,
      });

      if (error) {
        results.push({ error: error.message, item });
        continue;
      }

      const row = Array.isArray(data) ? data[0] : data;
      results.push({
        student_id: studentId,
        learning_objective_id: item.learning_objective_id,
        p_mastery_before: row?.p_mastery_before,
        p_mastery_after: row?.p_mastery_after,
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("update-mastery error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
