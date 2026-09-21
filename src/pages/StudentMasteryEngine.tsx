import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Target } from "lucide-react";
import { useMasteryTree } from "@/hooks/useMastery";
import { useAtRiskConcepts } from "@/hooks/useKnowledgeGraph";
import { MasteryTree } from "@/components/mastery/MasteryTree";

export default function StudentMasteryEngine() {
  const { data: subjects, isLoading, error } = useMasteryTree();
  const [activeBook, setActiveBook] = useState<string | null>(null);

  const activeSubject = subjects?.find((s) => String(s.book_id) === activeBook) ?? subjects?.[0];
  const { data: atRisk } = useAtRiskConcepts(activeSubject?.book_id);
  const atRiskSubtopicIds = new Set((atRisk ?? []).map((a) => a.subtopic_id));

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Target className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">My Mastery</h1>
              <p className="text-emerald-100 text-xs md:text-sm mt-0.5">
                How well you know each concept — from chapters down to individual skills.
              </p>
            </div>
          </div>
        </div>

        {isLoading && (
          <Card><CardContent className="p-6 space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent></Card>
        )}

        {error && (
          <Card><CardContent className="p-6 text-sm text-destructive">
            Couldn't load your mastery data. Try again in a moment.
          </CardContent></Card>
        )}

        {!isLoading && !error && (!subjects || subjects.length === 0) && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            No mastery data yet — this fills in as you take assessments, homework and worksheets.
          </CardContent></Card>
        )}

        {!isLoading && subjects && subjects.length > 0 && (
          <>
            <Tabs value={String(activeSubject?.book_id)} onValueChange={setActiveBook}>
              <TabsList className="flex-wrap h-auto">
                {subjects.map((s) => (
                  <TabsTrigger key={s.book_id} value={String(s.book_id)}>
                    {s.subject}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Card>
              <CardContent className="p-4 md:p-6">
                {activeSubject && <MasteryTree subject={activeSubject} atRiskSubtopicIds={atRiskSubtopicIds} />}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
