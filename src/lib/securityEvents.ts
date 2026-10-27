import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

// Security Anomaly Detection - client side.
//
// Everything goes through the already-deployed `log-audit` function, routed on its `mode` field
// ("sec_record" / "sec_list" / "sec_update"; no new edge function). Reporting is fire-and-forget: it can never
// block or break login, an export, or opening a record.

export type SecurityEventName = "login_success" | "login_failed" | "data_export" | "record_view";

export interface SecurityEventInput {
  event: SecurityEventName;
  /** login_failed only: what was typed in the id / email box. Hashed server-side, never stored in clear. */
  identifier?: string;
  role_attempted?: string;
  /** data_export / record_view: what was touched, e.g. "admission_applicants". */
  resource?: string;
  resource_id?: string;
  /** data_export: number of records in the file. */
  count?: number;
}

export function reportSecurityEvent(input: SecurityEventInput): void {
  try {
    void supabase.functions.invoke("log-audit", { body: { mode: "sec_record", ...input } }).then(
      () => {},
      () => {},
    );
  } catch {
    // reporting is best-effort
  }
}

// Record views are throttled per record so re-renders and tab switches don't count as new access.
const seenViews = new Map<string, number>();
export function reportRecordView(resource: string, resourceId: string): void {
  const key = `${resource}:${resourceId}`;
  const now = Date.now();
  if (now - (seenViews.get(key) ?? 0) < 10 * 60_000) return;
  seenViews.set(key, now);
  reportSecurityEvent({ event: "record_view", resource, resource_id: resourceId });
}

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "false_positive";

export interface SecurityAlert {
  id: string;
  school_id: string | null;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  rule: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  status: AlertStatus;
  detected_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface RecentLogin {
  id: string;
  user_id: string | null;
  user_name: string | null;
  role: string | null;
  event_type: "login_success" | "login_failed";
  ip_address: string | null;
  device_key: string | null;
  metadata: { identifier_hint?: string | null };
  created_at: string;
}

export interface SecurityOverview {
  persistence: "available" | "unavailable";
  scanned?: boolean;
  alerts: SecurityAlert[];
  recent_logins: RecentLogin[];
  summary: {
    open: number;
    open_by_severity: Record<AlertSeverity, number>;
    logins_24h: number;
    failed_logins_24h: number;
    exports_24h: number;
  } | null;
}

export async function getSecurityOverview(opts: { schoolId?: string; status?: AlertStatus; refresh?: boolean } = {}): Promise<SecurityOverview> {
  const { data, error } = await supabase.functions.invoke("log-audit", {
    body: { mode: "sec_list", school_id: opts.schoolId, status: opts.status, refresh: opts.refresh },
  });
  if (error) throw new Error((await unwrapFunctionError(error, "Could not load security alerts.")).message);
  return data as SecurityOverview;
}

export async function updateSecurityAlert(alertId: string, status: AlertStatus, note?: string): Promise<SecurityAlert> {
  const { data, error } = await supabase.functions.invoke("log-audit", {
    body: { mode: "sec_update", alert_id: alertId, status, note },
  });
  if (error) throw new Error((await unwrapFunctionError(error, "Could not update the alert.")).message);
  return data.alert as SecurityAlert;
}
