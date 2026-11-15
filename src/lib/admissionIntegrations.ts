import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/edgeFunctionError";

export type LeadProvider = "meta" | "google" | "zoho" | "website" | "zapier" | "make";

export const LEAD_PROVIDER_LABELS: Record<LeadProvider, string> = {
  meta: "Meta Lead Ads",
  google: "Google Lead Forms",
  zoho: "Zoho CRM",
  website: "Website form",
  zapier: "Zapier",
  make: "Make",
};

export const LEAD_PROVIDER_HINTS: Record<LeadProvider, string> = {
  meta: "Facebook & Instagram instant forms",
  google: "Lead form assets in Google Ads",
  zoho: "Receive from Zoho workflows or pull leads from the API",
  website: "Your own admissions enquiry form",
  zapier: "Connect any app through a Zap",
  make: "Connect any app through a Make scenario",
};

/** Credentials each provider needs (stored encrypted on the server, never shown again). */
export const PROVIDER_CREDENTIALS: Record<LeadProvider, { key: string; label: string; help: string }[]> = {
  meta: [
    { key: "app_secret", label: "App secret", help: "Meta for Developers → your app → Settings → Basic" },
    { key: "page_access_token", label: "Page access token", help: "Long-lived token with leads_retrieval and pages_manage_metadata" },
  ],
  zoho: [
    { key: "client_id", label: "Client ID", help: "Zoho API Console → Self Client" },
    { key: "client_secret", label: "Client secret", help: "Zoho API Console → Self Client" },
    { key: "refresh_token", label: "Refresh token", help: "Generated with scope ZohoCRM.modules.leads.READ" },
  ],
  google: [],
  website: [],
  zapier: [],
  make: [],
};

export const ZOHO_DATA_CENTRES = [
  { value: "com", label: "United States (.com)" },
  { value: "in", label: "India (.in)" },
  { value: "eu", label: "Europe (.eu)" },
  { value: "com.au", label: "Australia (.com.au)" },
  { value: "jp", label: "Japan (.jp)" },
  { value: "ca", label: "Canada (.ca)" },
  { value: "sa", label: "Saudi Arabia (.sa)" },
];

/** Public webhook address for an integration (served through the `log-audit` function; see CONSOLIDATION.md). */
export function webhookUrl(token: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
  return `${base}/functions/v1/log-audit?lead_hook=${token}`;
}

export interface AdmissionIntegration {
  id: string;
  school_id: string;
  provider: LeadProvider;
  name: string;
  status: "active" | "paused" | "error";
  webhook_token: string;
  default_intake_id: string | null;
  config: Record<string, any>;
  field_mapping: Record<string, string>;
  notify_emails: string[];
  leads_received: number;
  leads_created: number;
  leads_duplicate: number;
  leads_failed: number;
  last_received_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export interface LeadIngestion {
  id: string;
  integration_id: string;
  external_lead_id: string | null;
  status: "created" | "duplicate" | "failed" | "needs_review" | "test" | "rejected";
  applicant_id: string | null;
  error: string | null;
  summary: { student?: string | null; phone?: string | null; email?: string | null; grade?: string | null };
  received_at: string;
}

export interface LeadMeta {
  applicant_id: string;
  integration_id: string | null;
  lead_source: LeadProvider;
  campaign: Record<string, string>;
  assigned_to: string | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  enquiry_count: number;
  last_enquiry_at: string;
}

export interface LeadEvent {
  id: string;
  applicant_id: string;
  event_type: "lead_created" | "repeat_enquiry" | "status_changed" | "follow_up_note" | "follow_up_scheduled" | "assigned"
    | "call_answered" | "call_not_answered" | "message_sent" | "message_replied" | "visit_scheduled" | "visit_completed" | "visit_missed";
  detail: Record<string, any>;
  created_at: string;
  created_by: string | null;
}

export type IntegrationAction = "create" | "update" | "rotate" | "delete" | "test" | "subscribe" | "sync" | "retry";

export async function callIntegrationApi<T = any>(action: IntegrationAction, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("log-audit", { body: { mode: `adm_int_${action}`, ...payload } });
  if (error) throw new Error((await unwrapFunctionError(error, "Could not reach the integrations service.")).message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}
