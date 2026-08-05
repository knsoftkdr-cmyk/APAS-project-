import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, Loader2 } from "lucide-react";

interface RatingRow {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export default function DriverRatings() {
  const { profile } = useAuth();
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!profile?.id) return;
      const { data: driver } = await supabase
        .from("drivers")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (!driver) { setLoading(false); return; }

      const { data } = await supabase
        .from("driver_ratings")
        .select("id, rating, comment, created_at")
        .eq("driver_id", driver.id)
        .order("created_at", { ascending: false });

      setRatings((data || []) as RatingRow[]);
      setLoading(false);
    };
    load();
  }, [profile?.id]);

  const avgRating = ratings.length > 0
    ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(1)
    : null;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 p-8">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className="rounded-xl bg-white/15 p-3">
              <Star className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">My Ratings</h1>
              <p className="text-emerald-50/90 mt-1">
                {avgRating ? `${avgRating} average from ${ratings.length} rating${ratings.length === 1 ? "" : "s"}` : "Parent feedback on your trips"}
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" /> Ratings & Feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading ratings...
              </p>
            ) : ratings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ratings yet.</p>
            ) : (
              <div className="space-y-3">
                {ratings.map((r) => (
                  <div key={r.id} className="border-b last:border-b-0 pb-3">
                    <div className="flex items-center gap-1 mb-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-4 w-4 ${n <= r.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                      ))}
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
