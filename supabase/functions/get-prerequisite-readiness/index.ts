// supabase/functions/get-prerequisite-readiness/index.ts
//
// Deploy with:
//   supabase functions deploy get-prerequisite-readiness
//
// Two views, selected by `view`:
//
// 1) (default) PREREQUISITE READINESS - "are this concept's prerequisites in place?"
//    Body: { subtopic_id, student_id? }
//    Returns each direct prerequisite's current mastery for that student and an
//    overall readiness score/flag - call this before assigning or recommending
//    a concept.
//
// 2) view: "exam"  EXAM READINESS SCORE - "how ready is this student for the exam?"
//    Body: { view: "exam", student_id?, book_id?, blueprint_id?, exam_date? }
//      book_id       limit to one subject (omit for every subject)
//      blueprint_id  also return the score weighted by that exam's syllabus
//                    weightage (marks per chapter/topic), i.e. the predicted
//                    mark on THAT paper
//      exam_date     YYYY-MM-DD; project retention forward to that day using the
//                    forgetting curve so the score reflects what the student is
//                    likely to still remember on exam day, not today
//    Returns readiness by topic -> chapter -> subject -> overall (0-100), a
//    band, evidence coverage + confidence, the topics/concepts to study first,
//    Bloom-level readiness, and recent mock-exam results. See
//    get_exam_readiness() in 20261006000000_exam_readiness_simulation_cohort.sql
//    for the exact model.
//
// Students: student_id is resolved from their own profile (any value they
// pass is ignored). Staff: pass student_id explicitly. For the exam view a
// teacher may only request students on a roster they teach, and school-bound
// staff may only request students in their own school.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canStaffAccessStudent, resolveCaller, studentIdForProfile } from "../_shared/studentAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseExamDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { ok: false };
  return { ok: true, value: v };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const caller = await resolveCaller(supabaseAdmin, user.id);
    if (!caller) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    const { subtopic_id, student_id, view } = body;

    // ── Resolve which student this request is about ───────────────────
    let targetStudentId: string | null = null;
    if (caller.role === "student") {
      targetStudentId = await studentIdForProfile(supabaseAdmin, user.id);
    } else if (caller.isStaff) {
      if (!student_id) return json({ error: "student_id is required for staff requests" }, 400);
      targetStudentId = student_id;
    } else {
      return json({ error: "Not permitted" }, 403);
    }
    if (!targetStudentId) return json({ error: "Student record not found" }, 404);

    // ═════════════════════════════════════════════════════════════════
    // View 2: exam readiness
    // ═════════════════════════════════════════════════════════════════
    if (view === "exam") {
      if (caller.isStaff) {
        if (typeof targetStudentId !== "string" || !UUID_RE.test(targetStudentId)) return json({ error: "student_id must be a valid id" }, 400);
        const access = await canStaffAccessStudent(supabaseAdmin, caller, targetStudentId);
        if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      }

      const bookId = body.book_id == null || body.book_id === "" ? null : Number(body.book_id);
      if (bookId !== null && (!Number.isInteger(bookId) || bookId <= 0)) return json({ error: "book_id must be a positive integer" }, 400);

      const blueprintId = body.blueprint_id ?? null;
      if (blueprintId !== null && (typeof blueprintId !== "string" || !UUID_RE.test(blueprintId))) {
        return json({ error: "blueprint_id must be a valid id" }, 400);
      }

      const examDate = parseExamDate(body.exam_date);
      if (!examDate.ok) return json({ error: "exam_date must be a real date in YYYY-MM-DD format" }, 400);

      // Service role: get_exam_readiness is not exposed to browser JWTs (it reads
      // any student's mastery); the checks above are the access control.
      const { data, error } = await supabaseAdmin.rpc("get_exam_readiness", {
        p_student_id: targetStudentId,
        p_book_id: bookId,
        p_blueprint_id: blueprintId,
        p_exam_date: examDate.value,
      });
      if (error) throw error;
      return json(data);
    }

    // ═════════════════════════════════════════════════════════════════
    // View 1 (default): prerequisite readiness for one concept
    // ═════════════════════════════════════════════════════════════════
    if (!subtopic_id) return json({ error: "subtopic_id is required" }, 400);

    const { data, error } = await supabaseClient.rpc("get_prerequisite_readiness", {
      p_student_id: targetStudentId,
      p_subtopic_id: subtopic_id,
    });
    if (error) throw error;
    return json(data);
  } catch (e) {
    console.error("get-prerequisite-readiness error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
