// supabase/functions/_shared/handlers/competencyMissions.ts
//
// Competency Missions: gamification tied to verified mastery, not arbitrary points.
//
// Not a standalone edge function (deployment limit): `update-mastery` - the function every mastery-evidence flow already
// goes through - routes to this handler via its `action` field (see _shared/mergedRouter.ts and CONSOLIDATION.md).
//
//   action "cm_state"  Body: { tz_offset_minutes? } -> the student's missions, re-checked against their real mastery
//   action "cm_claim"  Body: { mission_id, tz_offset_minutes? } -> pays a completed mission's XP once
//
// How it stays honest:
//   * Missions are built from the student's own student_mastery rows (BKT scores) and the curriculum behind them.
//   * Nothing the browser reports can complete one. Every cm_state recomputes progress from student_mastery and
//     mastery_evidence_log. A mission completes only when the score reaches the target AND there are enough graded answers
//     since it started, enough correct ones, spread over enough different days (see competencyMissionModel.ts).
//   * XP is paid once per skill tier / topic target (UNIQUE(user_id, scope_key)), capped per day, and goes into the existing
//     user_gamification + xp_transactions, so levels and the Leaderboard pick it up unchanged.
//
// Access: students only, own data only (the user id always comes from the verified JWT).
// If migration 20261019000000 isn't applied every action answers 503 `persistence_unavailable`.
//
// Honest limit: the mastery score itself is only as trustworthy as the flows that write it. Some of them (e.g. useMastery's
// direct update-mastery call) send client-judged correctness. The multi-day / evidence rules and the daily XP cap make
// inflating it slow and bounded, not impossible; server-side grading of every flow is the real fix.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calcLevel, clampTz, levelInfo, localDate } from "../gamification2Model.ts";
import {
  CONFIG, TIER_LABEL, evaluateMission, flattenMasteryRow, levelUpCandidates, tierOf, topicCandidates,
  type EvidenceRow, type MasteryRow, type MissionDraft, type TopicAgg,
} from "../competencyMissionModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class Unavailable extends Error {}
class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

const tableMissing = (err: any) =>
  err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "42703" || /does not exist|schema cache/i.test(String(err?.message ?? ""));
function must<T>(res: { data: T; error: any }): T {
  if (res.error) { if (tableMissing(res.error)) throw new Unavailable(); throw res.error; }
  return res.data;
}

const MASTERY_SELECT =
  "learning_objective_id, p_mastery, opportunities_count, last_evidence_at, " +
  "learning_objectives(id, objective_text, subtopic_id, subtopics(subtopic_name, topic_id, " +
  "topics(id, topic_name, curriculum_chapters(chapter_name, units(books(subject))))))";

async function loadMastery(admin: any, studentId: string): Promise<MasteryRow[]> {
  const rows = must(await admin.from("student_mastery").select(MASTERY_SELECT).eq("student_id", studentId).limit(3000));
  return (rows ?? []).map(flattenMasteryRow).filter(Boolean) as MasteryRow[];
}

async function loadEvidence(admin: any, studentId: string, ids: number[], since: string): Promise<EvidenceRow[]> {
  if (!ids.length) return [];
  const rows = must(await admin.from("mastery_evidence_log").select("learning_objective_id, is_correct, responded_at")
    .eq("student_id", studentId).in("learning_objective_id", ids).gte("responded_at", since).limit(3000));
  return (rows ?? []) as EvidenceRow[];
}

/** Topics the student has started, with every active skill in each (so a topic quest counts skills not yet attempted). */
async function loadTopicAggs(admin: any, rows: MasteryRow[], maxTopics = 30): Promise<TopicAgg[]> {
  const byTopic = new Map<number, MasteryRow[]>();
  for (const r of rows) if (r.topic_id != null && r.opportunities_count > 0) byTopic.set(r.topic_id, [...(byTopic.get(r.topic_id) ?? []), r]);
  const topicIds = [...byTopic.keys()].slice(0, maxTopics);
  if (!topicIds.length) return [];
  const los = must(await admin.from("learning_objectives").select("id, subtopics!inner(topic_id)")
    .in("subtopics.topic_id", topicIds).eq("status", "active").limit(5000));
  const idsByTopic = new Map<number, number[]>();
  for (const lo of los ?? []) {
    const st = Array.isArray(lo.subtopics) ? lo.subtopics[0] : lo.subtopics;
    const tid = Number(st?.topic_id);
    idsByTopic.set(tid, [...(idsByTopic.get(tid) ?? []), Number(lo.id)]);
  }
  return topicIds.map((tid) => {
    const mine = byTopic.get(tid)!;
    return {
      topic_id: tid, topic_name: mine[0].topic_name, subject: mine[0].subject,
      objective_ids: idsByTopic.get(tid) ?? [],
      mastery: new Map(mine.map((r) => [r.learning_objective_id, { p: r.p_mastery, opps: r.opportunities_count }])),
    };
  });
}

async function resolveStudentId(admin: any, userId: string): Promise<string | null> {
  const row = must(await admin.from("students").select("id").eq("profile_id", userId).maybeSingle());
  return row?.id ?? null;
}

async function loadGamRow(admin: any, userId: string) {
  let row = must(await admin.from("user_gamification").select("*").eq("user_id", userId).maybeSingle());
  if (!row) {
    must(await admin.from("user_gamification").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true }));
    row = must(await admin.from("user_gamification").select("*").eq("user_id", userId).maybeSingle());
  }
  return row;
}

/** Start of the student's local day, as an ISO instant. */
const dayStartIso = (tz: number) => {
  const local = localDate(Date.now(), tz);
  return new Date(Date.parse(`${local}T00:00:00Z`) - tz * 60_000).toISOString();
};

async function xpClaimedToday(admin: any, userId: string, tz: number): Promise<number> {
  const rows = must(await admin.from("competency_xp_awards").select("xp").eq("user_id", userId).gte("awarded_at", dayStartIso(tz)));
  return (rows ?? []).reduce((s: number, r: any) => s + (r.xp || 0), 0);
}

// ── state ─────────────────────────────────────────────────────────────────────────────────────────────────

async function buildState(admin: any, userId: string, tz: number) {
  const studentId = await resolveStudentId(admin, userId);
  if (!studentId) return { persistence: "available", enrolled: false, missions: [], summary: null, recent: [] };

  const now = Date.now();
  const rows = await loadMastery(admin, studentId);
  const masteryMap = new Map(rows.map((r) => [r.learning_objective_id, { p: r.p_mastery, opps: r.opportunities_count }]));

  // 1. re-check live missions against the student's real mastery
  const live: any[] = must(await admin.from("competency_missions").select("*").eq("user_id", userId).in("status", ["active", "completed"]));
  const active = live.filter((m) => m.status === "active");
  if (active.length) {
    const ids = [...new Set(active.flatMap((m) => m.kind === "level_up" ? [Number(m.learning_objective_id)] : (m.meta?.objective_ids ?? [])))];
    const since = active.reduce((min, m) => (m.created_at < min ? m.created_at : min), active[0].created_at);
    const evidence = await loadEvidence(admin, studentId, ids as number[], since);
    for (const m of active) {
      const ev = evaluateMission(m, masteryMap, evidence, tz, now);
      m._eval = ev;
      if (ev.done) {
        const patch = { status: "completed", completed_at: new Date(now).toISOString(), progress: 1, evidence_count: ev.evidence.have, correct_count: ev.correct.have };
        must(await admin.from("competency_missions").update(patch).eq("id", m.id).eq("status", "active"));
        Object.assign(m, patch);
      } else if (ev.expired) {
        must(await admin.from("competency_missions").update({ status: "expired" }).eq("id", m.id).eq("status", "active"));
        m.status = "expired";
      } else {
        must(await admin.from("competency_missions").update({ progress: ev.progress, evidence_count: ev.evidence.have, correct_count: ev.correct.have }).eq("id", m.id));
        m.progress = ev.progress;
      }
    }
  }

  // 2. top up with new missions (never repeat something already paid or already live)
  const stillLive = live.filter((m) => m.status === "active" || m.status === "completed");
  const liveLevel = stillLive.filter((m) => m.kind === "level_up").length;
  const liveTopic = stillLive.filter((m) => m.kind === "topic_quest").length;
  if (liveLevel < CONFIG.maxLevelUp || liveTopic < CONFIG.maxTopicQuests) {
    const paid = must(await admin.from("competency_xp_awards").select("scope_key").eq("user_id", userId));
    const exclude = new Set<string>([...(paid ?? []).map((p: any) => p.scope_key), ...stillLive.map((m) => m.scope_key)]);
    const drafts: MissionDraft[] = [
      ...levelUpCandidates(rows, exclude, CONFIG.maxLevelUp - liveLevel, now),
      ...(liveTopic < CONFIG.maxTopicQuests ? topicCandidates(await loadTopicAggs(admin, rows), exclude, CONFIG.maxTopicQuests - liveTopic) : []),
    ];
    for (const d of drafts) {
      const { error } = await admin.from("competency_missions").insert({
        ...d, user_id: userId, student_id: studentId, expires_at: new Date(now + CONFIG.expiryDays * 86_400_000).toISOString(),
      });
      if (error && error.code !== "23505") { if (tableMissing(error)) throw new Unavailable(); throw error; }
    }
  }

  // 3. snapshot
  const missions: any[] = must(await admin.from("competency_missions").select("*").eq("user_id", userId)
    .in("status", ["active", "completed"]).order("created_at", { ascending: true }));
  const evalIds = [...new Set(missions.flatMap((m) => m.kind === "level_up" ? [Number(m.learning_objective_id)] : (m.meta?.objective_ids ?? [])))] as number[];
  const evidence = missions.length
    ? await loadEvidence(admin, studentId, evalIds, missions.reduce((min, m) => (m.created_at < min ? m.created_at : min), missions[0].created_at))
    : [];
  const view = missions.map((m) => {
    const ev = evaluateMission(m, masteryMap, evidence, tz, now);
    const completed = m.status === "completed";
    return {
      id: m.id, kind: m.kind, title: m.title, description: m.description, subject: m.subject, topic_name: m.topic_name,
      status: m.status, xp_reward: m.xp_reward,
      tier_from: m.tier_from, tier_to: m.tier_to,
      start_pct: Math.round(m.start_value * 100), current_pct: Math.round(ev.current * 100), target_pct: Math.round(m.target_value * 100),
      progress: completed ? 1 : ev.progress,
      requirements: { evidence: ev.evidence, correct: ev.correct, days: ev.days, coverage: ev.coverage },
      hint: completed ? "Mastery verified. Claim your reward!" : ev.hint,
      expires_at: m.expires_at,
    };
  });

  const recent = must(await admin.from("competency_missions").select("id, title, xp_reward, claimed_at, kind")
    .eq("user_id", userId).eq("status", "claimed").order("claimed_at", { ascending: false }).limit(5));
  const earned = must(await admin.from("competency_xp_awards").select("xp").eq("user_id", userId));
  const tiers = { mastered: 0, proficient: 0, developing: 0, beginning: 0 } as Record<string, number>;
  for (const r of rows) { const t = tierOf(r.p_mastery, r.opportunities_count); if (t in tiers) tiers[t]++; }

  return {
    persistence: "available", enrolled: true,
    missions: view,
    recent: recent ?? [],
    summary: {
      assessed: rows.filter((r) => r.opportunities_count > 0).length, ...tiers,
      xp_earned_total: (earned ?? []).reduce((s: number, r: any) => s + (r.xp || 0), 0),
      xp_today: await xpClaimedToday(admin, userId, tz), xp_daily_cap: CONFIG.dailyXpCap,
    },
    tier_labels: TIER_LABEL,
  };
}

// ── claim ─────────────────────────────────────────────────────────────────────────────────────────────────

async function claim(admin: any, userId: string, body: any, tz: number) {
  const id = typeof body?.mission_id === "string" ? body.mission_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "mission_id is required");
  const m = must(await admin.from("competency_missions").select("*").eq("id", id).eq("user_id", userId).maybeSingle());
  if (!m) throw new HttpError(404, "Mission not found");
  if (m.status === "claimed") throw new HttpError(409, "Mission already claimed", "already_claimed");
  if (m.status !== "completed") throw new HttpError(400, "Mastery for this mission isn't verified yet", "not_complete");

  const today = await xpClaimedToday(admin, userId, tz);
  if (today + m.xp_reward > CONFIG.dailyXpCap) {
    throw new HttpError(429, `You've reached today's mastery XP limit (${CONFIG.dailyXpCap}). Claim this tomorrow, it will wait for you.`, "daily_cap");
  }

  // only one concurrent claim can win
  const won = must(await admin.from("competency_missions")
    .update({ status: "claimed", claimed_at: new Date().toISOString() }).eq("id", id).eq("status", "completed").select("id"));
  if (!won?.length) throw new HttpError(409, "Mission already claimed", "already_claimed");

  // once per skill tier / topic target, ever
  const { error: awardErr } = await admin.from("competency_xp_awards").insert({ user_id: userId, scope_key: m.scope_key, mission_id: id, xp: m.xp_reward });
  if (awardErr) {
    if (awardErr.code === "23505") return { awarded: { mission_xp: 0, level_up: null, already_rewarded: true }, state: await buildState(admin, userId, tz) };
    if (tableMissing(awardErr)) throw new Unavailable();
    throw awardErr;
  }

  const gam = await loadGamRow(admin, userId);
  const prevXp = gam.total_xp ?? 0;
  const newXp = prevXp + m.xp_reward;
  must(await admin.from("user_gamification").update({ total_xp: newXp, level: calcLevel(newXp), updated_at: new Date().toISOString() }).eq("user_id", userId));
  await admin.from("xp_transactions").insert({ user_id: userId, xp_amount: m.xp_reward, action: "competency_mission", description: `Mastery: ${m.title}` });

  return {
    awarded: { mission_xp: m.xp_reward, level_up: calcLevel(newXp) > calcLevel(prevXp) ? calcLevel(newXp) : null, already_rewarded: false },
    progression: levelInfo(newXp),
    state: await buildState(admin, userId, tz),
  };
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function handleCompetencyMissions(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "student") return json({ error: "Competency missions are for students" }, 403);

    const body = await req.json().catch(() => ({}));
    const tz = clampTz(body?.tz_offset_minutes);
    switch (body?.action) {
      case "state": return json(await buildState(admin, user.id, tz));
      case "claim": return json(await claim(admin, user.id, body, tz));
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Unavailable) return json({ error: "Competency missions aren't set up yet (apply migration 20261019000000).", code: "persistence_unavailable" }, 503);
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("competency missions handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
