/**
 * ExamProctoring.tsx  (staff, route /exam-proctoring - a tab of the Assessments hub)
 *
 * Online exam attempts where the exam page recorded integrity alerts: leaving the exam tab, switching windows,
 * leaving full screen, copy/paste and right-click. Each attempt gets a risk level; opening one shows every alert
 * with its time and how long the student was away. The alerts are signals for the teacher to look into, not proof.
 */
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Search, ShieldAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { displayLocale } from "@/i18n/runtime";
import {
  integrityEventLabel, integrityRiskLabel, useIntegrityAttempts, useIntegrityEvents,
  type IntegrityAttempt, type IntegrityEventType, type IntegrityRisk,
} from "@/hooks/useExamIntegrity";

const RISK_CLASS: Record<IntegrityRisk, string> = {
  high: "border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/30",
  medium: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30",
  low: "border-slate-300 text-slate-600",
};
const EVENT_TYPES: IntegrityEventType[] = ["tab_hidden", "window_blur", "fullscreen_exit", "copy_paste", "right_click"];

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(displayLocale(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
const fmtAway = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

function Shell({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;
}

export default function ExamProctoring({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, isLoading, error } = useIntegrityAttempts();
  const [risk, setRisk] = useState<"all" | IntegrityRisk>("all");
  const [exam, setExam] = useState("all");
  const [search, setSearch] = useState("");

  const exams = useMemo(() => [...new Map((data ?? []).map((a) => [a.assignmentId, a.examTitle] as const)).entries()], [data]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((a) =>
      (risk === "all" || a.risk === risk) && (exam === "all" || a.assignmentId === exam) &&
      (!q || `${a.studentName} ${a.rollNumber ?? ""}`.toLowerCase().includes(q)));
  }, [data, risk, exam, search]);
  const highCount = (data ?? []).filter((a) => a.risk === "high").length;

  return (
    <Shell embedded={embedded}>
      <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-600" /> Exam proctoring</h1>
          <p className="text-sm text-muted-foreground">
            Alerts recorded while students sat online exams: leaving the exam tab, switching windows, leaving full screen, copy, paste and right-click. Treat them as signals to look into, not proof of cheating.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="ps-8" placeholder="Search student or roll number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={exam} onValueChange={setExam}>
            <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All exams</SelectItem>
              {exams.map(([id, title]) => <SelectItem key={id} value={id}>{title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={(v) => setRisk(v as typeof risk)}>
            <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              <SelectItem value="high">High risk</SelectItem>
              <SelectItem value="medium">Medium risk</SelectItem>
              <SelectItem value="low">Low risk</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {highCount > 0 && risk === "all" && (
          <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{highCount === 1 ? "1 attempt at high risk" : `${highCount} attempts at high risk`}</p>
        )}

        {isLoading ? <Skeleton className="h-40 w-full" />
          : error ? <Card><CardContent className="p-5 text-sm text-destructive">{`Couldn't load proctoring alerts: ${(error as Error).message}`}</CardContent></Card>
          : rows.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
              {(data ?? []).length === 0 ? "No proctoring alerts yet. They appear here when a student leaves the exam during an online exam." : "No attempts match these filters."}
            </CardContent></Card>
          ) : (
            <div className="space-y-2">{rows.map((a) => <AttemptRow key={a.id} a={a} />)}</div>
          )}
      </div>
    </Shell>
  );
}

function AttemptRow({ a }: { a: IntegrityAttempt }) {
  const [open, setOpen] = useState(false);
  const events = useIntegrityEvents(open ? a.id : null);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={cn(a.risk === "high" && "border-rose-200")}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-start p-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{a.studentName}{a.rollNumber ? ` · ${a.rollNumber}` : ""}</p>
              <p className="text-xs text-muted-foreground truncate">{a.examTitle}{a.studentClass ? ` · ${a.studentClass}` : ""} · {fmtTime(a.startedAt)}{a.status === "in_progress" ? " · in progress" : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {EVENT_TYPES.filter((t) => (a.summary[t] ?? 0) > 0).map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">{integrityEventLabel(t)}: {a.summary[t]}</Badge>
              ))}
              {(a.summary.away_seconds ?? 0) > 0 && <Badge variant="secondary" className="font-normal">{`Away ${fmtAway(a.summary.away_seconds ?? 0)}`}</Badge>}
              <Badge variant="outline" className={RISK_CLASS[a.risk]}>{integrityRiskLabel(a.risk)}</Badge>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            {events.isLoading ? <Skeleton className="h-16 w-full" />
              : events.error ? <p className="text-sm text-destructive">{(events.error as Error).message}</p>
              : (
                <ol className="border-s ps-4 space-y-1.5 text-sm">
                  {(events.data ?? []).map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-x-2">
                      <span className="tabular-nums text-muted-foreground">{fmtTime(e.occurred_at)}</span>
                      <span>{integrityEventLabel(e.event_type)}</span>
                      {e.away_seconds != null && e.away_seconds > 0 && <span className="text-muted-foreground">{`(away ${fmtAway(e.away_seconds)})`}</span>}
                    </li>
                  ))}
                </ol>
              )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
