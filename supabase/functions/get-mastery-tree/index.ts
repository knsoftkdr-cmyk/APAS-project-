// supabase/functions/get-mastery-tree/index.ts
//
// Deploy with:
//   supabase functions deploy get-mastery-tree
//
// Returns the nested subject -> chapter -> topic -> concept -> objective
// mastery tree for one student, via the get_student_mastery_tree() SQL
// rollup. Students may only fetch their own tree; teachers/admins may fetch
// any student's tree by passing student_id explicitly.
//
// Body: { student_id?: string, book_id?: number }

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
    const { student_id, book_id } = await req.json().catch(() => ({}));

    let targetStudentId: string | null = null;

    if (profile.role === "student") {
      const { data: studentRow } = await supabaseAdmin
        .from("students").select("id").eq("profile_id", user.id).single();
      targetStudentId = studentRow?.id ?? null;
    } else if (isStaff) {
      if (!student_id) {
        return new Response(JSON.stringify({ error: "student_id is required for staff requests" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetStudentId = student_id;
    } else {
      return new Response(JSON.stringify({ error: "Not permitted" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetStudentId) {
      return new Response(JSON.stringify({ error: "Student record not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabaseClient.rpc("get_student_mastery_tree", {
      p_student_id: targetStudentId,
      p_book_id: book_id ?? null,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ student_id: targetStudentId, subjects: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-mastery-tree error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
