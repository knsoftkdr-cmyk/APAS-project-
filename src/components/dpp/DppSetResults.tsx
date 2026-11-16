import { useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DppResultView } from "@/components/dpp/DppResultView";
import { formatDuration, friendlyDppError, percentTone, TONE_CLASS } from "@/lib/dpp";
import { useDppResult, useDppSetDetail } from "@/hooks/useDpp";

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function AttemptDialog({ attemptId, onClose }: { attemptId: string | null; onClose: () => void }) {
  const q = useDppResult(attemptId);
  return (
    <Dialog open={!!attemptId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{q.data?.student_name ?? "Student"}'s answers</DialogTitle></DialogHeader>
        {q.isLoading && <Skeleton className="h-48 w-full" />}
        {q.error && <p className="text-sm text-red-600">{friendlyDppError(q.error)}</p>}
        {q.data && <DppResultView result={q.data} />}
      </DialogContent>
    </Dialog>
  );
}

export function DppSetResults({ setId }: { setId: string }) {
  const q = useDppSetDetail(setId);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error) return <p className="text-sm text-red-600">{friendlyDppError(q.error)}</p>;
  if (!q.data) return null;
  const { students, question_stats, items, set } = q.data;

  const exportCsv = () => {
    const rows = [["Student", "Class", "Status", "Score", "Max", "Percent", "Time (s)", "Submitted"],
      ...students.map((s) => [s.name, s.class, s.status, s.score ?? "", s.max_score ?? "", s.percent ?? "", s.time_taken_seconds ?? "", s.submitted_at ?? ""])];
    const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `dpp-${set.title.replace(/[^\w-]+/g, "_")}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{students.length} assigned · {students.filter((s) => s.status === "submitted").length} submitted</p>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!students.length}><Download className="mr-1 h-4 w-4" />Export CSV</Button></div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Class</TableHead><TableHead>Status</TableHead><TableHead>Score</TableHead><TableHead>Time</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {students.map((s) => (
              <TableRow key={s.student_id}>
                <TableCell className="font-medium">{s.name}</TableCell><TableCell>{s.class || "—"}</TableCell>
                <TableCell><Badge variant="outline">{s.status.replace("_", " ")}</Badge>{s.pending_manual > 0 && <Badge variant="outline" className="ml-1 border-amber-400 text-amber-700">to mark</Badge>}</TableCell>
                <TableCell>{s.percent != null ? <Badge variant="outline" className={TONE_CLASS[percentTone(s.percent)]}>{Math.round(s.percent)}% ({s.score}/{s.max_score})</Badge> : "—"}</TableCell>
                <TableCell>{formatDuration(s.time_taken_seconds)}</TableCell>
                <TableCell>{s.attempt_id && s.status === "submitted" && <Button size="sm" variant="ghost" onClick={() => setOpen(s.attempt_id)}>Answers</Button>}</TableCell>
              </TableRow>
            ))}
            {students.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Not assigned to anyone yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">Question difficulty (share answering correctly)</h4>
        <div className="space-y-1">
          {question_stats.map((qs) => {
            const it = items.find((i) => i.id === qs.item_id);
            return (<div key={qs.item_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">Q{qs.position}. {it?.stem}</span>
              <Badge variant="outline" className={TONE_CLASS[percentTone(qs.correct_percent)]}>{qs.correct_percent == null ? "no data" : `${qs.correct_percent}%`}</Badge></div>);
          })}
        </div>
      </div>
      <AttemptDialog attemptId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
