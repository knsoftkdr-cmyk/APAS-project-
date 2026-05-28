import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface GamificationData {
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  xpToNextLevel: number;
  levelProgress: number;
}

export interface Achievement {
  id: string;
  key: string;
  title: string;
  description: string;
  icon: string;
  xp_reward: number;
  category: string;
  threshold: number;
  earned: boolean;
  earned_at?: string;
}

export interface XpTransaction {
  id: string;
  xp_amount: number;
  action: string;
  description: string | null;
  created_at: string;
}

export interface LeaderboardEntry {
  user_id: string;
  full_name: string;
  role: string;
  total_xp: number;
  level: number;
  current_streak: number;
}

const XP_PER_LEVEL = 200;
const calcLevel = (xp: number) => Math.floor(xp / XP_PER_LEVEL) + 1;
const calcProgress = (xp: number) => ((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100;
const calcXpToNext = (xp: number) => XP_PER_LEVEL - (xp % XP_PER_LEVEL);

// XP rewards for actions
const XP_ACTIONS: Record<string, { xp: number; label: string }> = {
  complete_assessment: { xp: 50, label: "Completed assessment" },
  generate_lesson: { xp: 40, label: "Generated lesson plan" },
  generate_report: { xp: 30, label: "Generated class report" },
  record_exit_ticket: { xp: 15, label: "Recorded exit ticket" },
  daily_login: { xp: 10, label: "Daily login bonus" },
  view_analytics: { xp: 5, label: "Reviewed analytics" },
};

export function useGamification() {
  const { user } = useAuth();
  const [data, setData] = useState<GamificationData | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [transactions, setTransactions] = useState<XpTransaction[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      // Fetch or create user gamification record
      let { data: gData } = await supabase
        .from("user_gamification")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!gData) {
        const { data: newData } = await supabase
          .from("user_gamification")
          .insert({ user_id: user.id })
          .select()
          .single();
        gData = newData;
      }

      if (gData) {
        const totalXp = gData.total_xp || 0;
        setData({
          totalXp,
          level: calcLevel(totalXp),
          currentStreak: gData.current_streak || 0,
          longestStreak: gData.longest_streak || 0,
          lastActivityDate: gData.last_activity_date,
          xpToNextLevel: calcXpToNext(totalXp),
          levelProgress: calcProgress(totalXp),
        });
      }

      // Fetch all achievement definitions + user's earned ones
      const [{ data: allAch }, { data: userAch }] = await Promise.all([
        supabase.from("achievement_definitions").select("*").order("category"),
        supabase.from("user_achievements").select("*, achievement_definitions(*)").eq("user_id", user.id),
      ]);

      const earnedIds = new Set((userAch || []).map((ua: any) => ua.achievement_id));
      const earnedMap = new Map((userAch || []).map((ua: any) => [ua.achievement_id, ua.earned_at]));

      setAchievements(
        (allAch || []).map((a: any) => ({
          ...a,
          earned: earnedIds.has(a.id),
          earned_at: earnedMap.get(a.id),
        }))
      );

      // Fetch recent XP transactions
      const { data: txData } = await supabase
        .from("xp_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      setTransactions(txData || []);

      // Fetch leaderboard (all users with gamification)
      const { data: lbData } = await supabase
        .from("user_gamification")
        .select("user_id, total_xp, level, current_streak")
        .order("total_xp", { ascending: false })
        .limit(50);

      if (lbData && lbData.length > 0) {
        const userIds = lbData.map((l: any) => l.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, role")
          .in("id", userIds);

        const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
        setLeaderboard(
          lbData.map((l: any) => ({
            ...l,
            full_name: profileMap.get(l.user_id)?.full_name || "Unknown",
            role: profileMap.get(l.user_id)?.role || "student",
          }))
        );
      }
    } catch (err) {
      console.error("Gamification fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const awardXp = useCallback(
    async (action: string, customDescription?: string) => {
      if (!user?.id) return;
      const config = XP_ACTIONS[action];
      if (!config) return;

      try {
        // Insert XP transaction
        await supabase.from("xp_transactions").insert({
          user_id: user.id,
          xp_amount: config.xp,
          action,
          description: customDescription || config.label,
        });

        // Update streak
        const today = new Date().toISOString().split("T")[0];
        const { data: current } = await supabase
          .from("user_gamification")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        let newStreak = 1;
        let longestStreak = current?.longest_streak || 0;

        if (current?.last_activity_date) {
          const lastDate = new Date(current.last_activity_date);
          const todayDate = new Date(today);
          const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

          if (diffDays === 0) {
            newStreak = current.current_streak || 1;
          } else if (diffDays === 1) {
            newStreak = (current.current_streak || 0) + 1;
          }
        }

        if (newStreak > longestStreak) longestStreak = newStreak;

        const newTotalXp = (current?.total_xp || 0) + config.xp;
        const newLevel = calcLevel(newTotalXp);

        await supabase
          .from("user_gamification")
          .upsert({
            user_id: user.id,
            total_xp: newTotalXp,
            level: newLevel,
            current_streak: newStreak,
            longest_streak: longestStreak,
            last_activity_date: today,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });

        // Check for new achievements
        await checkAchievements(user.id, newTotalXp, newStreak, action);

        toast.success(`+${config.xp} XP`, { description: customDescription || config.label });

        // Refresh data
        fetchAll();
      } catch (err) {
        console.error("Award XP error:", err);
      }
    },
    [user?.id, fetchAll]
  );

  const checkAchievements = async (userId: string, totalXp: number, streak: number, action: string) => {
    const { data: allAch } = await supabase.from("achievement_definitions").select("*");
    const { data: earned } = await supabase.from("user_achievements").select("achievement_id").eq("user_id", userId);
    const earnedIds = new Set((earned || []).map((e: any) => e.achievement_id));

    // Count actions
    const { count: assessmentCount } = await supabase
      .from("student_assessments")
      .select("*", { count: "exact", head: true })
      .eq("submitted_by", userId);

    const { count: lessonCount } = await supabase
      .from("xp_transactions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "generate_lesson");

    const { count: reportCount } = await supabase
      .from("xp_transactions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "generate_report");

    const level = calcLevel(totalXp);

    for (const ach of allAch || []) {
      if (earnedIds.has(ach.id)) continue;

      let shouldAward = false;
      switch (ach.key) {
        case "first_assessment": shouldAward = (assessmentCount || 0) >= 1; break;
        case "5_assessments": shouldAward = (assessmentCount || 0) >= 5; break;
        case "10_assessments": shouldAward = (assessmentCount || 0) >= 10; break;
        case "3_day_streak": shouldAward = streak >= 3; break;
        case "7_day_streak": shouldAward = streak >= 7; break;
        case "14_day_streak": shouldAward = streak >= 14; break;
        case "first_lesson": shouldAward = (lessonCount || 0) >= 1; break;
        case "10_lessons": shouldAward = (lessonCount || 0) >= 10; break;
        case "25_lessons": shouldAward = (lessonCount || 0) >= 25; break;
        case "first_report": shouldAward = (reportCount || 0) >= 1; break;
        case "level_5": shouldAward = level >= 5; break;
        case "level_10": shouldAward = level >= 10; break;
      }

      if (shouldAward) {
        await supabase.from("user_achievements").insert({
          user_id: userId,
          achievement_id: ach.id,
        });

        // Award bonus XP for achievement
        if (ach.xp_reward > 0) {
          await supabase.from("xp_transactions").insert({
            user_id: userId,
            xp_amount: ach.xp_reward,
            action: "achievement_bonus",
            description: `🏆 Achievement: ${ach.title}`,
          });

          const { data: curr } = await supabase
            .from("user_gamification")
            .select("total_xp")
            .eq("user_id", userId)
            .single();

          if (curr) {
            const updatedXp = curr.total_xp + ach.xp_reward;
            await supabase
              .from("user_gamification")
              .update({ total_xp: updatedXp, level: calcLevel(updatedXp) })
              .eq("user_id", userId);
          }
        }

        toast.success(`🏆 Achievement Unlocked!`, { description: ach.title });
      }
    }
  };

  return { data, achievements, transactions, leaderboard, loading, awardXp, refetch: fetchAll };
}
