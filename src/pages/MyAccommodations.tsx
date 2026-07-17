import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accessibility, BookOpen, PenSquare, Sparkles } from "lucide-react";

interface Accommodation {
  id: string;
  accommodation_type: string;
  applies_to: string;
  description: string | null;
}

const APPLIES_TO_LABEL: Record<string, string> = {
  classroom: "In the classroom",
  exam: "During exams",
  both: "Classroom & exams",
};

const APPLIES_TO_STYLE: Record<string, string> = {
  classroom: "border-emerald-200 text-emerald-700 bg-emerald-50/50",
  exam: "border-teal-200 text-teal-700 bg-teal-50/50",
  both: "border-cyan-200 text-cyan-700 bg-cyan-50/50",
};

const APPLIES_TO_ICON: Record<string, typeof BookOpen> = {
  classroom: BookOpen,
  exam: PenSquare,
  both: Sparkles,
};

export default function MyAccommodations() {
  const [accommodations, setAccommodations] = useState<Accommodation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // RLS scopes this automatically to the logged-in student's own
    // active accommodations - no student_id filter needed here.
    const { data, error } = await supabase
      .from("sen_accommodations")
      .select("id, accommodation_type, applies_to, description")
      .eq("active", true)
      .order("accommodation_type");

    if (!error) setAccommodations((data as Accommodation[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppLayout>
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="absolute top-10 right-10 w-72 h-72 rounded-full bg-emerald-300 opacity-[0.08] blur-3xl pointer-events-none" />
        <div className="absolute top-96 left-0 w-64 h-64 rounded-full bg-teal-200 opacity-[0.08] blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4 p-3 md:p-6 max-w-2xl mx-auto">
          {/* ── Hero ─────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 shadow-lg">
            <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
            <div className="absolute right-16 top-8 w-16 h-16 bg-white/10 rounded-full" />
            <div className="relative flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <Accessibility className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">My Accommodations</h1>
                <p className="text-emerald-100 text-xs md:text-sm mt-0.5">
                  The extra supports approved for you at school
                </p>
              </div>
            </div>
          </div>

          {loading && <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>}

          {!loading && accommodations.length === 0 && (
            <Card className="border border-emerald-100 rounded-2xl shadow-sm">
              <CardContent className="py-16 text-center text-muted-foreground">
                <Accessibility className="h-10 w-10 text-emerald-200 mx-auto mb-3" />
                You don't have any active accommodations on file right now.
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3">
            {accommodations.map((a) => {
              const Icon = APPLIES_TO_ICON[a.applies_to] || Sparkles;
              return (
                <Card key={a.id} className="border border-emerald-100 rounded-2xl shadow-sm overflow-hidden">
                  <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-400" />
                  <CardHeader className="pb-2 pt-3 bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-emerald-100">
                    <CardTitle className="text-base flex items-center gap-2.5 text-slate-800">
                      <div className="h-9 w-9 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm">
                        <Icon className="h-4 w-4 text-emerald-600" />
                      </div>
                      {a.accommodation_type}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3 space-y-1.5">
                    <Badge variant="outline" className={`font-normal ${APPLIES_TO_STYLE[a.applies_to] || ""}`}>
                      {APPLIES_TO_LABEL[a.applies_to] || a.applies_to}
                    </Badge>
                    {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}