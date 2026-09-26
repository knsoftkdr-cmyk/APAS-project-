// supabase/functions/adaptive-homework/index.ts
//
// Deploy with:
//   supabase functions deploy adaptive-homework
//
// Module 16: Adaptive Homework Generator. Two actions:
//
//   generate { class_id, book_id, chapter_id?, title?, items_per_student?, due_at? }
//     Staff only, and only for a class they're assigned to (same check as
//     get-class-mastery). Loads the class roster, then calls
//     generate_adaptive_homework_for_student() once per student - each
//     student's mastery band (beginning/developing/proficient/mastered) is
//     computed independently, so two students in the same class can come
//     away with a differently-shaped set. Writes one adaptive_homework_items
//     row per student and rolls up band_counts on the parent assignment.
//
//   submit_answer { item_row_id, item_id, learning_objective_id, selected_option }
//     Students only. Grades one item, exactly like learning-path's "answer"
//     action (module 10's misconception log, then module 1/3's BKT update),
//     and additionally appends the answer to that student's
//     adaptive_homework_items row - the SQL function auto-finalizes
//     (status -> 'submitted', score computed) once every item is answered.
//
// SECURITY
//   generate_adaptive_homework_for_student() is service-role-only (it joins
//   question_bank across the whole scope for every student in the class),
//   so - same reasoning as get-class-mastery / learning-path's "generate" -
//   this function checks class_teachers ownership itself before looping.
//   submit_adaptive_homework_answer() is called with the caller's own JWT
//   and ownStudentId only, exactly like learning-path's "answer" action, so
//   a student can never grade or read into someone else's set.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const BANDS = ["beginning", "developing", "proficient", "mastered"] as const;

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
  userId: string;
  role: string;
  isStaff: boolean;
  isStudent: boolean;
  ownStudentId: string | null;
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

    const ctx: Ctx = { asCaller, admin, userId: user.id, role: profile.role, isStaff, isStudent, ownStudentId };

    switch (action) {
      case "generate":
        if (!isStaff) throw new HttpError(403, "Staff only");
        return json(await generate(ctx, body));
      case "submit_answer":
        if (!isStudent) throw new HttpError(403, "Students only");
        return json(await submitAnswer(ctx, body));
      default:
        throw new HttpError(400, `Unknown action "${action}"`);
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message, code: e.code }, e.status);
    }
    console.error("adaptive-homework error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ── generate: one differentiated set per student in the class ──────────────
async function generate(ctx: Ctx, body: Row) {
  const classId = body.class_id as string | undefined;
  const bookId = Number(body.book_id);
  const chapterId = body.chapter_id ? Number(body.chapter_id) : null;
  const itemsPerStudent = Math.max(1, Math.min(20, Number(body.items_per_student ?? 6)));
  if (!classId || !bookId) throw new HttpError(400, "class_id and book_id are required");

  // Teachers may only generate for classes they're assigned to; admins/
  // principal/hod/school_admin may generate for any class - same check
  // as get-class-mastery.
  if (ctx.role === "teacher") {
    const { data: assignment } = await ctx.admin
      .from("class_teachers").select("id").eq("class_id", classId).eq("teacher_id", ctx.userId).maybeSingle();
    if (!assignment) throw new HttpError(403, "You are not assigned to this class");
  }

  const { data: roster, error: rosterError } = await ctx.admin
    .from("class_students").select("student_id").eq("class_id", classId);
  if (rosterError) throw new HttpError(500, rosterError.message);

  const studentIds = (roster ?? []).map((r) => r.student_id as string);
  if (studentIds.length === 0) throw new HttpError(400, "This class has no students", "empty_roster");

  const { data: bookRow } = await ctx.admin.from("books").select("subject, class_name").eq("id", bookId).single();
  const title = body.title || `${bookRow?.subject ?? "Homework"} - Adaptive Homework`;

  const { data: assignmentRow, error: assignError } = await ctx.admin
    .from("adaptive_homework_assignments")
    .insert({
      class_id: classId, book_id: bookId, chapter_id: chapterId, title,
      items_per_student: itemsPerStudent, due_at: body.due_at ?? null, assigned_by: ctx.userId,
    })
    .select("id")
    .single();
  if (assignError) throw new HttpError(500, assignError.message, "assignment_create_failed");
  const assignmentId = assignmentRow.id as string;

  const bandCounts: Record<string, number> = Object.fromEntries(BANDS.map((b) => [b, 0]));
  const results: Row[] = [];

  // One RPC + one insert per student. A class roster is small (tens of
  // students), so a simple loop keeps each student's generation isolated -
  // one failure doesn't take down the whole batch.
  for (const studentId of studentIds) {
    const { data: setData, error: genError } = await ctx.admin.rpc("generate_adaptive_homework_for_student", {
      p_student_id: studentId,
      p_book_id: bookId,
      p_chapter_id: chapterId,
      p_length: itemsPerStudent,
    });
    if (genError) {
      results.push({ student_id: studentId, error: genError.message });
      continue;
    }

    const set = setData as { mastery_band: string; avg_mastery: number; items: Row[] };
    const { data: itemRow, error: itemError } = await ctx.admin
      .from("adaptive_homework_items")
      .upsert({
        assignment_id: assignmentId, student_id: studentId,
        mastery_band: set.mastery_band, avg_mastery: set.avg_mastery, items: set.items,
      }, { onConflict: "assignment_id,student_id" })
      .select("id, mastery_band, avg_mastery")
      .single();
    if (itemError) {
      results.push({ student_id: studentId, error: itemError.message });
      continue;
    }

    bandCounts[set.mastery_band] = (bandCounts[set.mastery_band] ?? 0) + 1;
    results.push({
      student_id: studentId, item_row_id: itemRow.id,
      mastery_band: set.mastery_band, avg_mastery: set.avg_mastery, item_count: set.items.length,
    });
  }

  const successCount = results.filter((r) => !r.error).length;
  await ctx.admin.from("adaptive_homework_assignments")
    .update({ student_count: successCount, band_counts: bandCounts })
    .eq("id", assignmentId);

  return { assignment_id: assignmentId, title, student_count: successCount, band_counts: bandCounts, students: results };
}

// ── submit_answer: grade one item in the caller's own set ──────────────────
async function submitAnswer(ctx: Ctx, body: Row) {
  const { item_row_id, item_id, learning_objective_id, selected_option } = body;
  if (!item_row_id || !item_id || !learning_objective_id || !selected_option) {
    throw new HttpError(400, "item_row_id, item_id, learning_objective_id and selected_option are required");
  }

  // Ownership + tamper check: the row must be this student's own set, and
  // the item being answered must actually be one of the items it contains
  // (mirrors learning-path's "item belongs to that objective" check).
  const { data: itemRow, error: rowError } = await ctx.admin
    .from("adaptive_homework_items")
    .select("id, student_id, items, status")
    .eq("id", item_row_id)
    .eq("student_id", ctx.ownStudentId)
    .single();
  if (rowError || !itemRow) throw new HttpError(404, "Homework set not found", "set_not_found");
  if (itemRow.status === "submitted") throw new HttpError(400, "This homework has already been submitted", "already_submitted");

  const belongs = (itemRow.items as Row[]).some(
    (step) => step.item?.item_id === item_id && step.learning_objective_id === learning_objective_id,
  );
  if (!belongs) throw new HttpError(400, "That item is not part of this homework set", "item_not_in_set");

  const { data, error } = await ctx.asCaller.rpc("submit_adaptive_homework_answer", {
    p_item_row_id: item_row_id,
    p_student_id: ctx.ownStudentId,
    p_item_id: item_id,
    p_learning_objective_id: learning_objective_id,
    p_selected_option: selected_option,
  });
  if (error) throw new HttpError(500, error.message, "grade_failed");

  return data as Row;
}
