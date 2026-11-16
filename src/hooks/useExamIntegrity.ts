// Teacher side of exam proctoring: attempts with integrity events (useExamProctoring on the student's exam page),
// scoped the same way as Exam Reviews - school managers see their school, a teacher sees exams given to their
// classes or assigned by them.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchClassOptions } from "@/lib/Classsubjects";

// deno-lint-ignore no-explicit-any
const db = supabase as any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const STAFF_ADMIN_ROLES = ["admin", "principal", "school_admin", "hod"];
const CHUNK = 80;

export type IntegrityEventType = "tab_hidden" | "window_blur" | "fullscreen_exit" | "copy_paste" | "right_click";
export type IntegrityRisk = "low" | "medium" | "high";

export interface IntegritySummary {
  tab_hidden?: number; window_blur?: number; fullscreen_exit?: number; copy_paste?: number; right_click?: number; away_seconds?: number;
}

export interface IntegrityAttempt {
  id: string;
  status: string;
  studentName: string;
  studentClass: string;
  rollNumber: string | null;
  examTitle: string;
  assignmentId: string;
  startedAt: string | null;
  submittedAt: string | null;
  eventCount: number;
  summary: IntegritySummary;
  risk: IntegrityRisk;
}

export interface IntegrityEventRow { id: number; event_type: IntegrityEventType; away_seconds: number | null; occurred_at: string }

/** Weighted so leaving the tab and copy/paste count more than a stray right-click. Pure, unit-tested. */
export function integrityRisk(s: IntegritySummary): IntegrityRisk {
  const score = (s.tab_hidden ?? 0) * 2 + (s.window_blur ?? 0) + (s.fullscreen_exit ?? 0) + (s.copy_paste ?? 0) * 2
    + (s.right_click ?? 0) * 0.5 + Math.floor((s.away_seconds ?? 0) / 60);
  return score >= 10 ? "high" : score >= 4 ? "medium" : "low";
}

export function integrityRiskLabel(r: IntegrityRisk): string {
  return r === "high" ? "High risk" : r === "medium" ? "Medium risk" : "Low risk";
}

export function integrityEventLabel(e: IntegrityEventType): string {
  switch (e) {
    case "tab_hidden": return "Left the exam tab";
    case "window_blur": return "Switched to another window";
    case "fullscreen_exit": return "Left full screen";
    case "copy_paste": return "Copy or paste";
    case "right_click": return "Right-click";
  }
}

const COLS =
  "id, status, assignment_id, started_at, submitted_at, integrity_summary, integrity_event_count, " +
  "students!inner(full_name, class, section, roll_number, school_id), " +
  "generated_assessment_paper_assignments(title)";

async function loadIntegrityAttempts(profile: { id: string; role: string; school_id: string | null }): Promise<IntegrityAttempt[]> {
  const query = (assignmentIds?: string[]) => {
    let q = db.from("generated_assessment_paper_attempts").select(COLS).gt("integrity_event_count", 0);
    if (profile.school_id) q = q.eq("students.school_id", profile.school_id);
    if (assignmentIds) q = q.in("assignment_id", assignmentIds);
    return q.order("started_at", { ascending: false }).limit(300);
  };

  let rows: Row[] = [];
  if (STAFF_ADMIN_ROLES.includes(profile.role)) {
    const { data, error } = await query();
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } else {
    const classes = await fetchClassOptions(profile);
    const classIds = classes.map((c) => c.id);
    const scope = classIds.length ? `class_id.in.(${classIds.join(",")}),assigned_by.eq.${profile.id}` : `assigned_by.eq.${profile.id}`;
    const { data: asg, error: asgErr } = await db.from("generated_assessment_paper_assignments").select("id").or(scope);
    if (asgErr) throw new Error(asgErr.message);
    const ids: string[] = (asg ?? []).map((a: Row) => a.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await query(ids.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
    }
    rows.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  }

  return rows.map((r): IntegrityAttempt => {
    const summary = (r.integrity_summary ?? {}) as IntegritySummary;
    return {
      id: r.id, status: r.status, assignmentId: r.assignment_id,
      studentName: r.students?.full_name ?? "Student",
      studentClass: r.students ? [r.students.class, r.students.section].filter(Boolean).join(" - ") : "",
      rollNumber: r.students?.roll_number ?? null,
      examTitle: r.generated_assessment_paper_assignments?.title ?? "Exam",
      startedAt: r.started_at, submittedAt: r.submitted_at,
      eventCount: Number(r.integrity_event_count) || 0,
      summary, risk: integrityRisk(summary),
    };
  });
}

export function useIntegrityAttempts() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["exam-integrity", "list", profile?.id],
    enabled: !!profile?.id,
    staleTime: 30_000,
    queryFn: () => loadIntegrityAttempts({ id: profile!.id, role: profile!.role, school_id: profile!.school_id }),
  });
}

export function useIntegrityEvents(attemptId: string | null) {
  return useQuery({
    queryKey: ["exam-integrity", "events", attemptId],
    enabled: !!attemptId,
    queryFn: async (): Promise<IntegrityEventRow[]> => {
      const { data, error } = await db.from("exam_integrity_events")
        .select("id, event_type, away_seconds, occurred_at").eq("attempt_id", attemptId).order("occurred_at").limit(500);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
