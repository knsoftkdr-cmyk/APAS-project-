// supabase/functions/_shared/handlers/academicForecast.ts
//
// Academic Forecasting Engine: predicts subject / class / school performance trends.
//
// Not a standalone edge function (deployment limit): `predict-performance` routes to this handler
// via its `action` field ("forecast_overview") - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   action "forecast_overview"   Body: { class_id? }  -> school, subject and class forecasts,
//                                                        a student watch-list and signals
//
// Read-only. Staff only (admin, principal, school_admin, hod, teacher). School-bound staff are always
// pinned to THEIR OWN school (a school_id in the body is ignored); teachers only see the classes they
// are assigned to. predict-performance's own behaviour (no auth, writes student_predictions) is untouched.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, STAFF_ROLES } from "../studentAccess.ts";
import { buildForecastOverview, type TestPoint } from "../academicForecastModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;
const MAX_ROWS = 60000;
const WINDOW_DAYS = 365;

async function fetchAll(build: () => any, cap = MAX_ROWS): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function handleAcademicForecast(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    const caller = await resolveCaller(admin, user.id);
    if (!caller || !STAFF_ROLES.includes(caller.role)) return json({ error: "Not permitted" }, 403);
    if (!caller.schoolId) return json({ error: "No school is associated with this account" }, 400);

    const body = await req.json().catch(() => ({}));
    const onlyClassId: string | undefined = body.class_id;
    if (onlyClassId !== undefined && (typeof onlyClassId !== "string" || !UUID_RE.test(onlyClassId))) {
      return json({ error: "class_id must be a valid id" }, 400);
    }

    // Classes of this school; teachers are limited to the ones they are assigned to.
    const { data: classRows, error: cErr } = await admin.from("classes").select("id, name, section").eq("school_id", caller.schoolId);
    if (cErr) throw cErr;
    let classes: Row[] = classRows ?? [];
    if (caller.role === "teacher") {
      const { data: mine } = await admin.from("class_teachers").select("class_id").eq("teacher_id", caller.userId);
      const mineIds = new Set((mine ?? []).map((r: Row) => r.class_id));
      classes = classes.filter((c) => mineIds.has(c.id));
    }
    if (onlyClassId) {
      classes = classes.filter((c) => c.id === onlyClassId);
      if (!classes.length) return json({ error: "Class not found or you are not assigned to it" }, 403);
    }

    // Rosters (students.id)
    const rosterByClass = new Map<string, string[]>();
    for (const part of chunk(classes.map((c) => c.id), 100)) {
      const rows = await fetchAll(() => admin.from("class_students").select("class_id, student_id").in("class_id", part).order("id"));
      for (const r of rows) {
        const l = rosterByClass.get(r.class_id) ?? [];
        l.push(r.student_id);
        rosterByClass.set(r.class_id, l);
      }
    }

    // Which students feed the school-level numbers: the whole school for school staff,
    // only rostered students for teachers (or when one class is requested).
    const narrow = caller.role === "teacher" || !!onlyClassId;
    const students: Row[] = []; // { id, profile_id, full_name }
    if (narrow) {
      const ids = [...new Set([...rosterByClass.values()].flat())];
      for (const part of chunk(ids, 150)) {
        const { data } = await admin.from("students").select("id, profile_id, full_name").in("id", part);
        students.push(...(data ?? []));
      }
    } else {
      const profiles = await fetchAll(() => admin.from("profiles").select("id").eq("school_id", caller.schoolId).eq("role", "student").order("id"));
      for (const part of chunk(profiles.map((p) => p.id), 150)) {
        const { data } = await admin.from("students").select("id, profile_id, full_name").in("profile_id", part);
        students.push(...(data ?? []));
      }
    }

    const studentByProfile = new Map<string, Row>(students.map((s) => [s.profile_id, s]));
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    const tests: TestPoint[] = [];
    for (const part of chunk([...studentByProfile.keys()], 150)) {
      const rows = await fetchAll(() => admin.from("academic_tests")
        .select("student_id, subject, score, total_questions, completed_at")
        .in("student_id", part).gte("completed_at", since).order("id"));
      for (const r of rows) {
        const s = studentByProfile.get(r.student_id);
        if (!s || !r.subject || !(r.total_questions > 0)) continue;
        const at = Date.parse(r.completed_at);
        if (!Number.isFinite(at)) continue;
        tests.push({ studentId: s.id, subject: r.subject, pct: Math.max(0, Math.min(100, (r.score / r.total_questions) * 100)), at });
      }
    }

    const overview = buildForecastOverview({
      tests,
      classes: classes.map((c) => ({ id: c.id, name: c.name, section: c.section ?? null, studentIds: rosterByClass.get(c.id) ?? [] })),
      studentNames: new Map(students.map((s) => [s.id, s.full_name || "Student"])),
      scope: narrow ? "teacher" : "school",
    });
    return json(overview);
  } catch (e) {
    console.error("academicForecast error:", e);
    return json({ error: e instanceof Error ? e.message : (e as any)?.message ?? "Unknown error" }, 500);
  }
}
