// supabase/functions/get-class-mastery/index.ts
//
// Deploy with:
//   supabase functions deploy get-class-mastery
//
// One function, three views, selected by `mode`:
//
// mode "mastery" (default)  CLASS MASTERY - teacher/admin only
//   Body: { class_id, book_id }
//   Aggregates every student on a class roster against one subject/book, topic
//   by topic, and flags weak spots (class average P(mastery) < 0.5).
//
// mode "readiness"          CLASS EXAM READINESS - teacher/admin only
//   Body: { mode: "readiness", class_id, book_id?, blueprint_id?, exam_date? }
//   Every student's exam readiness (0-100, band, coverage, confidence), a band
//   histogram, and each topic's class-average readiness. Same model as the
//   per-student view in get-prerequisite-readiness (view: "exam").
//
// mode "cohort"             COHORT INTELLIGENCE
//   Staff, a whole section:   { mode: "cohort", class_id, book_id? }
//     -> the section vs its class-group, grade and school; every section in the
//        class-group; the score distribution; per-topic gaps; and each
//        student's percentile at section/grade/school level with a pattern
//        label (below_all_levels, strong_in_section_weak_in_grade, ...).
//   Staff, one student:       { mode: "cohort", student_id, book_id? }
//   Student (their own):      { mode: "cohort", book_id? }
//     -> that student vs section / class / grade / school: percentile, rank,
//        gap to the average, and per-topic standing. A student only ever
//        receives aggregates - never another student's identity or score - and
//        any comparison group with fewer than 5 ranked students is withheld.
//
// Access: teachers only reach classes they are assigned to and students on
// those rosters; school-bound staff only their own school (see
// _shared/studentAccess.ts).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canStaffAccessClass, canStaffAccessStudent, resolveCaller, studentIdForProfile,
} from "../_shared/studentAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A student only sees a comparison group if at least this many peers are ranked in it. */
const MIN_GROUP_FOR_STUDENTS = 5;

function optionalBookId(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}

function parseExamDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? { ok: false } : { ok: true, value: v };
}

/** Strips anything that could single out one peer, and hides groups too small to be anonymous. */
function anonymiseForStudent(cmp: Row): Row {
  const levels: Row = {};
  for (const [lvl, raw] of Object.entries((cmp.levels ?? {}) as Row)) {
    const l = raw as Row;
    if ((l.compared_with ?? 0) < MIN_GROUP_FOR_STUDENTS) {
      levels[lvl] = { label: l.label, suppressed: true, reason: `Fewer than ${MIN_GROUP_FOR_STUDENTS} classmates have enough data to compare with` };
    } else {
      const { top_pct: _top, ...rest } = l;
      levels[lvl] = rest;
    }
  }
  const visible = new Set(Object.entries(levels).filter(([, l]) => !(l as Row).suppressed).map(([k]) => k));
  const topics = ((cmp.topics ?? []) as Row[]).map((t) => ({
    ...t,
    section_avg_pct: visible.has("section") ? t.section_avg_pct : null,
    class_avg_pct: visible.has("class") ? t.class_avg_pct : null,
    grade_avg_pct: visible.has("grade") ? t.grade_avg_pct : null,
    school_avg_pct: visible.has("school") ? t.school_avg_pct : null,
  }));
  return { ...cmp, levels, topics };
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
    if (!caller) return json({ error: "Not permitted" }, 403);

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode ?? "mastery";
    if (!["mastery", "readiness", "cohort"].includes(mode)) return json({ error: `Unknown mode "${mode}"` }, 400);

    const book = optionalBookId(body.book_id);
    if (!book.ok) return json({ error: "book_id must be a positive integer" }, 400);
    const bookId = book.value;

    let minObjectives = 5;
    if (body.min_objectives != null) {
      const n = Number(body.min_objectives);
      if (!Number.isInteger(n) || n < 1 || n > 50) return json({ error: "min_objectives must be an integer from 1 to 50" }, 400);
      minObjectives = n;
    }

    // ═════════════════════════════════════════════════════════════════
    // Cohort: a student looking at themself
    // ═════════════════════════════════════════════════════════════════
    if (mode === "cohort" && caller.role === "student") {
      const studentId = await studentIdForProfile(supabaseAdmin, user.id);
      if (!studentId) return json({ error: "Student record not found" }, 404);
      const { data, error } = await supabaseAdmin.rpc("get_student_cohort_comparison", {
        p_student_id: studentId, p_book_id: bookId, p_min_objectives: minObjectives,
      });
      if (error) throw error;
      return json(anonymiseForStudent(data as Row));
    }

    // Everything else is staff-only.
    if (!caller.isStaff) return json({ error: "Not permitted" }, 403);

    const classId = body.class_id ?? null;
    if (classId !== null && (typeof classId !== "string" || !UUID_RE.test(classId))) return json({ error: "class_id must be a valid id" }, 400);

    // ═════════════════════════════════════════════════════════════════
    // Cohort: staff
    // ═════════════════════════════════════════════════════════════════
    if (mode === "cohort") {
      if (classId) {
        const access = await canStaffAccessClass(supabaseAdmin, caller, classId);
        if (!access.ok) return json({ error: access.error }, access.status ?? 403);
        const { data, error } = await supabaseAdmin.rpc("get_class_cohort_intelligence", {
          p_class_id: classId, p_book_id: bookId, p_min_objectives: minObjectives,
        });
        if (error) throw error;
        return json(data);
      }
      const studentId = body.student_id;
      if (typeof studentId !== "string" || !UUID_RE.test(studentId)) return json({ error: "Provide class_id, or student_id" }, 400);
      const access = await canStaffAccessStudent(supabaseAdmin, caller, studentId);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      const { data, error } = await supabaseAdmin.rpc("get_student_cohort_comparison", {
        p_student_id: studentId, p_book_id: bookId, p_min_objectives: minObjectives,
      });
      if (error) throw error;
      return json(data);
    }

    // ═════════════════════════════════════════════════════════════════
    // Class exam readiness
    // ═════════════════════════════════════════════════════════════════
    if (mode === "readiness") {
      if (!classId) return json({ error: "class_id is required" }, 400);
      const blueprintId = body.blueprint_id ?? null;
      if (blueprintId !== null && (typeof blueprintId !== "string" || !UUID_RE.test(blueprintId))) return json({ error: "blueprint_id must be a valid id" }, 400);
      const examDate = parseExamDate(body.exam_date);
      if (!examDate.ok) return json({ error: "exam_date must be a real date in YYYY-MM-DD format" }, 400);

      const access = await canStaffAccessClass(supabaseAdmin, caller, classId);
      if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      if (!access.studentIds?.length) {
        return json({ class_id: classId, roster_size: 0, students_with_data: 0, class_avg_readiness: null, bands: {}, students: [], topics: [] });
      }
      const { data, error } = await supabaseAdmin.rpc("get_class_exam_readiness", {
        p_student_ids: access.studentIds, p_book_id: bookId, p_blueprint_id: blueprintId, p_exam_date: examDate.value,
      });
      if (error) throw error;
      return json({ class_id: classId, ...(data as Row) });
    }

    // ═════════════════════════════════════════════════════════════════
    // Default: class mastery by topic (unchanged behaviour)
    // ═════════════════════════════════════════════════════════════════
    const book_id = body.book_id;
    if (!classId || !book_id) return json({ error: "class_id and book_id are required" }, 400);

    const access = await canStaffAccessClass(supabaseAdmin, caller, classId);
    if (!access.ok) return json({ error: access.error }, access.status ?? 403);

    const studentIds = access.studentIds ?? [];
    if (studentIds.length === 0) return json({ class_id: classId, book_id, topics: [] });

    const { data, error } = await supabaseClient.rpc("get_class_mastery", {
      p_student_ids: studentIds,
      p_book_id: book_id,
    });
    if (error) throw error;

    return json({ class_id: classId, book_id, roster_size: studentIds.length, topics: data ?? [] });
  } catch (e) {
    console.error("get-class-mastery error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
