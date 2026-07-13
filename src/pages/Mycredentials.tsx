import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Award } from "lucide-react";
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
    return <div className="p-6 text-muted-foreground">Loading credentials...</div>;
  }

  const { earned, locked } = data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Award className="h-5 w-5" />
        <h1 className="text-2xl font-semibold">My Credentials</h1>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          Earned ({earned.length})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {earned.map((e) => (
            <Card key={e.id} className="text-center">
              <CardContent className="pt-6 space-y-2">
                <div className="mx-auto h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
                  {e.credential?.badge_icon_url ? (
                    <img src={e.credential.badge_icon_url} alt="" className="h-10 w-10" />
                  ) : (
                    <Award className="h-8 w-8 text-amber-600" />
                  )}
                </div>
                <p className="text-sm font-medium">{e.credential?.title}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.awarded_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
          {earned.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full">
              No credentials earned yet — complete a course to earn your first one!
            </p>
          )}
        </div>
      </div>

      {locked.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Not yet earned ({locked.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {locked.map((c) => (
              <Card key={c.id} className="text-center opacity-50">
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
  );
}