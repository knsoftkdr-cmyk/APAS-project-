// supabase/functions/_shared/handlers/assignAssessmentPaper.ts
//
// Formerly the standalone `assign-assessment-paper` edge function. It is no longer deployed on its
// own (Edge Function deployment limit): `evaluate-assessment` routes to it via action "assign_paper"
// - see _shared/mergedRouter.ts. Request/response contract is unchanged.
//
// Staff only.
//   Body: {
//     paper_id: uuid
//     is_mock?: boolean          -- run as a mock exam (Exam Simulation Mode)
//     strict_timer?: boolean     -- server enforces started_at + time limit (+ grace); defaults to
//                                   true for mock exams. Requires a time limit.
//     grace_seconds?: number     -- network grace after the timer ends (default 60, max 600)
//     opens_at?: string (ISO)    -- exam cannot be started before this
//     class_id?: uuid            -- assign to this class's whole roster
//     student_ids?: uuid[]       -- and/or these specific students (union with class_id's roster)
//     title?: string             -- defaults to the paper's own title
//     due_at?: string (ISO)
//     time_limit_minutes?: number  -- defaults to the paper's blueprint duration_minutes, if any
//   }
//
// Locks the paper (status -> "finalized") if it was still "draft" - once
// students can see it, it shouldn't keep changing under them.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canStaffAccessClass, canStaffAccessStudent, resolveCaller } from "../studentAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleAssignAssessmentPaper(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const caller = await resolveCaller(admin, user.id);
    if (!caller || !STAFF_ROLES.includes(caller.role)) return json({ error: "Not permitted to assign assessments" }, 403);

    const body = await req.json().catch(() => ({}));
    const { paper_id, class_id = null, due_at = null } = body;
    const explicitStudentIds: string[] = Array.isArray(body.student_ids) ? body.student_ids : [];
    if (!paper_id) return json({ error: "paper_id is required" }, 400);
    if (!class_id && !explicitStudentIds.length) return json({ error: "Provide class_id and/or student_ids" }, 400);

    const { data: paper, error: paperErr } = await admin.from("generated_assessment_papers")
      .select("id, title, status, blueprint_id").eq("id", paper_id).single();
    if (paperErr || !paper) return json({ error: "Paper not found" }, 404);
    if (paper.status === "archived") return json({ error: "This paper is archived and can't be assigned" }, 409);

    // ── Exam-simulation rules ─────────────────────────────────────────
    const isMock = body.is_mock === true;
    const strictTimer = body.strict_timer === undefined ? isMock : body.strict_timer === true;
    let graceSeconds = 60;
    if (body.grace_seconds != null) {
      graceSeconds = Number(body.grace_seconds);
      if (!Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 600) return json({ error: "grace_seconds must be a whole number from 0 to 600" }, 400);
    }
    let opensAt: string | null = null;
    if (body.opens_at != null && body.opens_at !== "") {
      const t = new Date(body.opens_at);
      if (Number.isNaN(t.getTime())) return json({ error: "opens_at must be a valid date-time" }, 400);
      opensAt = t.toISOString();
    }
    if (due_at != null && Number.isNaN(new Date(due_at).getTime())) return json({ error: "due_at must be a valid date-time" }, 400);
    if (opensAt && due_at && new Date(due_at) <= new Date(opensAt)) return json({ error: "due_at must be after opens_at" }, 400);
    if (body.time_limit_minutes != null && !(Number(body.time_limit_minutes) > 0)) return json({ error: "time_limit_minutes must be positive" }, 400);

    let timeLimitMinutes = body.time_limit_minutes ?? null;
    if (timeLimitMinutes == null && paper.blueprint_id) {
      const { data: bp } = await admin.from("assessment_blueprints").select("duration_minutes").eq("id", paper.blueprint_id).single();
      timeLimitMinutes = bp?.duration_minutes ?? null;
    }

    if (strictTimer && timeLimitMinutes == null) {
      return json({ error: "A strict timer needs a time limit - set time_limit_minutes, or use a paper whose blueprint has a duration" }, 400);
    }

    // Teachers may only assign to classes they teach / students on those rosters;
    // school-bound staff only within their own school.
    if (class_id) {
      const access = await canStaffAccessClass(admin, caller, class_id);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
    }
    for (const sid of explicitStudentIds) {
      const access = await canStaffAccessStudent(admin, caller, sid);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
    }

    // ── Resolve the roster ────────────────────────────────────────────
    const rosterIds = new Set<string>(explicitStudentIds);
    if (class_id) {
      const { data: roster, error: rosterErr } = await admin.from("class_students").select("student_id").eq("class_id", class_id);
      if (rosterErr) throw new Error(rosterErr.message);
      for (const r of roster ?? []) rosterIds.add(r.student_id);
    }
    if (!rosterIds.size) return json({ error: "No students resolved from class_id/student_ids" }, 404);

    // ── Marks split, for each attempt's max-marks fields ──────────────
    const { data: items } = await admin.from("generated_assessment_paper_items")
      .select("mcq_item_id, extended_item_id, marks").eq("paper_id", paper_id);
    const mcqMax = (items ?? []).filter((i: Row) => i.mcq_item_id).reduce((s: number, i: Row) => s + Number(i.marks), 0);
    const openMax = (items ?? []).filter((i: Row) => i.extended_item_id).reduce((s: number, i: Row) => s + Number(i.marks), 0);

    // ── Lock the paper, create the assignment + one attempt per student ─
    if (paper.status === "draft") await admin.from("generated_assessment_papers").update({ status: "finalized" }).eq("id", paper_id);

    const { data: assignment, error: assignErr } = await admin.from("generated_assessment_paper_assignments").insert({
      paper_id, title: body.title || paper.title, class_id, student_ids: [...rosterIds],
      due_at, time_limit_minutes: timeLimitMinutes, student_count: rosterIds.size, assigned_by: user.id,
      is_mock: isMock, strict_timer: strictTimer, grace_seconds: graceSeconds, opens_at: opensAt,
    }).select().single();
    if (assignErr) throw new Error(assignErr.message);

    const attemptRows = [...rosterIds].map((studentId) => ({
      assignment_id: assignment.id, student_id: studentId,
      mcq_max_marks: mcqMax, open_ended_max_marks: openMax, total_max_marks: mcqMax + openMax,
    }));
    const { error: attemptErr } = await admin.from("generated_assessment_paper_attempts").insert(attemptRows);
    if (attemptErr) throw new Error(attemptErr.message);

    return json({ assignment_id: assignment.id, is_mock: isMock, strict_timer: strictTimer, time_limit_minutes: timeLimitMinutes, student_count: rosterIds.size, mcq_max_marks: mcqMax, open_ended_max_marks: openMax });
  } catch (e) {
    console.error("assign-assessment-paper error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
