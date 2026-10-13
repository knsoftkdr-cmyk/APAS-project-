/**
 * HomeworkResults.tsx — what teachers / principals see after adaptive homework is assigned:
 * for every generated set, who has submitted, who is still working, scores, and each student's answers.
 *
 * Reads adaptive_homework_items directly (staff have read access to it; students' answer keys are never stored there).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { AdaptiveHomeworkAnswer, AdaptiveHomeworkAssignment, MasteryBand } from "@/hooks/useAdaptiveHomework";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

const BAND_LABEL: Record<MasteryBand, string> = {
  beginning: "Beginning", developing: "Developing", proficient: "Proficient", mastered: "Mastered",
};
const BAND_CLASS: Record<MasteryBand, string> = {
  beginning: "bg-red-50 text-red-700 border-red-200", developing: "bg-amber-50 text-amber-700 border-amber-200",
  proficient: "bg-blue-50 text-blue-700 border-blue-200", mastered: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const STATUS_META = {
  submitted: { label: "Submitted", cls: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  in_progress: { label: "In progress", cls: "bg-amber-50 text-amber-700 border-amber-300" },
  assigned: { label: "Not started", cls: "bg-slate-100 text-slate-600 border-slate-300" },
} as const;
const STATUS_ORDER = { submitted: 0, in_progress: 1, assigned: 2 } as const;

interface ResultRow {
  id: string;
  assignment_id: string;
  student_id: string;
  mastery_band: MasteryBand;
  status: keyof typeof STATUS_META;
  score: number | null;
  submitted_at: string | null;
  answers: AdaptiveHomeworkAnswer[];
  name: string;
  roll: string | null;
}

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function useHomeworkResults(assignmentIds: string[]) {
  const key = [...assignmentIds].sort().join(",");
  return useQuery<ResultRow[]>({
    queryKey: ["adaptive-homework-results", key],
    enabled: assignmentIds.length > 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await db.from("adaptive_homework_items")
        .select("id, assignment_id, student_id, mastery_band, status, score, submitted_at, answers")
        .in("assignment_id", assignmentIds);
      if (error) throw error;
      const rows = (data ?? []) as Omit<ResultRow, "name" | "roll">[];

      // Names: students -> profiles (two small lookups, so it doesn't depend on relationship names).
      const studentIds = [...new Set(rows.map((r) => r.student_id))];
      const profileOf = new Map<string, string>();
      for (const ids of chunk(studentIds, 150)) {
        const { data: st } = await db.from("students").select("id, profile_id").in("id", ids);
        for (const s of st ?? []) if (s.profile_id) profileOf.set(s.id, s.profile_id);
      }
      const people = new Map<string, { full_name: string | null; roll_number: string | null }>();
      for (const ids of chunk([...new Set(profileOf.values())], 150)) {
        const { data: pr } = await db.from("profiles").select("id, full_name, roll_number").in("id", ids);
        for (const p of pr ?? []) people.set(p.id, p);
      }
      return rows.map((r) => {
        const p = people.get(profileOf.get(r.student_id) ?? "");
        return { ...r, answers: Array.isArray(r.answers) ? r.answers : [], name: p?.full_name?.trim() || "Student", roll: p?.roll_number ?? null };
      });
    },
  });
}

/** The questions of one student's set, loaded only when their row is opened. */
function useStudentSet(rowId: string, enabled: boolean) {
  return useQuery<{ item_id: string; stem: string; options: Record<string, string>; topic: string }[]>({
    queryKey: ["adaptive-homework-set", rowId],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("adaptive_homework_items").select("items").eq("id", rowId).single();
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return ((data?.items ?? []) as any[])
        .filter((s) => s?.item)
        .map((s) => ({ item_id: s.item.item_id, stem: s.item.stem, options: s.item.options ?? {}, topic: s.subtopic_name ?? s.topic_name ?? "" }));
    },
  });
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function StudentAnswers({ row }: { row: ResultRow }) {
  const { data: set, isLoading } = useStudentSet(row.id, true);
  if (isLoading) return <p className="text-xs text-muted-foreground flex items-center gap-1.5 py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading answers…</p>;
  if (row.answers.length === 0) return <p className="text-xs text-muted-foreground py-2">No answers yet.</p>;
  const byId = new Map((set ?? []).map((q) => [q.item_id, q]));
  return (
    <ol className="space-y-2 py-2">
      {row.answers.map((a, i) => {
        const q = byId.get(a.item_id);
        return (
          <li key={`${a.item_id}-${i}`} className={cn("rounded-lg border p-2.5 text-xs", a.is_correct ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40")}>
            <div className="flex items-start gap-2">
              {a.is_correct ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" /> : <XCircle className="h-4 w-4 text-red-600 shrink-0" />}
              <div className="min-w-0 space-y-1">
                <p className="font-medium break-words">{i + 1}. {q?.stem ?? "Question"}</p>
                {q?.topic && <p className="text-muted-foreground">{q.topic}</p>}
                <p className="break-words">
                  <span className="text-muted-foreground">Chose </span>
                  <span className="font-medium">{a.selected_option}{q?.options?.[a.selected_option] ? `. ${q.options[a.selected_option]}` : ""}</span>
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StudentRow({ row }: { row: ResultRow }) {
  const [open, setOpen] = useState(false);
  const correct = row.answers.filter((a) => a.is_correct).length;
  const st = STATUS_META[row.status] ?? STATUS_META.assigned;
  const canOpen = row.answers.length > 0;
  return (
    <div className="border-b last:border-0">
      <button type="button" disabled={!canOpen} onClick={() => setOpen((o) => !o)}
        className={cn("w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-left", canOpen && "hover:bg-muted/40")}>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-medium break-words">{row.name}</p>
          {row.roll && <p className="text-[11px] text-muted-foreground">Roll {row.roll}</p>}
        </div>
        <Badge variant="outline" className={cn("text-[10px]", BAND_CLASS[row.mastery_band])}>{BAND_LABEL[row.mastery_band]}</Badge>
        <Badge variant="outline" className={cn("text-[10px]", st.cls)}>{st.label}</Badge>
        <div className="text-xs tabular-nums text-right min-w-[5.5rem]">
          {row.status === "submitted"
            ? <><span className="font-semibold">{correct}/{row.answers.length}</span>{row.score != null && <span className="text-muted-foreground"> · {Math.round(row.score)}%</span>}</>
            : row.answers.length > 0 ? <span className="text-muted-foreground">{row.answers.length} answered</span> : <span className="text-muted-foreground">—</span>}
          {row.submitted_at && <p className="text-[10px] text-muted-foreground">{fmtDate(row.submitted_at)}</p>}
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !canOpen && "opacity-0", open && "rotate-180")} />
      </button>
      {open && <div className="pl-1 pr-1 pb-1"><StudentAnswers row={row} /></div>}
    </div>
  );
}

function BatchResults({ assignment, rows, loading }: { assignment: AdaptiveHomeworkAssignment; rows: ResultRow[]; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const submitted = rows.filter((r) => r.status === "submitted");
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const notStarted = rows.filter((r) => r.status === "assigned").length;
  const scored = submitted.filter((r) => r.score != null);
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + (r.score as number), 0) / scored.length) : null;
  const total = rows.length || assignment.student_count;
  const pct = total ? Math.round((submitted.length / total) * 100) : 0;
  const sorted = [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));

  return (
    <div className="rounded-xl border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left p-3 space-y-2 hover:bg-muted/30 rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium break-words">{assignment.title}</p>
            <p className="text-xs text-muted-foreground">{new Date(assignment.created_at).toLocaleDateString()} · {assignment.student_count} students</p>
          </div>
          <ChevronDown className={cn("h-4 w-4 mt-1 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </div>
        {loading ? <p className="text-xs text-muted-foreground">Loading results…</p> : (
          <>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className={cn("text-[11px]", STATUS_META.submitted.cls)}>{submitted.length} of {total} submitted</Badge>
              {inProgress > 0 && <Badge variant="outline" className={cn("text-[11px]", STATUS_META.in_progress.cls)}>{inProgress} in progress</Badge>}
              {notStarted > 0 && <Badge variant="outline" className={cn("text-[11px]", STATUS_META.assigned.cls)}>{notStarted} not started</Badge>}
              {avg != null && <Badge variant="outline" className="text-[11px]">Class average {avg}%</Badge>}
            </div>
          </>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2 border-t">
          {sorted.length === 0 ? <p className="text-xs text-muted-foreground py-3">No student sets found for this batch.</p> : sorted.map((r) => <StudentRow key={r.id} row={r} />)}
        </div>
      )}
    </div>
  );
}

/** All homework sets generated for the chosen class, each openable to see submissions. */
export function HomeworkBatches({ assignments }: { assignments: AdaptiveHomeworkAssignment[] }) {
  const qc = useQueryClient();
  const ids = assignments.map((a) => a.id);
  const { data, isLoading, isFetching, error } = useHomeworkResults(ids);
  const byAssignment = new Map<string, ResultRow[]>();
  for (const r of data ?? []) byAssignment.set(r.assignment_id, [...(byAssignment.get(r.assignment_id) ?? []), r]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Homework for this class</CardTitle>
          <Button size="sm" variant="outline" className="h-9 sm:h-8 text-xs" disabled={isFetching}
            onClick={() => { void qc.invalidateQueries({ queryKey: ["adaptive-homework-results"] }); void qc.invalidateQueries({ queryKey: ["adaptive-homework-assignments"] }); }}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Open a set to see who has submitted, their scores, and their answers.</p>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {error && <p className="text-sm text-destructive">Couldn't load results: {(error as Error).message}</p>}
        {assignments.map((a) => <BatchResults key={a.id} assignment={a} rows={byAssignment.get(a.id) ?? []} loading={isLoading} />)}
      </CardContent>
    </Card>
  );
}
