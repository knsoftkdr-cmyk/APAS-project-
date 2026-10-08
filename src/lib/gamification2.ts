import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Gamification 2.0 client. Goes through the already-deployed `update-mastery` edge function
// (actions g2_state / g2_event / g2_claim) - no new edge function. See supabase/functions/CONSOLIDATION.md.
// Keep the response shapes in sync with supabase/functions/_shared/handlers/gamification2.ts.

export interface G2Mission {
  id: string;
  period: "daily" | "weekly";
  mission_key: string;
  title: string;
  description: string;
  metric: string;
  target: number;
  progress: number;
  xp_reward: number;
  status: "active" | "completed" | "claimed";
  meta: Record<string, unknown> | null;
}

export interface G2Badge {
  key: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  xp_reward: number;
  earned: boolean;
  earned_at: string | null;
  progress: { current: number; target: number } | null;
}

export interface G2State {
  persistence: "available";
  today: string;
  week_start: string;
  progression: {
    total_xp: number; level: number; xp_into_level: number; xp_to_next_level: number; level_progress_pct: number;
    title: string; emoji: string;
    next_title: { title: string; at_level: number; levels_away: number } | null;
  };
  streak: { current: number; longest: number; freezes: number; at_risk: boolean; played_today: boolean; next_freeze_in_days: number };
  missions: { daily: G2Mission[]; weekly: G2Mission[] };
  badges: G2Badge[];
  insights: {
    avg_accuracy: number | null;
    weak_subject: { subject: string; avg_accuracy: number; rounds: number } | null;
    rounds_this_week: number; xp_this_week: number; rounds_14d: number;
  };
}

export interface G2Awarded {
  round_xp?: number;
  capped?: boolean;
  mission_xp?: number;
  badge_bonus_xp: number;
  streak?: { current: number; freezes_used: number; freeze_earned: boolean; broken: boolean; days_away: number };
  missions_completed?: { id: string; title: string; xp_reward: number; period: string }[];
  badges_unlocked: { key: string; title: string; icon: string; xp_reward: number }[];
  level_up: number | null;
}

export interface G2Round {
  game_id: string;
  subject?: string | null;
  accuracy: number;
  score: number;
  max_score: number;
  questions_attempted: number;
  duration_seconds: number;
}

export class G2Error extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

/** Minutes EAST of UTC (India = 330), so "today" matches the student's own calendar day. */
const tzOffset = () => -new Date().getTimezoneOffset();

async function call<T>(action: "g2_state" | "g2_event" | "g2_claim", body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("update-mastery", {
    body: { action, tz_offset_minutes: tzOffset(), ...body },
  });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Couldn't reach Gamification.");
    throw new G2Error(message, code);
  }
  if (data?.error) throw new G2Error(data.error, data.code);
  return data as T;
}

export const getGamificationState = () => call<G2State>("g2_state");

export const recordGameRound = (round: G2Round, dedupeKey?: string) =>
  call<{ duplicate: boolean; awarded?: G2Awarded; state: G2State }>("g2_event", { round, dedupe_key: dedupeKey });

export const claimMission = (missionId: string) =>
  call<{ awarded: G2Awarded; state: G2State }>("g2_claim", { mission_id: missionId });
