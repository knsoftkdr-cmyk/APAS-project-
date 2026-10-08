// supabase/functions/_shared/handlers/gamification2.ts
//
// Gamification 2.0: adaptive missions, streaks with freezes, tiered + adaptive badges, progression.
//
// Not a standalone edge function (deployment limit): `update-mastery` routes to this handler via its `action`
// field - see _shared/mergedRouter.ts and CONSOLIDATION.md.
//
//   action "g2_state"  Body: { tz_offset_minutes? }                          -> full snapshot for the Gamification page
//   action "g2_event"  Body: { round: {...}, tz_offset_minutes?, dedupe_key? } -> awards XP, updates streak / missions / badges
//   action "g2_claim"  Body: { mission_id, tz_offset_minutes? }               -> pays out a completed mission once
//
// Access: students only, own data only (the user id always comes from the verified JWT, never from the body).
// Writes go through the service role; the legacy client-side awardXp path in hooks/useGamification.ts is untouched.
// If migration 20261016000000 isn't applied every action answers 503 `persistence_unavailable`.
//
// Honest limit: round results are reported by the browser, so XP is bounded (see DAILY_ROUND_XP_CAP, minimum
// questions, duplicate keys) rather than cryptographically proven.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  addDays, applyActivity, applyDailyCap, badgeProgress, badgesSatisfied, calcLevel, clampTz, computeBaseline,
  dayDiff, displayStreak, FREEZE_EVERY_DAYS, generateMissions, isMissionDone, levelInfo, localDate,
  missionProgressAfterRound, roundXp, sanitizeRound, steadyClimbPoints, weekStart,
  type BadgeStats, type HistoryRound, type MissionDraft, type RoundInput,
} from "../gamification2Model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class Unavailable extends Error {}
class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

function tableMissing(err: any): boolean {
  const msg = String(err?.message ?? "");
  return err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "42703" || /does not exist|schema cache/i.test(msg);
}
function must<T>(res: { data: T; error: any }): T {
  if (res.error) {
    if (tableMissing(res.error)) throw new Unavailable();
    throw res.error;
  }
  return res.data;
}

// ── data access ───────────────────────────────────────────────────────────────────────────────────

async function loadHistory(admin: any, userId: string): Promise<HistoryRound[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const rows = must(await admin.from("gamification_events")
    .select("game_id, subject, accuracy, xp_awarded, created_at")
    .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(1000));
  return (rows ?? []).map((r: any) => ({ ...r, accuracy: r.accuracy == null ? null : Number(r.accuracy) }));
}

async function loadGamRow(admin: any, userId: string) {
  let row = must(await admin.from("user_gamification").select("*").eq("user_id", userId).maybeSingle());
  if (!row) {
    must(await admin.from("user_gamification").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true }));
    row = must(await admin.from("user_gamification").select("*").eq("user_id", userId).maybeSingle());
  }
  return row;
}

/** Make sure today's daily and this week's weekly missions exist (generated from the student's own recent history). */
async function ensureMissions(admin: any, userId: string, today: string, tz: number, history: HistoryRound[]) {
  const wk = weekStart(today);
  const load = async () => must(await admin.from("gamification_missions").select("*")
    .eq("user_id", userId).gte("period_start", wk).order("created_at", { ascending: true }));
  const pick = (rows: any[]) => ({
    daily: rows.filter((m) => m.period === "daily" && m.period_start === today),
    weekly: rows.filter((m) => m.period === "weekly" && m.period_start === wk),
  });
  let cur = pick(await load());
  if (cur.daily.length && cur.weekly.length) return cur;

  const drafts = generateMissions(computeBaseline(history, today, tz));
  const toRow = (d: MissionDraft, start: string) => ({ user_id: userId, period_start: start, ...d });
  const rows = [
    ...(cur.daily.length ? [] : drafts.daily.map((d) => toRow(d, today))),
    ...(cur.weekly.length ? [] : drafts.weekly.map((d) => toRow(d, wk))),
  ];
  must(await admin.from("gamification_missions").upsert(rows, { onConflict: "user_id,period,period_start,mission_key", ignoreDuplicates: true }));
  cur = pick(await load());
  return cur;
}

async function loadBadgeCatalog(admin: any, userId: string) {
  const defs = must(await admin.from("achievement_definitions").select("*").like("key", "g2_%").order("threshold", { ascending: true }));
  const earned = must(await admin.from("user_achievements").select("achievement_id, earned_at").eq("user_id", userId));
  const earnedAt = new Map<string, string>((earned ?? []).map((e: any) => [e.achievement_id, e.earned_at]));
  return { defs: defs ?? [], earnedAt };
}

async function buildBadgeStats(
  admin: any, userId: string, history: HistoryRound[], today: string, tz: number,
  extra: { days_away_before_this?: number; beat_personal_best?: boolean; longest_streak: number },
): Promise<BadgeStats> {
  const count = async (q: any) => { const r = await q; if (r.error) { if (tableMissing(r.error)) throw new Unavailable(); throw r.error; } return r.count ?? 0; };
  const base = () => admin.from("gamification_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const [total, r90, r100, claimed] = await Promise.all([
    count(base()),
    count(base().gte("accuracy", 90)),
    count(base().gte("accuracy", 100)),
    count(admin.from("gamification_missions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "claimed")),
  ]);
  const best = history.reduce((m, h) => Math.max(m, h.accuracy ?? 0), 0);
  return {
    total_rounds: total,
    best_accuracy: best,
    rounds_90: r90,
    rounds_100: r100,
    streak: extra.longest_streak,
    missions_claimed: claimed,
    days_away_before_this: extra.days_away_before_this ?? 0,
    beat_personal_best: extra.beat_personal_best ?? false,
    steady_climb_points: steadyClimbPoints(history, today, tz),
    distinct_games: new Set(history.map((h) => h.game_id).filter(Boolean)).size,
  };
}

/** Award any badges whose conditions are now met. Returns the new badges and the bonus XP they paid. */
async function awardBadges(admin: any, userId: string, stats: BadgeStats) {
  const { defs, earnedAt } = await loadBadgeCatalog(admin, userId);
  const byKey = new Map<string, any>(defs.map((d: any) => [d.key, d]));
  const fresh: any[] = [];
  for (const key of badgesSatisfied(stats)) {
    const def = byKey.get(key);
    if (!def || earnedAt.has(def.id)) continue;
    const { error } = await admin.from("user_achievements").insert({ user_id: userId, achievement_id: def.id });
    if (error) { if (error.code === "23505") continue; if (tableMissing(error)) throw new Unavailable(); throw error; }
    fresh.push(def);
    if (def.xp_reward > 0) {
      await admin.from("xp_transactions").insert({
        user_id: userId, xp_amount: def.xp_reward, action: "achievement_bonus", description: `🏆 Achievement: ${def.title}`,
      });
    }
  }
  return {
    badges: fresh.map((d) => ({ key: d.key, title: d.title, icon: d.icon, xp_reward: d.xp_reward })),
    bonus_xp: fresh.reduce((s, d) => s + (d.xp_reward || 0), 0),
  };
}

// ── snapshot ──────────────────────────────────────────────────────────────────────────────────────

async function buildState(admin: any, userId: string, tz: number) {
  const today = localDate(Date.now(), tz);
  const wk = weekStart(today);
  const history = await loadHistory(admin, userId);
  const [gam, missions] = await Promise.all([loadGamRow(admin, userId), ensureMissions(admin, userId, today, tz, history)]);
  const { defs, earnedAt } = await loadBadgeCatalog(admin, userId);

  const streakState = {
    current_streak: gam.current_streak ?? 0, longest_streak: gam.longest_streak ?? 0,
    last_activity_date: gam.last_activity_date ?? null, streak_freezes: gam.streak_freezes ?? 0,
    freeze_earned_at_streak: gam.freeze_earned_at_streak ?? 0,
  };
  const shown = displayStreak(streakState, today);
  const stats = await buildBadgeStats(admin, userId, history, today, tz, { longest_streak: streakState.longest_streak });
  const baseline = computeBaseline(history, today, tz);
  const inWeek = history.filter((h) => localDate(Date.parse(h.created_at), tz) >= wk);

  return {
    persistence: "available",
    today,
    week_start: wk,
    progression: levelInfo(gam.total_xp ?? 0),
    streak: {
      current: shown.current,
      longest: streakState.longest_streak,
      freezes: streakState.streak_freezes,
      at_risk: shown.at_risk,
      played_today: shown.played_today,
      next_freeze_in_days: shown.current > 0 ? FREEZE_EVERY_DAYS - (shown.current % FREEZE_EVERY_DAYS) : FREEZE_EVERY_DAYS,
    },
    missions,
    badges: defs.map((d: any) => ({
      key: d.key, title: d.title, description: d.description, icon: d.icon, category: d.category,
      xp_reward: d.xp_reward, earned: earnedAt.has(d.id), earned_at: earnedAt.get(d.id) ?? null,
      progress: badgeProgress(d.key, stats),
    })),
    insights: {
      avg_accuracy: baseline.avg_accuracy,
      weak_subject: baseline.weak_subject,
      rounds_this_week: inWeek.length,
      xp_this_week: inWeek.reduce((s, h) => s + h.xp_awarded, 0),
      rounds_14d: baseline.total_rounds_14d,
    },
  };
}

// ── actions ───────────────────────────────────────────────────────────────────────────────────────

async function recordRound(admin: any, userId: string, body: any, tz: number) {
  const round: RoundInput | null = sanitizeRound(body?.round);
  if (!round) throw new HttpError(400, "round is missing or invalid");
  const dedupe = typeof body?.dedupe_key === "string" && body.dedupe_key.trim() ? body.dedupe_key.trim().slice(0, 80) : null;

  const now = Date.now();
  const today = localDate(now, tz);
  const history = await loadHistory(admin, userId);
  const gam = await loadGamRow(admin, userId);
  const missions = await ensureMissions(admin, userId, today, tz, history);   // before the round, so baselines exclude it

  // XP for this round, bounded per day
  const earnedToday = history.filter((h) => localDate(Date.parse(h.created_at), tz) === today).reduce((s, h) => s + h.xp_awarded, 0);
  const xp = applyDailyCap(roundXp(round), earnedToday);

  // personal-best check uses the history from BEFORE this round
  const prevBest = history.reduce((m, h) => Math.max(m, h.accuracy ?? 0), 0);
  const beatBest = history.length >= 5 && round.accuracy > prevBest;

  const ins = await admin.from("gamification_events").insert({
    user_id: userId, event_type: "round_completed", game_id: round.game_id, subject: round.subject, accuracy: round.accuracy,
    score: round.score, max_score: round.max_score, questions_attempted: round.questions_attempted,
    duration_seconds: round.duration_seconds, xp_awarded: xp, dedupe_key: dedupe,
  });
  if (ins.error) {
    if (ins.error.code === "23505") return { duplicate: true, state: await buildState(admin, userId, tz) };
    if (tableMissing(ins.error)) throw new Unavailable();
    throw ins.error;
  }
  const withThis: HistoryRound[] = [{ game_id: round.game_id, subject: round.subject, accuracy: round.accuracy, xp_awarded: xp, created_at: new Date(now).toISOString() }, ...history];

  // streak
  const before = { current_streak: gam.current_streak ?? 0, longest_streak: gam.longest_streak ?? 0, last_activity_date: gam.last_activity_date ?? null,
    streak_freezes: gam.streak_freezes ?? 0, freeze_earned_at_streak: gam.freeze_earned_at_streak ?? 0 };
  const streak = applyActivity(before, today);

  // missions
  const wk = weekStart(today);
  const activeDays = new Set(withThis.map((h) => localDate(Date.parse(h.created_at), tz)).filter((d) => d >= wk)).size;
  const completed: any[] = [];
  for (const m of [...missions.daily, ...missions.weekly]) {
    const next = missionProgressAfterRound(m, round, xp, activeDays);
    if (next === null) continue;
    const done = isMissionDone({ progress: next, target: m.target });
    const patch: any = { progress: next };
    if (done) { patch.status = "completed"; patch.completed_at = new Date(now).toISOString(); }
    must(await admin.from("gamification_missions").update(patch).eq("id", m.id).eq("status", "active"));
    if (done) completed.push({ id: m.id, title: m.title, xp_reward: m.xp_reward, period: m.period });
  }

  // badges
  const stats = await buildBadgeStats(admin, userId, withThis, today, tz, {
    longest_streak: streak.longest_streak, days_away_before_this: streak.days_away, beat_personal_best: beatBest,
  });
  const { badges, bonus_xp } = await awardBadges(admin, userId, stats);

  // persist XP + streak
  const prevXp = gam.total_xp ?? 0;
  const newXp = prevXp + xp + bonus_xp;
  must(await admin.from("user_gamification").update({
    total_xp: newXp, level: calcLevel(newXp), current_streak: streak.current_streak, longest_streak: streak.longest_streak,
    last_activity_date: streak.last_activity_date, streak_freezes: streak.streak_freezes,
    freeze_earned_at_streak: streak.freeze_earned_at_streak, updated_at: new Date(now).toISOString(),
  }).eq("user_id", userId));
  if (xp > 0) {
    await admin.from("xp_transactions").insert({ user_id: userId, xp_amount: xp, action: "g2_round", description: `Game round: ${round.game_id} (${Math.round(round.accuracy)}%)` });
  }

  return {
    duplicate: false,
    awarded: {
      round_xp: xp, capped: xp < roundXp(round), badge_bonus_xp: bonus_xp,
      streak: { current: streak.current_streak, freezes_used: streak.freezes_used, freeze_earned: streak.freeze_earned, broken: streak.streak_broken, days_away: streak.days_away },
      missions_completed: completed, badges_unlocked: badges,
      level_up: calcLevel(newXp) > calcLevel(prevXp) ? calcLevel(newXp) : null,
    },
    state: await buildState(admin, userId, tz),
  };
}

async function claimMission(admin: any, userId: string, body: any, tz: number) {
  const id = typeof body?.mission_id === "string" ? body.mission_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "mission_id is required");
  const m = must(await admin.from("gamification_missions").select("*").eq("id", id).eq("user_id", userId).maybeSingle());
  if (!m) throw new HttpError(404, "Mission not found");
  if (m.status === "claimed") throw new HttpError(409, "Mission already claimed", "already_claimed");
  if (m.status !== "completed") throw new HttpError(400, "Mission isn't complete yet", "not_complete");

  // conditional update = only one concurrent claim can win
  const won = must(await admin.from("gamification_missions")
    .update({ status: "claimed", claimed_at: new Date().toISOString() }).eq("id", id).eq("status", "completed").select("id"));
  if (!won?.length) throw new HttpError(409, "Mission already claimed", "already_claimed");

  const gam = await loadGamRow(admin, userId);
  const today = localDate(Date.now(), tz);
  const history = await loadHistory(admin, userId);
  const stats = await buildBadgeStats(admin, userId, history, today, tz, { longest_streak: gam.longest_streak ?? 0 });
  const { badges, bonus_xp } = await awardBadges(admin, userId, stats);

  const prevXp = gam.total_xp ?? 0;
  const newXp = prevXp + m.xp_reward + bonus_xp;
  must(await admin.from("user_gamification").update({ total_xp: newXp, level: calcLevel(newXp), updated_at: new Date().toISOString() }).eq("user_id", userId));
  await admin.from("xp_transactions").insert({ user_id: userId, xp_amount: m.xp_reward, action: "g2_mission_claim", description: `Mission: ${m.title}` });

  return {
    awarded: { mission_xp: m.xp_reward, badge_bonus_xp: bonus_xp, badges_unlocked: badges, level_up: calcLevel(newXp) > calcLevel(prevXp) ? calcLevel(newXp) : null },
    state: await buildState(admin, userId, tz),
  };
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────────────

export async function handleGamification2(req: Request): Promise<Response> {
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

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "student") return json({ error: "Gamification missions are for students" }, 403);

    const body = await req.json().catch(() => ({}));
    const tz = clampTz(body?.tz_offset_minutes);

    switch (body?.action) {
      case "state": return json(await buildState(admin, user.id, tz));
      case "event": return json(await recordRound(admin, user.id, body, tz));
      case "claim": return json(await claimMission(admin, user.id, body, tz));
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof Unavailable) {
      return json({ error: "Gamification 2.0 isn't set up yet (apply migration 20261016000000).", code: "persistence_unavailable" }, 503);
    }
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error("gamification2 handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
}
