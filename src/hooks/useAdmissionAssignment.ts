/* eslint-disable @typescript-eslint/no-explicit-any -- the assignment/SLA tables and functions are newer than the generated Supabase types (same approach as useLeadScores) */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { clockSkewMs, type AssignmentDashboard, type EligibleStaff, type SlaConfig, type WorkbenchResult, type WorkbenchScope } from "@/lib/admissionAssignment";

// The assignment / SLA functions are newer than the generated Supabase types.
const db = supabase as any;
const msg = (e: { message?: string } | null) => (e ? e.message ?? "Something went wrong" : null);
const notInstalled = (m?: string) => !!m && /does not exist|schema cache|Could not find the function/i.test(m);

/** Roles that administer assignment (the database re-checks this on every call). */
export const ASSIGNMENT_ADMIN_ROLES = ["principal", "admin", "school_admin", "knsoft_admin"];

interface WorkbenchOpts { scope?: WorkbenchScope; counsellorId?: string | null; enabled?: boolean; pollMs?: number }

/** Leads for the Counsellor Workbench (or an admin queue). The server decides what the caller may see. */
export function useWorkbench({ scope = "mine", counsellorId = null, enabled = true, pollMs = 60_000 }: WorkbenchOpts = {}) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
  const [data, setData] = useState<WorkbenchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    if (!schoolId || !enabled) { setLoading(false); return; }
    const mine = ++seq.current;
    const { data: res, error: err } = await db.rpc("adm_workbench", { p_school: schoolId, p_scope: scope, p_counsellor: counsellorId, p_limit: 500 });
    if (mine !== seq.current) return;            // a newer request superseded this one
    if (err) { setError(notInstalled(err.message) ? "not_installed" : err.message); setData(null); }
    else { setError(null); setData(res as WorkbenchResult); setSkewMs(clockSkewMs((res as WorkbenchResult)?.server_now, Date.now())); }
    setLoading(false);
  }, [schoolId, scope, counsellorId, enabled]);

  useEffect(() => { setLoading(true); void refetch(); }, [refetch]);
  // The deadlines themselves are enforced by a database job; this only keeps the screen current.
  useEffect(() => {
    if (!enabled || !pollMs) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void refetch(); }, pollMs);
    return () => clearInterval(t);
  }, [refetch, enabled, pollMs]);

  return { data, leads: data?.leads ?? [], loading, error, skewMs, refetch };
}

export function useAssignmentDashboard(enabled: boolean, rangeDays = 30) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
  const [data, setData] = useState<AssignmentDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async () => {
    if (!schoolId || !enabled) { setLoading(false); return; }
    const from = new Date(Date.now() - rangeDays * 86_400_000).toISOString();
    const { data: res, error: err } = await db.rpc("adm_assignment_dashboard", { p_school: schoolId, p_from: from, p_to: new Date().toISOString() });
    if (err) { setError(notInstalled(err.message) ? "not_installed" : err.message); setData(null); } else { setError(null); setData(res as AssignmentDashboard); }
    setLoading(false);
  }, [schoolId, enabled, rangeDays]);
  useEffect(() => { setLoading(true); void refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}

export interface MonitorStatus { scheduled: boolean; last_run_at: string | null; last_run_ok: boolean | null; interval_minutes: number }
/** Is the database job that enforces the SLA deadlines actually running? (Independent of any browser.) */
export function useMonitorStatus(enabled: boolean) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  useEffect(() => {
    if (!schoolId || !enabled) return;
    void db.rpc("adm_sla_monitor_status", { p_school: schoolId }).then(({ data }: { data: MonitorStatus | null }) => setStatus(data ?? null));
  }, [schoolId, enabled]);
  return status;
}

export function useSlaConfig(enabled: boolean) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
  const [config, setConfig] = useState<SlaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(async () => {
    if (!schoolId || !enabled) { setLoading(false); return; }
    const { data } = await db.rpc("adm_get_sla_config", { p_school: schoolId });
    setConfig((data as SlaConfig) ?? null);
    setLoading(false);
  }, [schoolId, enabled]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { config, loading, refetch };
}

export function useEligibleStaff(enabled: boolean) {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
  const [staff, setStaff] = useState<EligibleStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(async () => {
    if (!schoolId || !enabled) { setLoading(false); return; }
    const { data } = await db.rpc("adm_eligible_staff", { p_school: schoolId });
    setStaff((data as EligibleStaff[]) ?? []);
    setLoading(false);
  }, [schoolId, enabled]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { staff, loading, refetch };
}

/** A lead's assignment history (who assigned it, to whom, when, why). Names resolved from profiles. */
export function useAssignmentHistory(applicantId: string | null, open: boolean) {
  const [rows, setRows] = useState<{ id: string; created_at: string; method: string; reason: string | null; from: string | null; to: string | null; by: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!applicantId) return;
    setLoading(true);
    const { data } = await db.from("admission_assignment_history").select("id, from_counsellor, to_counsellor, assigned_by, method, reason, created_at")
      .eq("applicant_id", applicantId).order("created_at", { ascending: false }).limit(30);
    const list = (data ?? []) as any[];
    const ids = [...new Set(list.flatMap((r) => [r.from_counsellor, r.to_counsellor, r.assigned_by]).filter(Boolean))] as string[];
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: p } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      names = Object.fromEntries((p ?? []).map((x: any) => [x.id, x.full_name ?? "Staff"]));
    }
    setRows(list.map((r) => ({ id: r.id, created_at: r.created_at, method: r.method, reason: r.reason,
      from: r.from_counsellor ? names[r.from_counsellor] ?? "Staff" : null, to: r.to_counsellor ? names[r.to_counsellor] ?? "Staff" : null,
      by: r.assigned_by ? names[r.assigned_by] ?? "Staff" : null })));
    setLoading(false);
  }, [applicantId]);
  useEffect(() => { if (open) void refetch(); }, [open, refetch]);
  return { rows, loading, refetch };
}

// ---- actions: authorisation is enforced by the database; the UI only surfaces its message ----
export async function assignLead(applicantId: string, counsellorId: string, reason?: string) {
  const { data, error } = await db.rpc("adm_assign_lead", { p_applicant: applicantId, p_counsellor: counsellorId, p_reason: reason?.trim() || null });
  return { error: msg(error), changed: !!(data as any)?.changed };
}
export async function assignUnassigned(schoolId: string) {
  const { data, error } = await db.rpc("adm_assign_unassigned", { p_school: schoolId });
  return { error: msg(error), assigned: Number((data as any)?.assigned ?? 0) };
}
export async function saveCounsellor(a: { schoolId: string; profileId: string; active: boolean; available: boolean; unavailableUntil: string | null; maxOpen: number | null; redistribute: boolean }) {
  const { data, error } = await db.rpc("adm_set_counsellor", {
    p_school: a.schoolId, p_profile: a.profileId, p_active: a.active, p_available: a.available,
    p_unavailable_until: a.unavailableUntil, p_max_open: a.maxOpen, p_redistribute: a.redistribute,
  });
  return { error: msg(error), result: (data ?? {}) as { redistributed?: number; waiting_assigned?: number } };
}
export async function saveSlaConfig(schoolId: string, settings: Partial<Omit<SlaConfig, "school_id">>) {
  const { error } = await db.rpc("adm_set_sla_config", { p_school: schoolId, p_settings: settings });
  return { error: msg(error) };
}
/** Schedule the next follow-up. The database restarts the follow-up SLA clock from the scheduled time. */
export async function scheduleFollowUp(args: { schoolId: string; applicantId: string; dueAtIso: string; userId: string; note?: string }) {
  const rows: any[] = [];
  if (args.note?.trim()) rows.push({ school_id: args.schoolId, applicant_id: args.applicantId, event_type: "follow_up_note", detail: { note: args.note.trim().slice(0, 1000) }, created_by: args.userId });
  rows.push({ school_id: args.schoolId, applicant_id: args.applicantId, event_type: "follow_up_scheduled", detail: { due: args.dueAtIso }, created_by: args.userId });
  const { error } = await db.from("admission_lead_events").insert(rows);
  if (error) return { error: msg(error) };
  // keep the integration-lead field in step where one exists (no-op for walk-ins); never fail the action over it
  await db.from("admission_lead_meta").update({ next_follow_up_at: args.dueAtIso }).eq("applicant_id", args.applicantId);
  return { error: null };
}
