import { CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCallMutations, usePendingFollowups, useTelephonySettings } from "@/hooks/useTelephony";
import { formatInSchoolTz } from "@/lib/telephony";

export function PendingFollowupsCard({ onOpenLead }: { onOpenLead?: (applicantId: string, name: string) => void }) {
  const { data: cfg } = useTelephonySettings();
  const q = usePendingFollowups(true, !!cfg?.canCall);
  const { updateFollowup } = useCallMutations(null);
  if (!cfg?.canCall || !q.data?.length) return null;
  const tz = cfg.settings?.timezone ?? "Asia/Kolkata";
  return (
    <Card><CardContent className="p-4 space-y-2">
      <h3 className="font-semibold flex items-center gap-2 text-sm"><CalendarClock className="h-4 w-4" />My follow-ups ({q.data.length})</h3>
      <ul className="divide-y">{q.data.slice(0, 8).map((f) => (
        <li key={f.id} className="py-2 flex items-center justify-between gap-2 text-sm">
          <button className="text-start" onClick={() => onOpenLead?.(f.applicant_id, f.applicant_name ?? "Lead")}>
            <div className="font-medium">{f.applicant_name ?? "Lead"} <span className="font-normal text-muted-foreground">· {f.reason}</span></div>
            <div className={`text-xs ${f.overdue ? "text-destructive" : "text-muted-foreground"}`}>{formatInSchoolTz(f.due_at, tz)}{f.overdue ? " · overdue" : ""}</div>
          </button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => updateFollowup.mutate({ id: f.id, action: "complete" }, { onError: (e) => toast.error((e as Error).message) })}>Done</Button>
        </li>))}</ul>
    </CardContent></Card>
  );
}
