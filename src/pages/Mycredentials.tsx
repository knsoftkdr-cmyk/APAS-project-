import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Award, Loader2, Sparkles, Lock } from "lucide-react";
import type { MicroCredential, StudentCredential } from "@/types/courseManagement";

export default function MyCredentials() {
  const { profile } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["my-credentials", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: earned, error: earnedErr } = await supabase
        .from("student_credentials")
        .select("*, credential:credential_id(*)")
        .eq("student_id", profile!.id)
        .order("awarded_at", { ascending: false });
      if (earnedErr) throw earnedErr;
      const { data: allCredentials, error: allErr } = await supabase
        .from("micro_credentials")
        .select("*")
        .eq("school_id", profile!.school_id);
      if (allErr) throw allErr;
      const earnedIds = new Set((earned as StudentCredential[]).map((e) => e.credential_id));
      const locked = (allCredentials as MicroCredential[]).filter((c) => !earnedIds.has(c.id));
      return { earned: earned as StudentCredential[], locked };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-sky-600">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading credentials...
      </div>
    );
  }

  const { earned, locked } = data;

  return (
    <div className="min-h-screen relative overflow-x-hidden">
      {/* Layered waves at top */}
      <svg className="absolute top-0 left-0 w-full h-48 opacity-[0.07]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,90 C240,150 480,30 720,70 C960,110 1200,30 1440,80 L1440,0 L0,0 Z" fill="#0ea5e9" />
      </svg>
      <svg className="absolute top-0 left-0 w-full h-36 opacity-[0.06]" viewBox="0 0 1440 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,50 C320,120 720,10 1440,60 L1440,0 L0,0 Z" fill="#4f46e5" />
      </svg>

      <div className="relative z-10 p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-sky-500 to-indigo-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
          <div className="relative flex items-start md:items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">My Credentials</h1>
              <p className="text-sky-100 text-xs md:text-sm mt-0.5">Badges and micro-credentials you've earned along the way.</p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Award className="h-4 w-4 text-sky-500" />
            <h2 className="font-semibold text-sm text-gray-700">Earned ({earned.length})</h2>
          </div>

          {earned.length === 0 ? (
            <Card className="border-sky-100 bg-white/70 backdrop-blur-sm">
              <CardContent className="py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center mx-auto mb-3">
                  <Award className="h-6 w-6 text-sky-500" />
                </div>
                <p className="text-muted-foreground text-sm">No credentials earned yet — complete a course to earn your first one!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {earned.map((e) => (
                <Card
                  key={e.id}
                  className="overflow-hidden text-center border-sky-100 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow duration-300"
                >
                  <div className="h-1 bg-gradient-to-r from-sky-400 to-indigo-500" />
                  <CardContent className="pt-6 space-y-2">
                    <div className="mx-auto h-16 w-16 rounded-full bg-sky-100 flex items-center justify-center">
                      {e.credential?.badge_icon_url ? (
                        <img src={e.credential.badge_icon_url} alt="" className="h-10 w-10" />
                      ) : (
                        <Award className="h-8 w-8 text-sky-600" />
                      )}
                    </div>
                    <p className="text-sm font-medium">{e.credential?.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.awarded_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {locked.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Lock className="h-4 w-4 text-slate-400" />
              <h2 className="font-semibold text-sm text-gray-700">Not yet earned ({locked.length})</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {locked.map((c) => (
                <Card key={c.id} className="text-center opacity-50 border-slate-100 bg-white/70">
                  <CardContent className="pt-6 space-y-2">
                    <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                      <Award className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">{c.title}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
