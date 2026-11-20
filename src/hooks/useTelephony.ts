/* eslint-disable @typescript-eslint/no-explicit-any */
// Click-to-Call data layer. Reads go through RLS / SECURITY DEFINER functions (school-scoped); the call itself and recording
// playback go through the existing `log-audit` edge function (mode "tel_call") - the provider credentials never reach the browser.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";
import { isTerminal } from "@/lib/telephony";

export class TelephonyError extends Error { code?: string; constructor(m: string, code?: string) { super(m); this.code = code; } }

async function callFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("log-audit", { body: { mode: "tel_call", ...body } });
  if (error) { const { message, code } = await unwrapFunctionError(error, "The call request failed."); throw new TelephonyError(message, code); }
  return data as T;
}
const rpc = async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new TelephonyError(error.message);
  return data as T;
};

export interface TelephonySettings {
  provider: "exotel" | "airtel_iq"; enabled: boolean; caller_id: string | null; recording_enabled: boolean;
  recording_retention_days: number; timezone: string; call_window_start: string; call_window_end: string;
}
export const DEFAULT_SETTINGS: TelephonySettings = {
  provider: "exotel", enabled: false, caller_id: null, recording_enabled: false, recording_retention_days: 90,
  timezone: "Asia/Kolkata", call_window_start: "09:00", call_window_end: "21:00",
};
export interface CallRow {
  id: string; direction: string; status: string; phone: string; staff_id: string | null; staff_name: string | null; provider: string;
  started_at: string | null; created_at: string; duration_seconds: number | null; conversation_seconds: number | null;
  failure_reason: string | null; recording_available: boolean; note_count: number;
}
export interface CallHistoryFilters { from?: string; to?: string; staff?: string; status?: string; direction?: string; provider?: string }
export interface TimelineEvent { type: string; at: string; id?: string; [k: string]: unknown }
export interface Followup {
  id: string; applicant_id: string; applicant_name: string | null; parent_name: string | null; parent_phone: string | null;
  due_at: string; reason: string; assigned_to: string | null; assigned_name: string | null; overdue: boolean;
}

/** null data = calling not set up for this user/school (the UI then hides the Call button). */
export function useTelephonySettings() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["telephony-settings", profile?.school_id], enabled: !!profile?.school_id, staleTime: 60_000,
    queryFn: async (): Promise<{ settings: TelephonySettings | null; myPhone: string | null; canCall: boolean }> => {
      const canCall = await rpc<boolean>("tel_user_can_call", { p_user: (await supabase.auth.getUser()).data.user?.id });
      if (!canCall) return { settings: null, myPhone: null, canCall: false };
      const [{ data: s }, { data: st }] = await Promise.all([
        (supabase as any).from("telephony_school_settings").select("*").maybeSingle(),
        (supabase as any).from("telephony_staff").select("phone").eq("user_id", (await supabase.auth.getUser()).data.user?.id).maybeSingle(),
      ]);
      return { settings: (s as TelephonySettings) ?? null, myPhone: st?.phone ?? null, canCall: true };
    },
  });
}

export function useSaveTelephonySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: TelephonySettings) => rpc("tel_save_settings", {
      p_enabled: s.enabled, p_provider: s.provider, p_caller_id: s.caller_id || null, p_recording_enabled: s.recording_enabled,
      p_retention_days: s.recording_retention_days, p_timezone: s.timezone, p_window_start: s.call_window_start, p_window_end: s.call_window_end,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telephony-settings"] }),
  });
}
export function useSaveMyPhone() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (phone: string) => rpc("tel_set_my_phone", { p_phone: phone }), onSuccess: () => qc.invalidateQueries({ queryKey: ["telephony-settings"] }) });
}

/** Starts a call and follows it until it ends (polling the stored status; asks the provider if the callback is late). */
export function useCallSession(onFinished?: () => void) {
  const [call, setCall] = useState<{ id: string; status: string; duration_seconds: number | null; failure_reason: string | null } | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);

  const follow = useCallback((id: string, n = 0) => {
    timer.current = setTimeout(async () => {
      if (!alive.current) return;
      try {
        if (n > 0 && n % 5 === 0) await callFn({ op: "refresh", call_id: id }).catch(() => undefined); // callback late: ask the provider
        const c = await rpc<any>("tel_get_call", { p_call: id });
        if (!alive.current) return;
        setCall({ id, status: c.status, duration_seconds: c.duration_seconds, failure_reason: c.failure_reason });
        if (isTerminal(c.status)) { onFinished?.(); return; }
      } catch { /* transient: keep polling */ }
      if (n < 200) follow(id, n + 1);
    }, n === 0 ? 1500 : 3000);
  }, [onFinished]);

  const start = useCallback(async (applicantId: string, opts: { record: boolean; consent: boolean }) => {
    setError(null); setStarting(true);
    try {
      const r = await callFn<{ call_id: string; status: string }>({ op: "start", applicant_id: applicantId, record: opts.record, recording_consent: opts.consent });
      setCall({ id: r.call_id, status: r.status, duration_seconds: null, failure_reason: null });
      follow(r.call_id);
      return true;
    } catch (e) {
      const te = e as TelephonyError; setError({ message: te.message, code: te.code }); return false;
    } finally { setStarting(false); }
  }, [follow]);
  const dismiss = useCallback(() => { clearTimeout(timer.current); setCall(null); setError(null); }, []);
  return { call, error, starting, start, dismiss };
}

export function useCallHistory(applicantId: string | null, f: CallHistoryFilters) {
  return useQuery({
    queryKey: ["tel-history", applicantId, f], enabled: !!applicantId,
    queryFn: () => rpc<CallRow[]>("tel_call_history", {
      p_applicant: applicantId, p_from: f.from || null, p_to: f.to || null, p_staff: f.staff || null,
      p_status: f.status || null, p_direction: f.direction || null, p_provider: f.provider || null, p_limit: 200,
    }),
  });
}
export const useLeadTimeline = (applicantId: string | null) =>
  useQuery({ queryKey: ["tel-timeline", applicantId], enabled: !!applicantId, queryFn: () => rpc<TimelineEvent[]>("tel_lead_timeline", { p_applicant: applicantId }) });
export const usePendingFollowups = (mine: boolean, enabled = true) =>
  useQuery({ queryKey: ["tel-followups", mine], enabled, queryFn: () => rpc<Followup[]>("tel_pending_followups", { p_mine: mine }) });

export function useCallMutations(applicantId: string | null) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["tel-timeline", applicantId] }); qc.invalidateQueries({ queryKey: ["tel-history", applicantId] }); qc.invalidateQueries({ queryKey: ["tel-followups"] }); };
  return {
    addNote: useMutation({ mutationFn: (v: { note: string; callId?: string | null }) => rpc("tel_add_note", { p_applicant: applicantId, p_call: v.callId ?? null, p_note: v.note }), onSuccess: refresh }),
    schedule: useMutation({ mutationFn: (v: { dueIso: string; reason: string; callId?: string | null }) => rpc("tel_schedule_followup", { p_applicant: applicantId, p_call: v.callId ?? null, p_due: v.dueIso, p_reason: v.reason }), onSuccess: refresh }),
    updateFollowup: useMutation({ mutationFn: (v: { id: string; action: "complete" | "cancel" | "reschedule"; dueIso?: string }) => rpc("tel_update_followup", { p_id: v.id, p_action: v.action, p_due: v.dueIso ?? null }), onSuccess: refresh }),
  };
}

/** Fetches a recording through the server and returns a short-lived blob URL (the provider's link is never exposed). */
export async function fetchRecordingBlobUrl(callId: string): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const base = (import.meta as any).env?.VITE_SUPABASE_URL as string;
  const res = await fetch(`${base}/functions/v1/log-audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token}`, apikey: (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? "" },
    body: JSON.stringify({ mode: "tel_call", op: "recording", call_id: callId }),
  });
  if (!res.ok) { let m = "The recording could not be played."; try { m = (await res.json()).error ?? m; } catch { /* */ } throw new TelephonyError(m); }
  return URL.createObjectURL(await res.blob());
}
