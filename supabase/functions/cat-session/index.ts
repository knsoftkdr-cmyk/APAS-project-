// supabase/functions/cat-session/index.ts
//
// Deploy with:
//   supabase functions deploy cat-session
//
// The Computerized Adaptive Test driver. One endpoint, several actions:
//
//   availability  { scope_type, scope_id }                    how many items exist for a scope
//   start         { scope_type, scope_id, max_items?, ... }   begin (or resume) a session
//   answer        { session_id, item_id, selected_option }    grade, update θ, serve next / finish
//   state         { session_id }                              resync after reload / lost response
//   result        { session_id }                              full report for a finished session
//   list          { student_id? }                             recent sessions (staff may pass student_id)
//   abandon       { session_id }
//
// SECURITY
//   * The answer key never leaves the server before an item is answered.
//   * Item selection, grading and θ estimation all run here - the browser
//     only ever receives "the next question" and "was that right".
//   * Students can only act on their own sessions; staff can read, not answer.
//   * All writes use the service role through apply_cat_response(), which
//     locks the session and only accepts the item that was actually served.
//
// The statistics (EAP ability estimate, Fisher-information selection,
// stopping rule) live in ../_shared/irt.ts and are unit tested separately.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  abilityBand,
  estimateAbilityEAP,
  evaluateStopping,
  precisionPercent,
  scaledScore,
  selectNextItem,
  type CatCandidate,
  type ScoredResponse,
} from "../_shared/irt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];
const SCOPE_TYPES = ["concept", "topic", "chapter", "subject"] as const;
type ScopeType = (typeof SCOPE_TYPES)[number];

const DEFAULTS = { minItems: 6, maxItems: 15, seTarget: 0.45 };
const STALE_SESSION_HOURS = 24;
const RECENT_ITEM_DAYS = 14;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

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

    const ctx: Ctx = { admin, isStaff, isStudent, ownStudentId };

    switch (action) {
      case "availability":
        return json(await availability(ctx, body));
      case "start":
        requireStudent(ctx);
        return json(await start(ctx, body));
      case "answer":
        requireStudent(ctx);
        return json(await answer(ctx, body));
      case "state":
        return json(await state(ctx, body));
      case "result":
        return json(await result(ctx, body));
      case "list":
        return json(await list(ctx, body));
      case "abandon":
        requireStudent(ctx);
        return json(await abandon(ctx, body));
      default:
        throw new HttpError(400, `Unknown action "${action}"`);
    }
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message, code: e.code, ...(e.extra ?? {}) }, e.status);
    }
    console.error("cat-session error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────

interface Ctx {
  admin: ReturnType<typeof createClient>;
  isStaff: boolean;
  isStudent: boolean;
  ownStudentId: string | null;
}

function requireStudent(ctx: Ctx) {
  if (!ctx.isStudent) throw new HttpError(403, "Only students can take adaptive tests");
}

function parseScope(body: Row): { scopeType: ScopeType; scopeId: number } {
  const scopeType = body.scope_type as ScopeType;
  const scopeId = Number(body.scope_id);
  if (!SCOPE_TYPES.includes(scopeType) || !Number.isFinite(scopeId)) {
    throw new HttpError(400, "scope_type (concept|topic|chapter|subject) and numeric scope_id are required");
  }
  return { scopeType, scopeId };
}

async function scopeLabel(ctx: Ctx, scopeType: ScopeType, scopeId: number): Promise<string> {
  const table = {
    concept: ["subtopics", "subtopic_name"],
    topic: ["topics", "topic_name"],
    chapter: ["curriculum_chapters", "chapter_name"],
    subject: ["books", "subject"],
  }[scopeType];
  const { data } = await ctx.admin.from(table[0]).select(table[1]).eq("id", scopeId).maybeSingle();
  if (!data) throw new HttpError(404, "That topic could not be found");
  return String((data as Row)[table[1]]);
}

async function loadSession(ctx: Ctx, sessionId: string): Promise<Row> {
  if (!sessionId) throw new HttpError(400, "session_id is required");
  const { data: session } = await ctx.admin.from("cat_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) throw new HttpError(404, "Session not found");
  if (ctx.isStudent && session.student_id !== ctx.ownStudentId) throw new HttpError(403, "Not your session");
  return session;
}

// Candidate pool with two-tier exposure control: prefer items this student
// hasn't seen recently; fall back to "anything not yet used this session"
// only if that would leave the pool empty.
async function loadCandidates(
  ctx: Ctx,
  studentId: string,
  scopeType: ScopeType,
  scopeId: number,
  sessionItemIds: string[],
): Promise<{ candidates: CatCandidate[]; calibratedById: Map<string, boolean> }> {
  const since = new Date(Date.now() - RECENT_ITEM_DAYS * 86400_000).toISOString();
  const { data: recent } = await ctx.admin
    .from("item_responses").select("item_id").eq("student_id", studentId).gte("responded_at", since).limit(2000);
  const recentIds = (recent ?? []).map((r: Row) => r.item_id as string);

  const fetchPool = async (exclude: string[]) => {
    const { data, error } = await ctx.admin.rpc("get_cat_candidates", {
      p_student_id: studentId, p_scope_type: scopeType, p_scope_id: scopeId, p_exclude: exclude,
    });
    if (error) throw new Error(`get_cat_candidates failed: ${error.message}`);
    return (data ?? []) as Row[];
  };

  let rows = await fetchPool([...new Set([...sessionItemIds, ...recentIds])]);
  if (rows.length === 0 && recentIds.length > 0) rows = await fetchPool(sessionItemIds);

  const calibratedById = new Map<string, boolean>();
  const candidates = rows.map((r) => {
    calibratedById.set(r.item_id, !!r.calibrated);
    return {
      id: r.item_id as string,
      params: { a: Number(r.irt_a), b: Number(r.irt_b), c: Number(r.irt_c) },
      learningObjectiveId: Number(r.learning_objective_id),
      pMastery: r.p_mastery == null ? null : Number(r.p_mastery),
      opportunities: Number(r.opportunities ?? 0),
    } as CatCandidate;
  });
  return { candidates, calibratedById };
}

async function publicItem(ctx: Ctx, itemId: string, seq: number) {
  const { data: item } = await ctx.admin
    .from("question_bank").select("id, stem, options, bloom_level").eq("id", itemId).single();
  if (!item) throw new HttpError(500, "Item vanished");
  // NOTE: correct_option / explanation deliberately not selected.
  return { item_id: item.id, seq, stem: item.stem, options: item.options, bloom_level: item.bloom_level };
}

function publicSession(s: Row) {
  return {
    id: s.id,
    scope_type: s.scope_type,
    scope_id: s.scope_id,
    scope_label: s.scope_label,
    status: s.status,
    items_administered: s.items_administered,
    correct_count: s.correct_count,
    min_items: s.min_items,
    max_items: s.max_items,
    precision_pct: precisionPercent(Number(s.se), Number(s.se_target), Number(s.prior_sd)),
    started_at: s.started_at,
  };
}

// ── availability ─────────────────────────────────────────────────────────
async function availability(ctx: Ctx, body: Row) {
  const { scopeType, scopeId } = parseScope(body);
  const { data, error } = await ctx.admin.rpc("get_cat_candidates", {
    p_student_id: ctx.ownStudentId ?? NIL_UUID, p_scope_type: scopeType, p_scope_id: scopeId, p_exclude: [],
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const calibrated = rows.filter((r) => r.calibrated).length;
  return {
    active_items: rows.length,
    objectives: new Set(rows.map((r) => r.learning_objective_id)).size,
    calibrated_items: calibrated,
    ready: rows.length >= DEFAULTS.minItems,
    min_required: DEFAULTS.minItems,
    // A CAT can only be selective if the pool is much bigger than the test.
    // Below this the test still works but behaves more like a fixed test.
    recommended_items: DEFAULTS.maxItems * 4,
  };
}

// ── start ────────────────────────────────────────────────────────────────
async function start(ctx: Ctx, body: Row) {
  const studentId = ctx.ownStudentId!;
  const { scopeType, scopeId } = parseScope(body);

  // Retire abandoned-looking sessions so they don't block a fresh start.
  const staleBefore = new Date(Date.now() - STALE_SESSION_HOURS * 3600_000).toISOString();
  await ctx.admin.from("cat_sessions").update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("student_id", studentId).eq("scope_type", scopeType).eq("scope_id", scopeId)
    .eq("status", "in_progress").lt("updated_at", staleBefore);

  const { data: live } = await ctx.admin.from("cat_sessions").select("*")
    .eq("student_id", studentId).eq("scope_type", scopeType).eq("scope_id", scopeId).eq("status", "in_progress").maybeSingle();
  if (live) return { resumed: true, ...(await currentView(ctx, live)) };

  const label = await scopeLabel(ctx, scopeType, scopeId);
  const { candidates } = await loadCandidates(ctx, studentId, scopeType, scopeId, []);

  const minItems = clampInt(body.min_items, 3, 30, DEFAULTS.minItems);
  if (candidates.length < minItems) {
    throw new HttpError(
      409,
      `Not enough questions are ready for "${label}" yet (${candidates.length} available, ${minItems} needed). Ask your teacher to add more.`,
      "bank_too_small",
      { active_items: candidates.length, min_required: minItems },
    );
  }
  const maxItems = clampInt(body.max_items, minItems, 30, Math.max(DEFAULTS.maxItems, minItems));
  const seTarget = clampNum(body.se_target, 0.25, 0.8, DEFAULTS.seTarget);

  // Warm start: begin from this student's last ability in the scope, if any.
  const { data: prev } = await ctx.admin.from("student_ability").select("theta")
    .eq("student_id", studentId).eq("scope_type", scopeType).eq("scope_id", scopeId).maybeSingle();
  const priorMean = prev ? clampNum(prev.theta, -3, 3, 0) : 0;

  const first = selectNextItem(priorMean, candidates, selectionOptions(candidates, [], maxItems));
  if (!first) throw new HttpError(409, "No questions available", "bank_too_small");

  const { data: created, error } = await ctx.admin.from("cat_sessions").insert({
    student_id: studentId, scope_type: scopeType, scope_id: scopeId, scope_label: label,
    theta: priorMean, se: 1, prior_mean: priorMean, prior_sd: 1,
    min_items: minItems, max_items: maxItems, se_target: seTarget,
    pending_item_id: first.id, pending_served_at: new Date().toISOString(),
  }).select("*").single();

  if (error) {
    // Lost a race with a concurrent Start - return the winner.
    const { data: winner } = await ctx.admin.from("cat_sessions").select("*")
      .eq("student_id", studentId).eq("scope_type", scopeType).eq("scope_id", scopeId).eq("status", "in_progress").maybeSingle();
    if (winner) return { resumed: true, ...(await currentView(ctx, winner)) };
    throw new Error(error.message);
  }
  return { resumed: false, session: publicSession(created), item: await publicItem(ctx, first.id, 1) };
}

// ── answer ───────────────────────────────────────────────────────────────
async function answer(ctx: Ctx, body: Row) {
  const session = await loadSession(ctx, body.session_id);
  const itemId = String(body.item_id ?? "");
  const selected = String(body.selected_option ?? "").toUpperCase();

  if (session.status !== "in_progress") throw new HttpError(409, "This test is already finished", "session_not_active");
  if (session.pending_item_id !== itemId) {
    throw new HttpError(409, "That question is not the current one", "item_not_pending");
  }

  const { data: item } = await ctx.admin.from("question_bank").select("*").eq("id", itemId).single();
  if (!item) throw new HttpError(404, "Question not found");
  if (!Object.keys(item.options ?? {}).includes(selected)) throw new HttpError(400, "Invalid option");

  const isCorrect = selected === item.correct_option;

  // θ from every earlier answer (parameters as they were when served) + this one.
  const { data: prior } = await ctx.admin.from("item_responses")
    .select("item_a, item_b, item_c, is_correct").eq("session_id", session.id).order("seq");
  const scored: ScoredResponse[] = (prior ?? []).map((r: Row) => ({
    item: { a: Number(r.item_a), b: Number(r.item_b), c: Number(r.item_c) }, correct: !!r.is_correct,
  }));
  scored.push({
    item: { a: Number(item.irt_a), b: Number(item.irt_b), c: Number(item.irt_c) }, correct: isCorrect,
  });
  const est = estimateAbilityEAP(scored, { mean: Number(session.prior_mean), sd: Number(session.prior_sd) });

  const { data: applied, error } = await ctx.admin.rpc("apply_cat_response", {
    p_session_id: session.id, p_item_id: itemId, p_selected_option: selected,
    p_is_correct: isCorrect, p_theta_after: est.theta, p_se_after: est.se,
  });
  if (error) {
    if (/item_not_pending|session_not_active/.test(error.message)) {
      throw new HttpError(409, "That answer was already recorded", "item_not_pending");
    }
    throw new Error(error.message);
  }
  const row = (Array.isArray(applied) ? applied[0] : applied) as Row;

  const feedback = {
    is_correct: isCorrect,
    correct_option: item.correct_option,
    explanation: item.explanation ?? null,
    mastery_before: row?.p_mastery_before != null ? Number(row.p_mastery_before) : null,
    mastery_after: row?.p_mastery_after != null ? Number(row.p_mastery_after) : null,
  };

  const { data: fresh } = await ctx.admin.from("cat_sessions").select("*").eq("id", session.id).single();
  const next = await advance(ctx, fresh as Row);
  return { feedback, ...next };
}

// ── advance: decide "stop or next item" (shared by answer/state) ─────────
async function advance(ctx: Ctx, session: Row) {
  const { data: answered } = await ctx.admin.from("item_responses")
    .select("item_id, learning_objective_id").eq("session_id", session.id);
  const answeredIds = (answered ?? []).map((r: Row) => r.item_id as string);

  const { candidates } = await loadCandidates(ctx, session.student_id, session.scope_type, Number(session.scope_id), answeredIds);

  const stop = evaluateStopping({
    administered: session.items_administered,
    se: Number(session.se),
    minItems: session.min_items,
    maxItems: session.max_items,
    seTarget: Number(session.se_target),
    remainingCandidates: candidates.length,
  });

  if (stop.stop) {
    await finalize(ctx, session, stop.reason!);
    return { complete: true, result: await buildResult(ctx, session.id) };
  }

  const next = selectNextItem(Number(session.theta), candidates, selectionOptions(candidates, answered ?? [], session.max_items));
  if (!next) {
    await finalize(ctx, session, "bank_exhausted");
    return { complete: true, result: await buildResult(ctx, session.id) };
  }

  await ctx.admin.from("cat_sessions").update({
    pending_item_id: next.id, pending_served_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", session.id);

  const { data: updated } = await ctx.admin.from("cat_sessions").select("*").eq("id", session.id).single();
  return {
    complete: false,
    session: publicSession(updated as Row),
    item: await publicItem(ctx, next.id, session.items_administered + 1),
  };
}

function selectionOptions(candidates: CatCandidate[], answered: Row[], maxItems: number) {
  const loCounts: Record<number, number> = {};
  const objectives = new Set<number>(candidates.map((c) => c.learningObjectiveId));
  for (const r of answered) {
    loCounts[r.learning_objective_id] = (loCounts[r.learning_objective_id] ?? 0) + 1;
    objectives.add(r.learning_objective_id);
  }
  // Spread the test across the scope: no objective gets much more than its fair share.
  const maxPerObjective = Math.max(2, Math.ceil(maxItems / Math.max(1, objectives.size)) + 1);
  return { loCounts, maxPerObjective, randomesqueK: 4 };
}

async function finalize(ctx: Ctx, session: Row, reason: string) {
  const { data: resp } = await ctx.admin.from("item_responses").select("calibrated").eq("session_id", session.id);
  const n = resp?.length ?? 0;
  const calibratedFraction = n ? (resp ?? []).filter((r: Row) => r.calibrated).length / n : 0;
  const now = new Date().toISOString();

  await ctx.admin.from("cat_sessions").update({
    status: "completed", stop_reason: reason, completed_at: now, updated_at: now,
    calibrated_fraction: calibratedFraction, pending_item_id: null, pending_served_at: null,
  }).eq("id", session.id);

  await ctx.admin.from("student_ability").upsert({
    student_id: session.student_id, scope_type: session.scope_type, scope_id: session.scope_id,
    theta: session.theta, se: session.se, n_items: session.items_administered,
    last_session_id: session.id, updated_at: now,
  }, { onConflict: "student_id,scope_type,scope_id" });
}

// ── state (resume / resync) ──────────────────────────────────────────────
async function state(ctx: Ctx, body: Row) {
  const session = await loadSession(ctx, body.session_id);
  return await currentView(ctx, session);
}

async function currentView(ctx: Ctx, session: Row) {
  if (session.status === "completed") return { complete: true, result: await buildResult(ctx, session.id) };
  if (session.status === "abandoned") throw new HttpError(409, "This test was abandoned", "session_not_active");
  if (session.pending_item_id) {
    return {
      complete: false,
      session: publicSession(session),
      item: await publicItem(ctx, session.pending_item_id, session.items_administered + 1),
    };
  }
  // Crashed between "answer recorded" and "next item served" - pick up from here.
  return await advance(ctx, session);
}

// ── result ───────────────────────────────────────────────────────────────
async function result(ctx: Ctx, body: Row) {
  const session = await loadSession(ctx, body.session_id);
  if (session.status === "in_progress") throw new HttpError(409, "This test is still in progress", "session_not_complete");
  return await buildResult(ctx, session.id);
}

async function buildResult(ctx: Ctx, sessionId: string) {
  const { data: session } = await ctx.admin.from("cat_sessions").select("*").eq("id", sessionId).single();
  const s = session as Row;
  const { data: responses } = await ctx.admin.from("item_responses")
    .select("item_id, learning_objective_id, selected_option, is_correct, seq").eq("session_id", sessionId).order("seq");
  const rs = (responses ?? []) as Row[];

  const loIds = [...new Set(rs.map((r) => r.learning_objective_id as number))];
  const itemIds = rs.map((r) => r.item_id as string);

  const [{ data: los }, { data: mastery }, { data: items }] = await Promise.all([
    loIds.length ? ctx.admin.from("learning_objectives").select("id, objective_text").in("id", loIds) : Promise.resolve({ data: [] }),
    loIds.length
      ? ctx.admin.from("student_mastery").select("learning_objective_id, p_mastery").eq("student_id", s.student_id).in("learning_objective_id", loIds)
      : Promise.resolve({ data: [] }),
    itemIds.length ? ctx.admin.from("question_bank").select("id, distractor_misconceptions").in("id", itemIds) : Promise.resolve({ data: [] }),
  ]);

  const loText = new Map((los ?? []).map((l: Row) => [l.id, l.objective_text]));
  const masteryById = new Map((mastery ?? []).map((m: Row) => [m.learning_objective_id, Number(m.p_mastery)]));
  const distractorMap = new Map((items ?? []).map((i: Row) => [i.id, (i.distractor_misconceptions ?? {}) as Row]));

  const byObjective = loIds.map((id) => {
    const rows = rs.filter((r) => r.learning_objective_id === id);
    return {
      learning_objective_id: id,
      text: loText.get(id) ?? "",
      answered: rows.length,
      correct: rows.filter((r) => r.is_correct).length,
      p_mastery: masteryById.get(id) ?? null,
    };
  }).sort((a, b) => (a.p_mastery ?? 1) - (b.p_mastery ?? 1));

  // Which known misconceptions did the wrong answers reveal?
  const hits = new Map<number, number>();
  for (const r of rs) {
    if (r.is_correct) continue;
    const mid = distractorMap.get(r.item_id)?.[r.selected_option];
    if (mid != null) hits.set(Number(mid), (hits.get(Number(mid)) ?? 0) + 1);
  }
  let misconceptions: Row[] = [];
  if (hits.size) {
    const { data: mc } = await ctx.admin.from("concept_misconceptions")
      .select("id, misconception_text, correction_hint").in("id", [...hits.keys()]);
    misconceptions = (mc ?? []).map((m: Row) => ({
      id: m.id, text: m.misconception_text, correction_hint: m.correction_hint, times_selected: hits.get(m.id) ?? 0,
    })).sort((a, b) => b.times_selected - a.times_selected);
  }

  const theta = Number(s.theta);
  const se = Number(s.se);
  const calibratedFraction = s.calibrated_fraction == null ? 0 : Number(s.calibrated_fraction);
  return {
    session: { ...publicSession(s), completed_at: s.completed_at, stop_reason: s.stop_reason },
    theta: round(theta, 3),
    se: round(se, 3),
    scaled_score: scaledScore(theta),
    band: abilityBand(theta),
    // "Provisional" until most items served have data-driven (not AI-guessed) difficulty.
    provisional: calibratedFraction < 0.5,
    calibrated_fraction: round(calibratedFraction, 2),
    accuracy: s.items_administered ? round(s.correct_count / s.items_administered, 3) : 0,
    by_objective: byObjective,
    misconceptions,
  };
}

// ── list ─────────────────────────────────────────────────────────────────
async function list(ctx: Ctx, body: Row) {
  const studentId = ctx.isStudent ? ctx.ownStudentId! : String(body.student_id ?? "");
  if (!studentId) throw new HttpError(400, "student_id is required");
  const { data } = await ctx.admin.from("cat_sessions")
    .select("id, scope_type, scope_id, scope_label, status, theta, se, items_administered, correct_count, calibrated_fraction, started_at, completed_at")
    .eq("student_id", studentId).order("started_at", { ascending: false }).limit(20);
  return {
    sessions: (data ?? []).map((s: Row) => ({
      ...s,
      scaled_score: s.status === "completed" ? scaledScore(Number(s.theta)) : null,
      band: s.status === "completed" ? abilityBand(Number(s.theta)) : null,
      provisional: (s.calibrated_fraction ?? 0) < 0.5,
    })),
  };
}

// ── abandon ──────────────────────────────────────────────────────────────
async function abandon(ctx: Ctx, body: Row) {
  const session = await loadSession(ctx, body.session_id);
  if (session.status === "in_progress") {
    await ctx.admin.from("cat_sessions").update({
      status: "abandoned", pending_item_id: null, pending_served_at: null, updated_at: new Date().toISOString(),
    }).eq("id", session.id);
  }
  return { ok: true };
}

// ── small utils ──────────────────────────────────────────────────────────
function clampInt(v: unknown, lo: number, hi: number, fallback: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
function clampNum(v: unknown, lo: number, hi: number, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
function round(x: number, d: number) {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}