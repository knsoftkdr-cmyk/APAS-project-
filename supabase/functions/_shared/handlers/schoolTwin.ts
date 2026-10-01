// supabase/functions/_shared/handlers/schoolTwin.ts
//
// School Academic Digital Twin + What-If Academic Simulation.
//
// Not a standalone edge function (deployment limit): `whatif-timetable` routes to this handler via
// its `mode` field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   mode "twin_snapshot"             Body: { class_id? }                         -> live twin of the school
//   mode "academic_simulation_options" Body: {}                                  -> classes/subjects/teachers to pick from
//   mode "academic_simulation"       Body: { class_id, scenarios: [{ subject, extra_periods?,
//                                      remedial_periods?, remedial_target?, weeks?, teacher_id?, label? }] }
//
// Read-only: nothing is written to the database. Staff only (admin, principal, school_admin, hod,
// teacher). Staff are always scoped to THEIR OWN school (a school_id in the body is ignored for
// school-bound accounts); teachers only see classes they are assigned to.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller } from "../studentAccess.ts";
import {
  buildTwinSnapshot, listClassOptions, simulateScenarios, validateScenario, chapterKey,
  type Agg, type SchoolData, MAX_WEEKS,
} from "../schoolTwinModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESENT_LIKE = new Set(["present", "late", "half_day"]);
const ATTENDANCE_WINDOW_DAYS = 30;
const LESSON_WINDOW_WEEKS = 8;
const PAGE = 1000;
const MAX_ROWS = 60000;
const MAX_MASTERY_ROWS = 40000;
const ROLES = ["admin", "principal", "school_admin", "hod", "teacher"];

/** Pages through a query (PostgREST caps responses at 1000 rows). `build` must return a fresh query each call. */
async function fetchAll(build: () => any, cap = MAX_ROWS): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function loadSchoolData(admin: any, schoolId: string, caller: { userId: string; role: string }, onlyClassId?: string): Promise<SchoolData> {
  const { data: classes, error: cErr } = await admin.from("classes").select("id, name, section").eq("school_id", schoolId);
  if (cErr) throw cErr;
  const classRows: Row[] = classes ?? [];
  const classIds = classRows.map((c) => c.id);

  const assignments: Row[] = [];
  for (const part of chunk(classIds, 200)) {
    const { data, error } = await admin.from("class_teachers").select("class_id, teacher_id, subject").in("class_id", part);
    if (error) throw error;
    assignments.push(...(data ?? []));
  }

  // Scope: teachers see only classes they are assigned to; an explicit class_id narrows further.
  let scope = new Set<string>(classIds);
  if (caller.role === "teacher") {
    scope = new Set(assignments.filter((a) => a.teacher_id === caller.userId).map((a) => a.class_id));
  }
  if (onlyClassId) scope = new Set([...scope].filter((id) => id === onlyClassId));

  // Teacher names (school's own teachers + anyone assigned to a class)
  const teacherIds = [...new Set(assignments.map((a) => a.teacher_id))];
  const teacherNames = new Map<string, string>();
  for (const part of chunk(teacherIds, 200)) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", part);
    (data ?? []).forEach((p: Row) => teacherNames.set(p.id, p.full_name || "Unknown Teacher"));
  }

  // Rosters for classes in scope
  const scopeIds = [...scope];
  const studentsByClass = new Map<string, string[]>();
  const allStudentIds = new Set<string>();
  for (const part of chunk(scopeIds, 100)) {
    const { rows } = await fetchAll(() => admin.from("class_students").select("class_id, student_id").in("class_id", part).order("id"));
    for (const r of rows) {
      const l = studentsByClass.get(r.class_id) ?? [];
      l.push(r.student_id);
      studentsByClass.set(r.class_id, l);
      allStudentIds.add(r.student_id);
    }
  }
  const studentIds = [...allStudentIds];

  const studentNames = new Map<string, string>();
  const predictions: Row[] = [];
  const mastery = new Map<string, Agg>();
  const attendance = new Map<string, Agg>();
  let masterySampled = false;

  const since = new Date(Date.now() - ATTENDANCE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  for (const part of chunk(studentIds, 150)) {
    const [{ data: names }, preds] = await Promise.all([
      admin.from("students").select("id, full_name").in("id", part),
      fetchAll(() => admin.from("student_predictions")
        .select("student_id, subject, predicted_score_next_test, risk_level, dropout_risk_percentage, confidence_score, updated_at")
        .in("student_id", part).order("id")),
    ]);
    (names ?? []).forEach((s: Row) => studentNames.set(s.id, s.full_name || "Student"));
    predictions.push(...preds.rows);

    const att = await fetchAll(() => admin.from("attendance_records").select("student_id, status")
      .eq("school_id", schoolId).in("student_id", part).gte("date", since).order("id"), 20000);
    for (const r of att.rows) {
      const a = attendance.get(r.student_id) ?? { sum: 0, n: 0 };
      a.n++;
      if (PRESENT_LIKE.has(r.status)) a.sum++;
      attendance.set(r.student_id, a);
    }

    // mastery is the largest table - bounded; the flag tells the UI it is a sample
    if (!masterySampled) {
      const m = await fetchAll(() => admin.from("student_mastery").select("student_id, p_mastery")
        .in("student_id", part).gt("opportunities_count", 0).order("id"), MAX_MASTERY_ROWS);
      if (m.truncated) masterySampled = true;
      for (const r of m.rows) {
        const a = mastery.get(r.student_id) ?? { sum: 0, n: 0 };
        a.sum += Number(r.p_mastery); a.n++;
        mastery.set(r.student_id, a);
      }
    } else {
      masterySampled = true;
    }
  }

  // Teacher attendance (school's teachers)
  const teacherAttendance = new Map<string, Agg>();
  if (teacherIds.length) {
    const { rows } = await fetchAll(() => admin.from("teacher_attendance").select("teacher_id, status")
      .eq("school_id", schoolId).gte("date", since).order("id"), 20000);
    for (const r of rows) {
      const a = teacherAttendance.get(r.teacher_id) ?? { sum: 0, n: 0 };
      a.n++;
      if (PRESENT_LIKE.has(r.status)) a.sum++;
      teacherAttendance.set(r.teacher_id, a);
    }
  }

  // Timetables are always loaded school-wide: teacher busy-slots must include other classes.
  const { data: timetables, error: ttErr } = await admin.from("timetables")
    .select("class_grade, section, parsed_grid").eq("school_id", schoolId).not("parsed_grid", "is", null);
  if (ttErr) throw ttErr;

  // Lessons taught in this school (same source as Syllabus Coverage)
  const lessonsRes = await fetchAll(() => admin.from("lessons").select("teacher_id, class_level, subject, created_at")
    .eq("school_id", schoolId).order("created_at", { ascending: false }), 30000);

  // Chapters per class+subject from the school's books
  const chaptersByKey = new Map<string, number>();
  const { data: books } = await admin.from("books").select("id, class_name, subject").eq("school_id", schoolId);
  const bookById = new Map<number, Row>((books ?? []).map((b: Row) => [b.id, b]));
  if (bookById.size) {
    const unitToBook = new Map<number, number>();
    for (const part of chunk([...bookById.keys()], 200)) {
      const { rows } = await fetchAll(() => admin.from("units").select("id, book_id").in("book_id", part).order("id"));
      rows.forEach((u) => unitToBook.set(u.id, u.book_id));
    }
    for (const part of chunk([...unitToBook.keys()], 200)) {
      const { rows } = await fetchAll(() => admin.from("curriculum_chapters").select("id, unit_id").in("unit_id", part).order("id"));
      for (const ch of rows) {
        const book = bookById.get(unitToBook.get(ch.unit_id)!);
        if (!book?.class_name || !book?.subject) continue;
        const k = chapterKey(book.class_name, book.subject);
        chaptersByKey.set(k, (chaptersByKey.get(k) ?? 0) + 1);
      }
    }
  }

  return {
    schoolId, classes: classRows as any, assignments: assignments as any, teacherNames, studentsByClass, studentNames,
    predictions: predictions as any, mastery, masterySampled, attendance, teacherAttendance,
    timetables: (timetables ?? []) as any, lessons: lessonsRes.rows as any, chaptersByKey,
    scopeClassIds: scope, windowDays: ATTENDANCE_WINDOW_DAYS, lessonWindowWeeks: LESSON_WINDOW_WEEKS,
  };
}

export async function handleSchoolTwin(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const caller = await resolveCaller(admin, user.id);
    if (!caller || !ROLES.includes(caller.role)) return json({ error: "Not permitted" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as "snapshot" | "options" | "simulate";

    // School-bound staff are pinned to their own school. Only an account with no school (platform-level
    // staff) may name one explicitly.
    const schoolId: string | null = caller.schoolId ?? (typeof body.school_id === "string" && UUID_RE.test(body.school_id) ? body.school_id : null);
    if (!schoolId) return json({ error: "No school is associated with this account" }, 400);

    const classId: string | undefined = body.class_id;
    if (classId !== undefined && (typeof classId !== "string" || !UUID_RE.test(classId))) return json({ error: "class_id must be a valid id" }, 400);

    if (action === "snapshot") {
      const data = await loadSchoolData(admin, schoolId, caller, classId);
      if (classId && !data.scopeClassIds.has(classId)) return json({ error: "You don't have access to this class" }, 403);
      return json(buildTwinSnapshot(data, caller.role === "teacher" ? "teacher" : "school"));
    }

    if (action === "options") {
      const data = await loadSchoolData(admin, schoolId, caller);
      const teachers = [...data.teacherNames.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
      return json({ classes: listClassOptions(data), teachers, max_weeks: MAX_WEEKS });
    }

    if (action === "simulate") {
      if (!classId) return json({ error: "class_id is required" }, 400);
      if (!Array.isArray(body.scenarios) || body.scenarios.length < 1 || body.scenarios.length > 4) {
        return json({ error: "Provide between 1 and 4 scenarios" }, 400);
      }
      const validated = [];
      for (const raw of body.scenarios) {
        const v = validateScenario(raw);
        if (!v.ok) return json({ error: v.error }, 400);
        validated.push(v.value);
      }
      const data = await loadSchoolData(admin, schoolId, caller, classId);
      if (!data.scopeClassIds.has(classId)) {
        const exists = data.classes.some((c) => c.id === classId);
        return json({ error: exists ? "You are not assigned to this class" : "Class not found" }, exists ? 403 : 404);
      }
      for (const v of validated) {
        if (v.teacher_id && !data.teacherNames.has(v.teacher_id)) return json({ error: "The chosen teacher isn't a teacher at this school" }, 400);
      }
      return json(simulateScenarios(data, classId, validated));
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("schoolTwin error:", e);
    return json({ error: e instanceof Error ? e.message : (e as any)?.message ?? "Unknown error" }, 500);
  }
}
