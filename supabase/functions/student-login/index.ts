import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeStudentId = (value: string | null | undefined) =>
  String(value || "").trim().toLowerCase();

const dobToPassword = (dob: string | null | undefined): string | null => {
  if (!dob) return null;
  const match = String(dob).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[3]}${match[2]}${match[1]}`;
};

const errorResponse = (message: string) =>
  new Response(JSON.stringify({ success: false, error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { studentId, password } = await req.json();
    const normalizedStudentId = normalizeStudentId(studentId);
    const providedPassword = String(password || "").trim();

    if (!normalizedStudentId || !providedPassword) {
      return new Response(JSON.stringify({ error: "Student ID and password are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    let { data: student, error: studentError } = await supabaseAdmin
      .from("students")
      .select("profile_id, date_of_birth, roll_number")
      .ilike("roll_number", normalizedStudentId)
      .maybeSingle();

    if (studentError) throw studentError;

    // Fallback: registered students may not have a roll_number row yet.
    // Look them up by their canonical auth email (studentId@student.apas.local).
    if (!student?.profile_id) {
      const canonicalEmail = `${normalizedStudentId}@student.apas.local`;
      const { data: usersList, error: listError } =
        await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (listError) throw listError;
      const matchedUser = usersList.users.find(
        (u) => (u.email || "").toLowerCase() === canonicalEmail,
      );
      if (matchedUser) {
        const { data: studentByProfile } = await supabaseAdmin
          .from("students")
          .select("profile_id, date_of_birth, roll_number")
          .eq("profile_id", matchedUser.id)
          .maybeSingle();
        student = studentByProfile ?? {
          profile_id: matchedUser.id,
          date_of_birth: null,
          roll_number: normalizedStudentId,
        };
      }
    }

    if (!student?.profile_id) {
      return errorResponse(`Student ID "${studentId}" not found. Please check your Student ID.`);
    }

    const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(student.profile_id);
    if (authUserError) throw authUserError;

    const currentEmail = authUserData.user?.email;
    const desiredEmail = `${normalizedStudentId}@student.apas.local`;
    const expectedDobPassword = dobToPassword(student.date_of_birth);

    // Attempt 1: try the provided password against the current (existing) email
    if (currentEmail) {
      const { data: existingLogin, error: existingLoginError } = await supabaseAnon.auth.signInWithPassword({
        email: currentEmail,
        password: providedPassword,
      });

      if (!existingLoginError && existingLogin.session) {
        return new Response(JSON.stringify({ success: true, session: existingLogin.session, user: existingLogin.user }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Attempt 2: try the provided password against the desired (canonical) email
    if (currentEmail !== desiredEmail) {
      const { data: desiredLogin, error: desiredLoginError } = await supabaseAnon.auth.signInWithPassword({
        email: desiredEmail,
        password: providedPassword,
      });

      if (!desiredLoginError && desiredLogin.session) {
        return new Response(JSON.stringify({ success: true, session: desiredLogin.session, user: desiredLogin.user }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Attempt 3: if provided password matches DOB (DDMMYYYY), create a passwordless session
    // without overwriting the student's existing password.
    if (expectedDobPassword && providedPassword === expectedDobPassword && currentEmail) {
      const { data: magicLinkData, error: magicLinkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: currentEmail,
      });

      if (magicLinkError) throw magicLinkError;

      const tokenHash = magicLinkData.properties?.hashed_token;
      if (tokenHash) {
        const { data: otpLogin, error: otpLoginError } = await supabaseAnon.auth.verifyOtp({
          token_hash: tokenHash,
          type: "magiclink",
        });

        if (!otpLoginError && otpLogin.session) {
          return new Response(JSON.stringify({ success: true, session: otpLogin.session, user: otpLogin.user }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const hint = expectedDobPassword
      ? "Use your previous password, or your Date of Birth in DDMMYYYY format."
      : "Use the password set by your teacher/admin. (No Date of Birth on file for DOB login.)";
    return errorResponse(`Incorrect password for ${student.roll_number}. ${hint}`);
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
