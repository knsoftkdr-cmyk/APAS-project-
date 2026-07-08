import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transfer_id, decision } = await req.json();

    if (!transfer_id || !["approved", "rejected"].includes(decision)) {
      return new Response(
        JSON.stringify({ error: "transfer_id and decision ('approved' | 'rejected') are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client scoped to the caller, to verify identity + role
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client for the actual writes
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("id, role, school_id")
      .eq("id", user.id)
      .single();

    if (callerProfileError || !callerProfile || callerProfile.role !== "principal") {
      return new Response(JSON.stringify({ error: "Only principals can approve or reject transfers" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: transfer, error: transferError } = await admin
      .from("student_transfers")
      .select("*")
      .eq("id", transfer_id)
      .single();

    if (transferError || !transfer) {
      return new Response(JSON.stringify({ error: "Transfer request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (transfer.status !== "pending_review") {
      return new Response(
        JSON.stringify({ error: `Transfer is already '${transfer.status}', cannot re-process` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Principal must belong to either the from-school or to-school
    const relevantSchools = [transfer.from_school_id, transfer.to_school_id].filter(Boolean);
    if (!relevantSchools.includes(callerProfile.school_id)) {
      return new Response(
        JSON.stringify({ error: "You are not authorized to act on this transfer" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (decision === "rejected") {
      const { error: updateError } = await admin
        .from("student_transfers")
        .update({
          status: "rejected",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", transfer_id);

      if (updateError) throw updateError;

      return new Response(JSON.stringify({ success: true, status: "rejected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // decision === "approved" — execute the actual transfer logic
    if (transfer.transfer_type === "internal") {
      if (!transfer.to_school_id) {
        return new Response(
          JSON.stringify({ error: "Internal transfer is missing to_school_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({
          school_id: transfer.to_school_id,
        })
        .eq("id", transfer.student_id);

      if (profileUpdateError) throw profileUpdateError;

      // Update class/section on the students table if new values were given
      if (transfer.new_class || transfer.new_section) {
        const studentUpdate: Record<string, string> = {};
        if (transfer.new_class) studentUpdate.class = transfer.new_class;
        if (transfer.new_section) studentUpdate.section = transfer.new_section;

        const { error: studentUpdateError } = await admin
          .from("students")
          .update(studentUpdate)
          .eq("id", transfer.student_id);

        if (studentUpdateError) throw studentUpdateError;
      }

      // No class_teachers cleanup needed — that table links teachers to classes/subjects,
      // not students. Once the student's class/section is updated above, they'll naturally
      // resolve to the new school's teachers via the existing .ilike() class-name matching,
      // with no per-student association to clean up.

      await admin.from("student_lifecycle_events").insert({
        student_id: transfer.student_id,
        school_id: transfer.to_school_id,
        event_type: "transfer_internal",
        event_date: transfer.transfer_date,
        details: {
          from_school_id: transfer.from_school_id,
          to_school_id: transfer.to_school_id,
          new_class: transfer.new_class,
          new_section: transfer.new_section,
          reason: transfer.reason,
        },
        created_by: user.id,
      });
    } else if (transfer.transfer_type === "external_out") {
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({ status: "transferred_out" })
        .eq("id", transfer.student_id);

      if (profileUpdateError) throw profileUpdateError;

      await admin.from("student_lifecycle_events").insert({
        student_id: transfer.student_id,
        school_id: transfer.from_school_id,
        event_type: "transfer_external_out",
        event_date: transfer.transfer_date,
        details: {
          new_school_name: transfer.new_school_name,
          reason: transfer.reason,
        },
        created_by: user.id,
      });
    } else if (transfer.transfer_type === "external_in") {
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({ status: "active" })
        .eq("id", transfer.student_id);

      if (profileUpdateError) throw profileUpdateError;

      await admin.from("student_lifecycle_events").insert({
        student_id: transfer.student_id,
        school_id: transfer.to_school_id,
        event_type: "transfer_external_in",
        event_date: transfer.transfer_date,
        details: {
          previous_school_name: transfer.previous_school_name,
          reason: transfer.reason,
        },
        created_by: user.id,
      });
    }

    const { error: finalUpdateError } = await admin
      .from("student_transfers")
      .update({
        status: "completed",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", transfer_id);

    if (finalUpdateError) throw finalUpdateError;

    return new Response(JSON.stringify({ success: true, status: "completed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("approve-transfer error:", err);
    return new Response(JSON.stringify({ error: err.message ?? "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});