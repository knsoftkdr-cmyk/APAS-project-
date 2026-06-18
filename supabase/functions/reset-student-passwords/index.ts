import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Resets every student's auth password to their DOB in DDMMYYYY format.
// Also ensures their auth email is "<roll_number>@student.apas.local" so login works.
// Only callable by admin / school_admin.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is admin
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "school_admin"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const targetRollNumber: string | undefined = body?.roll_number;

    let query = supabaseAdmin
      .from("students")
      .select("id, profile_id, roll_number, date_of_birth");
    if (targetRollNumber) query = query.ilike("roll_number", targetRollNumber);

    const { data: students, error } = await query;
    if (error) throw error;

    const dobToPassword = (dob: string | null | undefined): string | null => {
      if (!dob) return null;
      const m = String(dob).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      return `${m[3]}${m[2]}${m[1]}`;
    };

    const results: any[] = [];
    for (const s of students ?? []) {
      if (!s.roll_number || !s.date_of_birth) {
        results.push({ id: s.id, roll: s.roll_number, success: false, error: "missing roll/DOB" });
        continue;
      }
      const password = dobToPassword(s.date_of_birth);
      if (!password) {
        results.push({ id: s.id, roll: s.roll_number, success: false, error: "bad DOB format" });
        continue;
      }
      const newEmail = `${s.roll_number.trim().toLowerCase()}@student.apas.local`;
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
        s.profile_id,
        { email: newEmail, password, email_confirm: true }
      );
      if (updErr) {
        results.push({ id: s.id, roll: s.roll_number, success: false, error: updErr.message });
      } else {
        results.push({ id: s.id, roll: s.roll_number, success: true, loginId: s.roll_number, password });
      }
    }

    return new Response(JSON.stringify({ count: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
