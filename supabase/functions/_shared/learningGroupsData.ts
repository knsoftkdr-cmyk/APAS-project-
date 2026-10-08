// supabase/functions/_shared/learningGroupsData.ts
//
// Auth + data loading shared by the three handlers added for Peer Group Identification,
// Dynamic Student Grouping and the Teacher Copilot. Served through the existing anchors
// (get-class-mastery, ai-teacher-assistant) - see _shared/mergedRouter.ts. No new edge function.
//
// Signals come from the same RPCs the Class Mastery / Early Warning dashboards already use:
//   cohort_student_scores / cohort_topic_scores  (BKT mastery per student / per topic)
//   get_class_velocity                            (learning pace)
//   get_class_risk_roster                         (early-warning risk)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type Caller, resolveCaller } from "./studentAccess.ts";
import type { Pace, RiskLevel, StudentSignal, TopicScore } from "./learningGroupsCore.ts";

type Row = Record<string, any>;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthContext {
  admin: any;
  userClient: any;
  userId: string;
  caller: Caller;
}

/** Verifies the JWT and resolves the caller. Staff only. Returns a ready-made error Response on failure. */
export async function authenticateStaff(req: Request): Promise<{ ok: true; ctx: AuthContext } | { ok: false; res: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, res: json({ error: "Missing authorization" }, 401) };

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { ok: false, res: json({ error: "Not authenticated" }, 401) };

  const caller = await resolveCaller(admin, user.id);
  if (!caller || !caller.isStaff) return { ok: false, res: json({ error: "Not permitted" }, 403) };

  return { ok: true, ctx: { admin, userClient, userId: user.id, caller } };
}

/** null/""  -> null (all subjects); positive integer -> number; anything else -> invalid. */
export function parseBookId(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v == null || v === "" || v === "all") return { ok: true, value: null };
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}

export function parseMinObjectives(v: unknown): { ok: true; value: number } | { ok: false } {
  if (v == null) return { ok: true, value: 3 };
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? { ok: true, value: n } : { ok: false };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};


/**
 * student_id -> display name. Names live on `profiles` (students.profile_id -> profiles.full_name); some
 * deployments also have a denormalised students.full_name, so it is tried too but never required.
 * A lookup failure never breaks a request: callers fall back to "Student".
 */
export async function loadStudentNames(admin: any, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data: studs, error } = await admin.from("students").select("id, profile_id").in("id", ids);
  if (error) { console.error("student name lookup failed (non-fatal)", error); return out; }
  const profileIds = [...new Set(((studs ?? []) as Row[]).map((r) => r.profile_id).filter(Boolean))];
  const nameByProfile = new Map<string, string>();
  if (profileIds.length) {
    const { data: profs, error: pErr } = await admin.from("profiles").select("id, full_name").in("id", profileIds);
    if (pErr) console.error("profile name lookup failed (non-fatal)", pErr);
    for (const r of (profs ?? []) as Row[]) if (r.full_name) nameByProfile.set(r.id, r.full_name);
  }
  for (const r of (studs ?? []) as Row[]) {
    const n = nameByProfile.get(r.profile_id);
    if (n) out.set(r.id, n);
  }
  return out;
}

export interface ClassSignals {
  classId: string;
  className: string | null;
  signals: Array<StudentSignal & { gain: number | null }>;
  warnings: string[];
}

function riskFromCauses(core: Row | undefined): RiskLevel | null {
  if (!core) return null;
  const causes: Row[] = Array.isArray(core.causes) ? core.causes : [];
  if (causes.some((c) => c.evidence_strength === "strong")) return "high";
  if (causes.some((c) => c.evidence_strength === "moderate")) return "medium";
  if (causes.some((c) => c.evidence_strength === "none")) return "low";
  return "insufficient_data";
}

/**
 * One StudentSignal per rostered student. Mastery/topic scores are required (a failure throws);
 * velocity and risk are best-effort enrichments (a failure adds a warning and leaves those fields null).
 * Students with fewer than `minObjectives` assessed objectives get score = null ("not enough data").
 */
export async function loadClassSignals(
  ctx: AuthContext,
  args: { classId: string; studentIds: string[]; bookId: number | null; minObjectives: number },
): Promise<ClassSignals> {
  const { admin, userClient, caller } = ctx;
  const { classId, studentIds, bookId, minObjectives } = args;
  const warnings: string[] = [];

  const [nameBy, { data: cls }] = await Promise.all([
    loadStudentNames(admin, studentIds),
    admin.from("classes").select("name, section, school_id").eq("id", classId).maybeSingle(),
  ]);
  const schoolId = cls?.school_id ?? caller.schoolId ?? null;
  const roster = new Set(studentIds);

  const [scoresRes, topicsRes, velRes, riskRes] = await Promise.all([
    admin.rpc("cohort_student_scores", { p_school_id: schoolId, p_book_id: bookId, p_min_objectives: minObjectives }),
    admin.rpc("cohort_topic_scores", { p_school_id: schoolId, p_book_id: bookId }),
    userClient.rpc("get_class_velocity", { p_student_ids: studentIds, p_book_id: bookId }),
    userClient.rpc("get_class_risk_roster", { p_student_ids: studentIds }),
  ]);
  if (scoresRes.error) throw scoresRes.error;
  if (topicsRes.error) throw topicsRes.error;
  if (velRes.error) { console.error("velocity lookup failed (non-fatal)", velRes.error); warnings.push("Learning pace data was unavailable; grouping used mastery only."); }
  if (riskRes.error) { console.error("risk lookup failed (non-fatal)", riskRes.error); warnings.push("Early-warning risk data was unavailable; grouping used mastery only."); }

  const scoreBy = new Map<string, number>();
  for (const r of (scoresRes.data ?? []) as Row[]) {
    const s = num(r.score);
    if (roster.has(r.student_id) && s !== null) scoreBy.set(r.student_id, s);
  }

  // Only count a topic for a student the same way the score does: the student must clear the objective minimum.
  const topicsBy = new Map<string, TopicScore[]>();
  for (const r of (topicsRes.data ?? []) as Row[]) {
    const s = num(r.score);
    if (!roster.has(r.student_id) || s === null || !scoreBy.has(r.student_id)) continue;
    const list = topicsBy.get(r.student_id) ?? [];
    list.push({ topic_id: Number(r.topic_id), topic_name: r.topic_name, chapter_name: r.chapter_name, score: s });
    topicsBy.set(r.student_id, list);
  }

  const paceBy = new Map<string, { pace: Pace; gain: number | null }>();
  for (const r of ((velRes.data as Row | null)?.students ?? []) as Row[]) {
    paceBy.set(r.student_id, { pace: (r.pace_label ?? "insufficient_data") as Pace, gain: num(r.overall_avg_gain_per_attempt) });
  }
  const riskBy = new Map<string, RiskLevel | null>();
  for (const core of (Array.isArray(riskRes.data) ? riskRes.data : []) as Row[]) riskBy.set(core.student_id, riskFromCauses(core));

  const signals = studentIds.map((id) => {
    const p = paceBy.get(id);
    return {
      student_id: id,
      full_name: nameBy.get(id) ?? "Student",
      score: scoreBy.get(id) ?? null,
      topics: topicsBy.get(id) ?? [],
      pace: p?.pace ?? null,
      risk: riskBy.get(id) ?? null,
      gain: p?.gain ?? null,
    };
  });

  return {
    classId,
    className: cls ? `${cls.name}${cls.section ? " - " + cls.section : ""}` : null,
    signals,
    warnings,
  };
}
