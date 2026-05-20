import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, password, full_name, role } = await req.json();

    if (!["teacher", "school_admin"].includes(role)) {
      return new Response(
        JSON.stringify({ error: "This endpoint is only for teacher/admin registration" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 🔧 1. Create the user profile with email_confirm set to false
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false, 
      user_metadata: { full_name, role },
    });

    if (error) {
      const isDuplicate = /already.*registered|already exists|duplicate/i.test(error.message);
      return new Response(
        JSON.stringify({
          error: isDuplicate
            ? `This email is already registered. Please sign in instead.`
            : error.message,
          code: isDuplicate ? "user_already_exists" : undefined,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 🚀 2. Trigger the automated verification invitation link via your Resend SMTP setup
    if (data?.user?.email) {
      const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.user.email, {
        redirectTo: "http://localhost:5173/login"
      });
      
      if (inviteError) {
        console.error("SMTP Mailer Delivery Error:", inviteError.message);
      }
    }

    return new Response(
      JSON.stringify({ user: data.user }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});