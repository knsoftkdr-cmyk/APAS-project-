// One student's engagement breakdown, opened from the teacher / admin views.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTIVITY_META, fetchStudentEngagement } from "@/lib/engagement";
import { ActivityBars, CategoryBadge, DeltaBadge, ScoreRing, TrendChart, periodText } from "./EngagementParts";

export default function StudentEngagementDialog({ studentId, name, onClose }: { studentId: string | null; name?: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["engagement", "student", studentId], queryFn: () => fetchStudentEngagement(studentId!), enabled: !!studentId, staleTime: 30_000 });
  const s = q.data?.score;
  return (
    <Dialog open={!!studentId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-blue-950">{q.data?.student.name ?? name ?? "Student"} - engagement</DialogTitle></DialogHeader>
        {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError ? <p className="text-sm text-red-600">{(q.error as Error).message}</p> : !s ? (
          <p className="text-sm text-slate-500">No score calculated yet.</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-5">
              <ScoreRing score={s.score} category={s.category} size={112} />
              <div className="space-y-1.5">
                <CategoryBadge category={s.category} />
                {s.status === "ok" && <div><DeltaBadge delta={s.delta} trend={s.trend} declining={s.declining} /></div>}
                <p className="text-xs text-slate-400">Based on the {periodText(s)}{s.previous_score !== null ? ` · previous period ${s.previous_score}` : ""}</p>
              </div>
            </div>
            {s.declining && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Engagement has dropped by {Math.abs(s.delta ?? 0)} points compared with the previous period. Consider a timely check-in.
              </div>
            )}
            {s.status === "insufficient" || !s.activities
              ? <p className="rounded-lg border border-dashed p-3 text-sm text-slate-600">Not enough data: too few assigned activities in this period to judge fairly.</p>
              : <ActivityBars activities={s.activities} />}
            {s.not_participating.length > 0 && (
              <p className="text-xs text-amber-800 rounded-lg bg-amber-50 border border-amber-200 p-3">
                Not participating in: <b>{s.not_participating.map((k) => ACTIVITY_META[k].label).join(", ")}</b>
              </p>
            )}
            <div>
              <p className="mb-1 text-xs font-medium text-slate-600">Trend over time</p>
              <TrendChart data={(q.data?.history ?? []).map((h) => ({ date: h.date, value: h.score }))} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
