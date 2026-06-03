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

    await admin.from("profiles").update({
      full_name,
      role,
      ...(school_id ? { school_id } : {}),
    }).eq("id", data.user.id);

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
        return new Response(JSON.stringify({ error: "Failed to save student details: " + studentError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: studentRow } = await admin
        .from("students")
        .select("id")
        .eq("profile_id", data.user.id)
        .single();

      console.log("studentClass:", studentClass, "section:", section);

      // List all classes to debug
      const { data: allClasses } = await admin.from("classes").select("id, name, section");
      console.log("all classes:", JSON.stringify(allClasses));

      const classRow = allClasses?.find(
        (c: any) => c.name.toLowerCase().includes(String(studentClass).toLowerCase()) && c.section === section
      );

      console.log("matched classRow:", JSON.stringify(classRow));

      if (studentRow && classRow) {
        const { error: csError } = await admin.from("class_students").insert({
          class_id: classRow.id,
          student_id: studentRow.id,
        });
        console.log("class_students insert error:", csError?.message);

        const { data: teacherRow } = await admin
          .from("class_teachers")
          .select("teacher_id, profiles:teacher_id(full_name)")
          .eq("class_id", classRow.id)
          .limit(1)
          .maybeSingle();

        await admin.from("students")
          .update({ assigned_teacher: (teacherRow as any)?.profiles?.full_name ?? null })
          .eq("id", studentRow.id);
      } else {
        console.log("No class match found for studentClass:", studentClass, "section:", section);
      }
    }

    return new Response(JSON.stringify({ user: data.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log("CATCH ERROR:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});