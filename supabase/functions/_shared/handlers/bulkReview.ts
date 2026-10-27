// supabase/functions/_shared/handlers/bulkReview.ts
//
// BULK ACTIONS (sheet row 45). Not a standalone edge function (deployment limit): `evaluate-assessment`
// routes to it via action "bulk_review" - see _shared/mergedRouter.ts.
//
// Review many exam answer sheets at once, SAFELY:
//   op "preview" { attempt_ids[] }                 -> exactly what "apply" would do; changes nothing
//   op "apply"   { attempt_ids[], feedback? }      -> confirms every pending written answer that HAS an AI mark,
//                                                     using the AI mark (and the AI feedback, or `feedback` if given);
//                                                     answers without an AI mark are skipped, never guessed
//   op "undo"    { batch_id }                       -> restores every value the batch changed (24 h window, own batches)
//   op "list"    {}                                 -> the caller's last 10 batches
//
// Safety rules: max 100 attempts per batch; teachers only touch attempts from their own classes / their own
// assignments; school staff only their school; the plan is recomputed on the server at apply time (the preview
// is never trusted); every change is recorded with its previous value so the batch can be undone.

// deno-lint-ignore-file no-explicit-any
import { authenticateStaff, corsHeaders, json, UUID_RE } from "../learningGroupsData.ts";
import type { Caller } from "../studentAccess.ts";

type Row = Record<string, any>;
const MAX_ATTEMPTS = 100;
const UNDO_WINDOW_MS = 24 * 3600 * 1000;
const STAFF_ADMINS = ["admin", "principal", "school_admin", "hod"];

/** Attempts the caller may review, with the student's name. Unknown / forbidden ids are reported, not used. */
async function allowedAttempts(admin: any, caller: Caller, ids: string[]) {
  const { data: attempts, error } = await admin.from("generated_assessment_paper_attempts")
    .select("id, status, total_score, open_ended_teacher_score, graded_at, mcq_score, assignment_id, student_id, students(full_name, school_id), generated_assessment_paper_assignments(title, class_id, assigned_by)")
    .in("id", ids);
  if (error) throw new Error(error.message);

  let teacherClasses = new Set<string>();
  if (!STAFF_ADMINS.includes(caller.role)) {
    const { data } = await admin.from("class_teachers").select("class_id").eq("teacher_id", caller.userId);
    teacherClasses = new Set((data ?? []).map((r: Row) => r.class_id));
  }
  const ok: Row[] = [];
  const denied: string[] = [];
  for (const a of attempts ?? []) {
    const asg = a.generated_assessment_paper_assignments ?? {};
    const sameSchool = !caller.schoolId || !a.students?.school_id || a.students.school_id === caller.schoolId;
    const allowed = STAFF_ADMINS.includes(caller.role)
      ? sameSchool
      : sameSchool && (asg.assigned_by === caller.userId || (asg.class_id && teacherClasses.has(asg.class_id)));
    (allowed ? ok : denied).push(allowed ? a : a.id);
  }
  for (const id of ids) if (!(attempts ?? []).some((a: Row) => a.id === id)) denied.push(id);
  return { ok, denied };
}

async function buildPlan(admin: any, attempts: Row[]) {
  const ids = attempts.map((a) => a.id);
  const { data: subs, error } = ids.length
    ? await admin.from("open_response_submissions")
      .select("id, source_id, item_id, status, ai_suggested_score, ai_feedback, teacher_score, teacher_feedback, graded_by, graded_at")
      .eq("source", "test").in("source_id", ids)
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const pending = (subs ?? []).filter((s: Row) => s.status !== "teacher_reviewed");
  const confirm = pending.filter((s: Row) => s.ai_suggested_score != null);
  const skipped = pending.filter((s: Row) => s.ai_suggested_score == null).map((s: Row) => ({ submission_id: s.id, attempt_id: s.source_id, reason: "No AI mark - review this answer yourself" }));
  const perAttempt = attempts.map((a) => {
    const mine = pending.filter((s: Row) => s.source_id === a.id);
    const ok = mine.filter((s: Row) => s.ai_suggested_score != null);
    return {
      attempt_id: a.id, student: a.students?.full_name ?? "Student", exam: a.generated_assessment_paper_assignments?.title ?? "Exam",
      pending: mine.length, will_confirm: ok.length, will_skip: mine.length - ok.length,
      ai_marks: Math.round(ok.reduce((s: number, x: Row) => s + Number(x.ai_suggested_score), 0) * 100) / 100,
      becomes_final: mine.length > 0 && ok.length === mine.length,
    };
  });
  return { confirm, skipped, perAttempt };
}

export async function handleBulkReview(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateStaff(req);
    if (!auth.ok) return auth.res;
    const { admin, caller, userId } = auth.ctx;
    const body = await req.json().catch(() => ({}));
    const op = String(body.op ?? "");

    if (op === "list") {
      const { data } = await admin.from("exam_review_batches").select("id, action, changed_count, skipped, attempt_ids, created_at, undone_at")
        .eq("performed_by", userId).order("created_at", { ascending: false }).limit(10);
      return json({
        batches: (data ?? []).map((b: Row) => ({
          id: b.id, action: b.action, changed: b.changed_count, skipped: (b.skipped ?? []).length, attempts: (b.attempt_ids ?? []).length,
          created_at: b.created_at, undone_at: b.undone_at,
          can_undo: !b.undone_at && Date.now() - new Date(b.created_at).getTime() < UNDO_WINDOW_MS,
        })),
      });
    }

    if (op === "undo") {
      if (!UUID_RE.test(String(body.batch_id))) return json({ error: "batch_id is required" }, 400);
      const { data: batch } = await admin.from("exam_review_batches").select("*").eq("id", body.batch_id).maybeSingle();
      if (!batch || batch.performed_by !== userId) return json({ error: "Batch not found" }, 404);
      if (batch.undone_at) return json({ error: "This batch was already undone" }, 409);
      if (Date.now() - new Date(batch.created_at).getTime() > UNDO_WINDOW_MS) return json({ error: "Batches can only be undone within 24 hours" }, 409);

      let restored = 0;
      const untouchedAttempts = new Set<string>();
      for (const p of batch.previous?.submissions ?? []) {
        // Only roll back answers nobody has re-marked since this batch.
        const { data: cur } = await admin.from("open_response_submissions").select("graded_by, graded_at, source_id").eq("id", p.id).maybeSingle();
        // (compare as instants: the DB returns "+00:00" where the batch stored "Z")
        if (!cur || cur.graded_by !== userId || Date.parse(cur.graded_at) !== Date.parse(p.batch_graded_at)) continue;
        const { error } = await admin.from("open_response_submissions").update({
          status: p.status, teacher_score: p.teacher_score, teacher_feedback: p.teacher_feedback, graded_by: p.graded_by, graded_at: p.graded_at,
        }).eq("id", p.id);
        if (error) throw new Error(error.message);
        restored++;
        untouchedAttempts.add(cur.source_id);
      }
      for (const a of batch.previous?.attempts ?? []) {
        if (!untouchedAttempts.has(a.id)) continue;
        await admin.from("generated_assessment_paper_attempts").update({
          status: a.status, total_score: a.total_score, open_ended_teacher_score: a.open_ended_teacher_score, graded_at: a.graded_at,
        }).eq("id", a.id);
      }
      await admin.from("exam_review_batches").update({ undone_at: new Date().toISOString(), undone_by: userId }).eq("id", batch.id);
      return json({ restored, not_restored: (batch.previous?.submissions ?? []).length - restored });
    }

    if (op !== "preview" && op !== "apply") return json({ error: "Unknown op" }, 400);
    const ids = [...new Set((Array.isArray(body.attempt_ids) ? body.attempt_ids : []).map(String))].filter((id) => UUID_RE.test(id));
    if (!ids.length) return json({ error: "Select at least one answer sheet" }, 400);
    if (ids.length > MAX_ATTEMPTS) return json({ error: `At most ${MAX_ATTEMPTS} answer sheets per batch` }, 400);

    const { ok, denied } = await allowedAttempts(admin, caller, ids);
    const plan = await buildPlan(admin, ok);
    const summary = {
      attempts: ok.length, denied: denied.length, will_confirm: plan.confirm.length, will_skip: plan.skipped.length,
      becomes_final: plan.perAttempt.filter((a) => a.becomes_final).length, per_attempt: plan.perAttempt,
    };
    if (op === "preview") return json(summary);

    if (!plan.confirm.length) return json({ error: "Nothing to confirm - none of the selected answers has an AI mark" }, 409);
    const feedback = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim().slice(0, 1000) : null;
    const now = new Date().toISOString();

    // Record previous values BEFORE changing anything.
    const { data: batch, error: bErr } = await admin.from("exam_review_batches").insert({
      performed_by: userId, action: "accept_ai", feedback, attempt_ids: ok.map((a) => a.id), skipped: plan.skipped,
      previous: {
        submissions: plan.confirm.map((s: Row) => ({
          id: s.id, status: s.status, teacher_score: s.teacher_score, teacher_feedback: s.teacher_feedback,
          graded_by: s.graded_by, graded_at: s.graded_at, batch_graded_at: now,
        })),
        attempts: ok.map((a) => ({ id: a.id, status: a.status, total_score: a.total_score, open_ended_teacher_score: a.open_ended_teacher_score, graded_at: a.graded_at })),
      },
    }).select("id").single();
    if (bErr) throw new Error(bErr.message);

    let changed = 0;
    for (const s of plan.confirm) {
      const { error } = await admin.from("open_response_submissions").update({
        teacher_score: s.ai_suggested_score, teacher_feedback: feedback ?? s.ai_feedback ?? null,
        status: "teacher_reviewed", graded_by: userId, graded_at: now,
      }).eq("id", s.id).neq("status", "teacher_reviewed"); // never overwrite an answer a teacher confirmed meanwhile
      if (error) throw new Error(error.message);
      changed++;
    }
    await admin.from("exam_review_batches").update({ changed_count: changed }).eq("id", batch.id);
    return json({ batch_id: batch.id, ...summary, changed });
  } catch (e) {
    console.error("bulk-review error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
