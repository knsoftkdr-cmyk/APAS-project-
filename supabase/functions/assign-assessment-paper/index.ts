// supabase/functions/assign-assessment-paper/index.ts
//
// Deploy with:
//   supabase functions deploy assign-assessment-paper
//
// Staff only.
//   Body: {
//     paper_id: uuid
//     class_id?: uuid            -- assign to this class's whole roster
//     student_ids?: uuid[]       -- and/or these specific students (union with class_id's roster)
//     title?: string             -- defaults to the paper's own title
//     due_at?: string (ISO)
//     time_limit_minutes?: number  -- defaults to the paper's blueprint duration_minutes, if any
//   }
//
// Locks the paper (status -> "finalized") if it was still "draft" - once
// students can see it, it shouldn't keep changing under them.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
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

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to assign assessments" }, 403);

    const body = await req.json().catch(() => ({}));
    const { paper_id, class_id = null, due_at = null } = body;
    const explicitStudentIds: string[] = Array.isArray(body.student_ids) ? body.student_ids : [];
    if (!paper_id) return json({ error: "paper_id is required" }, 400);
    if (!class_id && !explicitStudentIds.length) return json({ error: "Provide class_id and/or student_ids" }, 400);

    const { data: paper, error: paperErr } = await admin.from("generated_assessment_papers")
      .select("id, title, status, blueprint_id").eq("id", paper_id).single();
    if (paperErr || !paper) return json({ error: "Paper not found" }, 404);
    if (paper.status === "archived") return json({ error: "This paper is archived and can't be assigned" }, 409);

    let timeLimitMinutes = body.time_limit_minutes ?? null;
    if (timeLimitMinutes == null && paper.blueprint_id) {
      const { data: bp } = await admin.from("assessment_blueprints").select("duration_minutes").eq("id", paper.blueprint_id).single();
      timeLimitMinutes = bp?.duration_minutes ?? null;
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
    }).select().single();
    if (assignErr) throw new Error(assignErr.message);

    const attemptRows = [...rosterIds].map((studentId) => ({
      assignment_id: assignment.id, student_id: studentId,
      mcq_max_marks: mcqMax, open_ended_max_marks: openMax, total_max_marks: mcqMax + openMax,
    }));
    const { error: attemptErr } = await admin.from("generated_assessment_paper_attempts").insert(attemptRows);
    if (attemptErr) throw new Error(attemptErr.message);

    return json({ assignment_id: assignment.id, student_count: rosterIds.size, mcq_max_marks: mcqMax, open_ended_max_marks: openMax });
  } catch (e) {
    console.error("assign-assessment-paper error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
