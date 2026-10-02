// supabase/functions/_shared/handlers/studentTwin.ts
//
// Student Digital Learning Twin: a continuously updated model of one learner's ability, preferences
// and progression.
//
// Not a standalone edge function (deployment limit): `get-mastery-history` routes to this handler via
// its `action` field ("student_twin") - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   action "student_twin"   Body: { student_id? }   (students.id; omitted for a student viewing themself)
//
// Access: a student sees only their own twin; a parent sees only linked children (parent_students);
// staff follow the same rules as the exam-readiness views (own school; teachers only their students).
// Each view stores at most one snapshot per student per day in student_learning_twin_snapshots so
// progression has history. If that migration hasn't been applied the twin still works, without history.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCaller, studentIdForProfile, canStaffAccessStudent } from "../studentAccess.ts";
import { buildStudentTwin } from "../studentTwinModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESENT_LIKE = new Set(["present", "late", "half_day"]);
const HISTORY_DAYS = 365;
const MAX_ROWS = 5000;

export async function handleStudentTwin(req: Request): Promise<Response> {
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
    if (!caller) return json({ error: "Profile not found" }, 403);

    const body = await req.json().catch(() => ({}));
    let studentId: string | null = typeof body.student_id === "string" ? body.student_id : null;
    if (studentId !== null && !UUID_RE.test(studentId)) return json({ error: "student_id must be a valid id" }, 400);

    // ── who may see this twin ──────────────────────────────────────────────────────────────────
    if (caller.role === "student") {
      const own = await studentIdForProfile(admin, user.id);
      if (!own) return json({ error: "No student record found for this account" }, 404);
      if (studentId && studentId !== own) return json({ error: "Not permitted" }, 403);
      studentId = own;
    } else {
      if (!studentId) return json({ error: "student_id is required" }, 400);
      if (caller.role === "parent") {
        const { data: target } = await admin.from("students").select("profile_id").eq("id", studentId).maybeSingle();
        if (!target) return json({ error: "Student not found" }, 404);
        const { data: link } = await admin.from("parent_students").select("student_id")
          .eq("parent_id", user.id).eq("student_id", target.profile_id).maybeSingle();
        if (!link) return json({ error: "Not permitted" }, 403);
      } else if (caller.isStaff) {
        const access = await canStaffAccessStudent(admin, caller, studentId);
        if (!access.ok) return json({ error: access.error }, access.status ?? 403);
      } else {
        return json({ error: "Not permitted" }, 403);
      }
    }

    // ── evidence ───────────────────────────────────────────────────────────────────────────────
    const { data: student } = await admin.from("students").select("id, profile_id, full_name, vark_type").eq("id", studentId).maybeSingle();
    if (!student) return json({ error: "Student not found" }, 404);

    const now = Date.now();
    const since = new Date(now - HISTORY_DAYS * 86400000).toISOString();
    const attSince = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

    const [testsRes, masteryRes, abilityRes, attRes] = await Promise.all([
      admin.from("academic_tests").select("subject, score, total_questions, completed_at")
        .eq("student_id", student.profile_id).gte("completed_at", since).order("completed_at", { ascending: false }).limit(MAX_ROWS),
      admin.from("student_mastery").select("p_mastery, opportunities_count, last_evidence_at")
        .eq("student_id", studentId).limit(MAX_ROWS),
      admin.from("student_ability").select("scope_id, theta, n_items").eq("student_id", studentId).eq("scope_type", "subject"),
      admin.from("attendance_records").select("status").eq("student_id", studentId).gte("date", attSince).limit(MAX_ROWS),
    ]);

    const tests = (testsRes.data ?? []).flatMap((r: Row) => {
      const at = Date.parse(r.completed_at);
      if (!r.subject || !(r.total_questions > 0) || !Number.isFinite(at)) return [];
      return [{ subject: r.subject as string, pct: Math.max(0, Math.min(100, (r.score / r.total_questions) * 100)), at }];
    });
    const mastery = (masteryRes.data ?? []).map((r: Row) => ({
      p: Number(r.p_mastery), opportunities: Number(r.opportunities_count ?? 0),
      lastAt: r.last_evidence_at ? Date.parse(r.last_evidence_at) : null,
    }));

    // adaptive ability is stored per book (scope_id = books.id); the book's subject names it
    const adaptive: { subject: string; theta: number; items: number }[] = [];
    const abilityRows: Row[] = abilityRes.data ?? [];
    if (abilityRows.length) {
      const { data: books } = await admin.from("books").select("id, subject").in("id", abilityRows.map((a) => a.scope_id));
      const subjectOf = new Map<number, string>((books ?? []).filter((b: Row) => b.subject).map((b: Row) => [b.id, b.subject]));
      for (const a of abilityRows) {
        const subject = subjectOf.get(a.scope_id);
        if (subject) adaptive.push({ subject, theta: Number(a.theta), items: Number(a.n_items ?? 0) });
      }
    }

    const attRows: Row[] = attRes.data ?? [];
    const attendance = attRows.length
      ? { present: attRows.filter((r) => PRESENT_LIKE.has(r.status)).length, total: attRows.length }
      : null;

    // ── earlier snapshots (optional table) ─────────────────────────────────────────────────────
    const today = new Date(now).toISOString().slice(0, 10);
    let history: { date: string; overall: number | null }[] = [];
    let snapshotsAvailable = true;
    {
      const { data, error } = await admin.from("student_learning_twin_snapshots")
        .select("snapshot_date, overall_ability").eq("student_id", studentId).lt("snapshot_date", today)
        .order("snapshot_date", { ascending: false }).limit(12);
      if (error) snapshotsAvailable = false;
      else history = (data ?? []).reverse().map((r: Row) => ({ date: r.snapshot_date, overall: r.overall_ability === null ? null : Number(r.overall_ability) }));
    }

    const twin = buildStudentTwin({ now, tests, mastery, adaptive, attendance, vark: student.vark_type ?? null, history });

    if (snapshotsAvailable) {
      const { error } = await admin.from("student_learning_twin_snapshots").upsert({
        student_id: studentId, snapshot_date: today, overall_ability: twin.overall_ability,
        risk_level: twin.risk.level, payload: twin,
      }, { onConflict: "student_id,snapshot_date" });
      if (!error) twin.progression.history = [...history, { date: today, overall: twin.overall_ability }];
    }

    return json({ student: { id: student.id, name: student.full_name || "Student" }, twin });
  } catch (e) {
    console.error("studentTwin error:", e);
    return json({ error: e instanceof Error ? e.message : (e as any)?.message ?? "Unknown error" }, 500);
  }
}
