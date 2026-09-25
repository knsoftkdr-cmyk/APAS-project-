// supabase/functions/get-intervention-recommendations/index.ts
//
// Deploy with:
//   supabase functions deploy get-intervention-recommendations
//
// INTERVENTION RECOMMENDATION ENGINE (module 14)
// "Suggests remedial lesson, extra practice, teacher intervention, parent
//  communication or counselling."
//
// This engine adds NO new tables or SQL functions - it's a deterministic
// decision-table layer on top of module 13's already-computed causes
// (get_student_risk_core / get_class_risk_roster + the same
// calculate_attendance_risk merge root-cause-analysis and
// get-student-risk-profile already do). Given those four causes
// (academic_decline, disengagement, stalled_progress, chronic_absenteeism)
// with their evidence_strength, deriveRecommendations() below maps them to
// one or more concrete intervention types a teacher can act on immediately
// via the existing InterventionDrawer (student_interventions table) - see
// suggested_tier / suggested_priority / suggested_action_plan below, which
// map 1:1 onto that drawer's own props and PRESET_ACTIONS.
//
// Body (single student): { student_id?: string }
// Body (class roster):   { class_id: string }
// (Same auth rules as get-student-risk-profile / get-class-risk-roster.)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STRENGTH_ORDER: Record<string, number> = { strong: 0, moderate: 1, none: 2, insufficient_data: 3, unavailable: 4 };

type Strength = "strong" | "moderate" | "none" | "insufficient_data" | "unavailable";
interface Cause { cause_type: string; evidence_strength: Strength; explanation: string; evidence?: Record<string, unknown> }
type InterventionType = "remedial_lesson" | "extra_practice" | "teacher_intervention" | "parent_communication" | "counselling";
type Priority = "low" | "medium" | "high";

interface Recommendation {
  type: InterventionType;
  priority: Priority;
  reason: string;
  suggested_actions: string[]; // matches InterventionDrawer's PRESET_ACTIONS where possible
}

const ACTIONS_BY_TYPE: Record<InterventionType, string[]> = {
  remedial_lesson: ["Provide Remedial Worksheets", "One-to-One Support"],
  extra_practice: ["Extra Practice"],
  teacher_intervention: ["Meet Student", "Weekly Monitoring"],
  parent_communication: ["Call Parents"],
  counselling: ["Counselling"],
};

function strengthOf(causes: Cause[], type: string): Strength {
  return (causes.find((c) => c.cause_type === type)?.evidence_strength) ?? "insufficient_data";
}
function isAtLeastModerate(s: Strength) { return s === "strong" || s === "moderate"; }
function priorityOf(s: Strength): Priority { return s === "strong" ? "high" : "medium"; }

/**
 * The decision table. Deterministic and documented, exactly like module
 * 11's root-cause checklist - not a trained model. A student can receive
 * more than one recommendation (e.g. extra_practice AND parent_communication
 * at once); the caller sorts by priority.
 */
function deriveRecommendations(causes: Cause[]): Recommendation[] {
  const decline = strengthOf(causes, "academic_decline");
  const disengagement = strengthOf(causes, "disengagement");
  const stalled = strengthOf(causes, "stalled_progress");
  const attendance = strengthOf(causes, "chronic_absenteeism");

  const recs: Recommendation[] = [];

  // 1. Academic decline + stalled progress together -> the concept itself
  //    likely needs re-teaching, not just more of the same practice.
  if (isAtLeastModerate(decline) && isAtLeastModerate(stalled)) {
    recs.push({
      type: "remedial_lesson",
      priority: priorityOf(decline === "strong" || stalled === "strong" ? "strong" : "moderate"),
      reason: "Scores are slipping AND several concepts are progressing slowly - a sign the underlying concept needs re-teaching, not just more repetition.",
      suggested_actions: ACTIONS_BY_TYPE.remedial_lesson,
    });
  } else if (isAtLeastModerate(stalled)) {
    // 2. Stalled progress on its own -> more reps should close the gap.
    recs.push({
      type: "extra_practice",
      priority: priorityOf(stalled),
      reason: "Several concepts are taking far more attempts than expected to land, without an active drop in accuracy - extra guided practice should help it stick.",
      suggested_actions: ACTIONS_BY_TYPE.extra_practice,
    });
  } else if (isAtLeastModerate(decline)) {
    // 3. Decline without a stalled-progress pattern -> still worth a remedial pass.
    recs.push({
      type: "remedial_lesson",
      priority: priorityOf(decline),
      reason: "Correctness has dropped over the last two weeks - a short remedial pass on recent topics can catch it before it compounds.",
      suggested_actions: ACTIONS_BY_TYPE.remedial_lesson,
    });
  }

  // 4. Disengagement -> a direct teacher touchpoint, regardless of the above.
  if (isAtLeastModerate(disengagement)) {
    recs.push({
      type: "teacher_intervention",
      priority: priorityOf(disengagement),
      reason: disengagement === "strong"
        ? "Activity has gone quiet - a direct check-in is likely to surface what's going on before it becomes a bigger gap."
        : "Activity has noticeably slowed - worth a quick check-in to catch it early.",
      suggested_actions: ACTIONS_BY_TYPE.teacher_intervention,
    });
  }

  // 5. Chronic absenteeism -> the family needs to be looped in.
  if (isAtLeastModerate(attendance)) {
    recs.push({
      type: "parent_communication",
      priority: priorityOf(attendance),
      reason: "Attendance has been a risk factor recently - missed class time is likely compounding the other signals, and this usually needs a home conversation.",
      suggested_actions: ACTIONS_BY_TYPE.parent_communication,
    });
  }

  // 6. Compound breakdown across academics AND engagement/attendance ->
  //    counselling, on top of whatever else was already recommended above.
  //    This is deliberately a high bar: disengagement has to be strong, and
  //    it has to be paired with another strong signal, before pointing past
  //    academic fixes toward pastoral support.
  if (disengagement === "strong" && (decline === "strong" || attendance === "strong")) {
    recs.push({
      type: "counselling",
      priority: "high",
      reason: "Multiple signals are breaking down together (disengagement plus academic decline and/or attendance) - this pattern often has a cause beyond the classroom and is worth a counselling referral alongside the academic steps above.",
      suggested_actions: ACTIONS_BY_TYPE.counselling,
    });
  }

  return recs.sort((a, b) => (a.priority === "high" ? 0 : a.priority === "medium" ? 1 : 2) - (b.priority === "high" ? 0 : b.priority === "medium" ? 1 : 2));
}

function suggestedTier(recs: Recommendation[]): 2 | 3 {
  const strongCount = recs.filter((r) => r.priority === "high").length;
  return (recs.some((r) => r.type === "counselling") || strongCount >= 2) ? 3 : 2;
}
function suggestedPriority(recs: Recommendation[]): Priority {
  if (recs.some((r) => r.priority === "high")) return "high";
  if (recs.some((r) => r.priority === "medium")) return "medium";
  return "low";
}
function suggestedActionPlan(recs: Recommendation[]): string[] {
  return [...new Set(recs.flatMap((r) => r.suggested_actions))];
}

async function fetchAttendanceCause(
  supabaseClient: ReturnType<typeof createClient>,
  supabaseAdmin: ReturnType<typeof createClient>,
  studentId: string,
): Promise<Cause> {
  try {
    const { data: studentRow } = await supabaseAdmin.from("students").select("school_id").eq("id", studentId).single();
    const schoolId = studentRow?.school_id;
    if (!schoolId) throw new Error("no_school_id");
    const { data: riskRows, error } = await supabaseClient.rpc("calculate_attendance_risk", { p_school_id: schoolId, p_class_ids: null });
    if (error) throw error;
    const row = (riskRows as Array<Record<string, unknown>> ?? []).find((r) => r.student_id === studentId);
    if (!row) return { cause_type: "chronic_absenteeism", evidence_strength: "unavailable", explanation: "No attendance record found for this student." };
    const riskLevel = row.risk_level as string;
    const strength: Strength = riskLevel === "high" ? "strong" : riskLevel === "medium" ? "moderate" : "none";
    return {
      cause_type: "chronic_absenteeism",
      evidence_strength: strength,
      explanation: strength === "none"
        ? `Attendance is steady (${row.last_30_pct}% over the last 30 days).`
        : `Attendance has been ${riskLevel} risk (${row.last_30_pct}% over the last 30 days, trend: ${row.trend}).`,
      evidence: row,
    };
  } catch (e) {
    console.error("attendance lookup failed (non-fatal)", e);
    return { cause_type: "chronic_absenteeism", evidence_strength: "unavailable", explanation: "Attendance data could not be retrieved." };
  }
}

function overallRiskLevel(causes: Cause[]): "high" | "medium" | "low" | "insufficient_data" {
  const strong = causes.some((c) => c.evidence_strength === "strong");
  const moderate = causes.some((c) => c.evidence_strength === "moderate");
  const known = causes.some((c) => !["insufficient_data", "unavailable"].includes(c.evidence_strength));
  return strong ? "high" : moderate ? "medium" : known ? "low" : "insufficient_data";
}

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
    const { student_id, class_id } = await req.json().catch(() => ({}));

    // ── Roster mode (staff only) ─────────────────────────────────────────
    if (class_id) {
      if (!isStaff) {
        return new Response(JSON.stringify({ error: "Not permitted" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        return new Response(JSON.stringify({ class_id, students: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const [{ data: names }, { data: classRow }, { data: coreRows, error: coreError }] = await Promise.all([
        supabaseAdmin.from("students").select("id, full_name").in("id", studentIds),
        supabaseAdmin.from("classes").select("school_id").eq("id", class_id).single(),
        supabaseClient.rpc("get_class_risk_roster", { p_student_ids: studentIds }),
      ]);
      if (coreError) throw coreError;
      const nameById = new Map((names ?? []).map((n) => [n.id, n.full_name as string]));

      let attendanceById = new Map<string, Cause>();
      try {
        const schoolId = classRow?.school_id;
        if (!schoolId) throw new Error("no_school_id");
        const { data: riskRows, error } = await supabaseClient.rpc("calculate_attendance_risk", { p_school_id: schoolId, p_class_ids: [class_id] });
        if (error) throw error;
        attendanceById = new Map((riskRows as Array<Record<string, unknown>> ?? []).map((r) => {
          const riskLevel = r.risk_level as string;
          const strength: Strength = riskLevel === "high" ? "strong" : riskLevel === "medium" ? "moderate" : "none";
          const cause: Cause = {
            cause_type: "chronic_absenteeism", evidence_strength: strength,
            explanation: strength === "none" ? `Attendance steady (${r.last_30_pct}% last 30 days).` : `Attendance ${riskLevel} risk (${r.last_30_pct}% last 30 days).`,
            evidence: r,
          };
          return [r.student_id as string, cause];
        }));
      } catch (e) {
        console.error("class attendance lookup failed (non-fatal)", e);
      }

      const students = (coreRows as Array<Record<string, unknown>> ?? []).map((core) => {
        const sid = core.student_id as string;
        const ledgerCauses: Cause[] = Array.isArray(core.causes) ? core.causes as Cause[] : [];
        const attendanceCause = attendanceById.get(sid) ?? { cause_type: "chronic_absenteeism", evidence_strength: "unavailable" as Strength, explanation: "No attendance record found." };
        const allCauses = [...ledgerCauses, attendanceCause].sort((a, b) => STRENGTH_ORDER[a.evidence_strength] - STRENGTH_ORDER[b.evidence_strength]);
        const recommendations = deriveRecommendations(allCauses);
        return {
          student_id: sid,
          full_name: nameById.get(sid) ?? "Student",
          overall_risk_level: overallRiskLevel(allCauses),
          recommended_interventions: recommendations,
          suggested_tier: suggestedTier(recommendations),
          suggested_priority: suggestedPriority(recommendations),
          suggested_action_plan: suggestedActionPlan(recommendations),
        };
      }).sort((a, b) => (b.recommended_interventions.length - a.recommended_interventions.length) || (STRENGTH_ORDER[a.overall_risk_level === "high" ? "strong" : a.overall_risk_level === "medium" ? "moderate" : "none"] - STRENGTH_ORDER[b.overall_risk_level === "high" ? "strong" : b.overall_risk_level === "medium" ? "moderate" : "none"]));

      return new Response(JSON.stringify({ class_id, roster_size: studentIds.length, students }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Single-student mode ──────────────────────────────────────────────
    let targetStudentId: string | null = null;
    if (profile.role === "student") {
      const { data: studentRow } = await supabaseAdmin.from("students").select("id").eq("profile_id", user.id).single();
      targetStudentId = studentRow?.id ?? null;
    } else if (isStaff) {
      if (!student_id) {
        return new Response(JSON.stringify({ error: "student_id or class_id is required" }), {
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

    const { data: core, error: coreError } = await supabaseClient.rpc("get_student_risk_core", { p_student_id: targetStudentId });
    if (coreError) throw coreError;
    const ledgerCauses: Cause[] = Array.isArray(core?.causes) ? core.causes as Cause[] : [];
    const attendanceCause = await fetchAttendanceCause(supabaseClient, supabaseAdmin, targetStudentId);
    const allCauses = [...ledgerCauses, attendanceCause].sort((a, b) => STRENGTH_ORDER[a.evidence_strength] - STRENGTH_ORDER[b.evidence_strength]);

    const recommendations = deriveRecommendations(allCauses);

    return new Response(JSON.stringify({
      student_id: targetStudentId,
      overall_risk_level: overallRiskLevel(allCauses),
      causes: allCauses,
      recommended_interventions: recommendations,
      suggested_tier: suggestedTier(recommendations),
      suggested_priority: suggestedPriority(recommendations),
      suggested_action_plan: suggestedActionPlan(recommendations),
      generated_at: core?.generated_at ?? new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-intervention-recommendations error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
