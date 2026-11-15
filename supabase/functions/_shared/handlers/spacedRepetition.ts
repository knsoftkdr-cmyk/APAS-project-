// supabase/functions/_shared/handlers/spacedRepetition.ts
//
// Formerly the standalone `spaced-repetition` edge function. It is no longer deployed on its
// own (Edge Function deployment limit): `cat-session` routes to it via actions "sr_forecast" | "sr_due" | "sr_session_answer" | "sr_snooze"
// - see _shared/mergedRouter.ts. Request/response contract is unchanged.
//
// The Spaced Repetition Engine's driver. One endpoint, several actions:
//
//   forecast      { student_id? }                              due-now/today/7-day counts
//   due           { student_id?, limit?, book_id? }             the actual review queue (items included)
//   session-start { student_id?, limit?, book_id? }             alias for `due`, named for symmetry with cat-session
//   session-answer{ schedule_id, learning_objective_id,
//                   item_id, selected_option, student_id? }     grade one review, reschedule it, feed BKT
//   snooze        { learning_objective_id, days, student_id?,
//                   schedule_id?, session_id? }                  "remind me later" (a skipped question scores 0)
//   scoring-get   {}                                            the school's Daily Review marking rules
//   scoring-set   { enabled, marks_per_correct,
//                   negative_marks_per_wrong }                   principal only (applies to their whole school)
//
// NEGATIVE MARKING (Daily Review only)
//   A scoring overlay: correct = +marks, wrong = -penalty, skipped / unanswered = 0. It is written to
//   daily_review_marks and NEVER changes what is sent to record_mastery_evidence(), so BKT and SM-2 are
//   untouched. One question can be scored once per scheduled review (UNIQUE student+schedule+due_at), so
//   retrying other options can't farm marks. Off by default; if the table is missing or a marks write
//   fails, grading carries on exactly as before.
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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_RULES, marksFor, rulesFromRow, summarizeSession, validateRules,
  type Outcome, type ScoredRow, type ScoringRules,
} from "../dailyReviewScoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
/** Who may change the Daily Review marking rules (they apply to the principal's own school). */
const SCORING_ADMIN_ROLES = ["principal"];
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
  userId: string;
  role: string;
  schoolId: string | null;
}

function resolveStudentId(ctx: Ctx, requested?: string | null): string {
  if (ctx.isStaff && requested) return requested;
  if (ctx.ownStudentId) return ctx.ownStudentId;
  throw new HttpError(403, "Could not resolve a student to act on");
}

function requireStudent(ctx: Ctx) {
  if (!ctx.isStudent || !ctx.ownStudentId) throw new HttpError(403, "Students only");
}

export async function handleSpacedRepetition(req: Request): Promise<Response> {
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

    const { data: profile } = await admin.from("profiles").select("role, school_id").eq("id", user.id).single();
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

    const ctx: Ctx = { asCaller, admin, isStaff, isStudent, ownStudentId, userId: user.id, role: profile.role, schoolId: profile.school_id ?? null };

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
      case "scoring-get":
        return json(await scoringGet(ctx));
      case "scoring-set":
        return json(await scoringSet(ctx, body));
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
}

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
    scoring: await loadRules(ctx),
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

// ── Daily Review marking rules ───────────────────────────────────────────────

const isMissingRelation = (err: Row | null | undefined) =>
  !!err && (["42P01", "PGRST205", "42703"].includes(String(err.code)) || /does not exist|schema cache/i.test(String(err.message ?? "")));

/** The school's rules. Missing table / row / any read problem => marking stays OFF, so grading is never blocked. */
async function loadRules(ctx: Ctx): Promise<ScoringRules> {
  if (!ctx.schoolId) return { ...DEFAULT_RULES };
  const { data, error } = await ctx.admin
    .from("daily_review_settings")
    .select("negative_marking_enabled, marks_per_correct, negative_marks_per_wrong")
    .eq("school_id", ctx.schoolId)
    .maybeSingle();
  if (error) {
    if (!isMissingRelation(error)) console.error("daily_review_settings read failed (marking off)", error);
    return { ...DEFAULT_RULES };
  }
  return rulesFromRow(data);
}

async function scoringGet(ctx: Ctx) {
  return { rules: await loadRules(ctx), can_edit: SCORING_ADMIN_ROLES.includes(ctx.role) && !!ctx.schoolId, school_id: ctx.schoolId };
}

async function scoringSet(ctx: Ctx, body: Row) {
  if (!SCORING_ADMIN_ROLES.includes(ctx.role)) throw new HttpError(403, "Only a principal can change the Daily Review scoring rules", "not_authorised");
  if (!ctx.schoolId) throw new HttpError(400, "Your account isn't linked to a school", "no_school");
  const check = validateRules({
    enabled: body.enabled,
    marks_per_correct: body.marks_per_correct,
    negative_marks_per_wrong: body.negative_marks_per_wrong,
  });
  if (!check.ok) throw new HttpError(400, check.error, "invalid_rules");

  const { error } = await ctx.admin.from("daily_review_settings").upsert({
    school_id: ctx.schoolId,
    negative_marking_enabled: check.rules.enabled,
    marks_per_correct: check.rules.marks_per_correct,
    negative_marks_per_wrong: check.rules.negative_marks_per_wrong,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "school_id" });
  if (error) {
    if (isMissingRelation(error)) throw new HttpError(503, "Scoring rules aren't set up yet (apply migration 20261112000000).", "persistence_unavailable");
    throw new HttpError(500, error.message, "scoring_save_failed");
  }
  return { rules: check.rules, can_edit: true, school_id: ctx.schoolId };
}

/** The scheduled review being answered, only if it is the student's own, matches the objective, and is due now. */
async function findDueSchedule(ctx: Ctx, scheduleId: unknown, learningObjectiveId: unknown): Promise<Row | null> {
  if (typeof scheduleId !== "string" || !/^[0-9a-f-]{36}$/i.test(scheduleId) || !ctx.ownStudentId) return null;
  const { data } = await ctx.admin
    .from("review_schedule")
    .select("id, learning_objective_id, due_at, suspended")
    .eq("id", scheduleId)
    .eq("student_id", ctx.ownStudentId)
    .maybeSingle();
  if (!data || data.suspended) return null;
  if (learningObjectiveId != null && Number(data.learning_objective_id) !== Number(learningObjectiveId)) return null;
  if (new Date(data.due_at).getTime() > Date.now()) return null;
  return data;
}

const cleanSessionId = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null);

/** Running score of one session, straight from the ledger (the server's numbers, not the browser's). */
async function sessionScore(ctx: Ctx, sessionId: string, total: number, rules: ScoringRules) {
  const { data, error } = await ctx.admin
    .from("daily_review_marks")
    .select("outcome, marks, marks_for_correct")
    .eq("student_id", ctx.ownStudentId)
    .eq("session_id", sessionId)
    .limit(200);
  if (error) { console.error("session score read failed (non-fatal)", error); return null; }
  return summarizeSession((data as ScoredRow[]) ?? [], total, rules);
}

// ── session-answer: grade one review. Feeds BKT via record_mastery_evidence
//    (source='spaced_review'); the trigger on that table reschedules the
//    objective automatically - this function does not touch review_schedule
//    directly at all. Negative marking only adds a score on top: it never
//    changes the verdict or anything sent to record_mastery_evidence. ───────
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
  const outcome: Outcome = isCorrect ? "correct" : "wrong";

  // ── negative marking: claim this scheduled review's one scoring slot ──
  const rules = await loadRules(ctx);
  const sessionId = cleanSessionId(body.session_id);
  const sessionTotal = Math.max(1, Math.min(100, Math.round(Number(body.session_total)) || 1));
  let claimId: string | null = null;
  let counted = false;
  let marks = 0;

  if (rules.enabled) {
    const sched = await findDueSchedule(ctx, schedule_id, learning_objective_id);
    if (sched) {
      marks = marksFor(outcome, rules);
      const { data: ins, error: insErr } = await ctx.admin.from("daily_review_marks").insert({
        student_id: ctx.ownStudentId, school_id: ctx.schoolId, session_id: sessionId,
        schedule_id: sched.id, learning_objective_id: Number(learning_objective_id), item_id,
        due_at: sched.due_at, outcome, selected_option: String(selected_option).toUpperCase(),
        marks_for_correct: rules.marks_per_correct, penalty: rules.negative_marks_per_wrong, marks,
      }).select("id").single();

      if (insErr) {
        if (insErr.code === "23505") {
          // This scheduled review was already answered: report what it scored, change nothing, record no new evidence.
          const { data: prior } = await ctx.admin.from("daily_review_marks")
            .select("outcome, marks").eq("student_id", ctx.ownStudentId).eq("schedule_id", sched.id).eq("due_at", sched.due_at).maybeSingle();
          return {
            is_correct: isCorrect,
            correct_option: itemRow.correct_option,
            explanation: itemRow.explanation,
            p_mastery_before: null,
            p_mastery_after: null,
            scoring: { enabled: true, counted: false, duplicate: true, outcome: prior?.outcome ?? outcome, marks: Number(prior?.marks ?? 0), rules },
          };
        }
        if (!isMissingRelation(insErr)) console.error("daily_review_marks insert failed (grading continues unscored)", insErr);
      } else {
        claimId = ins.id;
        counted = true;
      }
    }
  }

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
  if (error) {
    // Nothing was graded, so release the scoring slot: the student can answer this question again.
    if (claimId) await ctx.admin.from("daily_review_marks").delete().eq("id", claimId);
    throw new HttpError(500, error.message, "evidence_failed");
  }

  const row = Array.isArray(data) ? data[0] : data;

  const scoring = rules.enabled
    ? {
        enabled: true, counted, outcome, marks: counted ? marks : 0, rules,
        session: counted && sessionId ? await sessionScore(ctx, sessionId, sessionTotal, rules) : null,
      }
    : { enabled: false, counted: false };

  return {
    is_correct: isCorrect,
    correct_option: itemRow.correct_option,
    explanation: itemRow.explanation,
    p_mastery_before: row?.p_mastery_before,
    p_mastery_after: row?.p_mastery_after,
    scoring,
  };
}

// ── snooze: manual "remind me later". With marking on, the skipped question is
//    logged as 0 marks (history only - the score already treats it as unanswered). ─
async function snooze(ctx: Ctx, body: Row) {
  const studentId = resolveStudentId(ctx, body.student_id);
  const { learning_objective_id, days } = body;
  if (!learning_objective_id) throw new HttpError(400, "learning_objective_id is required");

  let skipRow: Row | null = null;
  if (ctx.isStudent && body.schedule_id) {
    const rules = await loadRules(ctx);
    if (rules.enabled) {
      const sched = await findDueSchedule(ctx, body.schedule_id, learning_objective_id);
      if (sched) {
        skipRow = {
          student_id: ctx.ownStudentId, school_id: ctx.schoolId, session_id: cleanSessionId(body.session_id),
          schedule_id: sched.id, learning_objective_id: Number(learning_objective_id), item_id: null,
          due_at: sched.due_at, outcome: "skipped", selected_option: null,
          marks_for_correct: rules.marks_per_correct, penalty: rules.negative_marks_per_wrong, marks: 0,
        };
      }
    }
  }

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

  if (skipRow) {
    const { error: skipErr } = await ctx.admin.from("daily_review_marks")
      .upsert(skipRow, { onConflict: "student_id,schedule_id,due_at", ignoreDuplicates: true });
    if (skipErr && !isMissingRelation(skipErr)) console.error("skipped-question log failed (non-fatal)", skipErr);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { learning_objective_id, due_at: row?.due_at };
}
