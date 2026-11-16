import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, BellRing, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KIND_LABEL, SUBMISSION_STATUS_LABEL, hoursLabel } from "@/lib/approvalWorkflow";
import { friendlyCourseError } from "@/lib/courseStructure";
import { useStaffSubjects } from "@/hooks/useCourseStructure";
import { useApprovalQueue, useApprovalStats, useIsAdminLevel, useReviewActions, type QueueParams } from "@/hooks/useApprovalWorkflow";
import { StatusPill } from "./StatusPill";

const PAGE_SIZE = 15;

export function ApprovalQueueTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [p, setP] = useState<QueueParams>({ status: "pending_review", search: "", kind: "all", course: "all", sort: "submitted_asc", page: 0, pageSize: PAGE_SIZE });
  const [searchText, setSearchText] = useState("");
  const q = useApprovalQueue(p, true);
  const stats = useApprovalStats(true);
  const subjects = useStaffSubjects();
  const adminLevel = useIsAdminLevel();
  const reminders = useReviewActions().reminders;
  const set = (patch: Partial<QueueParams>) => setP((x) => ({ ...x, page: 0, ...patch }));
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const s = stats.data;
  const cards: { label: string; value: string | number; status?: string }[] = [
    { label: "Pending approvals", value: s?.pending ?? "-", status: "pending_review" },
    { label: "Approved (to publish)", value: s?.approved ?? "-", status: "approved" },
    { label: "Published items", value: s?.published ?? "-", status: "published" },
    { label: "Rejected", value: s?.rejected ?? "-", status: "rejected" },
    { label: "Changes requested", value: s?.changes_requested ?? "-", status: "changes_requested" },
    { label: "Avg review time", value: s && s.reviewed_count > 0 ? hoursLabel(s.avg_review_hours) : "-" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {cards.map((c) => (
          <button key={c.label} disabled={!c.status} onClick={() => c.status && set({ status: p.status === c.status ? "all" : c.status })}
            aria-pressed={!!c.status && p.status === c.status}
            className={`rounded-lg border p-3 text-start ${c.status ? "hover:bg-muted/40" : "cursor-default"} ${c.status && p.status === c.status ? "ring-2 ring-primary" : ""}`}>
            <div className="text-2xl font-semibold">{stats.isLoading ? <Skeleton className="h-7 w-10" /> : c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row">
        <form className="relative flex-1 min-w-48" onSubmit={(e) => { e.preventDefault(); set({ search: searchText.trim() }); }}>
          <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchText} onChange={(e) => { setSearchText(e.target.value); if (e.target.value === "") set({ search: "" }); }}
            placeholder="Search title or subject, press Enter…" className="ps-9" aria-label="Search submissions" />
        </form>
        <Select value={p.status} onValueChange={(v) => set({ status: v })}>
          <SelectTrigger className="lg:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>
            {Object.entries(SUBMISSION_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={p.kind} onValueChange={(v) => set({ kind: v })}>
          <SelectTrigger className="lg:w-36" aria-label="Filter by content type"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All types</SelectItem>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={p.course} onValueChange={(v) => set({ course: v })}>
          <SelectTrigger className="lg:w-44" aria-label="Filter by subject"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All subjects</SelectItem>{(subjects.data?.courses ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={p.sort} onValueChange={(v) => set({ sort: v })}>
          <SelectTrigger className="lg:w-44" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="submitted_asc">Oldest first</SelectItem><SelectItem value="submitted_desc">Newest first</SelectItem>
            <SelectItem value="priority">High priority first</SelectItem><SelectItem value="title">Title A-Z</SelectItem>
          </SelectContent>
        </Select>
        {adminLevel && (
          <Button variant="outline" disabled={reminders.isPending}
            onClick={() => reminders.mutate(undefined, { onError: (e) => toast.error(friendlyCourseError(e.message)), onSuccess: (n) => toast.success(n ? `Reminders sent for ${n} submission${n === 1 ? "" : "s"}` : "No submissions need a reminder right now") })}>
            <BellRing className="h-4 w-4 me-1.5" />Send reminders
          </Button>
        )}
      </div>

      {q.error ? (
        <div className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{friendlyCourseError((q.error as Error).message)}</div>
      ) : q.isLoading ? <Skeleton className="h-64" /> : (q.data?.rows.length ?? 0) === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{p.status === "pending_review" && !p.search ? "Nothing is waiting for review. 🎉" : "No submissions match these filters."}</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead><TableHead>Type</TableHead><TableHead className="hidden lg:table-cell">Session / semester</TableHead>
                <TableHead className="hidden md:table-cell">Subject › module › chapter › topic</TableHead><TableHead className="hidden sm:table-cell">Submitted by</TableHead>
                <TableHead>Submitted</TableHead><TableHead>Status</TableHead><TableHead className="hidden lg:table-cell">Reviewer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)} tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.id)} aria-label={`Open ${r.title}`}>
                  <TableCell className="max-w-56"><div className="font-medium truncate">{r.title}</div>
                    <div className="text-xs text-muted-foreground">v{r.version}{r.status === "pending_review" ? ` · stage ${r.current_stage}/${r.total_stages}` : ""}</div></TableCell>
                  <TableCell><Badge variant="secondary">{KIND_LABEL[r.content_kind]}</Badge>{r.priority === "high" && <Badge className="ms-1 bg-red-600 hover:bg-red-600">High</Badge>}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{[r.path?.academic_year, r.path?.semester].filter(Boolean).join(" · ") || "-"}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-64 truncate">{[r.path?.subject, r.path?.module, r.path?.chapter, r.path?.topic].filter(Boolean).join(" › ")}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">{r.submitted_by_name ?? "-"}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.submitted_at).toLocaleDateString()}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">{r.assigned_reviewer_name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} submission{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" disabled={p.page === 0} onClick={() => setP((x) => ({ ...x, page: x.page - 1 }))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          <span>Page {p.page + 1} of {pages}</span>
          <Button size="icon" variant="outline" disabled={p.page + 1 >= pages} onClick={() => setP((x) => ({ ...x, page: x.page + 1 }))} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
