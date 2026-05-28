import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const { students, mode } = await req.json();

    // Mode: "import" — bulk create auth users (triggers profile + student auto-creation), then update student details
    if (mode === "import") {
      const results: any[] = [];

      const dobToPassword = (dob: string | null | undefined): string | null => {
        if (!dob) return null;
        const m = String(dob).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        return `${m[3]}${m[2]}${m[1]}`;
      };

      const normalizeStudentId = (value: string | null | undefined) =>
        String(value || "").trim().toLowerCase();

      for (const s of students) {
        const studentIdRaw = normalizeStudentId(s.roll_number);
        if (!studentIdRaw) {
          results.push({
            rowNum: s.rowNum,
            success: false,
            error: "Student ID is required to create a login",
          });
          continue;
        }

        const loginEmail = `${studentIdRaw}@student.apas.local`;
        const dobPassword = dobToPassword(s.date_of_birth);
        if (!dobPassword) {
          results.push({
            rowNum: s.rowNum,
            success: false,
            error: "Valid Date of Birth is required to generate a password",
          });
          continue;
        }

        const { data: existingStudent, error: existingStudentError } = await supabaseAdmin
          .from("students")
          .select("id, profile_id")
          .ilike("roll_number", s.roll_number || "")
          .maybeSingle();

        if (existingStudentError) {
          results.push({
            rowNum: s.rowNum,
            success: false,
            error: existingStudentError.message,
          });
          continue;
        }

        let userId = existingStudent?.profile_id;
        let studentId = existingStudent?.id;

        if (userId) {
          const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            email: loginEmail,
            email_confirm: true,
            user_metadata: {
              full_name: s.student_name,
              role: "student",
              class: s.class || null,
            },
          });

          if (updateAuthError) {
            results.push({
              rowNum: s.rowNum,
              success: false,
              error: updateAuthError.message,
            });
            continue;
          }
        } else {
          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: loginEmail,
            password: dobPassword,
            email_confirm: true,
            user_metadata: {
              full_name: s.student_name,
              role: "student",
              class: s.class || null,
            },
          });

          if (authError) {
            results.push({
              rowNum: s.rowNum,
              success: false,
              error: authError.message,
            });
            continue;
          }

          userId = authData.user.id;
        }

        const { error: profileError } = await supabaseAdmin
          .from("profiles")
          .update({ full_name: s.student_name || null, role: "student" })
          .eq("id", userId);

        if (profileError) {
          results.push({
            rowNum: s.rowNum,
            success: false,
            error: profileError.message,
          });
          continue;
        }

        const studentPayload = {
          roll_number: s.roll_number || null,
          parent_phone: s.parent_phone || null,
          parent_email: s.parent_email || null,
          grade: s.class || null,
          date_of_birth: s.date_of_birth || null,
          profile_id: userId,
        };

        if (studentId) {
          const { error: updateStudentError } = await supabaseAdmin
            .from("students")
            .update(studentPayload)
            .eq("id", studentId);

          if (updateStudentError) {
            results.push({
              rowNum: s.rowNum,
              success: false,
              error: updateStudentError.message,
            });
            continue;
          }
        } else {
          const { data: insertedStudent, error: insertError } = await supabaseAdmin
            .from("students")
            .insert(studentPayload)
            .select("id")
            .single();

          if (insertError) {
            results.push({
              rowNum: s.rowNum,
              success: false,
              error: insertError.message,
            });
            continue;
          }

          studentId = insertedStudent.id;
        }

        results.push({
          rowNum: s.rowNum,
          success: true,
          studentId,
          profileId: userId,
          loginId: studentIdRaw,
          password: dobPassword,
        });
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Legacy mode: create auth users
    const results: any[] = [];
    for (const s of students) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: s.email,
        password: s.password,
        email_confirm: true,
        user_metadata: { full_name: s.name, role: "student" },
      });
      results.push({
        id: s.id,
        name: s.name,
        success: !error,
        error: error?.message || null,
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
