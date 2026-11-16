import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompletionStats } from "@/hooks/useCourseStructure";
import { formatDuration, percent } from "@/lib/courseStructure";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; courseId: string | null; title: string }

/** Teacher / admin view of how students are progressing through a subject. */
export function SubjectStatsDialog({ open, onOpenChange, courseId, title }: Props) {
  const { data, isLoading, error } = useCompletionStats(courseId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Student progress – {title}</DialogTitle>
          <DialogDescription>Based on topics students have opened or completed. Only published content counts toward a student's percentage.</DialogDescription>
        </DialogHeader>
        {isLoading ? <Skeleton className="h-40 w-full" /> : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : !data || data.learners === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No students have started this subject yet.</div>
        ) : (
          <Tabs defaultValue="topics">
            <TabsList><TabsTrigger value="topics">By topic</TabsTrigger><TabsTrigger value="students">By student ({data.learners})</TabsTrigger></TabsList>
            <TabsContent value="topics" className="mt-3">
              <Table>
                <TableHeader><TableRow><TableHead>Topic</TableHead><TableHead className="w-48">Completed</TableHead><TableHead className="text-end">Started</TableHead><TableHead className="text-end">Avg. time</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.topics.map((t) => (
                    <TableRow key={t.topic_id}>
                      <TableCell className="font-medium">{t.title}</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={percent(t.completed, data.learners)} className="h-2" /><span className="text-xs tabular-nums w-16 text-end">{t.completed}/{data.learners}</span></div></TableCell>
                      <TableCell className="text-end tabular-nums">{t.started}</TableCell>
                      <TableCell className="text-end tabular-nums">{t.avg_seconds ? formatDuration(t.avg_seconds) : "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="students" className="mt-3">
              <Table>
                <TableHeader><TableRow><TableHead>Student</TableHead><TableHead className="w-48">Progress</TableHead><TableHead className="text-end">Time spent</TableHead><TableHead className="text-end">Last active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.students.map((s) => (
                    <TableRow key={s.student_id}>
                      <TableCell className="font-medium">{s.name ?? "Student"}</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={s.percent} className="h-2" /><span className="text-xs tabular-nums w-10 text-end">{s.percent}%</span></div></TableCell>
                      <TableCell className="text-end tabular-nums">{formatDuration(s.time_spent_seconds)}</TableCell>
                      <TableCell className="text-end text-xs text-muted-foreground">{s.last_active ? new Date(s.last_active).toLocaleDateString() : "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
