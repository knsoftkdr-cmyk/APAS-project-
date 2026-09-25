// supabase/functions/get-class-risk-roster/index.ts
//
// Deploy with:
//   supabase functions deploy get-class-risk-roster
//
// Teacher/admin only. Body: { class_id: string }
//
// Runs get_class_risk_roster() (academic_decline, disengagement,
// stalled_progress) for every student on the roster, then fetches
// attendance for the whole class in ONE calculate_attendance_risk call
// (same RPC AttendanceRiskView.tsx and root-cause-analysis already use)
// and merges it in per student, so a teacher can see their whole class
// ranked by composite early-warning risk in a single request.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STRENGTH_ORDER: Record<string, number> = { strong: 0, moderate: 1, none: 2, insufficient_data: 3, unavailable: 4 };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Not permitted" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { class_id } = await req.json();
    if (!class_id) {
      return new Response(JSON.stringify({ error: "class_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.role === "teacher") {
      const { data: assignment } = await supabaseAdmin
        .from("class_teachers").select("id").eq("class_id", class_id).eq("teacher_id", user.id).maybeSingle();
      if (!assignment) {
        return new Response(JSON.stringify({ error: "You are not assigned to this class" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: roster, error: rosterError } = await supabaseAdmin
      .from("class_students").select("student_id").eq("class_id", class_id);
    if (rosterError) throw rosterError;

    const studentIds = (roster ?? []).map((r) => r.student_id);
    if (studentIds.length === 0) {
      return new Response(JSON.stringify({ class_id, students: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: names }, { data: classRow }, { data: coreRows, error: coreError }] = await Promise.all([
      supabaseAdmin.from("students").select("id, full_name").in("id", studentIds),
      supabaseAdmin.from("classes").select("school_id").eq("id", class_id).single(),
      supabaseClient.rpc("get_class_risk_roster", { p_student_ids: studentIds }),
    ]);
    if (coreError) throw coreError;

    const nameById = new Map((names ?? []).map((n) => [n.id, n.full_name as string]));

    // ── Attendance for the whole class in one shot ──────────────────────
    let attendanceById = new Map<string, Record<string, unknown>>();
    try {
      const schoolId = classRow?.school_id;
      if (!schoolId) throw new Error("no_school_id");
      const { data: riskRows, error: riskError } = await supabaseClient.rpc("calculate_attendance_risk", {
        p_school_id: schoolId,
        p_class_ids: [class_id],
      });
      if (riskError) throw riskError;
      attendanceById = new Map((riskRows as Array<Record<string, unknown>> ?? []).map((r) => [r.student_id as string, r]));
    } catch (e) {
      console.error("class attendance lookup failed (non-fatal)", e);
    }

    const students = (coreRows as Array<Record<string, unknown>> ?? []).map((core) => {
      const sid = core.student_id as string;
      const causes: Array<Record<string, unknown>> = Array.isArray(core.causes) ? core.causes : [];

      const attRow = attendanceById.get(sid);
      let attendanceCause: Record<string, unknown>;
      if (!attRow) {
        attendanceCause = { cause_type: "chronic_absenteeism", evidence_strength: "unavailable", explanation: "No attendance record found." };
      } else {
        const riskLevel = attRow.risk_level as string;
        const strength = riskLevel === "high" ? "strong" : riskLevel === "medium" ? "moderate" : "none";
        attendanceCause = {
          cause_type: "chronic_absenteeism",
          evidence_strength: strength,
          explanation: strength === "none"
            ? `Attendance steady (${attRow.last_30_pct}% last 30 days)`
            : `Attendance ${riskLevel} risk (${attRow.last_30_pct}% last 30 days, trend: ${attRow.trend})`,
          evidence: attRow,
        };
      }

      const allCauses = [...causes, attendanceCause].sort(
        (a, b) => (STRENGTH_ORDER[a.evidence_strength as string] ?? 9) - (STRENGTH_ORDER[b.evidence_strength as string] ?? 9),
      );
      const strongCauses = allCauses.filter((c) => c.evidence_strength === "strong");
      const moderateCauses = allCauses.filter((c) => c.evidence_strength === "moderate");
      const knownCauses = allCauses.filter((c) => !["insufficient_data", "unavailable"].includes(c.evidence_strength as string));
      const overallRiskLevel = strongCauses.length > 0 ? "high" : moderateCauses.length > 0 ? "medium" : knownCauses.length > 0 ? "low" : "insufficient_data";
      const primaryCause = strongCauses[0] ?? moderateCauses[0] ?? null;

      return {
        student_id: sid,
        full_name: nameById.get(sid) ?? "Student",
        overall_risk_level: overallRiskLevel,
        primary_cause: primaryCause,
        causes: allCauses,
      };
    }).sort((a, b) => STRENGTH_ORDER[a.overall_risk_level === "high" ? "strong" : a.overall_risk_level === "medium" ? "moderate" : a.overall_risk_level === "low" ? "none" : "insufficient_data"]
      - STRENGTH_ORDER[b.overall_risk_level === "high" ? "strong" : b.overall_risk_level === "medium" ? "moderate" : b.overall_risk_level === "low" ? "none" : "insufficient_data"]);

    return new Response(JSON.stringify({ class_id, roster_size: studentIds.length, students }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-class-risk-roster error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
