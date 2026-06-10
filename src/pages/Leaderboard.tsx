import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Trophy, Medal, Zap, Award } from "lucide-react";
import leaderBanner from "@/assets/leaderboard-banner.png";
import Confetti from "react-confetti";
interface LeaderboardEntry {
  user_id: string;
  total_xp: number;
  level: number;
  full_name: string;
  avatar_url: string | null;
}

export default function Leaderboard() {
  const { user, profile } = useAuth();
  const [period, setPeriod] = useState<"all-time">("all-time");

  // Fetch global leaderboard
  const { data: globalLeaderboard, isLoading: globalLoading } = useQuery({
    queryKey: ["leaderboard-global", period],
    queryFn: async () => {
      if (!profile?.school_id) return [];
      const { data, error } = await supabase
        .from("user_gamification")
        .select("user_id, total_xp, level, profiles!inner(full_name, avatar_url, school_id)")
        .eq("profiles.school_id", profile.school_id)
        .order("total_xp", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((entry: any) => ({
        user_id: entry.user_id,
        total_xp: entry.total_xp,
        level: entry.level,
        full_name: entry.profiles?.full_name || "Unknown",
        avatar_url: entry.profiles?.avatar_url ?? null,
      }));
    },
    enabled: !!profile?.school_id,
  });

  // Fetch class leaderboard (if student)
  const { data: classLeaderboard, isLoading: classLoading } = useQuery({
    queryKey: ["leaderboard-class", period, user?.id],
    queryFn: async () => {
      if (!user?.id || !profile?.school_id) return [];
      const { data: studentRec } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", user.id)
        .single();
      if (!studentRec?.id) return [];
      const { data: classRec } = await supabase
        .from("class_students")
        .select("class_id")
        .eq("student_id", studentRec.id)
        .single();
      if (!classRec?.class_id) return [];
      const { data: classmates } = await supabase
        .from("class_students")
        .select("student_id")
        .eq("class_id", classRec.class_id);
      const studentIds = (classmates ?? []).map((c: any) => c.student_id);
      if (!studentIds.length) return [];
      const { data: profileRecs } = await supabase
        .from("students")
        .select("profile_id")
        .in("id", studentIds);
      const profileIds = (profileRecs ?? []).map((s: any) => s.profile_id).filter(Boolean);
      if (!profileIds.length) return [];
      const { data, error } = await supabase
        .from("user_gamification")
        .select("user_id, total_xp, level, profiles(full_name, avatar_url)")
        .in("user_id", profileIds)
        .order("total_xp", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((entry: any) => ({
        user_id: entry.user_id,
        total_xp: entry.total_xp,
        level: entry.level,
        full_name: entry.profiles?.full_name || "Unknown",
        avatar_url: entry.profiles?.avatar_url ?? null,
      }));
    },
    enabled: !!user?.id && !!profile?.school_id,

  });
  // Find user's rank
  const userRank = globalLeaderboard?.findIndex(u => u.user_id === user?.id) ?? -1;
  const userXp = globalLeaderboard?.find(u => u.user_id === user?.id)?.total_xp ?? 0;

  const renderLeaderboard = (data: LeaderboardEntry[] | undefined, isLoading: boolean) => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    if (!data?.length) {
      return (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No rankings available yet. Start playing games to earn XP!
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12">Rank</TableHead>
              <TableHead className="w-12">Icon</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="text-right">Level</TableHead>
              <TableHead className="text-right">XP Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry, index) => {
              const isCurrentUser = entry.user_id === user?.id;
              const isTopThree = index < 3;
              
              return (
                <TableRow
                  key={entry.user_id}
                  className={isCurrentUser ? "bg-primary/10 font-semibold" : ""}
                >
                  <TableCell className="text-center">
                    {isTopThree ? (
                      <div className="flex justify-center">
                        {index === 0 && <Trophy className="h-7 w-7 text-amber-500" />}
                        {index === 1 && <Medal className="h-7 w-7 text-slate-400" />}
                        {index === 2 && <Medal className="h-7 w-7 text-orange-600" />}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">#{index + 1}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.avatar_url ? (
                      <img
                        src={entry.avatar_url}
                        alt={entry.full_name}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                        {entry.full_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{entry.full_name}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{entry.level}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <div className="flex items-center justify-end gap-1">
                      <Zap className="h-6 w-6 text-yellow-500" />
                      {entry.total_xp.toLocaleString()}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-r from-blue-400 via-blue-0 to-blue-300 p-8 relative min-h-[220px]">
<div className="hidden md:block">
          <div className="absolute top-6 right-40 w-14 h-14 rounded-full border border-white/60"></div>
          <div className="absolute bottom-10 right-80 w-8 h-8 rounded-full border border-white/80"></div>
          <div className="absolute top-16 left-1/2 w-6 h-6 rounded-full border border-white/80"></div>

  <div className="absolute top-12 left-[45%] text-white/80 text-xl">✦</div>
          <div className="absolute bottom-16 left-[60%] text-white/50 text-lg">✦</div>
          <div className="absolute top-24 right-[35%] text-white/80 text-lg">✦</div>
          
          <div className="absolute top-6 left-1/4 text-white/50 text-xl">✦</div>
          <div className="absolute top-0 left-[45%] text-white/40 text-lg">✦</div>
          <div className="absolute top-1/2 left-[70%] text-white/40 text-lg">✦</div>
          <div className="absolute top-24 right-[45%] text-white/90 text-lg">✦</div>

          <div className="absolute top-12 right-64 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-b-[20px] border-b-white/40"></div>

          <div className="absolute bottom-16 left-72 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[18px] border-b-white/40"></div>

          <div className="absolute top-28 left-1/3 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-white/80"></div>
</div>

  <div className="max-w-xl">
    <h1 className="text-5xl font-bold text-slate-900">
      🏆 Leaderboard
    </h1>

    <p className="mt-3 text-slate-700 text-lg">
      Compete with friends, earn XP and climb the rankings.
    </p>
  </div>

  <img
    src={leaderBanner}
    alt="Leaderboard Banner"
    /* className="absolute right-10 bottom-0 h-[220px]" */
    className="hidden md:block absolute right-10 bottom-0 w-80"
  />
</div>
        {/* Your Ranking Card */}
        {userRank >= 0 && (
          <Card className="border-primary/50 bg-gradient-to-r from-primary/5 to-transparent">
             <CardContent className="py-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
<div>
  <div className="text-sm text-muted-foreground">
    🏅 Your Rank
  </div>

  <div className="flex items-center gap-2">
    <div className="text-4xl font-bold text-primary">
      #{userRank + 1}
    </div>

    <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">
      Top 10%
    </Badge>
  </div>
</div>
                <div>
                  <div className="text-sm text-muted-foreground">Your XP</div>
                  <div className="text-3xl font-bold flex items-center gap-2">
                    <Zap className="h-6 w-6 text-yellow-500" />
                    {userXp.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">XP to Next Rank</div>
                  <div className="text-3xl font-bold text-emerald-600">
                    {globalLeaderboard && userRank < globalLeaderboard.length - 1
                      ? (globalLeaderboard[userRank + 1] ? (userXp - globalLeaderboard[userRank + 1].total_xp).toLocaleString() : "—")
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Distance to Top</div>
                  <div className="text-3xl font-bold">
                    {globalLeaderboard && userRank > 0
                      ? `−${(globalLeaderboard[0].total_xp - userXp).toLocaleString()}`
                      : "🥇"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}



        {/* Leaderboard Tabs */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Rankings</h2>
          </div>

          <Tabs defaultValue="global" className="space-y-4 ">
            <TabsList>
              <TabsTrigger value="global">
                <Award className="h-4 w-4 mr-2 " />
                Global Ranking
              </TabsTrigger>
              <TabsTrigger value="class">
                <Trophy className="h-4 w-4 mr-2" />
                Class Ranking
              </TabsTrigger>
            </TabsList>

            <TabsContent value="global" className="space-y-4">
              {globalLeaderboard && globalLeaderboard.length >= 3 && (
                <Card className="border-0 bg-gradient-to-r from-yellow-50 via-white to-orange-50 shadow-lg">
                  <CardContent className="py-8">

                    <h2 className="text-base md:text-xl font-bold text-center mb-8">
                      🏆 Top Performers
                    </h2>

<div className="space-y-10">

  {/* WINNER SECTION */}
  <div className="relative text-center">
  <div className="absolute left-1/2 -translate-x-1/2 -top-12 w-[200px] md:w-[300px] h-[180px] md:h-[250px] overflow-hidden pointer-events-none">
    <Confetti
      numberOfPieces={100}
      recycle={false}
      gravity={0.08}
      width={600}
      height={250}
    />
</div>
    <div className="text-3xl md:text-5xl mb-3 animate-bounce">
      👑
    </div>

    <div className="mx-auto w-24 h-32 md:w-36 md:h-44 rounded-2xl bg-gradient-to-b  from-yellow-300 to-yellow-500 flex items-center justify-center text-3xl md:text-5xl font-bold text-white shadow-2xl">
      1
    </div>

    <div className="mt-4">
      <div className="font-bold text-base md:text-xl break-words">
        {globalLeaderboard[0]?.full_name}
      </div>

      <div className="text-yellow-600 font-semibold text-sm md:text-base">
        🥇 {globalLeaderboard[0]?.total_xp.toLocaleString()} XP
      </div>
    </div>
  </div>

  {/* SECOND & THIRD */}
  <div className="flex flex-row justify-center flex-wrap items-center gap-6 md:gap-16">

    {/* SECOND */}
    <div className="text-center">
      <div className="w-20 h-24 md:w-28 md:h-32 rounded-2xl bg-gradient-to-b from-slate-300  to-slate-500 flex items-center justify-center text-2xl md:text-4xl font-bold text-white shadow-xl">
        2
      </div>

      <div className="mt-3">
        <div className="font-semibold">
          {globalLeaderboard[1]?.full_name}
        </div>

        <div className="text-slate-600">
          🥈 {globalLeaderboard[1]?.total_xp.toLocaleString()} XP
        </div>
      </div>

    </div>

    {/* THIRD */}
    <div className="text-center">
      <div className="w-20 h-24 md:w-28 md:h-32 rounded-2xl bg-gradient-to-b  from-orange-300 to-orange-500 flex items-center justify-center text-2xl md:text-4xl font-bold text-white shadow-xl">
        3
      </div>

      <div className="mt-3">
        <div className="font-semibold">
          {globalLeaderboard[2]?.full_name}
        </div>

        <div className="text-orange-600">
          🥉 {globalLeaderboard[2]?.total_xp.toLocaleString()} XP
        </div>
      </div>

    </div>

  </div>

</div>
                  </CardContent>
                </Card>
              )}
              {renderLeaderboard(globalLeaderboard, globalLoading)}
            </TabsContent>

            <TabsContent value="class">
              {classLeaderboard && classLeaderboard.length >= 3 && (
                 <Card className="border-0 bg-gradient-to-r from-yellow-50 via-white to-orange-50 shadow-lg">
                    <CardContent className="py-8">
                      <h2 className="text-base md:text-xl font-bold text-center mb-8">
                        🏫 Class Top Performers
                      </h2>
                      <div className="space-y-10">
                        {/* WINNER */}
                        <div className="relative text-center">
                          {/* Confetti above #1 */}
                          <div className="absolute left-1/2 -translate-x-1/2 -top-12 w-[200px] md:w-[300px] h-[180px] md:h-[250px] overflow-hidden pointer-events-none">
                            <Confetti
                              width={250}
                              height={250}
                              numberOfPieces={100}
                              recycle={false}
                              gravity={0.08}
                            />
                          </div>
                          <div className="text-3xl md:text-5xl mb-3 animate-bounce">
                            👑
                          </div>
                          <div className="mx-auto w-24 h-32 md:w-36 md:h-44 rounded-2xl bg-gradient-to-b  from-yellow-300 to-yellow-500 flex items-center justify-center text-3xl md:text-5xl font-bold  text-white shadow-2xl">
                            1
                          </div>
                          <div className="mt-4">
                            <div className="font-bold text-base md:text-xl break-words">
                              {classLeaderboard[0]?.full_name}
                            </div>
                            <div className="text-yellow-600 font-semibold text-sm md:text-base">
                              🥇 {classLeaderboard[0]?.total_xp.toLocaleString()} XP
                            </div>
                          </div>
                        </div>

                        {/* 2nd & 3rd */}
                        <div className="flex flex-row justify-center flex-wrap items-center gap-6 md:gap-16">

                          <div className="text-center">
                            <div className="w-20 h-24 md:w-28 md:h-32 rounded-2xl bg-gradient-to-b from-slate-300 to-slate-500 flex items-center justify-center text-2xl md:text-4xl font-bold text-white shadow-xl">
                              2
                            </div>
                            <div className="mt-3">
                              <div className="font-semibold">
                                {classLeaderboard[1]?.full_name}
                              </div>
                              <div className="text-slate-600">
                                🥈 {classLeaderboard[1]?.total_xp.toLocaleString()} XP
                              </div>
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="w-20 h-24 md:w-28 md:h-32 rounded-2xl bg-gradient-to-b from-orange-300 to-orange-500 flex items-center justify-center text-2xl md:text-4xl font-bold text-white shadow-xl">
                              3
                            </div>
                            <div className="mt-3">
                              <div className="font-semibold">
                                {classLeaderboard[2]?.full_name}
                              </div>
                              <div className="text-orange-600">
                                🥉 {classLeaderboard[2]?.total_xp.toLocaleString()} XP
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              {renderLeaderboard(classLeaderboard, classLoading)}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
