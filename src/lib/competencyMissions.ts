import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Competency Missions client. Goes through the already-deployed `update-mastery` edge function
// (actions cm_state / cm_claim) - no new edge function. See supabase/functions/CONSOLIDATION.md.
// Keep the response shapes in sync with supabase/functions/_shared/handlers/competencyMissions.ts.

export interface CompetencyMission {
  id: string;
  kind: "level_up" | "topic_quest";
  title: string;
  description: string;
  subject: string | null;
  topic_name: string | null;
  status: "active" | "completed";
  xp_reward: number;
  tier_from: string | null;
  tier_to: string | null;
  start_pct: number;
  current_pct: number;
  target_pct: number;
  /** 0..1; held below 1 until every requirement is verified. */
  progress: number;
  requirements: {
    evidence: { have: number; need: number };
    correct: { have: number; need: number };
    days: { have: number; need: number };
    coverage: { have: number; need: number } | null;
  };
  hint: string;
  expires_at: string;
}

export interface CompetencyState {
  persistence: "available";
  enrolled: boolean;
  missions: CompetencyMission[];
  recent: { id: string; title: string; xp_reward: number; claimed_at: string; kind: string }[];
  summary: {
    assessed: number; mastered: number; proficient: number; developing: number; beginning: number;
    xp_earned_total: number; xp_today: number; xp_daily_cap: number;
  } | null;
}

export interface CompetencyClaimResult {
  awarded: { mission_xp: number; level_up: number | null; already_rewarded: boolean };
  state: CompetencyState;
}

export class CompetencyError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

/** Minutes EAST of UTC (India = 330), so "a different day" means the student's own calendar day. */
const tzOffset = () => -new Date().getTimezoneOffset();

async function call<T>(action: "cm_state" | "cm_claim", body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("update-mastery", {
    body: { action, tz_offset_minutes: tzOffset(), ...body },
  });
  if (error) {
    const { message, code } = await unwrapFunctionError(error, "Couldn't load your competency missions.");
    throw new CompetencyError(message, code);
  }
  if (data?.error) throw new CompetencyError(data.error, data.code);
  return data as T;
}

export const getCompetencyMissions = () => call<CompetencyState>("cm_state");

export const claimCompetencyMission = (missionId: string) =>
  call<CompetencyClaimResult>("cm_claim", { mission_id: missionId });
