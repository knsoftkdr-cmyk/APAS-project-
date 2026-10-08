import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { claimMission, G2Awarded, G2Error, G2State, getGamificationState } from "@/lib/gamification2";

// Gamification 2.0 state for the Gamification page (missions, badges, streak, progression).
// Additive: the legacy useGamification() hook (XP, achievements, leaderboard) is untouched.

export function useGamification2() {
  const { user } = useAuth();
  const [state, setState] = useState<G2State | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      setState(await getGamificationState());
      setError(null);
      setUnavailable(false);
    } catch (e) {
      if (e instanceof G2Error && e.code === "persistence_unavailable") setUnavailable(true);
      else setError(e instanceof Error ? e.message : "Couldn't load missions.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  /** Show what the server just awarded (called after a round or a claim). */
  const announce = useCallback((a: G2Awarded | undefined) => {
    if (!a) return;
    a.missions_completed?.forEach((m) => toast.success("Mission complete!", { description: `${m.title} - claim +${m.xp_reward} XP in Missions` }));
    a.badges_unlocked.forEach((b) => toast.success("Badge unlocked!", { description: `${b.title}${b.xp_reward ? ` (+${b.xp_reward} XP)` : ""}` }));
    if (a.streak?.freezes_used) toast.info("Streak saved", { description: `A streak freeze covered ${a.streak.freezes_used} missed day${a.streak.freezes_used > 1 ? "s" : ""}.` });
    if (a.streak?.freeze_earned) toast.success("Streak freeze earned", { description: "It will protect one missed day." });
    if (a.level_up) toast.success(`Level ${a.level_up}!`, { description: "You levelled up." });
  }, []);

  const claim = useCallback(async (missionId: string) => {
    setClaimingId(missionId);
    try {
      const res = await claimMission(missionId);
      setState(res.state);
      toast.success(`+${res.awarded.mission_xp} XP`, { description: "Mission reward claimed" });
      announce({ ...res.awarded, missions_completed: undefined });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't claim that mission.");
      refresh();
    } finally {
      setClaimingId(null);
    }
  }, [announce, refresh]);

  return { state, loading, unavailable, error, claimingId, refresh, claim, announce, applyState: setState };
}
