// Video analytics for teachers / school staff, shown inside the existing dashboards and student reports:
//   <VideoInsightsPanel />       dashboard section: every video's watch time, completion, question accuracy, doubts
//   <VideoInsightsDialog />      one video in detail: question-wise performance, per-student results, doubts to answer
//   <StudentVideoReport />       one student's video results (inside the existing student engagement dialog)
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Clock, HelpCircle, Loader2, MessageCircleQuestion, Video as VideoIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  answerVideoDoubt, fetchStudentVideoReport, fetchVideoDetail, fetchVideoDoubts, fetchVideoOverview, formatTimestamp, formatWatch,
  type VideoOverviewRow,
} from "@/lib/interactiveVideo";
import { getClassLabel } from "@/lib/marketplace";

const accuracyTone = (p: number | null) => p === null ? "text-slate-400" : p >= 75 ? "text-emerald-600" : p >= 50 ? "text-amber-600" : "text-red-600";

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 text-lg font-semibold text-blue-950">{value}</div>
    </div>
  );
}

// ── dashboard panel ──────────────────────────────────────────────────────────────────────────────
export function VideoInsightsPanel() {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["video-insights", "overview"], queryFn: fetchVideoOverview, staleTime: 60_000 });
  const videos = q.data?.videos ?? [];
  // Nothing set up yet / nothing to show: stay out of the way instead of adding an empty card to the dashboard.
  if (!q.isLoading && (q.isError || q.data?.persistence === "unavailable" || videos.length === 0)) return null;

  const withActivity = videos.filter((v) => v.viewers > 0 || v.question_count > 0);
  return (
    <Card className="mb-10 rounded-2xl border-2 border-blue-100">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-blue-950">
          <VideoIcon className="h-4 w-4 text-blue-600" /> Video learning
          {q.data?.scope === "your_classes" && <Badge variant="outline" className="rounded-full text-[10px]">your classes</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">Watch time, completion and question results for the videos students are learning from.</p>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-32 w-full" /> : withActivity.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No student has watched a video yet, and no video has questions yet.</p>
        ) : (
          <div className="space-y-2">
            {withActivity.slice(0, 12).map((v) => <OverviewRow key={v.listing_id} v={v} onOpen={() => setOpen(v.listing_id)} />)}
            {withActivity.length > 12 && <p className="text-center text-xs text-muted-foreground">Showing 12 of {withActivity.length} videos. Open the Marketplace for the rest.</p>}
          </div>
        )}
      </CardContent>
      {open && <VideoInsightsDialog listingId={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function OverviewRow({ v, onOpen }: { v: VideoOverviewRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-xl border bg-white p-3 text-start transition-colors hover:border-blue-300 hover:bg-blue-50/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{v.title}</span>
        {v.class_label && <Badge variant="secondary" className="rounded-full text-[10px]">{getClassLabel(v.class_label)}</Badge>}
        {v.subject && <Badge variant="outline" className="rounded-full text-[10px]">{v.subject}</Badge>}
        {v.doubts_open > 0 && <Badge className="rounded-full bg-amber-100 text-[10px] text-amber-800 hover:bg-amber-100">{v.doubts_open} open doubt{v.doubts_open === 1 ? "" : "s"}</Badge>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <span className="text-muted-foreground">Viewers <b className="text-slate-800">{v.viewers}</b></span>
        <span className="text-muted-foreground">Avg watch <b className="text-slate-800">{v.viewers ? formatWatch(v.avg_watch_seconds) : "-"}</b></span>
        <span className="text-muted-foreground">Completed <b className="text-slate-800">{v.completion_rate_pct === null ? "-" : `${v.completion_rate_pct}%`}</b></span>
        <span className="text-muted-foreground">Question accuracy <b className={accuracyTone(v.accuracy_pct)}>{v.question_count === 0 ? "no questions" : v.accuracy_pct === null ? "-" : `${v.accuracy_pct}%`}</b></span>
      </div>
    </button>
  );
}

// ── one video in detail ──────────────────────────────────────────────────────────────────────────
export function VideoInsightsDialog({ listingId, onClose }: { listingId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["video-insights", "detail", listingId], queryFn: () => fetchVideoDetail(listingId!), enabled: !!listingId, staleTime: 30_000 });
  const d = q.data;
  return (
    <Dialog open={!!listingId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-4xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="pe-6 text-blue-950">{d?.listing.title ?? "Video"} · performance</DialogTitle>
          <DialogDescription>{d?.scope === "your_classes" ? "Results for students in the classes you teach." : "Results for students in your school."}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError || !d || d.persistence === "unavailable" ? (
          <p className="text-sm text-red-600">{q.error instanceof Error ? q.error.message : "Video analytics are not available yet."}</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat icon={VideoIcon} label="Students watching" value={String(d.summary.viewers)} />
              <Stat icon={Clock} label="Avg watch time" value={d.summary.viewers ? formatWatch(d.summary.avg_watch_seconds) : "-"} />
              <Stat icon={CheckCircle2} label="Completion rate" value={d.summary.completion_rate_pct === null ? "-" : `${d.summary.completion_rate_pct}%`} />
              <Stat icon={MessageCircleQuestion} label="Open doubts" value={`${d.doubts.open} of ${d.doubts.total}`} />
            </div>

            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-blue-950"><BarChart3 className="h-4 w-4 text-blue-600" />Question-wise performance</h3>
              {d.questions.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">This video has no questions yet.</p> : d.questions.map((qs) => (
                <div key={qs.question_id} className="space-y-2 rounded-xl border bg-white p-3">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{formatTimestamp(qs.timestamp_seconds)}</span>
                    <p className="min-w-0 flex-1 break-words text-sm font-medium">{qs.question_text}</p>
                    <span className={cn("shrink-0 text-sm font-semibold", accuracyTone(qs.accuracy_pct))}>{qs.accuracy_pct === null ? "-" : `${qs.accuracy_pct}%`}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{qs.answered} answered · {qs.correct} correct{qs.skipped > 0 ? ` · ${qs.skipped} skipped` : ""} (first attempts)</p>
                  {qs.answered > 0 && (
                    <div className="space-y-1">
                      {qs.options.map((o, i) => {
                        const n = qs.option_counts[i] ?? 0, share = qs.answered ? Math.round((n / qs.answered) * 100) : 0;
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={cn("w-1/3 min-w-0 truncate", i === qs.correct_index && "font-semibold text-emerald-700")} title={o}>{o}{i === qs.correct_index ? " ✓" : ""}</span>
                            <div className="h-2 flex-1 rounded-full bg-slate-100"><div className={cn("h-2 rounded-full", i === qs.correct_index ? "bg-emerald-500" : "bg-red-300")} style={{ width: `${share}%` }} /></div>
                            <span className="w-14 text-end text-muted-foreground">{n} ({share}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-blue-950">Students</h3>
              {d.students.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No student has watched this video yet.</p> : (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="bg-slate-50 text-xs text-muted-foreground"><tr>
                      <th className="px-3 py-2 text-start font-medium">Student</th><th className="px-3 py-2 text-start font-medium">Watched</th>
                      <th className="px-3 py-2 text-start font-medium">Completion</th><th className="px-3 py-2 text-start font-medium">Questions</th>
                    </tr></thead>
                    <tbody>{d.students.map((s) => (
                      <tr key={s.student_id} className="border-t">
                        <td className="px-3 py-2">{s.name ?? "Student"}</td>
                        <td className="px-3 py-2">{formatWatch(s.watched_seconds)}</td>
                        <td className="px-3 py-2"><span className="me-2">{Math.round(s.completion_pct)}%</span>{s.completed && <Badge className="rounded-full bg-emerald-100 text-[10px] text-emerald-800 hover:bg-emerald-100">done</Badge>}</td>
                        <td className="px-3 py-2">{s.questions_answered ? `${s.questions_correct}/${s.questions_answered} correct` : "-"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <DoubtsSection listingId={d.listing.id} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DoubtsSection({ listingId }: { listingId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["video-insights", "doubts", listingId], queryFn: () => fetchVideoDoubts(listingId), staleTime: 15_000 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const reply = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => answerVideoDoubt(id, text),
    onSuccess: (_r, v) => {
      setDrafts((d) => ({ ...d, [v.id]: "" }));
      qc.invalidateQueries({ queryKey: ["video-insights"] });
      toast.success("Reply sent to the student");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't send the reply"),
  });
  const doubts = q.data?.doubts ?? [];
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-blue-950"><HelpCircle className="h-4 w-4 text-blue-600" />Student doubts</h3>
      {q.isLoading ? <Skeleton className="h-16 w-full" /> : doubts.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No doubts asked on this video.</p> : doubts.map((x) => (
        <div key={x.id} className="space-y-2 rounded-xl border bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <b className="text-slate-800">{x.student_name ?? "Student"}</b><span>at {formatTimestamp(x.timestamp_seconds)}</span>
            <Badge variant="outline" className={cn("rounded-full text-[10px]", x.status === "answered" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700")}>{x.status === "answered" ? "answered" : "open"}</Badge>
          </div>
          <p className="break-words">{x.question_text}</p>
          {x.ai_answer && <p className="rounded-md bg-violet-50 p-2 text-xs text-violet-900"><b>AI answer shown to the student:</b> {x.ai_answer}</p>}
          {x.answer_text ? <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-900"><b>Your reply:</b> {x.answer_text}</p> : (
            <div className="space-y-1.5">
              <Textarea rows={2} maxLength={4000} value={drafts[x.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [x.id]: e.target.value }))} placeholder="Write a reply" className="text-sm" />
              <div className="flex justify-end">
                <Button size="sm" className="rounded-full bg-blue-600 hover:bg-blue-700" disabled={reply.isPending || !(drafts[x.id] ?? "").trim()} onClick={() => reply.mutate({ id: x.id, text: drafts[x.id] })}>
                  {reply.isPending && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />}Reply
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ── one student's video results (used inside the engagement dialog) ───────────────────────────────
export function StudentVideoReport({ studentId }: { studentId: string }) {
  const q = useQuery({ queryKey: ["video-insights", "student", studentId], queryFn: () => fetchStudentVideoReport(studentId), staleTime: 60_000 });
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  const videos = q.data?.videos ?? [];
  if (q.isError || q.data?.persistence === "unavailable" || videos.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">Video learning</p>
      <div className="space-y-1.5">
        {videos.slice(0, 8).map((v) => (
          <div key={v.listing_id} className="rounded-lg border bg-white p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2"><span className="min-w-0 flex-1 truncate font-medium text-slate-800">{v.title}</span><span className="shrink-0 text-muted-foreground">{Math.round(v.completion_pct)}%{v.completed ? " · done" : ""}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.min(100, v.completion_pct)}%` }} /></div>
            <p className="mt-1 text-muted-foreground">
              Watched {formatWatch(v.watched_seconds)}
              {v.questions_answered + v.questions_skipped > 0 ? ` · ${v.questions_correct}/${v.questions_answered} questions correct${v.questions_skipped ? `, ${v.questions_skipped} skipped` : ""}` : ""}
              {v.doubts > 0 ? ` · ${v.doubts} doubt${v.doubts === 1 ? "" : "s"} asked` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
