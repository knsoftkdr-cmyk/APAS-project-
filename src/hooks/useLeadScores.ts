import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { InteractionType, LeadCategory, LeadQualification, LeadScore, ScoreHistoryRow } from "@/lib/leadScoring";

// The scoring tables / RPCs are newer than the generated Supabase types.
const db = supabase as any;

const SCORE_COLUMNS = "applicant_id, computed_score, override_score, override_reason, override_by, override_at, score, category, coverage, factors, calculated_at, score_changed_at";

/** Scores for the applicants currently on screen (one query, joined client-side like useLeadMeta). */
export function useLeadScores(applicantIds: string[]) {
  const [scores, setScores] = useState<Record<string, LeadScore>>({});
  const key = applicantIds.join(",");
  const refetch = useCallback(async () => {
    if (applicantIds.length === 0) { setScores({}); return; }
    const out: Record<string, LeadScore> = {};
    for (let i = 0; i < applicantIds.length; i += 200) {
      const { data, error } = await db.from("admission_lead_scores").select(SCORE_COLUMNS).in("applicant_id", applicantIds.slice(i, i + 200));
      if (error) { setScores({}); return; }          // e.g. migration not applied yet: the list keeps working without scores
      for (const r of data ?? []) out[r.applicant_id] = r as LeadScore;
    }
    setScores(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void refetch(); }, [refetch]);
  return { scores, refetch };
}

/** Hot / Warm / Cold counts for the whole school (dashboard overview). */
export function useLeadTemperature(refreshKey: unknown = 0) {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<Record<LeadCategory, number> | null>(null);
  useEffect(() => {
    if (!profile?.school_id) return;
    let live = true;
    void (async () => {
      const { data, error } = await db.from("admission_lead_scores").select("category").eq("school_id", profile.school_id);
      if (!live || error) return;
      const c = { hot: 0, warm: 0, cold: 0 } as Record<LeadCategory, number>;
      for (const r of data ?? []) if (r.category in c) c[r.category as LeadCategory] += 1;
      setCounts(c);
    })();
    return () => { live = false; };
  }, [profile?.school_id, refreshKey]);
  return counts;
}

export function useScoreHistory(applicantId: string | null, open: boolean) {
  const [rows, setRows] = useState<ScoreHistoryRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!applicantId) return;
    setLoading(true);
    const { data } = await db.from("admission_lead_score_history")
      .select("id, change_type, trigger_source, old_score, new_score, old_category, new_category, computed_score, reason, created_by, created_at")
      .eq("applicant_id", applicantId).order("created_at", { ascending: false }).limit(50);
    const list = (data ?? []) as ScoreHistoryRow[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.created_by).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: p } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setNames(Object.fromEntries((p ?? []).map((x: any) => [x.id, x.full_name ?? "Staff"])));
    }
    setLoading(false);
  }, [applicantId]);
  useEffect(() => { if (open) void refetch(); }, [open, refetch]);
  return { rows, names, loading, refetch };
}

export function useLeadQualification(applicantId: string | null, open: boolean) {
  const [q, setQ] = useState<LeadQualification | null>(null);
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!applicantId) return;
    setLoading(true);
    const { data } = await db.from("admission_lead_qualification")
      .select("interest_level, interested_course, annual_budget, fee_affordability, admission_timeline").eq("applicant_id", applicantId).maybeSingle();
    setQ((data as LeadQualification | null) ?? null);
    setLoading(false);
  }, [applicantId]);
  useEffect(() => { if (open) void refetch(); }, [open, refetch]);
  return { q, loading, refetch };
}

// ---- actions (authorisation is enforced by the database; the UI only surfaces its message) ----
const msg = (e: { message?: string } | null) => (e ? e.message ?? "Something went wrong" : null);

export async function setScoreOverride(applicantId: string, score: number, reason: string) {
  const { error } = await db.rpc("adm_set_lead_score_override", { p_applicant: applicantId, p_score: score, p_reason: reason });
  return { error: msg(error) };
}
export async function clearScoreOverride(applicantId: string, reason: string) {
  const { error } = await db.rpc("adm_clear_lead_score_override", { p_applicant: applicantId, p_reason: reason });
  return { error: msg(error) };
}
export async function saveQualification(applicantId: string, q: { interest_level: string; interested_course: string; annual_budget: string; fee_affordability: string; admission_timeline: string }) {
  const budget = q.annual_budget.trim() === "" ? null : Number(q.annual_budget);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return { error: "Budget must be a positive number" };
  const { error } = await db.rpc("adm_save_lead_qualification", {
    p_applicant: applicantId, p_interest_level: q.interest_level || null, p_interested_course: q.interested_course || null,
    p_annual_budget: budget, p_fee_affordability: q.fee_affordability || null, p_admission_timeline: q.admission_timeline || null,
  });
  return { error: msg(error) };
}
/** Log a call / message / visit / follow-up in the existing lead timeline; the database re-scores the lead. */
export async function logInteraction(args: { schoolId: string; applicantId: string; type: InteractionType; note?: string; userId: string }) {
  const detail = args.note?.trim() ? { note: args.note.trim().slice(0, 1000) } : {};
  const { error } = await db.from("admission_lead_events").insert({
    school_id: args.schoolId, applicant_id: args.applicantId, event_type: args.type, detail, created_by: args.userId,
  });
  return { error: msg(error) };
}
