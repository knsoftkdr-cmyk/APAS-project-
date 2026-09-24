import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge } from "lucide-react";
import { useVelocityTree } from "@/hooks/useLearningVelocity";
import { VelocityTree } from "@/components/mastery/VelocityTree";

export default function LearningVelocity() {
  const { data: subjects, isLoading, error } = useVelocityTree();
  const [activeBook, setActiveBook] = useState<string | null>(null);

  const activeSubject = subjects?.find((s) => String(s.book_id) === activeBook) ?? subjects?.[0];

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-sky-600 to-cyan-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Gauge className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">My Learning Pace</h1>
              <p className="text-sky-100 text-xs md:text-sm mt-0.5">
                How quickly you're picking up each concept — and how many more attempts it'll likely take.
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
            Couldn't load your learning pace data. Try again in a moment.
          </CardContent></Card>
        )}

        {!isLoading && !error && (!subjects || subjects.length === 0) && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">
            No pace data yet — once you've attempted a few questions on a concept, your pace will show up here.
          </CardContent></Card>
        )}

        {!isLoading && !error && subjects && subjects.length > 0 && (
          <>
            {subjects.length > 1 && (
              <Tabs value={String(activeSubject?.book_id)} onValueChange={setActiveBook}>
                <TabsList className="flex-wrap h-auto">
                  {subjects.map((s) => (
                    <TabsTrigger key={s.book_id} value={String(s.book_id)}>{s.subject}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
            <Card>
              <CardContent className="p-4 md:p-5">
                {activeSubject && <VelocityTree subject={activeSubject} />}
              </CardContent>
            </Card>
            <p className="text-[11px] text-muted-foreground text-center">
              Pace is measured from your actual mastery gain per attempt on each concept — a concept needs at
              least 3 attempts before a pace can be shown.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
