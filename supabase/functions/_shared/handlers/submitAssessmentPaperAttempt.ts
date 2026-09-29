// supabase/functions/_shared/handlers/submitAssessmentPaperAttempt.ts
//
// Formerly the standalone `submit-assessment-paper-attempt` edge function. It is no longer deployed on its
// own (Edge Function deployment limit): `cat-session` routes to it via action "paper_submit"
// - see _shared/mergedRouter.ts. Request/response contract is unchanged.
//
// Student-facing.
//   Body: {
//     attempt_id: uuid
//     mcq_answers?: [{ item_id: uuid, selected_option: "A"|"B"|"C"|"D" }]
//     open_responses?: [{ item_id: uuid, answer_text: string }]
//   }
//
// What happens on submit:
//   0. The attempt is CLAIMED atomically (in_progress/assigned -> submitted), so a
//      double-click or a retry can never grade or record mastery twice.
//   1. Deadline (strict-timer exams): if the deadline + grace has passed, the answers
//      in the request are IGNORED and the last autosaved draft is graded instead
//      (auto_submitted = true, late_submission = true). Nothing typed after the
//      buzzer counts. Non-strict exams accept late work but flag late_submission.
//   2. Only questions that are actually on this paper are accepted; each question is
//      counted once.
//   3. MCQs are scored immediately against question_bank.correct_option.
//   4. Each open-ended answer becomes a real open_response_submissions row
//      (source="test", source_id=attempt_id) and gets the same AI first-pass rubric
//      grade as feature 18's grade-open-response - same shared grader. AI scores are
//      scaled to the marks the PAPER gives that question (a 5-mark bank item in a
//      3-mark slot is worth at most 3).
//   5. Every answered item feeds BKT (record_mastery_evidence, source
//      "assessment_paper") - for open-ended items "correct" means >= 50% of the
//      question's marks, since BKT wants a binary signal.
//   6. A post-exam analysis (by section, Bloom level, difficulty, topic) is stored on
//      the attempt and returned.
//   7. If the paper has open-ended items, the attempt stays "submitted" (provisional
//      total) until a teacher reviews each one - the DB trigger then flips it to
//      "graded". A pure-MCQ paper is "graded" immediately.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiGradeOpenResponse, GRADING_MODEL } from "../gradeOpenResponse.ts";
import { buildAttemptResult, scaleToSlot } from "../examAnalysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_ANSWER_CHARS = 20_000;
const GRADING_CONCURRENCY = 4;

async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function handleSubmitAssessmentPaperAttempt(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let claimedAttemptId: string | null = null;
  let previousStatus: string | null = null;
  let previousStartedAt: string | null = null;
  // deno-lint-ignore no-explicit-any
  let adminRef: any = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    adminRef = admin;

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const { data: student } = await admin.from("students").select("id").eq("profile_id", user.id).single();
    if (!student) return json({ error: "Only students can submit an attempt" }, 403);

    const body = await req.json().catch(() => ({}));
    const { attempt_id } = body;
    if (!attempt_id) return json({ error: "attempt_id is required" }, 400);

    const { data: attempt, error: attemptErr } = await admin.from("generated_assessment_paper_attempts").select("*").eq("id", attempt_id).single();
    if (attemptErr || !attempt) return json({ error: "Attempt not found" }, 404);
    if (attempt.student_id !== student.id) return json({ error: "This attempt belongs to another student" }, 403);
    if (attempt.status === "submitted" || attempt.status === "graded") return json({ error: "This attempt has already been submitted" }, 409);

    const { data: assignment } = await admin.from("generated_assessment_paper_assignments")
      .select("paper_id, time_limit_minutes, due_at, is_mock, strict_timer, grace_seconds, opens_at").eq("id", attempt.assignment_id).single();
    if (!assignment) return json({ error: "Assignment not found" }, 404);

    const now = new Date();
    if (assignment.strict_timer && attempt.status !== "in_progress") {
      return json({ error: "Open the exam first - the timer starts when you open it" }, 409);
    }
    if (assignment.opens_at && now < new Date(assignment.opens_at)) {
      return json({ error: "This exam has not opened yet", opens_at: assignment.opens_at }, 409);
    }

    // ── Deadline ─────────────────────────────────────────────────────
    const startedAt = attempt.started_at ? new Date(attempt.started_at) : now;
    const deadline = assignment.time_limit_minutes ? new Date(startedAt.getTime() + assignment.time_limit_minutes * 60_000) : null;
    const graceMs = (assignment.grace_seconds ?? 60) * 1000;
    const pastStrictDeadline = !!assignment.strict_timer && !!deadline && now.getTime() > deadline.getTime() + graceMs;
    const pastSoftDeadline = !assignment.strict_timer && (
      (!!deadline && now.getTime() > deadline.getTime() + graceMs) || (!!assignment.due_at && now > new Date(assignment.due_at)));

    // Where the answers come from: the request, or (after the buzzer) the last draft.
    let mcqAnswers: Row[];
    let openResponses: Row[];
    if (pastStrictDeadline) {
      const draft = attempt.answers_draft ?? {};
      mcqAnswers = Object.entries(draft.mcq ?? {}).map(([item_id, selected_option]) => ({ item_id, selected_option }));
      openResponses = Object.entries(draft.open ?? {}).map(([item_id, answer_text]) => ({ item_id, answer_text }));
    } else {
      mcqAnswers = Array.isArray(body.mcq_answers) ? body.mcq_answers : [];
      openResponses = Array.isArray(body.open_responses) ? body.open_responses : [];
    }

    // ── 0. Claim the attempt (atomic) ────────────────────────────────
    previousStatus = attempt.status;
    previousStartedAt = attempt.started_at;
    const { data: claimed } = await admin.from("generated_assessment_paper_attempts")
      .update({ status: "submitted", submitted_at: now.toISOString(), ...(attempt.started_at ? {} : { started_at: now.toISOString() }) })
      .eq("id", attempt_id).in("status", ["assigned", "in_progress"]).select("id").maybeSingle();
    if (!claimed) return json({ error: "This attempt has already been submitted" }, 409);
    claimedAttemptId = attempt_id;

    // ── 2. Paper membership + marks ──────────────────────────────────
    const { data: paperItems } = await admin.from("generated_assessment_paper_items")
      .select("mcq_item_id, extended_item_id, marks").eq("paper_id", assignment.paper_id);
    const mcqSlot = new Map<string, number>();
    const extSlot = new Map<string, number>();
    for (const pi of paperItems ?? []) {
      if (pi.mcq_item_id) mcqSlot.set(pi.mcq_item_id, Number(pi.marks));
      if (pi.extended_item_id) extSlot.set(pi.extended_item_id, Number(pi.marks));
    }

    // Keep only on-paper questions, first answer per question wins.
    const mcqClean = new Map<string, string>();
    for (const a of mcqAnswers) {
      if (!mcqSlot.has(a?.item_id) || mcqClean.has(a.item_id)) continue;
      const opt = typeof a.selected_option === "string" ? a.selected_option.trim().toUpperCase() : "";
      if (["A", "B", "C", "D"].includes(opt)) mcqClean.set(a.item_id, opt);
    }
    const openClean = new Map<string, string>();
    for (const r of openResponses) {
      if (!extSlot.has(r?.item_id) || openClean.has(r.item_id)) continue;
      const text = typeof r.answer_text === "string" ? r.answer_text.trim().slice(0, MAX_ANSWER_CHARS) : "";
      if (text) openClean.set(r.item_id, text);
    }

    // ── 3. Score MCQs ────────────────────────────────────────────────
    let mcqScore = 0;
    const mcqKeyById = new Map<string, Row>();
    if (mcqClean.size) {
      const { data } = await admin.from("question_bank").select("id, correct_option, learning_objective_id").in("id", [...mcqClean.keys()]);
      for (const r of data ?? []) mcqKeyById.set(r.id, r);
    }
    const mastery_events: Row[] = [];
    for (const [itemId, selected] of mcqClean) {
      const key = mcqKeyById.get(itemId);
      if (!key) continue;
      const isCorrect = selected === key.correct_option;
      if (isCorrect) mcqScore += mcqSlot.get(itemId) ?? 0;
      if (key.learning_objective_id) mastery_events.push({ learning_objective_id: key.learning_objective_id, is_correct: isCorrect });
    }

    // ── 4. Grade open-ended answers ──────────────────────────────────
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const extById = new Map<string, Row>();
    if (openClean.size) {
      const { data } = await admin.from("question_bank_extended")
        .select("id, question_type, stem, context_passage, sub_questions, rubric, model_answer, max_marks, learning_objective_id").in("id", [...openClean.keys()]);
      for (const r of data ?? []) extById.set(r.id, r);
    }

    const graded = await mapPool([...openClean.entries()], GRADING_CONCURRENCY, async ([itemId, answerText]) => {
      const item = extById.get(itemId);
      if (!item) return null;
      const slot = extSlot.get(itemId) ?? (Number(item.max_marks) || 1);

      const { data: submission, error: subErr } = await admin.from("open_response_submissions").insert({
        item_id: item.id, student_id: student.id, source: "test", source_id: attempt_id, answer_text: answerText, status: "pending_ai",
      }).select().single();
      if (subErr) { console.error("could not save open response", subErr.message); return null; }

      let awarded = 0;
      if (apiKey) {
        try {
          const g = await aiGradeOpenResponse(apiKey, item as Row, answerText);
          awarded = scaleToSlot(g.total_score, item.max_marks, slot);
          await admin.from("open_response_submissions").update({
            ai_suggested_score: g.total_score, ai_rubric_scores: g.rubric_scores, ai_feedback: g.feedback,
            ai_model: GRADING_MODEL, ai_graded_at: new Date().toISOString(), status: "ai_graded",
          }).eq("id", submission.id);
        } catch (e) {
          console.error("AI grading failed for", item.id, e instanceof Error ? e.message : e);
        }
      }
      if (item.learning_objective_id) {
        mastery_events.push({ learning_objective_id: item.learning_objective_id, is_correct: awarded / slot >= 0.5 });
      }
      return awarded;
    });
    const anyOpenEnded = graded.some((g) => g !== null);
    const openEndedAiScore = Math.round(graded.reduce((s: number, g) => s + (g ?? 0), 0) * 100) / 100;

    // ── 6/7. Finalise the attempt + analysis ──────────────────────────
    const totalScore = Math.round((mcqScore + openEndedAiScore) * 100) / 100;
    const status = anyOpenEnded ? "submitted" : "graded";
    const timeEnd = pastStrictDeadline && deadline ? deadline : now;
    const timeTaken = Math.max(0, Math.round((timeEnd.getTime() - startedAt.getTime()) / 1000));

    const { data: updated, error: updErr } = await admin.from("generated_assessment_paper_attempts").update({
      mcq_answers: [...mcqClean.entries()].map(([item_id, selected_option]) => ({ item_id, selected_option })),
      mcq_score: mcqScore, open_ended_ai_score: anyOpenEnded ? openEndedAiScore : null,
      total_score: totalScore, status, ...(status === "graded" ? { graded_at: now.toISOString() } : {}),
      auto_submitted: pastStrictDeadline, late_submission: pastStrictDeadline || pastSoftDeadline,
      time_taken_seconds: timeTaken,
    }).eq("id", attempt_id).select().single();
    if (updErr) throw new Error(updErr.message);

    const built = await buildAttemptResult(admin, updated, assignment.paper_id);
    await admin.from("generated_assessment_paper_attempts").update({ analysis: built.analysis }).eq("id", attempt_id);
    claimedAttemptId = null; // committed - nothing to roll back

    // ── 5. Feed BKT for everything answered - only AFTER the attempt is committed,
    //      so a rolled-back submission can never leave mastery evidence behind ──
    for (const ev of mastery_events) {
      const { error } = await admin.rpc("record_mastery_evidence", {
        p_student_id: student.id, p_learning_objective_id: ev.learning_objective_id,
        p_is_correct: ev.is_correct, p_source: "assessment_paper", p_source_id: attempt_id,
      });
      if (error) console.error("record_mastery_evidence failed", error.message);
    }

    return json({
      attempt_id, status,
      mcq_score: mcqScore, mcq_max_marks: attempt.mcq_max_marks,
      open_ended_ai_score: anyOpenEnded ? openEndedAiScore : null, open_ended_max_marks: attempt.open_ended_max_marks,
      total_score: totalScore, total_max_marks: attempt.total_max_marks,
      auto_submitted: pastStrictDeadline, late_submission: pastStrictDeadline || pastSoftDeadline,
      time_taken_seconds: timeTaken,
      analysis: built.analysis,
      note: pastStrictDeadline
        ? "Time ran out, so the answers you had saved were submitted automatically."
        : anyOpenEnded ? "Open-ended scores are the AI's first pass and provisional until a teacher reviews them." : undefined,
    });
  } catch (e) {
    console.error("submit-assessment-paper-attempt error", e);
    // Something failed AFTER we claimed the attempt: release it so the student can retry,
    // and remove any half-written open-ended rows so a retry can't create duplicates.
    if (claimedAttemptId && adminRef) {
      try {
        await adminRef.from("open_response_submissions").delete().eq("source", "test").eq("source_id", claimedAttemptId);
        await adminRef.from("generated_assessment_paper_attempts")
          .update({ status: previousStatus ?? "in_progress", submitted_at: null, started_at: previousStartedAt })
          .eq("id", claimedAttemptId).eq("status", "submitted");
      } catch (rollbackErr) { console.error("rollback failed", rollbackErr); }
    }
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
