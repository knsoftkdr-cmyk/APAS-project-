// supabase/functions/submit-assessment-paper-attempt/index.ts
//
// Deploy with:
//   supabase functions deploy submit-assessment-paper-attempt
//
// Student-facing.
//   Body: {
//     attempt_id: uuid
//     mcq_answers?: [{ item_id: uuid, selected_option: "A"|"B"|"C"|"D" }]
//     open_responses?: [{ item_id: uuid, answer_text: string }]
//   }
//
// What happens on submit:
//   1. MCQs are scored immediately against question_bank.correct_option.
//   2. Each open-ended answer becomes a real open_response_submissions row
//      (source="test", source_id=attempt_id) and gets the same AI first-pass
//      rubric grade as feature 18's grade-open-response - same shared grader,
//      so there's exactly one grading prompt in the codebase, not two.
//   3. Every answered item feeds BKT (record_mastery_evidence, source
//      "assessment_paper") - for open-ended items "correct" is a >=50%-of-
//      marks heuristic, since BKT wants a binary signal and a rubric gives a
//      continuous one.
//   4. If the paper has open-ended items, the attempt lands on "submitted"
//      (provisional total, from the AI's scores) until a teacher reviews
//      every one of them - the DB trigger from the schema migration then
//      flips it to "graded" automatically. A pure-MCQ paper is fully
//      "graded" immediately, since there's nothing left for a human to check.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiGradeOpenResponse, GRADING_MODEL } from "../_shared/gradeOpenResponse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { data: student } = await admin.from("students").select("id").eq("profile_id", user.id).single();
    if (!student) return json({ error: "Only students can submit an attempt" }, 403);

    const body = await req.json().catch(() => ({}));
    const { attempt_id } = body;
    const mcqAnswers: Row[] = Array.isArray(body.mcq_answers) ? body.mcq_answers : [];
    const openResponses: Row[] = Array.isArray(body.open_responses) ? body.open_responses : [];
    if (!attempt_id) return json({ error: "attempt_id is required" }, 400);

    const { data: attempt, error: attemptErr } = await admin.from("generated_assessment_paper_attempts").select("*").eq("id", attempt_id).single();
    if (attemptErr || !attempt) return json({ error: "Attempt not found" }, 404);
    if (attempt.student_id !== student.id) return json({ error: "This attempt belongs to another student" }, 403);
    if (attempt.status === "submitted" || attempt.status === "graded") return json({ error: "This attempt has already been submitted" }, 409);

    const { data: assignment } = await admin.from("generated_assessment_paper_assignments").select("paper_id").eq("id", attempt.assignment_id).single();
    if (!assignment) return json({ error: "Assignment not found" }, 404);

    const { data: paperItems } = await admin.from("generated_assessment_paper_items")
      .select("mcq_item_id, extended_item_id, marks").eq("paper_id", assignment.paper_id);
    const marksByItemId = new Map<string, number>();
    for (const pi of paperItems ?? []) marksByItemId.set(pi.mcq_item_id ?? pi.extended_item_id, Number(pi.marks));

    // ── 1. Score MCQs ────────────────────────────────────────────────
    let mcqScore = 0;
    const mcqIds = mcqAnswers.map((a) => a.item_id);
    const mcqKeyById = new Map<string, Row>();
    if (mcqIds.length) {
      const { data } = await admin.from("question_bank").select("id, correct_option, learning_objective_id").in("id", mcqIds);
      for (const r of data ?? []) mcqKeyById.set(r.id, r);
    }
    const mastery_events: Row[] = [];
    for (const ans of mcqAnswers) {
      const key = mcqKeyById.get(ans.item_id);
      if (!key) continue;
      const marks = marksByItemId.get(ans.item_id) ?? 0;
      const isCorrect = ans.selected_option === key.correct_option;
      if (isCorrect) mcqScore += marks;
      if (key.learning_objective_id) {
        mastery_events.push({ learning_objective_id: key.learning_objective_id, is_correct: isCorrect });
      }
    }

    // ── 2. Grade open-ended answers ──────────────────────────────────
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    let openEndedAiScore = 0;
    let anyOpenEnded = false;
    const extIds = openResponses.map((r) => r.item_id);
    const extById = new Map<string, Row>();
    if (extIds.length) {
      const { data } = await admin.from("question_bank_extended")
        .select("id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks, learning_objective_id").in("id", extIds);
      for (const r of data ?? []) extById.set(r.id, r);
    }
    for (const resp of openResponses) {
      const item = extById.get(resp.item_id);
      const answerText = typeof resp.answer_text === "string" ? resp.answer_text.trim() : "";
      if (!item || !answerText) continue;
      anyOpenEnded = true;

      const { data: submission, error: subErr } = await admin.from("open_response_submissions").insert({
        item_id: item.id, student_id: student.id, source: "test", source_id: attempt_id, answer_text: answerText, status: "pending_ai",
      }).select().single();
      if (subErr) { console.error("could not save open response", subErr.message); continue; }

      let score = 0;
      if (apiKey) {
        try {
          const graded = await aiGradeOpenResponse(apiKey, item as Row, answerText);
          score = graded.total_score;
          await admin.from("open_response_submissions").update({
            ai_suggested_score: graded.total_score, ai_rubric_scores: graded.rubric_scores, ai_feedback: graded.feedback,
            ai_model: GRADING_MODEL, ai_graded_at: new Date().toISOString(), status: "ai_graded",
          }).eq("id", submission.id);
        } catch (e) {
          console.error("AI grading failed for", item.id, e instanceof Error ? e.message : e);
        }
      }
      openEndedAiScore += score;
      if (item.learning_objective_id) {
        const maxMarks = Number(item.max_marks) || 1;
        mastery_events.push({ learning_objective_id: item.learning_objective_id, is_correct: score / maxMarks >= 0.5 });
      }
    }

    // ── 3. Feed BKT for everything answered ──────────────────────────
    for (const ev of mastery_events) {
      const { error } = await admin.rpc("record_mastery_evidence", {
        p_student_id: student.id, p_learning_objective_id: ev.learning_objective_id,
        p_is_correct: ev.is_correct, p_source: "assessment_paper", p_source_id: attempt_id,
      });
      if (error) console.error("record_mastery_evidence failed", error.message);
    }

    // ── 4. Update the attempt ─────────────────────────────────────────
    const now = new Date().toISOString();
    const totalScore = mcqScore + openEndedAiScore;
    const status = anyOpenEnded ? "submitted" : "graded";
    const { data: updated, error: updErr } = await admin.from("generated_assessment_paper_attempts").update({
      mcq_answers: mcqAnswers, mcq_score: mcqScore, open_ended_ai_score: anyOpenEnded ? openEndedAiScore : null,
      total_score: totalScore, submitted_at: now, status, ...(status === "graded" ? { graded_at: now } : {}),
    }).eq("id", attempt_id).select().single();
    if (updErr) throw new Error(updErr.message);

    return json({
      attempt_id, status,
      mcq_score: mcqScore, mcq_max_marks: attempt.mcq_max_marks,
      open_ended_ai_score: anyOpenEnded ? openEndedAiScore : null, open_ended_max_marks: attempt.open_ended_max_marks,
      total_score: totalScore, total_max_marks: attempt.total_max_marks,
      note: anyOpenEnded ? "Open-ended scores are the AI's first pass and provisional until a teacher reviews them." : undefined,
    });
  } catch (e) {
    console.error("submit-assessment-paper-attempt error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
