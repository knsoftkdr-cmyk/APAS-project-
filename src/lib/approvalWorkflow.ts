// Pure helpers for the publish workflow (no React, no Supabase) - one definition of statuses, labels, counts,
// filters and "which action is offered when". The database enforces every rule again; this only drives the UI.
import type { ContentStatus } from "@/types/courseManagement";

export type ContentKind = "module" | "chapter" | "topic" | "material";

export const KIND_LABEL: Record<ContentKind, string> = { module: "Module", chapter: "Chapter", topic: "Topic", material: "Material" };

/** Tailwind classes per status (same soft-badge look the course tree already uses). */
export const WF_STATUS_STYLE: Record<ContentStatus, string> = {
  draft: "bg-amber-100 text-amber-800 border-amber-200",
  pending_review: "bg-blue-100 text-blue-800 border-blue-200",
  changes_requested: "bg-orange-100 text-orange-800 border-orange-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  approved: "bg-violet-100 text-violet-800 border-violet-200",
  published: "bg-emerald-100 text-emerald-800 border-emerald-200",
  archived: "bg-slate-100 text-slate-600 border-slate-200",
};

export const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending review", changes_requested: "Changes requested", rejected: "Rejected", approved: "Approved",
  published: "Published", withdrawn: "Withdrawn", superseded: "Superseded",
};

export const ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted for review", resubmitted: "Resubmitted for review", stage_approved: "Stage approved", approved: "Approved",
  rejected: "Rejected", changes_requested: "Changes requested", published: "Published", direct_published: "Published directly",
  direct_publish_requested: "Direct publish requested", assigned: "Reviewer assigned", reassigned: "Reviewer reassigned",
  withdrawn: "Withdrawn", reopened: "Reopened as draft", archived: "Archived",
};

export const REVIEWER_ROLE_LABEL: Record<string, string> = {
  hod: "Head of department / coordinator", principal: "Principal", school_admin: "School admin", admin: "Admin",
};

export interface WorkflowItem {
  kind: ContentKind;
  id: string;
  title: string;
  status: ContentStatus;
  courseId: string;
  subject: string;
  module: string | null;
  chapter: string | null;
  topic: string | null;
  materialType?: string | null;
  updatedAt?: string | null;
  /** latest submission of this item (for "view submission" / withdraw) */
  submissionId?: string;
  submissionStatus?: string;
}

export const STATUS_ORDER: ContentStatus[] = ["draft", "pending_review", "changes_requested", "approved", "published", "rejected", "archived"];

export function summarizeStatuses(items: Pick<WorkflowItem, "status">[]): Record<ContentStatus, number> {
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<ContentStatus, number>;
  for (const i of items) out[i.status] = (out[i.status] ?? 0) + 1;
  return out;
}

export interface ItemFilters { search: string; subject: string; module: string; chapter: string; kind: string; status: string }
export const EMPTY_FILTERS: ItemFilters = { search: "", subject: "all", module: "all", chapter: "all", kind: "all", status: "all" };

export function filterItems(items: WorkflowItem[], f: ItemFilters): WorkflowItem[] {
  const q = f.search.trim().toLowerCase();
  return items.filter((i) =>
    (f.subject === "all" || i.courseId === f.subject) &&
    (f.module === "all" || i.module === f.module) &&
    (f.chapter === "all" || i.chapter === f.chapter) &&
    (f.kind === "all" || i.kind === f.kind) &&
    (f.status === "all" || i.status === f.status) &&
    (!q || i.title.toLowerCase().includes(q) || (i.subject ?? "").toLowerCase().includes(q)));
}

/** What a content owner may do from each status. `enabled` = the school's workflow switch. */
export function ownerActions(status: ContentStatus, enabled: boolean) {
  if (!enabled) return { submit: false, reopen: false, archive: false, history: true, edit: true };
  return {
    submit: status === "draft" || status === "changes_requested",
    reopen: status === "published" || status === "approved" || status === "rejected" || status === "archived",
    archive: status === "published" || status === "draft" || status === "rejected",
    history: true,
    edit: status === "draft" || status === "changes_requested",
  };
}

/** Why an item cannot be edited right now (shown instead of a silent disabled button). */
export function lockedReason(status: ContentStatus, enabled: boolean): string | null {
  if (!enabled) return null;
  if (status === "pending_review") return "Under review - withdraw the submission to edit it.";
  if (status === "approved") return "Approved and waiting to be published - revise it to make changes.";
  if (status === "published") return "Published - start a revision to change it.";
  if (status === "archived") return "Archived - reopen it to make changes.";
  if (status === "rejected") return "Rejected - reopen it as a draft to rework it.";
  return null;
}

/** Approval progress for the stepper: done / current / todo per stage plus the final publish step. */
export function stageProgress(status: string, currentStage: number, stages: { name: string }[]) {
  const names = stages.length ? stages.map((s) => s.name) : ["Review"];
  const steps = names.map((name, i) => {
    const n = i + 1;
    let state: "done" | "current" | "todo" = "todo";
    if (status === "approved" || status === "published") state = "done";
    else if (status === "pending_review") state = n < currentStage ? "done" : n === currentStage ? "current" : "todo";
    else if (status === "changes_requested" || status === "rejected") state = n < currentStage ? "done" : n === currentStage ? "current" : "todo";
    return { name, state };
  });
  steps.push({ name: "Publish", state: status === "published" ? "done" : status === "approved" ? "current" : "todo" });
  return steps;
}

export function reasonRequired(decision: "reject" | "request_changes" | "approve" | "reopen" | "direct_publish"): boolean {
  return decision !== "approve";
}
export const MIN_REASON = 5;
export const reasonOk = (s: string) => s.trim().length >= MIN_REASON;

export function hoursLabel(h: number | null | undefined): string {
  if (h === null || h === undefined) return "-";
  if (h < 1) return "<1 h";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}
