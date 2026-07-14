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
      <div className="flex flex-col gap-4 p-4 md:p-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Accessibility className="h-6 w-6 text-emerald-600" />
            My Accommodations
          </h1>
          <p className="text-sm text-muted-foreground">
            These are the extra supports approved for you at school.
          </p>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

        {!loading && accommodations.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              You don't have any active accommodations on file right now.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {accommodations.map((a) => {
            const Icon = APPLIES_TO_ICON[a.applies_to] || Sparkles;
            return (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className="h-4 w-4 text-emerald-600" />
                    {a.accommodation_type}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-1">
                  <Badge variant="outline">{APPLIES_TO_LABEL[a.applies_to] || a.applies_to}</Badge>
                  {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
