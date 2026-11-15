import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, Search, Video } from "lucide-react";
import { RecordingPlayerDialog } from "@/components/live-recordings/RecordingPlayerDialog";
import { formatRecordingDuration, groupBySubject, listRecordings, matchesSearch, type Recording } from "@/lib/liveRecordings";

/** Previous class recordings for revision, inside the student's existing Virtual Classroom page. */
export function StudentRecordingsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Recording[] | null>(null);
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState<Recording | null>(null);

  useEffect(() => {
    let alive = true;
    listRecordings()
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) { setRows([]); toast({ title: "Could not load recordings", description: (e as Error).message, variant: "destructive" }); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => groupBySubject((rows ?? []).filter((r) => matchesSearch(r, q))), [rows, q]);

  if (rows === null) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading recordings...</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <Video className="h-8 w-8 mx-auto text-slate-300" />
        <p className="text-sm text-muted-foreground">No class recordings yet. They appear here after a recorded class ends.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by subject, topic or lesson" className="ps-9 border-slate-200" aria-label="Search recordings" />
      </div>
      {groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nothing matches "{q}".</p>}
      {groups.map((g) => (
        <section key={g.subject} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700">{g.subject}</h3>
          <div className="space-y-2">
            {g.items.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-100 bg-white p-3 flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium text-slate-800">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.session_date ? new Date(`${r.session_date}T00:00:00`).toLocaleDateString() : ""}
                    {formatRecordingDuration(r.duration_seconds) ? ` · ${formatRecordingDuration(r.duration_seconds)}` : ""}
                    {r.class_label ? ` · ${r.class_label}` : ""}
                  </p>
                  {(r.course_title || r.lesson_title) && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.course_title && <Badge variant="outline" className="border-teal-300 text-teal-700">Course: {r.course_title}</Badge>}
                      {r.lesson_title && <Badge variant="outline" className="border-teal-300 text-teal-700">Lesson: {r.lesson_title}</Badge>}
                    </div>
                  )}
                  {r.notes && <p className="text-xs text-slate-600">{r.notes}</p>}
                </div>
                <Button size="sm" className="gap-1 shrink-0" onClick={() => setPlaying(r)}><Play className="h-3.5 w-3.5" />Watch</Button>
              </div>
            ))}
          </div>
        </section>
      ))}
      <RecordingPlayerDialog recording={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}

export default StudentRecordingsPanel;
