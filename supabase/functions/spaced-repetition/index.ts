// supabase/functions/spaced-repetition/index.ts
//
// Deploy with:
//   supabase functions deploy spaced-repetition
//
// The Spaced Repetition Engine's driver. One endpoint, several actions:
//
//   forecast      { student_id? }                              due-now/today/7-day counts
//   due           { student_id?, limit?, book_id? }             the actual review queue (items included)
//   session-start { student_id?, limit?, book_id? }             alias for `due`, named for symmetry with cat-session
//   session-answer{ schedule_id, learning_objective_id,
//                   item_id, selected_option, student_id? }     grade one review, reschedule it, feed BKT
//   snooze        { learning_objective_id, days, student_id? }  "remind me later"
//
// SECURITY
//   * The scheduling state (review_schedule) is fed entirely by a DB trigger
//     on mastery_evidence_log (see the migration) - this function never
//     writes ease/interval/due_at directly, it only reads the queue and
//     forwards graded answers to record_mastery_evidence(), exactly like
//     update-mastery and cat-session do.
//   * get_due_reviews() and reschedule_review() are service-role-only in
//     Postgres (they trust their student_id argument / touch question_bank),
//     so this function resolves and enforces the caller's own student_id
//     before ever calling them with the admin client.
//   * Students can only act on their own reviews; staff may pass student_id
//     to inspect (not answer on behalf of) another student's queue.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const DEFAULT_LIMIT = 20;

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface Ctx {
  asCaller: ReturnType<typeof createClient>;
  admin: ReturnType<typeof createClient>;
  isStaff: boolean;
  isStudent: boolean;
  ownStudentId: string | null;
}

function resolveStudentId(ctx: Ctx, requested?: string | null): string {
  if (ctx.isStaff && requested) return requested;
  if (ctx.ownStudentId) return ctx.ownStudentId;
  throw new HttpError(403, "Could not resolve a student to act on");
}

function requireStudent(ctx: Ctx) {
  if (!ctx.isStudent || !ctx.ownStudentId) throw new HttpError(403, "Students only");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) throw new HttpError(401, "Not authenticated");

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile) throw new HttpError(403, "Profile not found");

    const isStaff = STAFF_ROLES.includes(profile.role);
    const isStudent = profile.role === "student";

    let ownStudentId: string | null = null;
    if (isStudent) {
      const { data: s } = await admin.from("students").select("id").eq("profile_id", user.id).single();
      ownStudentId = s?.id ?? null;
      if (!ownStudentId) throw new HttpError(403, "Student record not found");
    }
    if (!isStudent && !isStaff) throw new HttpError(403, "Not permitted");

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    const ctx: Ctx = { asCaller, admin, isStaff, isStudent, ownStudentId };

    switch (action) {
      case "forecast":
        return json(await forecast(ctx, body));
      case "due":
      case "session-start":
        return json(await due(ctx, body));
      case "session-answer":
        requireStudent(ctx);
        return json(await sessionAnswer(ctx, body));
      case "snooze":
        return json(await snooze(ctx, body));
      default:
        throw new HttpError(400, `Unknown action "${action}"`);
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message, code: e.code }, e.status);
    }
    console.error("spaced-repetition error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ── forecast: due-now/today/7-day counts for a "Daily Review" widget ────────
async function forecast(ctx: Ctx, body: Row) {
  const studentId = resolveStudentId(ctx, body.student_id);
  // get_review_forecast is GRANTed to authenticated and scoped by RLS on
  // review_schedule itself, so calling it as the caller is fine here.
  const { data, error } = await ctx.asCaller.rpc("get_review_forecast", { p_student_id: studentId });
  if (error) throw new HttpError(500, error.message, "forecast_failed");
  return { student_id: studentId, ...(data as Row) };
}

// ── due / session-start: the actual queue, each objective paired with an
//    item (stem + options, no answer key) ───────────────────────────────────
async function due(ctx: Ctx, body: Row) {
  const studentId = resolveStudentId(ctx, body.student_id);
  const limit = Math.max(1, Math.min(50, Number(body.limit ?? DEFAULT_LIMIT)));
  const bookId = body.book_id != null ? Number(body.book_id) : null;

  // get_due_reviews is service-role only (it joins question_bank), so this
  // must go through the admin client - the ownership check above is what
  // keeps a student from passing someone else's student_id.
  const { data, error } = await ctx.admin.rpc("get_due_reviews", {
    p_student_id: studentId,
    p_limit: limit,
    p_book_id: bookId,
  });
  if (error) throw new HttpError(500, error.message, "due_fetch_failed");

  const reviews = (data as Row[]) ?? [];
  return {
    student_id: studentId,
    count: reviews.length,
    reviews: reviews.map((r) => ({
      schedule_id: r.schedule_id,
      learning_objective_id: r.learning_objective_id,
      objective_text: r.objective_text,
      difficulty: r.difficulty,
      subtopic_id: r.subtopic_id,
      subtopic_name: r.subtopic_name,
      topic_id: r.topic_id,
      topic_name: r.topic_name,
      chapter_name: r.chapter_name,
      subject: r.subject,
      class_name: r.class_name,
      p_mastery: r.p_mastery,
      due_at: r.due_at,
      days_overdue: r.days_overdue,
      repetitions: r.repetitions,
      lapses: r.lapses,
      ease_factor: r.ease_factor,
      item: r.item, // { item_id, stem, options, bloom_level } — no correct_option
    })),
  };
}

// ── session-answer: grade one review. Feeds BKT via record_mastery_evidence
//    (source='spaced_review'); the trigger on that table reschedules the
//    objective automatically - this function does not touch review_schedule
//    directly at all. ────────────────────────────────────────────────────────
async function sessionAnswer(ctx: Ctx, body: Row) {
  const { learning_objective_id, item_id, selected_option, schedule_id } = body;
  if (!learning_objective_id || !item_id || !selected_option) {
    throw new HttpError(400, "learning_objective_id, item_id and selected_option are required");
  }

  // Look up the correct answer + explanation with the admin client (students
  // have no SELECT policy on question_bank at all).
  const { data: itemRow, error: itemError } = await ctx.admin
    .from("question_bank")
    .select("id, correct_option, explanation, learning_objective_id")
    .eq("id", item_id)
    .eq("status", "active")
    .single();
  if (itemError || !itemRow) throw new HttpError(404, "Item not found", "item_not_found");
  if (itemRow.learning_objective_id !== learning_objective_id) {
    throw new HttpError(400, "Item does not belong to that learning objective", "item_lo_mismatch");
  }

  const isCorrect = String(selected_option).toUpperCase() === itemRow.correct_option;

  // Module 10 (Misconception Detection Engine): log which option was picked
  // so a repeated wrong choice can surface as a pattern later. Independent
  // of the BKT write below - if this fails, grading still proceeds.
  const { error: logError } = await ctx.asCaller.rpc("record_item_response", {
    p_student_id: ctx.ownStudentId,
    p_item_id: item_id,
    p_selected_option: selected_option,
    p_source: "spaced_review",
  });
  if (logError) console.error("record_item_response failed (non-fatal)", logError);

  // record_mastery_evidence is GRANTed to authenticated; call it as the
  // caller so student_id is never something the request body could spoof -
  // the function itself only ever sees the caller's own student row.
  const { data, error } = await ctx.asCaller.rpc("record_mastery_evidence", {
    p_student_id: ctx.ownStudentId,
    p_learning_objective_id: learning_objective_id,
    p_is_correct: isCorrect,
    p_source: "spaced_review",
    p_source_id: schedule_id ?? null,
  });
  if (error) throw new HttpError(500, error.message, "evidence_failed");

  const row = Array.isArray(data) ? data[0] : data;

  return {
    is_correct: isCorrect,
    correct_option: itemRow.correct_option,
    explanation: itemRow.explanation,
    p_mastery_before: row?.p_mastery_before,
    p_mastery_after: row?.p_mastery_after,
  };
}

// ── snooze: manual "remind me later" ────────────────────────────────────────
async function snooze(ctx: Ctx, body: Row) {
  const studentId = resolveStudentId(ctx, body.student_id);
  const { learning_objective_id, days } = body;
  if (!learning_objective_id) throw new HttpError(400, "learning_objective_id is required");

  const { data, error } = await ctx.admin.rpc("reschedule_review", {
    p_student_id: studentId,
    p_learning_objective_id: learning_objective_id,
    p_days: Math.max(1, Number(days ?? 1)),
  });
  if (error) {
    if (error.message?.includes("review_schedule_not_found")) {
      throw new HttpError(404, "No review scheduled for that objective yet", "not_scheduled");
    }
    throw new HttpError(500, error.message, "snooze_failed");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { learning_objective_id, due_at: row?.due_at };
}
