// src/pages/ExamReadiness.tsx  (student, route /exam-readiness)
//
// "How ready am I for my exam, and how do I compare?" - the student's own
// Exam Readiness Score (by topic, chapter, subject and overall) plus their
// standing against section / class / grade / school. Comparison data is
// anonymised by the edge function: only aggregates, never a peer's identity.

import { useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge, ClipboardCheck } from "lucide-react";
import { useMasteryTree } from "@/hooks/useMastery";
import { StudentCohortView, StudentReadinessView } from "@/components/exam/ExamReadinessPanels";

export default function ExamReadiness() {
  const { data: subjects } = useMasteryTree();
  const [bookId, setBookId] = useState<string>("all");
  const [view, setView] = useState<"readiness" | "cohort">("readiness");
  const numericBook = bookId === "all" ? undefined : Number(bookId);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
        <div className="rounded-2xl p-5 md:p-6 relative overflow-hidden bg-gradient-to-r from-indigo-600 to-fuchsia-600 shadow-lg">
          <div className="absolute -right-6 -top-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="relative flex items-center gap-3 md:gap-4">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0"><Gauge className="h-5 w-5 md:h-6 md:w-6 text-white" /></div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-white">Exam Readiness</h1>
              <p className="text-indigo-100 text-xs md:text-sm mt-0.5">Your predicted readiness by topic, subject and overall — and how you compare.</p>
            </div>
            <Button asChild size="sm" variant="secondary" className="shrink-0 hidden sm:inline-flex">
              <Link to="/my-exams"><ClipboardCheck className="h-4 w-4 mr-1.5" />My exams</Link>
            </Button>
          </div>
        </div>

        <Card><CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <Select value={bookId} onValueChange={setBookId}>
            <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {(subjects ?? []).map((s) => <SelectItem key={s.book_id} value={String(s.book_id)}>{s.subject}{s.class_name ? ` (${s.class_name})` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList><TabsTrigger value="readiness">My readiness</TabsTrigger><TabsTrigger value="cohort">How I compare</TabsTrigger></TabsList>
          </Tabs>
        </CardContent></Card>

        {view === "readiness"
          ? <StudentReadinessView key={`r-${bookId}`} bookId={numericBook} />
          : <StudentCohortView key={`c-${bookId}`} bookId={numericBook} />}
      </div>
    </AppLayout>
  );
}
