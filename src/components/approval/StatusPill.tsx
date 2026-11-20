import { Badge } from "@/components/ui/badge";
import { SUBMISSION_STATUS_LABEL, WF_STATUS_STYLE } from "@/lib/approvalWorkflow";
import { STATUS_LABEL } from "@/lib/courseStructure";
import type { ContentStatus } from "@/types/courseManagement";

/** Badge for a content status or a submission status (same colours as the course tree). */
export function StatusPill({ status }: { status: string }) {
  const known = status in WF_STATUS_STYLE;
  const style = known ? WF_STATUS_STYLE[status as ContentStatus]
    : status === "withdrawn" || status === "superseded" ? WF_STATUS_STYLE.archived : WF_STATUS_STYLE.draft;
  const label = known ? STATUS_LABEL[status as ContentStatus] : SUBMISSION_STATUS_LABEL[status] ?? status;
  return <Badge variant="outline" className={`text-[11px] px-1.5 py-0 whitespace-nowrap ${style}`}>{label}</Badge>;
}
