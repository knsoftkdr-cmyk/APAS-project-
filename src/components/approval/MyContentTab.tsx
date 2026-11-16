import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertCircle, Archive, FileSearch, History, Info, MoreHorizontal, Pencil, Search, Send, Undo2, Zap } from "lucide-react";
import { EMPTY_FILTERS, KIND_LABEL, filterItems, lockedReason, ownerActions, summarizeStatuses, type ItemFilters, type WorkflowItem } from "@/lib/approvalWorkflow";
import { STATUS_LABEL, friendlyCourseError } from "@/lib/courseStructure";
import type { ContentStatus } from "@/types/courseManagement";
import { useIsAdminLevel, useItemHistory, useMyContent, useOwnerActions, useReviewActions, useWorkflowSettings } from "@/hooks/useApprovalWorkflow";
import { HistoryTimeline } from "./HistoryTimeline";
import { ReasonDialog } from "./ReasonDialog";
import { StatusPill } from "./StatusPill";

const CARDS: { key: ContentStatus; label: string }[] = [
  { key: "draft", label: "Drafts" }, { key: "pending_review", label: "Pending reviews" }, { key: "approved", label: "Approved" },
  { key: "published", label: "Published" }, { key: "changes_requested", label: "Changes requested" }, { key: "rejected", label: "Rejected" },
];

function HistoryDialog({ item, onClose }: { item: WorkflowItem | null; onClose: () => void }) {
  const q = useItemHistory(item?.kind ?? null, item?.id ?? null);
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Approval history</DialogTitle><DialogDescription>{item?.title}</DialogDescription></DialogHeader>
        {q.isLoading ? <Skeleton className="h-24" /> : q.error ? <p className="text-sm text-destructive">{friendlyCourseError((q.error as Error).message)}</p> : <HistoryTimeline entries={q.data ?? []} />}
      </DialogContent>
    </Dialog>
  );
}

export function MyContentTab({ onOpenSubmission, onOpenSettings }: { onOpenSubmission: (id: string) => void; onOpenSettings: () => void }) {
  const { data: items, isLoading, error } = useMyContent();
  const settings = useWorkflowSettings();
  const enabled = settings.data?.enabled ?? false;
  const adminLevel = useIsAdminLevel();
  const owner = useOwnerActions();
  const direct = useReviewActions().directPublish;
  const [f, setF] = useState<ItemFilters>(EMPTY_FILTERS);
  const [historyFor, setHistoryFor] = useState<WorkflowItem | null>(null);
  const [dlg, setDlg] = useState<null | { type: "submit" | "reopen" | "archive" | "direct"; item: WorkflowItem }>(null);

  const all = useMemo(() => items ?? [], [items]);
  const counts = useMemo(() => summarizeStatuses(all), [all]);
  const rows = useMemo(() => filterItems(all, f), [all, f]);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
  const subjects = useMemo(() => [...new Map(all.map((i) => [i.courseId, i.subject])).entries()], [all]);
  const modules = useMemo(() => uniq(all.filter((i) => f.subject === "all" || i.courseId === f.subject).map((i) => i.module)), [all, f.subject]);
  const chapters = useMemo(() => uniq(all.filter((i) => (f.subject === "all" || i.courseId === f.subject) && (f.module === "all" || i.module === f.module)).map((i) => i.chapter)), [all, f.subject, f.module]);

  const fail = (e: Error) => toast.error(friendlyCourseError(e.message));
  const ok = (m: string) => { setDlg(null); toast.success(m); };
  const set = (patch: Partial<ItemFilters>) => setF((x) => ({ ...x, ...patch }));

  if (isLoading || settings.isLoading) return <div className="space-y-3"><div className="grid grid-cols-2 md:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div><Skeleton className="h-64" /></div>;
  if (error) return <div className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />Couldn't load your content. {friendlyCourseError((error as Error).message)}</div>;

  return (
    <div className="space-y-4">
      {!enabled && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="flex-1 min-w-48">The approval workflow is switched off for your school, so content is published directly from the Course Structure page. Statuses below are shown for reference.</p>
          {adminLevel && <Button size="sm" variant="outline" onClick={onOpenSettings}>Turn it on</Button>}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3" role="group" aria-label="Content status summary">
        {CARDS.map((c) => (
          <button key={c.key} onClick={() => set({ status: f.status === c.key ? "all" : c.key })} aria-pressed={f.status === c.key}
            className={`rounded-lg border p-3 text-start transition hover:bg-muted/40 ${f.status === c.key ? "ring-2 ring-primary" : ""}`}>
            <div className="text-2xl font-semibold">{counts[c.key]}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={f.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search title or subject…" className="ps-9" aria-label="Search content" />
        </div>
        <Select value={f.subject} onValueChange={(v) => set({ subject: v, module: "all", chapter: "all" })}>
          <SelectTrigger className="lg:w-44" aria-label="Filter by subject"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All subjects</SelectItem>{subjects.map(([id, t]) => <SelectItem key={id} value={id}>{t}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.module} onValueChange={(v) => set({ module: v, chapter: "all" })}>
          <SelectTrigger className="lg:w-40" aria-label="Filter by module"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All modules</SelectItem>{modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.chapter} onValueChange={(v) => set({ chapter: v })}>
          <SelectTrigger className="lg:w-40" aria-label="Filter by chapter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All chapters</SelectItem>{chapters.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.kind} onValueChange={(v) => set({ kind: v })}>
          <SelectTrigger className="lg:w-36" aria-label="Filter by content type"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All types</SelectItem>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.status} onValueChange={(v) => set({ status: v })}>
          <SelectTrigger className="lg:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{(Object.keys(STATUS_LABEL) as ContentStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
        {JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS) && <Button variant="ghost" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</Button>}
      </div>

      {all.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">You don't have any content yet. Add modules, chapters and topics on the Course Structure page, then submit them for review here.</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nothing matches these filters.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Content</TableHead><TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Where</TableHead><TableHead>Status</TableHead><TableHead className="w-10"><span className="sr-only">Actions</span></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => {
                const a = ownerActions(i.status, enabled);
                const lock = lockedReason(i.status, enabled);
                return (
                  <TableRow key={`${i.kind}:${i.id}`}>
                    <TableCell className="max-w-64">
                      <div className="font-medium truncate">{i.title}</div>
                      {lock && <div className="text-xs text-muted-foreground">{lock}</div>}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{KIND_LABEL[i.kind]}</Badge>{i.materialType ? <span className="ms-1 text-xs text-muted-foreground">{i.materialType}</span> : null}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{[i.subject, i.module, i.chapter, i.kind === "material" ? i.topic : null].filter(Boolean).join(" › ")}</TableCell>
                    <TableCell><StatusPill status={i.status} /></TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for ${i.title}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {a.submit && <DropdownMenuItem onClick={() => setDlg({ type: "submit", item: i })}><Send className="h-4 w-4 me-2" />{i.status === "changes_requested" ? "Resubmit for review" : "Submit for review"}</DropdownMenuItem>}
                          {i.submissionId && <DropdownMenuItem onClick={() => onOpenSubmission(i.submissionId!)}><FileSearch className="h-4 w-4 me-2" />{i.status === "changes_requested" || i.status === "rejected" ? "View feedback" : "View submission"}</DropdownMenuItem>}
                          {i.status === "pending_review" && i.submissionId && <DropdownMenuItem onClick={() => onOpenSubmission(i.submissionId!)}><Undo2 className="h-4 w-4 me-2" />Withdraw…</DropdownMenuItem>}
                          {a.reopen && <DropdownMenuItem onClick={() => setDlg({ type: "reopen", item: i })}><Pencil className="h-4 w-4 me-2" />{i.status === "published" ? "Revise (new version)" : "Reopen as draft"}</DropdownMenuItem>}
                          {adminLevel && enabled && (i.status === "draft" || i.status === "changes_requested" || i.status === "rejected" || i.status === "approved") && (
                            <DropdownMenuItem onClick={() => setDlg({ type: "direct", item: i })}><Zap className="h-4 w-4 me-2" />Publish directly (audited)</DropdownMenuItem>)}
                          {a.archive && enabled && <DropdownMenuItem onClick={() => setDlg({ type: "archive", item: i })}><Archive className="h-4 w-4 me-2" />Archive</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setHistoryFor(i)}><History className="h-4 w-4 me-2" />Approval history</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{rows.length} of {all.length} item{all.length === 1 ? "" : "s"}. Edit content on the Course Structure page; students only ever see Published items.</p>

      <HistoryDialog item={historyFor} onClose={() => setHistoryFor(null)} />

      <ReasonDialog open={dlg?.type === "submit"} onOpenChange={(o) => !o && setDlg(null)} required={false} busy={owner.submit.isPending}
        title={dlg?.item.status === "changes_requested" ? "Resubmit for review" : "Submit for review"}
        description={`"${dlg?.item.title ?? ""}" will be locked for editing while it is reviewed and hidden from students until it is published.`}
        label="Note for the reviewer" confirmLabel="Submit"
        onConfirm={(note) => owner.submit.mutate({ kind: dlg!.item.kind, id: dlg!.item.id, note }, { onError: fail, onSuccess: () => ok("Submitted for review") })} />
      <ReasonDialog open={dlg?.type === "reopen"} onOpenChange={(o) => !o && setDlg(null)} busy={owner.reopen.isPending}
        title={dlg?.item.status === "published" ? "Start a revision?" : "Reopen as draft?"}
        description={dlg?.item.status === "published" ? "The item goes back to Draft and is hidden from students while you revise it. Student progress is kept. Submit it again when ready." : "The item goes back to Draft so you can edit and submit it again."}
        label="Why is this being reopened?" confirmLabel="Reopen"
        onConfirm={(reason) => owner.reopen.mutate({ kind: dlg!.item.kind, id: dlg!.item.id, reason }, { onError: fail, onSuccess: () => ok("Reopened as draft") })} />
      <ReasonDialog open={dlg?.type === "archive"} onOpenChange={(o) => !o && setDlg(null)} busy={owner.archive.isPending} required={false} destructive
        title="Archive this item?" description="Archived items are hidden from students. Student progress is kept and you can reopen the item later."
        label="Reason" confirmLabel="Archive"
        onConfirm={(reason) => owner.archive.mutate({ kind: dlg!.item.kind, id: dlg!.item.id, reason }, { onError: fail, onSuccess: () => ok("Archived") })} />
      <ReasonDialog open={dlg?.type === "direct"} onOpenChange={(o) => !o && setDlg(null)} busy={direct.isPending}
        title="Publish without review?" description="Only school administrators can do this. A new version and an audit entry with your reason are recorded, and enrolled students are notified."
        label="Reason for publishing directly" confirmLabel="Publish now"
        onConfirm={(reason) => direct.mutate({ kind: dlg!.item.kind, id: dlg!.item.id, reason }, { onError: fail, onSuccess: () => ok("Published") })} />
    </div>
  );
}
