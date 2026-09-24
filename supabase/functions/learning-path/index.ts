// supabase/functions/learning-path/index.ts
//
// Deploy with:
//   supabase functions deploy learning-path
//
// The Personalized Learning Path Generator's driver. Two actions:
//
//   generate { student_id?, book_id, length? }
//     Builds the ranked next-steps queue via generate_learning_path(), which
//     itself calls into the Spaced Repetition and Forgetting Curve engines
//     for the "review" steps and derives "remediate"/"learn"/"practice"
//     steps from the Mastery + Knowledge Graph + IRT engines.
//
//   answer { learning_objective_id, item_id, selected_option, step_type,
//            schedule_id?, student_id? }
//     Grades one step's item, whatever its type. "review" steps feed BKT
//     with source='spaced_review' (so the Spaced Repetition Engine's own
//     trigger reschedules it, exactly as if answered from Daily Review);
//     every other step type feeds it with source='learning_path'. Either
//     way this function never writes review_schedule directly - that stays
//     the trigger's job alone.
//
// SECURITY
//   generate_learning_path() is service-role-only (it joins question_bank),
//   so - same pattern as get_due_reviews - this function resolves/enforces
//   the caller's own student_id before calling it with the admin client.
//   Grading itself goes through record_mastery_evidence() as the caller,
//   exactly like update-mastery/cat-session/spaced-repetition already do,
//   so a student can only ever write their own evidence.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];

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
      case "generate":
        return json(await generate(ctx, body));
      case "answer":
        if (!isStudent) throw new HttpError(403, "Students only");
        return json(await answer(ctx, body));
      default:
        throw new HttpError(400, `Unknown action "${action}"`);
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message, code: e.code }, e.status);
    }
    console.error("learning-path error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ── generate: build the ranked next-steps queue ─────────────────────────────
async function generate(ctx: Ctx, body: Row) {
  const studentId = resolveStudentId(ctx, body.student_id);
  const bookId = Number(body.book_id);
  if (!bookId) throw new HttpError(400, "book_id is required");
  const length = Math.max(1, Math.min(25, Number(body.length ?? 10)));

  // Service-role only (joins question_bank) - the ownership check above is
  // what keeps a student from passing someone else's student_id.
  const { data, error } = await ctx.admin.rpc("generate_learning_path", {
    p_student_id: studentId,
    p_book_id: bookId,
    p_length: length,
  });
  if (error) throw new HttpError(500, error.message, "generate_failed");

  return { student_id: studentId, book_id: bookId, path: (data as Row[]) ?? [] };
}

// ── answer: grade one step, whatever its type ───────────────────────────────
async function answer(ctx: Ctx, body: Row) {
  const { learning_objective_id, item_id, selected_option, step_type, schedule_id } = body;
  if (!learning_objective_id || !item_id || !selected_option) {
    throw new HttpError(400, "learning_objective_id, item_id and selected_option are required");
  }

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
  const source = step_type === "review" ? "spaced_review" : "learning_path";

  // Module 10 (Misconception Detection Engine): log which option was picked
  // so a repeated wrong choice can surface as a pattern later. Independent
  // of the BKT write below - if this fails, grading still proceeds.
  const { error: logError } = await ctx.asCaller.rpc("record_item_response", {
    p_student_id: ctx.ownStudentId,
    p_item_id: item_id,
    p_selected_option: selected_option,
    p_source: source,
  });
  if (logError) console.error("record_item_response failed (non-fatal)", logError);

  // Caller's own JWT client, exactly like update-mastery/cat-session/
  // spaced-repetition: record_mastery_evidence only ever writes the
  // caller's own student row, so student_id in the request body is never
  // what's trusted here.
  const { data, error } = await ctx.asCaller.rpc("record_mastery_evidence", {
    p_student_id: ctx.ownStudentId,
    p_learning_objective_id: learning_objective_id,
    p_is_correct: isCorrect,
    p_source: source,
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
