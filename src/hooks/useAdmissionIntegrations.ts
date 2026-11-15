import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AdmissionIntegration, LeadEvent, LeadIngestion, LeadMeta } from "@/lib/admissionIntegrations";

// The lead tables are new and not yet in the generated Supabase types.
const db = supabase as any;

export const ADMISSION_ADMIN_ROLES = ["principal", "admin", "school_admin"];

export function useAdmissionIntegrations() {
  const { profile } = useAuth();
  const schoolId = profile?.school_id ?? null;
  const canManage = !!profile && ADMISSION_ADMIN_ROLES.includes(profile.role);
  const [integrations, setIntegrations] = useState<AdmissionIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!schoolId) { setIntegrations([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await db.from("admission_integrations").select("*").eq("school_id", schoolId).order("created_at", { ascending: true });
    if (err) {
      // Migration not applied yet: keep the rest of Admissions working.
      setError(/does not exist|schema cache/i.test(err.message) ? "not_installed" : err.message);
      setIntegrations([]);
    } else { setError(null); setIntegrations((data ?? []) as AdmissionIntegration[]); }
    setLoading(false);
  }, [schoolId]);

  useEffect(() => { void refetch(); }, [refetch]);
  return { integrations, loading, error, canManage, refetch };
}

export function useIntegrationActivity(integrationId: string | null, open: boolean) {
  const [rows, setRows] = useState<LeadIngestion[]>([]);
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!integrationId) return;
    setLoading(true);
    // payload_enc is deliberately not selectable by the browser.
    const { data } = await db.from("admission_lead_ingestions")
      .select("id, integration_id, external_lead_id, status, applicant_id, error, summary, received_at")
      .eq("integration_id", integrationId).order("received_at", { ascending: false }).limit(50);
    setRows((data ?? []) as LeadIngestion[]);
    setLoading(false);
  }, [integrationId]);
  useEffect(() => { if (open) void refetch(); }, [open, refetch]);
  return { rows, loading, refetch };
}

/** Lead source / follow-up info for the applicants currently on screen (one query, joined client-side). */
export function useLeadMeta(applicantIds: string[], integrations: AdmissionIntegration[]) {
  const [meta, setMeta] = useState<Record<string, LeadMeta>>({});
  const key = applicantIds.join(",");
  const refetch = useCallback(async () => {
    if (applicantIds.length === 0) { setMeta({}); return; }
    const out: Record<string, LeadMeta> = {};
    for (let i = 0; i < applicantIds.length; i += 200) {
      const { data, error } = await db.from("admission_lead_meta")
        .select("applicant_id, integration_id, lead_source, campaign, assigned_to, next_follow_up_at, last_contacted_at, enquiry_count, last_enquiry_at")
        .in("applicant_id", applicantIds.slice(i, i + 200));
      if (error) { setMeta({}); return; }
      for (const r of data ?? []) out[r.applicant_id] = r as LeadMeta;
    }
    setMeta(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void refetch(); }, [refetch]);
  const integrationName = useCallback((id: string | null) => integrations.find((i) => i.id === id)?.name ?? null, [integrations]);
  return { meta, refetch, integrationName };
}

export function useLeadTimeline(applicantId: string | null, open: boolean) {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const refetch = useCallback(async () => {
    if (!applicantId) return;
    setLoading(true);
    const { data } = await db.from("admission_lead_events").select("id, applicant_id, event_type, detail, created_at, created_by")
      .eq("applicant_id", applicantId).order("created_at", { ascending: false }).limit(100);
    setEvents((data ?? []) as LeadEvent[]);
    setLoading(false);
  }, [applicantId]);
  useEffect(() => { if (open) void refetch(); }, [open, refetch]);
  return { events, loading, refetch };
}

export async function addFollowUpNote(args: { schoolId: string; applicantId: string; note: string; nextFollowUpAt?: string | null; userId: string }) {
  const rows: any[] = [];
  if (args.note.trim()) rows.push({ school_id: args.schoolId, applicant_id: args.applicantId, event_type: "follow_up_note", detail: { note: args.note.trim().slice(0, 1000) }, created_by: args.userId });
  if (args.nextFollowUpAt) rows.push({ school_id: args.schoolId, applicant_id: args.applicantId, event_type: "follow_up_scheduled", detail: { due: args.nextFollowUpAt }, created_by: args.userId });
  if (rows.length) {
    const { error } = await db.from("admission_lead_events").insert(rows);
    if (error) return { error: error.message };
  }
  const patch: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
  if (args.nextFollowUpAt !== undefined) patch.next_follow_up_at = args.nextFollowUpAt;
  const { error } = await db.from("admission_lead_meta").update(patch).eq("applicant_id", args.applicantId);
  return { error: error?.message ?? null };
}
