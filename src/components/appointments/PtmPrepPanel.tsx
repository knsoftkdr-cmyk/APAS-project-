// src/components/appointments/PtmPrepPanel.tsx
//
// Parent-Teacher Meeting prep, shown inside a teacher's appointment card on /teacher/appointments.
// Data: ai-teacher-assistant { action: "ptm_prep" } via getPtmPrep() in src/lib/appointments.ts.
//
// Meetings happening today / tomorrow / the day after open and load automatically; further-out meetings load when the
// teacher expands the panel. Results are cached by React Query (and server-side), so re-opening is instant.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ChevronDown, ChevronUp, ClipboardCopy, Loader2, MessageCircleQuestion, RefreshCw, Sparkles, ThumbsUp, Target,
} from "lucide-react";
import { getPtmPrep, type PtmCategory, type PtmPrepResponse, type PtmPriority } from "@/lib/appointments";
import { useToast } from "@/hooks/use-toast";

const AUTO_OPEN_WITHIN_DAYS = 2;

const CATEGORY_LABEL: Record<PtmCategory, string> = {
  agenda: "Agenda",
  academics: "Academics",
  attendance: "Attendance",
  homework: "Homework",
  behaviour: "Behaviour",
  wellbeing: "Wellbeing",
  support: "Support",
  strengths: "Strengths",
};

const PRIORITY_STYLE: Record<PtmPriority, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};

function daysUntil(dateStr: string): number | null {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function toPlainText(studentName: string, date: string, r: PtmPrepResponse): string {
  const p = r.prep;
  const lines: string[] = [`Meeting prep: ${studentName} (${date})`, "", p.summary, ""];
  if (p.strengths.length) {
    lines.push("Start with strengths:");
    p.strengths.forEach((s) => lines.push(`- ${s.title}: ${s.evidence}`));
    lines.push("");
  }
  lines.push("Discussion points:");
  p.discussion_points.forEach((d, i) => {
    lines.push(`${i + 1}. [${d.priority}] ${d.title}`);
    d.evidence.forEach((e) => lines.push(`   Data: ${e}`));
    lines.push(`   How to raise it: ${d.approach}`);
  });
  if (p.questions_for_parent.length) {
    lines.push("", "Questions to ask the parent:");
    p.questions_for_parent.forEach((q) => lines.push(`- ${q}`));
  }
  if (p.proposed_next_steps.length) {
    lines.push("", "Proposed next steps:");
    p.proposed_next_steps.forEach((s) => lines.push(`- ${s}`));
  }
  return lines.join("\n");
}

interface Props {
  appointmentId: string;
  appointmentDate: string; // YYYY-MM-DD
  studentName?: string;
}

export function PtmPrepPanel({ appointmentId, appointmentDate, studentName }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const days = daysUntil(appointmentDate);
  const soon = days !== null && days >= 0 && days <= AUTO_OPEN_WITHIN_DAYS;
  const [open, setOpen] = useState(soon);
  const [refreshing, setRefreshing] = useState(false);

  const queryKey = ["ptm-prep", appointmentId];
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => getPtmPrep(appointmentId),
    enabled: open,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const fresh = await getPtmPrep(appointmentId, { refresh: true });
      qc.setQueryData(queryKey, fresh);
    } catch (e: unknown) {
      toast({ title: "Couldn't refresh the prep", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCopy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(toPlainText(studentName || data.student_name, appointmentDate, data));
      toast({ title: "Copied", description: "Meeting prep copied to your clipboard." });
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" });
    }
  }

  const prep = data?.prep;
  const snap = prep?.snapshot;

  return (
    <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-violet-800">
          <Sparkles className="h-4 w-4" />
          Meeting prep
          {soon && <span className="text-[10px] font-bold uppercase bg-violet-200 text-violet-800 px-1.5 py-0.5 rounded-full">Meeting soon</span>}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-violet-500" /> : <ChevronDown className="h-4 w-4 text-violet-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-violet-100 pt-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing discussion points from your records...
            </div>
          )}

          {isError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3 space-y-2">
              <p>{(error as Error)?.message || "Couldn't prepare this meeting."}</p>
              <button type="button" onClick={() => refetch()} className="text-xs font-semibold underline">Try again</button>
            </div>
          )}

          {prep && snap && (
            <>
              <p className="text-sm text-slate-700">{prep.summary}</p>

              {/* Snapshot */}
              <div className="flex flex-wrap gap-1.5">
                {snap.attendance_rate_pct !== null && <Chip label="Attendance" value={`${snap.attendance_rate_pct}%`} warn={snap.attendance_rate_pct < 90} />}
                {snap.avg_marks_pct !== null && <Chip label="Avg marks" value={`${snap.avg_marks_pct}%`} warn={snap.avg_marks_pct < 60} />}
                {snap.homework_completion_pct !== null && <Chip label="Homework" value={`${snap.homework_completion_pct}%`} warn={snap.homework_completion_pct < 75} />}
                <Chip label="Behaviour (90d)" value={`+${snap.behaviour.positive} / -${snap.behaviour.negative}`} warn={snap.behaviour.negative >= 3} />
                {snap.active_interventions > 0 && <Chip label="Active interventions" value={String(snap.active_interventions)} warn />}
                {snap.risk_level && snap.risk_level !== "low" && <Chip label="Predicted risk" value={snap.risk_level} warn />}
                {snap.last_meeting && <Chip label="Last met" value={snap.last_meeting.date} />}
              </div>

              {prep.strengths.length > 0 && (
                <Section icon={<ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />} title="Start with strengths">
                  <ul className="space-y-1">
                    {prep.strengths.map((s, i) => (
                      <li key={i} className="text-xs text-slate-700">
                        <span className="font-medium">{s.title}</span>
                        <span className="text-muted-foreground"> - {s.evidence}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section icon={<Target className="h-3.5 w-3.5 text-violet-600" />} title="Discussion points">
                <ol className="space-y-2.5">
                  {prep.discussion_points.map((d, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 bg-card p-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[d.priority]}`}>{d.priority}</span>
                        <span className="text-[10px] font-semibold uppercase text-violet-600">{CATEGORY_LABEL[d.category] ?? d.category}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-1">{d.title}</p>
                      {d.evidence.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {d.evidence.map((e, j) => (
                            <li key={j} className="text-xs text-muted-foreground">Data: {e}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-slate-700 mt-1.5"><span className="font-medium">How to raise it:</span> {d.approach}</p>
                    </li>
                  ))}
                </ol>
              </Section>

              {prep.questions_for_parent.length > 0 && (
                <Section icon={<MessageCircleQuestion className="h-3.5 w-3.5 text-indigo-600" />} title="Questions to ask the parent">
                  <ul className="list-disc pl-4 space-y-0.5">
                    {prep.questions_for_parent.map((q, i) => <li key={i} className="text-xs text-slate-700">{q}</li>)}
                  </ul>
                </Section>
              )}

              {prep.proposed_next_steps.length > 0 && (
                <Section icon={<Target className="h-3.5 w-3.5 text-emerald-600" />} title="Proposed next steps">
                  <ul className="list-disc pl-4 space-y-0.5">
                    {prep.proposed_next_steps.map((q, i) => <li key={i} className="text-xs text-slate-700">{q}</li>)}
                  </ul>
                </Section>
              )}

              {(data.warnings.length > 0 || prep.data_gaps.length > 0) && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2 space-y-0.5">
                  {data.warnings.map((w, i) => (
                    <p key={`w${i}`} className="flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {w}</p>
                  ))}
                  {prep.data_gaps.map((g, i) => <p key={`g${i}`}>Note: {g}</p>)}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-violet-100">
                <span className="text-[11px] text-muted-foreground">
                  {data.source === "ai" ? "AI-assisted, from your records" : "From your records only"}
                  {" · "}
                  {new Date(data.generated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="flex items-center gap-1.5">
                  <button type="button" onClick={handleCopy} className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 px-2 py-1 rounded-md hover:bg-violet-100">
                    <ClipboardCopy className="h-3 w-3" /> Copy
                  </button>
                  <button type="button" onClick={handleRefresh} disabled={refreshing} className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 px-2 py-1 rounded-md hover:bg-violet-100 disabled:opacity-50">
                    <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className={`text-[11px] px-2 py-1 rounded-full border ${warn ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-white border-slate-200 text-slate-600"}`}>
      {label}: <strong>{value}</strong>
    </span>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{icon}{title}</h4>
      {children}
    </div>
  );
}
