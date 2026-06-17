import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NormalizedGainBadge } from "@/components/NormalizedGainBadge";
import { BarChart3, ClipboardCheck, FileText } from "lucide-react";
import { PerformanceEntryModal } from "@/components/PerformanceEntryModal";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface LessonPerformanceSummaryProps {
  lessonId: string;
  lessonTitle: string;
  students: Array<{ id: string; name: string }>;
}

export function LessonPerformanceSummary({ lessonId, lessonTitle, students }: LessonPerformanceSummaryProps) {
  const [modalMode, setModalMode] = useState<"pretest" | "exit_ticket">("pretest");
  const [modalOpen, setModalOpen] = useState(false);

  const { data: records = [], refetch } = useQuery({
    queryKey: ["performance-records", lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_records")
        .select("*")
        .eq("lesson_id", lessonId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!lessonId,
  });

  const existingRecords = records.map(r => ({
    student_id: r.student_id,
    pretest_score: r.pretest_score,
  }));

  const summary = useMemo(() => {
    const withGain = records.filter(r => r.normalized_gain != null);
    if (withGain.length === 0) return null;
    const gains = withGain.map(r => Number(r.normalized_gain));
    const avg = gains.reduce((a, b) => a + b, 0) / gains.length;
    const high = gains.filter(g => g >= 0.7).length;
    const medium = gains.filter(g => g >= 0.3 && g < 0.7).length;
    const low = gains.filter(g => g < 0.3).length;
    return { avg: Math.round(avg * 1000) / 1000, high, medium, low, total: withGain.length };
  }, [records]);

  const studentMap = new Map(students.map(s => [s.id, s.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-5 w-5 text-accent" />
          Performance Tracking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => { setModalMode("pretest"); setModalOpen(true); }}>
            <ClipboardCheck className="h-4 w-4 mr-1" /> Record Pre-test Score
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setModalMode("exit_ticket"); setModalOpen(true); }}>
            <FileText className="h-4 w-4 mr-1" /> Record Post-test Score
          </Button>
        </div>

        {summary && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{summary.avg.toFixed(3)}</p>
                <p className="text-xs text-muted-foreground">Avg Normalized Gain</p>
                <NormalizedGainBadge gain={summary.avg} showValue={false} className="mt-1" />
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold text-success">{summary.high}</p>
                <p className="text-xs text-muted-foreground">High Gain</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold text-warning">{summary.medium}</p>
                <p className="text-xs text-muted-foreground">Medium Gain</p>
              </div>
              <div className="rounded-lg border border-border p-3 text-center">
                <p className="text-2xl font-bold text-danger">{summary.low}</p>
                <p className="text-xs text-muted-foreground">Low Gain</p>
              </div>
            </div>
          </div>
        )}

        {records.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Pre-test</TableHead>
                <TableHead>Post-test</TableHead>
                <TableHead>Gain</TableHead>
                <TableHead>Mastery</TableHead>
                <TableHead>Effort</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{studentMap.get(r.student_id) || r.student_id.slice(0, 8)}</TableCell>
                  <TableCell>{r.pretest_score ?? "—"}</TableCell>
                  <TableCell>{r.posttest_score ?? "—"}</TableCell>
                  <TableCell>
                    {r.normalized_gain != null ? (
                      <NormalizedGainBadge gain={Number(r.normalized_gain)} />
                    ) : "—"}
                  </TableCell>
                  <TableCell>{r.mastery_score ?? "—"}</TableCell>
                  <TableCell>{r.effort_score ?? "—"}/5</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {records.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No performance records yet. Start by recording pre-test scores.
          </p>
        )}

        <PerformanceEntryModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          mode={modalMode}
          lessonId={lessonId}
          lessonTitle={lessonTitle}
          students={students}
          existingRecords={existingRecords}
          onSaved={refetch}
        />
      </CardContent>
    </Card>
  );
}
