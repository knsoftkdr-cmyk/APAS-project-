// supabase/functions/grade-open-response/index.ts
//
// Deploy with:
//   supabase functions deploy grade-open-response
//
// Two jobs, chosen by which fields are in the body:
//
//   1. STUDENT SUBMITS an answer to a question_bank_extended item:
//        Body: { item_id: uuid, answer_text: string, source?: 'homework'|'practice'|'test'|'worksheet', source_id?: uuid }
//      -> inserts into open_response_submissions, runs the AI first-pass
//         grade against the item's rubric + model_answer, stores it, and
//         returns the submission with status "ai_graded".
//
//   2. TEACHER FINALIZES a submission:
//        Body: { submission_id: uuid, teacher_score: number, teacher_feedback?: string }
//      -> staff only. Overwrites nothing the AI wrote; just fills in
//         teacher_score/teacher_feedback and flips status to "teacher_reviewed".
//
// The AI grade is always a suggestion (status "ai_graded"). A submission only
// counts as final once a teacher has reviewed it, same pattern as
// question_bank_extended items staying "draft" until approved.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiGradeOpenResponse, GRADING_MODEL } from "../_shared/gradeOpenResponse.ts";

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

    const body = await req.json().catch(() => ({}));

    if (body.submission_id) return await finalizeAsTeacher(admin, user.id, body);
    if (body.item_id) return await submitAndGrade(admin, user.id, body);

    return json({ error: "Provide either { item_id, answer_text } to submit, or { submission_id, teacher_score } to finalize" }, 400);
  } catch (e) {
    console.error("grade-open-response error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Student submits -> AI first-pass grade

async function submitAndGrade(admin: ReturnType<typeof createClient>, userId: string, body: Row) {
  const { item_id, answer_text, source = "practice", source_id = null } = body;
  if (typeof answer_text !== "string" || !answer_text.trim()) return json({ error: "answer_text is required" }, 400);

  const { data: student } = await admin.from("students").select("id").eq("profile_id", userId).single();
  if (!student) return json({ error: "Only students can submit answers" }, 403);

  const { data: item, error: itemErr } = await admin.from("question_bank_extended")
    .select("id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks, status")
    .eq("id", item_id).single();
  if (itemErr || !item) return json({ error: "Item not found" }, 404);
  if (item.status !== "active") return json({ error: "This item is not currently active" }, 409);

  const { data: submission, error: insErr } = await admin.from("open_response_submissions").insert({
    item_id, student_id: student.id, source, source_id, answer_text: answer_text.trim(), status: "pending_ai",
  }).select().single();
  if (insErr) throw new Error(insErr.message);

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    // No grading key configured - leave it queued for a teacher instead of failing the submission.
    return json({ submission, ai_graded: false, message: "Saved. Awaiting teacher grading (AI grading not configured)." });
  }

  try {
    const graded = await aiGradeOpenResponse(apiKey, item as Row, answer_text.trim());
    const { data: updated, error: updErr } = await admin.from("open_response_submissions").update({
      ai_suggested_score: graded.total_score,
      ai_rubric_scores: graded.rubric_scores,
      ai_feedback: graded.feedback,
      ai_model: GRADING_MODEL,
      ai_graded_at: new Date().toISOString(),
      status: "ai_graded",
    }).eq("id", submission.id).select().single();
    if (updErr) throw new Error(updErr.message);
    return json({ submission: updated, ai_graded: true });
  } catch (e) {
    console.error("AI grading failed, leaving submission pending for a teacher", e);
    return json({ submission, ai_graded: false, message: "Saved. AI grading failed - awaiting teacher grading." });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Teacher finalizes a grade

async function finalizeAsTeacher(admin: ReturnType<typeof createClient>, userId: string, body: Row) {
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to grade" }, 403);

  const { submission_id, teacher_score, teacher_feedback } = body;
  const score = Number(teacher_score);
  if (!Number.isFinite(score) || score < 0) return json({ error: "teacher_score must be a non-negative number" }, 400);

  const { data: updated, error } = await admin.from("open_response_submissions").update({
    teacher_score: score,
    teacher_feedback: typeof teacher_feedback === "string" ? teacher_feedback : null,
    status: "teacher_reviewed",
    graded_by: userId,
    graded_at: new Date().toISOString(),
  }).eq("id", submission_id).select().single();
  if (error) throw new Error(error.message);

  return json({ submission: updated });
}
