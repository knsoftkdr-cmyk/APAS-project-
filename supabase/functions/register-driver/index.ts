import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, password, full_name } = await req.json();

    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ error: "email, password, and full_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Identify the caller and their school, and confirm they're allowed to create drivers
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");
    if (!callerToken) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("school_id, role")
      .eq("id", callerData.user.id)
      .single();

    const allowedCallerRoles = ["school_admin", "admin", "principal", "knsoft_admin"];
    if (!callerProfile?.school_id || !allowedCallerRoles.includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: "Not authorized to create driver accounts" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerSchoolId = callerProfile.school_id;

    // Create the auth user (does NOT affect the caller's own session — service role client)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // drivers log in with a school-issued password, no email verification flow needed
      user_metadata: { full_name, role: "driver" },
    });

    if (error) {
      const isDuplicate = /already.*registered|already exists|duplicate/i.test(error.message);
      return new Response(
        JSON.stringify({
          error: isDuplicate ? "This email is already registered." : error.message,
          code: isDuplicate ? "user_already_exists" : undefined,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // handle_new_user() trigger already inserted a profiles row with role from metadata,
    // but it doesn't set school_id — patch that in now via the service-role client.
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ school_id: callerSchoolId, role: "driver", full_name })
      .eq("id", data.user!.id);

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: `User created but profile setup failed: ${updateErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ user_id: data.user!.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});