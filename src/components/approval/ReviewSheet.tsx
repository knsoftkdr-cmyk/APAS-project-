import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CheckCircle2, ExternalLink, Loader2, MessageSquareWarning, Send, UserCog, Undo2, XCircle } from "lucide-react";
import { KIND_LABEL, type ContentKind } from "@/lib/approvalWorkflow";
import { friendlyCourseError, safeExternalUrl, videoEmbedUrl, MATERIAL_TYPE_LABEL } from "@/lib/courseStructure";
import { signedMaterialUrl } from "@/hooks/useCourseStructure";
import { useOwnerActions, useReviewActions, useReviewerCandidates, useSubmissionDetail } from "@/hooks/useApprovalWorkflow";
import { ApprovalStepper } from "./ApprovalStepper";
import { HistoryTimeline } from "./HistoryTimeline";
import { ReasonDialog } from "./ReasonDialog";
import { StatusPill } from "./StatusPill";

type Pending = null | "approve" | "reject" | "changes" | "publish" | "withdraw" | "assign";

/** Text that teachers typed is shown as plain text; rich lesson HTML is shown in a script-free sandboxed frame. */
function SandboxedHtml({ html }: { html: string }) {
  return <iframe title="Content preview" sandbox="" srcDoc={`<base target="_blank"><style>body{font:14px system-ui;margin:12px;color:#111}img{max-width:100%}</style>${html}`}
    className="h-64 w-full rounded-md border bg-white" />;
}

function MaterialPreview({ item }: { item: Record<string, unknown> }) {
  const storagePath = item.storage_path as string | null;
  const fileUrl = item.file_url as string | null;
  const type = item.material_type as keyof typeof MATERIAL_TYPE_LABEL;
  const [url, setUrl] = useState<string | null>(safeExternalUrl(fileUrl));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (storagePath) signedMaterialUrl(storagePath).then((u) => live && setUrl(u)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [storagePath]);
  const embed = type === "video" && fileUrl ? videoEmbedUrl(fileUrl) : null;
  return (
    <div className="space-y-2">
      <Badge variant="outline">{MATERIAL_TYPE_LABEL[type] ?? String(type)}</Badge>
      {typeof item.content_body === "string" && item.content_body && <p className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{item.content_body}</p>}
      {embed && <div className="aspect-video"><iframe src={embed} title="Video preview" className="h-full w-full rounded-md" allowFullScreen /></div>}
      {!embed && url && type === "video" && storagePath && <video src={url} controls className="w-full rounded-md" />}
      {!embed && url && type === "image" && <img src={url} alt="" className="max-h-72 rounded-md" />}
      {url && type !== "notes" && (
        <Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4 me-1.5" />Open {String(item.file_name ?? "attachment")}</a></Button>
      )}
      {err && <p className="text-sm text-destructive">{friendlyCourseError(err)}</p>}
    </div>
  );
}

export function ReviewSheet({ submissionId, onClose }: { submissionId: string | null; onClose: () => void }) {
  const { data: d, isLoading, error } = useSubmissionDetail(submissionId);
  const act = useReviewActions();
  const owner = useOwnerActions();
  const [pending, setPending] = useState<Pending>(null);
  const [reviewer, setReviewer] = useState("");
  const candidates = useReviewerCandidates(!!d?.can_assign && pending === "assign");
  useEffect(() => { setPending(null); setReviewer(""); }, [submissionId]);

  const done = (msg: string) => { setPending(null); toast.success(msg); };
  const fail = (e: Error) => toast.error(friendlyCourseError(e.message));
  const busy = act.review.isPending || act.publish.isPending || act.assign.isPending || owner.withdraw.isPending;

  const sub = d?.submission;
  const item = d?.snapshot.item ?? {};
  const path = d?.snapshot.path;
  const crumbs = [path?.academic_year, path?.semester, path?.subject, path?.module, path?.chapter, path?.topic].filter(Boolean) as string[];
  const kind = (sub?.content_kind ?? "topic") as ContentKind;
  const html = typeof item.content_body === "string" ? item.content_body : "";

  return (
    <Sheet open={!!submissionId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="text-start">
          <SheetTitle className="pe-6">{sub?.title ?? "Submission"}</SheetTitle>
          <SheetDescription>Review a submission: preview, history and decision.</SheetDescription>
        </SheetHeader>

        {isLoading && <div className="mt-6 space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-32" /><Skeleton className="h-24" /></div>}
        {error && <p className="mt-6 text-sm text-destructive">{friendlyCourseError((error as Error).message)}</p>}

        {d && sub && (
          <div className="mt-4 space-y-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{KIND_LABEL[kind]}</Badge><StatusPill status={sub.status} />
                <span className="text-xs text-muted-foreground">Version {sub.version}</span>
                {sub.priority === "high" && <Badge className="bg-red-600 hover:bg-red-600">High priority</Badge>}
              </div>
              {crumbs.length > 0 && <p className="text-xs text-muted-foreground">{crumbs.join("  ›  ")}</p>}
              <ApprovalStepper status={sub.status} currentStage={sub.current_stage} stages={d.stages} />
              <p className="text-xs text-muted-foreground">
                Submitted by {d.submitted_by_name ?? "unknown"} on {new Date(sub.submitted_at).toLocaleString()}
                {d.assigned_reviewer_name ? ` · Reviewer: ${d.assigned_reviewer_name}` : " · No reviewer assigned"}
              </p>
              {sub.note && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm"><span className="font-medium">Teacher's note: </span>{sub.note}</p>}
            </div>

            <section className="space-y-3" aria-label="Content preview">
              <h3 className="text-sm font-semibold">Preview (as submitted)</h3>
              {typeof item.description === "string" && item.description && <p className="text-sm">{item.description}</p>}
              {typeof item.learning_objectives === "string" && item.learning_objectives && (
                <div className="rounded-md border p-3"><p className="text-xs font-semibold mb-1">Learning objectives</p><p className="text-sm whitespace-pre-wrap">{item.learning_objectives}</p></div>
              )}
              {kind === "material" ? <MaterialPreview item={item} /> : html && <SandboxedHtml html={html} />}
              {d.snapshot.children.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">{kind === "topic" ? "Attached materials" : "Contains"}</p>
                  <ul className="space-y-1">
                    {d.snapshot.children.map((c) => (
                      <li key={c.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                        <span className="truncate">{c.title}{c.type ? ` · ${c.type}` : ""}</span><StatusPill status={c.status} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">Items inside are approved on their own; approving this one does not publish them.</p>
                </div>
              )}
            </section>

            {d.versions.length > 1 && (
              <section aria-label="Versions">
                <h3 className="text-sm font-semibold mb-2">Versions</h3>
                <ul className="space-y-1">
                  {d.versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between text-sm">
                      <span>Version {v.version} · {new Date(v.submitted_at).toLocaleDateString()}</span><StatusPill status={v.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-label="History">
              <h3 className="text-sm font-semibold mb-3">Approval history</h3>
              <HistoryTimeline entries={d.history} />
            </section>

            <div className="sticky bottom-0 -mx-6 border-t bg-background px-6 py-3 flex flex-wrap gap-2">
              {d.can_review && <>
                <Button onClick={() => setPending("approve")} disabled={busy}><CheckCircle2 className="h-4 w-4 me-1.5" />Approve</Button>
                <Button variant="outline" onClick={() => setPending("changes")} disabled={busy}><MessageSquareWarning className="h-4 w-4 me-1.5" />Request changes</Button>
                <Button variant="outline" className="text-destructive" onClick={() => setPending("reject")} disabled={busy}><XCircle className="h-4 w-4 me-1.5" />Reject</Button>
              </>}
              {d.can_publish && <Button onClick={() => setPending("publish")} disabled={busy}><Send className="h-4 w-4 me-1.5" />Publish</Button>}
              {d.can_assign && <Button variant="outline" onClick={() => setPending("assign")} disabled={busy}><UserCog className="h-4 w-4 me-1.5" />{d.assigned_reviewer_name ? "Reassign reviewer" : "Assign reviewer"}</Button>}
              {d.can_withdraw && <Button variant="ghost" onClick={() => setPending("withdraw")} disabled={busy}><Undo2 className="h-4 w-4 me-1.5" />Withdraw</Button>}
              {d.is_own && sub.status === "pending_review" && !d.allow_self_approval && d.can_review &&
                <p className="w-full text-xs text-muted-foreground">You submitted this, so another reviewer must approve it.</p>}
              {!d.can_review && !d.can_publish && !d.can_assign && !d.can_withdraw && <p className="text-xs text-muted-foreground">No actions available for you on this submission.</p>}
            </div>
          </div>
        )}

        <ReasonDialog open={pending === "approve"} onOpenChange={(o) => !o && setPending(null)} title="Approve this submission?"
          description={d && sub && sub.current_stage < sub.total_stages ? "It will move to the next approval stage." : "Approved content is not visible to students until it is published."}
          label="Note for the teacher" required={false} confirmLabel="Approve" busy={act.review.isPending}
          onConfirm={(t) => act.review.mutate({ id: sub!.id, decision: "approve", comment: t }, { onError: fail, onSuccess: (r) => done(r === "published" ? "Approved and published" : r === "approved" ? "Approved" : "Approved - moved to the next stage") })} />
        <ReasonDialog open={pending === "changes"} onOpenChange={(o) => !o && setPending(null)} title="Request changes"
          description="The teacher will see your feedback and can edit and resubmit." label="What needs to change?" confirmLabel="Request changes" busy={act.review.isPending}
          onConfirm={(t) => act.review.mutate({ id: sub!.id, decision: "request_changes", comment: t }, { onError: fail, onSuccess: () => done("Changes requested") })} />
        <ReasonDialog open={pending === "reject"} onOpenChange={(o) => !o && setPending(null)} title="Reject this submission?" destructive
          description="Rejected content stays hidden from students. The teacher can reopen it as a draft and start again." label="Reason for rejection" confirmLabel="Reject" busy={act.review.isPending}
          onConfirm={(t) => act.review.mutate({ id: sub!.id, decision: "reject", comment: t }, { onError: fail, onSuccess: () => done("Rejected") })} />

        <AlertDialog open={pending === "publish"} onOpenChange={(o) => !o && setPending(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Publish now?</AlertDialogTitle>
              <AlertDialogDescription>Students enrolled in this subject will be notified and can open it right away (if everything above it is published too).</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => act.publish.mutate(sub!.id, { onError: fail, onSuccess: () => done("Published") })}>Publish</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={pending === "withdraw"} onOpenChange={(o) => !o && setPending(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Withdraw this submission?</AlertDialogTitle>
              <AlertDialogDescription>It goes back to Draft so it can be edited. You will need to submit it again for review.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => owner.withdraw.mutate(sub!.id, { onError: fail, onSuccess: () => done("Withdrawn - back to draft") })}>Withdraw</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={pending === "assign"} onOpenChange={(o) => !o && setPending(null)}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>{d?.assigned_reviewer_name ? "Reassign reviewer" : "Assign reviewer"}</AlertDialogTitle>
              <AlertDialogDescription>The chosen person is notified and becomes the only non-admin who can act on this stage.</AlertDialogDescription></AlertDialogHeader>
            <div className="space-y-1.5">
              <Label>Reviewer</Label>
              <Select value={reviewer} onValueChange={setReviewer}>
                <SelectTrigger><SelectValue placeholder={candidates.isLoading ? "Loading…" : "Choose a staff member"} /></SelectTrigger>
                <SelectContent>
                  {(candidates.data ?? []).filter((c) => c.id !== sub?.submitted_by).map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? "Unnamed"} · {c.role}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={!reviewer || act.assign.isPending} onClick={() => act.assign.mutate({ id: sub!.id, reviewer }, { onError: fail, onSuccess: () => done("Reviewer assigned") })}>
                {act.assign.isPending && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}Assign</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
