// supabase/functions/root-cause-analysis/index.ts
//
// Deploy with:
//   supabase functions deploy root-cause-analysis
//
// Body: { student_id?, learning_objective_id }
// Students: student_id is resolved from their own profile (any value they
// pass is ignored). Staff: may pass student_id explicitly.
//
// Combines get_root_cause_analysis_core() (prerequisite_gap, misconception,
// difficulty_mismatch, practice_deficiency - all computable from tracked
// schema) with a fifth cause, attendance, fetched here via calculate_
// attendance_risk exactly the way AttendanceRiskView.tsx already calls it.
// That RPC isn't defined in this repo's migrations, so its exact return
// shape can't be verified from SQL - calling it through the JS client (which
// doesn't care about the underlying Postgres type) and handling failure
// gracefully is safer than guessing at its shape inside a DB function that
// four other, verifiable causes also depend on.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STRENGTH_ORDER: Record<string, number> = { strong: 0, moderate: 1, weak: 1.5, none: 2, unavailable: 3 };

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
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStaff = ["admin", "teacher", "school_admin", "principal", "hod"].includes(profile.role);
    const { student_id, learning_objective_id } = await req.json().catch(() => ({}));
    if (!learning_objective_id) {
      return new Response(JSON.stringify({ error: "learning_objective_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetStudentId: string | null = null;
    if (profile.role === "student") {
      const { data: studentRow } = await supabaseAdmin.from("students").select("id").eq("profile_id", user.id).single();
      targetStudentId = studentRow?.id ?? null;
    } else if (isStaff) {
      if (!student_id) {
        return new Response(JSON.stringify({ error: "student_id is required for staff requests" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetStudentId = student_id;
    } else {
      return new Response(JSON.stringify({ error: "Not permitted" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetStudentId) {
      return new Response(JSON.stringify({ error: "Student record not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── The four schema-verifiable causes ─────────────────────────────────
    const { data: core, error: coreError } = await supabaseClient.rpc("get_root_cause_analysis_core", {
      p_student_id: targetStudentId,
      p_learning_objective_id: learning_objective_id,
    });
    if (coreError) throw coreError;
    if (core?.error) {
      return new Response(JSON.stringify({ error: core.error }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const causes: Array<Record<string, unknown>> = Array.isArray(core.causes) ? core.causes : [];

    // ── Fifth cause: attendance, best-effort ────────────────────────────────
    let attendanceCause: Record<string, unknown>;
    try {
      const { data: studentRow } = await supabaseAdmin.from("students").select("school_id").eq("id", targetStudentId).single();
      const schoolId = studentRow?.school_id;
      if (!schoolId) throw new Error("no_school_id");

      const { data: riskRows, error: riskError } = await supabaseClient.rpc("calculate_attendance_risk", {
        p_school_id: schoolId,
        p_class_ids: null,
      });
      if (riskError) throw riskError;

      const row = (riskRows as Array<Record<string, unknown>> ?? []).find((r) => r.student_id === targetStudentId);
      if (!row) {
        attendanceCause = {
          cause_type: "attendance",
          evidence_strength: "unavailable",
          explanation: "No attendance record found for this student.",
        };
      } else {
        const riskLevel = row.risk_level as string;
        const strength = riskLevel === "high" ? "strong" : riskLevel === "medium" ? "moderate" : "none";
        attendanceCause = {
          cause_type: "attendance",
          evidence_strength: strength,
          explanation: strength === "none"
            ? `Attendance is steady (${row.last_30_pct}% over the last 30 days) — unlikely to be a factor here`
            : `Attendance has been ${riskLevel} risk (${row.last_30_pct}% over the last 30 days, trend: ${row.trend}) — missed class time may be contributing`,
          evidence: row,
        };
      }
    } catch (e) {
      console.error("attendance lookup failed (non-fatal)", e);
      attendanceCause = {
        cause_type: "attendance",
        evidence_strength: "unavailable",
        explanation: "Attendance data could not be retrieved for this analysis.",
      };
    }

    const allCauses = [...causes, attendanceCause].sort(
      (a, b) => (STRENGTH_ORDER[a.evidence_strength as string] ?? 9) - (STRENGTH_ORDER[b.evidence_strength as string] ?? 9),
    );
    const primary = allCauses.find((c) => c.evidence_strength === "strong")
      ?? allCauses.find((c) => c.evidence_strength === "moderate")
      ?? null;

    return new Response(JSON.stringify({
      student_id: targetStudentId,
      learning_objective_id: core.learning_objective_id,
      objective_text: core.objective_text,
      subtopic_name: core.subtopic_name,
      topic_name: core.topic_name,
      chapter_name: core.chapter_name,
      subject: core.subject,
      primary_cause: primary,
      causes: allCauses,
      generated_at: core.generated_at,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("root-cause-analysis error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
