// src/pages/MyExams.tsx  (student, route /my-exams)
// The student's assigned papers and mock exams, with status and score.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardCheck, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMyExams, type MyExamRow } from "@/hooks/useExamIntelligence";

const STATUS: Record<MyExamRow["status"], { label: string; className: string }> = {
  assigned: { label: "Not started", className: "" },
  in_progress: { label: "In progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  submitted: { label: "Awaiting review", className: "bg-sky-100 text-sky-800 border-sky-200" },
  graded: { label: "Graded", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null);

export default function MyExams() {
  const { profile } = useAuth();
  const [studentId, setStudentId] = useState<string | undefined>();
  const [lookupDone, setLookupDone] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    // deno-lint-ignore no-explicit-any
    (supabase as any).from("students").select("id").eq("profile_id", profile.id).maybeSingle()
      .then(({ data }: { data: { id: string } | null }) => { setStudentId(data?.id); setLookupDone(true); });
  }, [profile?.id]);

  const { data, isLoading, error } = useMyExams(studentId);
  const now = Date.now();

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center gap-3"><ClipboardCheck className="h-6 w-6 text-primary" /><h1 className="text-xl font-bold">My Exams</h1></div>

        {(!lookupDone || isLoading) ? <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-full" /></CardContent></Card>
          : error ? <Card><CardContent className="p-6 text-sm text-destructive">Couldn't load your exams.</CardContent></Card>
          : (data ?? []).length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground text-center">No exams have been assigned to you yet.</CardContent></Card>
          : (data ?? []).map((e) => {
              const notOpen = e.opens_at && new Date(e.opens_at).getTime() > now && e.status === "assigned";
              const closed = e.assignment_status === "closed" && e.status === "assigned";
              const s = STATUS[e.status];
              return (
                <Card key={e.attempt_id}><CardContent className="p-4 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><p className="font-medium truncate">{e.title}</p>
                      {e.is_mock && <Badge variant="outline">Mock exam</Badge>}<Badge variant="outline" className={s.className}>{s.label}</Badge></div>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                      {e.time_limit_minutes && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{e.time_limit_minutes} min{e.strict_timer ? " · timed" : ""}</span>}
                      {e.opens_at && <span>Opens {fmt(e.opens_at)}</span>}
                      {e.due_at && <span>Due {fmt(e.due_at)}</span>}
                      {(e.status === "graded" || e.status === "submitted") && e.total_score != null && <span className="font-medium text-foreground">{e.total_score}/{e.total_max_marks}{e.status === "submitted" ? " (provisional)" : ""}</span>}
                    </p>
                  </div>
                  <Button asChild size="sm" variant={e.status === "assigned" || e.status === "in_progress" ? "default" : "outline"} disabled={!!notOpen || closed}>
                    <Link to={`/exam/${e.assignment_id}`} aria-disabled={!!notOpen || closed}>
                      {e.status === "assigned" ? "Start" : e.status === "in_progress" ? "Resume" : "View result"}
                    </Link>
                  </Button>
                </CardContent></Card>
              );
            })}
      </div>
    </AppLayout>
  );
}
