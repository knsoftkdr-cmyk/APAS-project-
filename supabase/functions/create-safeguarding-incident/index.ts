// supabase/functions/create-safeguarding-incident/index.ts
//
// Deploy with:
//   supabase functions deploy create-safeguarding-incident
//
// Why an Edge Function instead of a direct client insert?
// - Lets us write to safeguarding_audit_log using the service role
//   (regular users have no insert policy on that table — see migration).
// - Centralizes validation so the UI can't be bypassed by a bad request.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IncidentPayload {
  student_id?: string | null;
  category: "physical" | "emotional" | "neglect" | "online" | "bullying" | "other";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client bound to the caller's JWT — used to check who is calling
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Admin client with service role — used to bypass RLS for the audit log write
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm the caller's role + school_id
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, school_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["admin", "school_admin", "principal", "super_admin", "teacher", "hod"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Not permitted to file a report" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: IncidentPayload = await req.json();

    if (!payload.category || !payload.severity || !payload.description?.trim()) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: incident, error: insertError } = await supabaseAdmin
      .from("safeguarding_incidents")
      .insert({
        school_id: profile.school_id,
        student_id: payload.student_id ?? null,
        category: payload.category,
        severity: payload.severity,
        description: payload.description.trim(),
        reported_by: profile.id,
        is_anonymous: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create incident" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.from("safeguarding_audit_log").insert({
      actor_id: profile.id,
      action: "created",
      record_type: "incident",
      record_id: incident.id,
    });

    return new Response(JSON.stringify({ incident }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Unexpected server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});