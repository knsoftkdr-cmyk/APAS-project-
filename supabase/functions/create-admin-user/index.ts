import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { email, password, full_name, role, school_id, class: studentClass, section, roll_number, date_of_birth, parent_phone } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("profiles").update({ full_name, role, ...(school_id ? { school_id } : {}) }).eq("id", data.user.id);

    if (role === "student") {
      const { error: studentError } = await admin.from("students").insert({
        profile_id: data.user.id,
        school_id,
        full_name,
        class: studentClass,
        section,
        roll_number,
        date_of_birth: date_of_birth || null,
        parent_phone: parent_phone || null,
      });
      if (studentError) {
        return new Response(JSON.stringify({ error: "User created but failed to save student details: " + studentError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ user: data.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
