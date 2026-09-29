// supabase/functions/get-assessment-paper-attempt/index.ts
//
// Deploy with:
//   supabase functions deploy get-assessment-paper-attempt
//
// Student-facing. The one legitimate way for a student to see a paper's
// questions: question_bank / question_bank_extended have no student SELECT
// policy at all (same reasoning as the CAT engine), so this runs as service
// role, joins the paper's items, and strips every answer-revealing field
// (correct_option, rubric, model_answer, quality/calibration flags) before
// returning.
//
//   Body: { assignment_id: uuid }   -- resolves this student's attempt for that assignment
//     or  { attempt_id: uuid }      -- go straight to a known attempt
//     or  { assignment_id | attempt_id, action: "save_draft", answers: {...} }
//            autosave in-progress answers (see below)
//
// EXAM SIMULATION RULES (assignment.is_mock / strict_timer / opens_at):
//   - opens_at    the exam cannot be opened before this time (409 + opens_at).
//   - timer       first open of an "assigned" attempt flips it to "in_progress" and stamps
//                 started_at. The response carries `server_now` and `deadline_at`
//                 (started_at + time limit) so the client counts down against the SERVER's
//                 clock, not the device's. With strict_timer the deadline is enforced:
//                 `expired: true` once deadline + grace has passed, and saves are refused.
//   - autosave    action "save_draft" stores {"mcq": {itemId: "B"}, "open": {itemId: "text"}}.
//                 Re-opening an in-progress attempt returns that `draft`, so a refresh or a
//                 dropped connection loses nothing. If a strict exam expires before the
//                 student submits, submit-assessment-paper-attempt auto-submits the draft.
//   - review      once submitted/graded the response also carries `result`: marks per
//                 question, the correct MCQ option + explanation, AI/teacher feedback on
//                 open-ended answers, and the by-section / Bloom / difficulty / topic analysis.
//                 Open-ended marks are marked provisional until a teacher has reviewed them.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAttemptResult } from "../_shared/examAnalysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_DRAFT_CHARS = 200_000;

function deadlineFor(startedAt: string | null, limitMinutes: number | null): Date | null {
  if (!startedAt || !limitMinutes) return null;
  return new Date(new Date(startedAt).getTime() + limitMinutes * 60_000);
}

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
    if (!student) return json({ error: "Only students can open an assessment attempt" }, 403);

    const body = await req.json().catch(() => ({}));

    let attempt: Row | null = null;
    if (body.attempt_id) {
      const { data } = await admin.from("generated_assessment_paper_attempts").select("*").eq("id", body.attempt_id).maybeSingle();
      attempt = data;
    } else if (body.assignment_id) {
      const { data } = await admin.from("generated_assessment_paper_attempts").select("*")
        .eq("assignment_id", body.assignment_id).eq("student_id", student.id).maybeSingle();
      attempt = data;
    } else {
      return json({ error: "Provide attempt_id or assignment_id" }, 400);
    }
    if (!attempt) return json({ error: "Attempt not found - this paper may not be assigned to you" }, 404);
    if (attempt.student_id !== student.id) return json({ error: "This attempt belongs to another student" }, 403);

    const { data: assignment } = await admin.from("generated_assessment_paper_assignments")
      .select("id, paper_id, title, due_at, time_limit_minutes, status, is_mock, strict_timer, grace_seconds, opens_at").eq("id", attempt.assignment_id).single();
    if (!assignment) return json({ error: "Assignment not found" }, 404);

    const now = new Date();
    const graceMs = (assignment.grace_seconds ?? 60) * 1000;

    // ── Autosave ─────────────────────────────────────────────────────
    if (body.action === "save_draft") {
      if (attempt.status !== "in_progress") return json({ error: "Only an exam in progress can be saved" }, 409);
      const deadline = deadlineFor(attempt.started_at, assignment.time_limit_minutes);
      if (assignment.strict_timer && deadline && now.getTime() > deadline.getTime() + graceMs) {
        return json({ error: "Time is up - this exam can no longer be edited", expired: true }, 409);
      }
      const a = body.answers;
      if (!a || typeof a !== "object" || Array.isArray(a)) return json({ error: "answers must be an object" }, 400);
      const draft = {
        mcq: a.mcq && typeof a.mcq === "object" && !Array.isArray(a.mcq) ? a.mcq : {},
        open: a.open && typeof a.open === "object" && !Array.isArray(a.open) ? a.open : {},
      };
      if (JSON.stringify(draft).length > MAX_DRAFT_CHARS) return json({ error: "Draft is too large" }, 413);
      const { error } = await admin.from("generated_assessment_paper_attempts")
        .update({ answers_draft: draft, draft_saved_at: now.toISOString() })
        .eq("id", attempt.id).eq("status", "in_progress");
      if (error) throw new Error(error.message);
      return json({ saved: true, saved_at: now.toISOString(), server_now: now.toISOString() });
    }

    if (assignment.status === "closed" && attempt.status === "assigned") {
      return json({ error: "This assignment has been closed" }, 409);
    }
    if (assignment.opens_at && now < new Date(assignment.opens_at) && attempt.status === "assigned") {
      return json({ error: "This exam has not opened yet", opens_at: assignment.opens_at, server_now: now.toISOString() }, 409);
    }

    // ── First open -> start the clock (atomic: only one opener wins) ──
    if (attempt.status === "assigned") {
      const { data: updated } = await admin.from("generated_assessment_paper_attempts")
        .update({ status: "in_progress", started_at: now.toISOString() })
        .eq("id", attempt.id).eq("status", "assigned").select().maybeSingle();
      if (updated) attempt = updated;
      else {
        const { data: fresh } = await admin.from("generated_assessment_paper_attempts").select("*").eq("id", attempt.id).single();
        attempt = fresh ?? attempt;
      }
    }

    const deadline = deadlineFor(attempt.started_at, assignment.time_limit_minutes);
    const expired = attempt.status === "in_progress" && !!assignment.strict_timer && !!deadline
      && now.getTime() > deadline.getTime() + graceMs;

    const finished = attempt.status === "submitted" || attempt.status === "graded";

    // ── Paper items, stripped of every answer-revealing field ──────────
    const { data: paperItems, error: itemsErr } = await admin.from("generated_assessment_paper_items")
      .select("order_index, section_label, marks, mcq_item_id, extended_item_id").eq("paper_id", assignment.paper_id).order("order_index");
    if (itemsErr) throw new Error(itemsErr.message);

    const mcqIds = (paperItems ?? []).filter((i: Row) => i.mcq_item_id).map((i: Row) => i.mcq_item_id);
    const extIds = (paperItems ?? []).filter((i: Row) => i.extended_item_id).map((i: Row) => i.extended_item_id);

    const mcqById = new Map<string, Row>();
    if (mcqIds.length) {
      const { data } = await admin.from("question_bank").select("id, stem, options, bloom_level, difficulty").in("id", mcqIds);
      for (const r of data ?? []) mcqById.set(r.id, r);
    }
    const extById = new Map<string, Row>();
    if (extIds.length) {
      const { data } = await admin.from("question_bank_extended")
        .select("id, question_type, stem, context_passage, sub_questions, bloom_level, difficulty").in("id", extIds);
      for (const r of data ?? []) {
        // strip everything but id/text/max_marks off each sub_question - the marks
        // breakdown is fine to show, only the rubric/model_answer must stay hidden
        const cleanSubQs = (r.sub_questions ?? []).map((sq: Row) => ({ id: sq.id, text: sq.text, max_marks: sq.max_marks }));
        extById.set(r.id, { ...r, sub_questions: cleanSubQs });
      }
    }

    const items = (paperItems ?? []).map((pi: Row) => {
      if (pi.mcq_item_id) {
        const q = mcqById.get(pi.mcq_item_id);
        return {
          item_id: pi.mcq_item_id, item_table: "question_bank", question_type: "mcq",
          order_index: pi.order_index, section_label: pi.section_label, marks: pi.marks,
          stem: q?.stem, options: q?.options, bloom_level: q?.bloom_level, difficulty: q?.difficulty,
        };
      }
      const q = extById.get(pi.extended_item_id);
      return {
        item_id: pi.extended_item_id, item_table: "question_bank_extended", question_type: q?.question_type,
        order_index: pi.order_index, section_label: pi.section_label, marks: pi.marks,
        stem: q?.stem, context_passage: q?.context_passage, sub_questions: q?.sub_questions,
        bloom_level: q?.bloom_level, difficulty: q?.difficulty,
      };
    });

    const { data: paper } = await admin.from("generated_assessment_papers")
      .select("title, instructions, exam_pattern_code").eq("id", assignment.paper_id).maybeSingle();

    let result: Row | undefined;
    if (finished) {
      const built = await buildAttemptResult(admin, attempt, assignment.paper_id);
      result = { ...built.totals, items: built.items, analysis: built.analysis };
    }

    return json({
      attempt: {
        id: attempt.id, status: attempt.status, started_at: attempt.started_at,
        mcq_max_marks: attempt.mcq_max_marks, open_ended_max_marks: attempt.open_ended_max_marks, total_max_marks: attempt.total_max_marks,
        ...(finished ? {
          mcq_score: attempt.mcq_score, total_score: attempt.total_score, submitted_at: attempt.submitted_at,
          auto_submitted: attempt.auto_submitted, late_submission: attempt.late_submission, time_taken_seconds: attempt.time_taken_seconds,
        } : {}),
      },
      assignment: {
        id: assignment.id, title: assignment.title, due_at: assignment.due_at, time_limit_minutes: assignment.time_limit_minutes,
        is_mock: assignment.is_mock, strict_timer: assignment.strict_timer, grace_seconds: assignment.grace_seconds, opens_at: assignment.opens_at,
      },
      exam: { title: paper?.title ?? assignment.title, instructions: paper?.instructions ?? [], exam_pattern_code: paper?.exam_pattern_code ?? null },
      timing: {
        server_now: now.toISOString(),
        deadline_at: deadline ? deadline.toISOString() : null,
        seconds_remaining: deadline ? Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 1000)) : null,
        expired,
      },
      draft: attempt.status === "in_progress" ? (attempt.answers_draft ?? {}) : undefined,
      items,
      result,
    });
  } catch (e) {
    console.error("get-assessment-paper-attempt error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
