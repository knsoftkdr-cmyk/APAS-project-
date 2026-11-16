import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeMerged, type RouteTable } from "../_shared/mergedRouter.ts";
import { handleSecurityAnomaly } from "../_shared/handlers/securityAnomaly.ts";
import { handleSessionManagement } from "../_shared/handlers/sessionManagement.ts";
import { handleTranslateUi } from "../_shared/handlers/translateUi.ts";
import { handleAdmissionIntegrations } from "../_shared/handlers/admissionIntegrations.ts";
import { handleLeadWebhookRequest } from "../_shared/handlers/leadWebhook.ts";
import { handleTelephonyCalls, handleTelephonyWebhook } from "../_shared/handlers/telephonyCalls.ts";

// Security Anomaly Detection (merged in, no new edge function - see _shared/mergedRouter.ts and CONSOLIDATION.md).
// Routed on `mode` because this function's own body already uses `action` for the audit action name.
// A body without a matching `mode` falls through to the original audit-log insert below, unchanged.
const MERGED_ROUTES: RouteTable = {
  sec_record: { handler: handleSecurityAnomaly, action: "record" },
  sec_list: { handler: handleSecurityAnomaly, action: "list" },
  sec_update: { handler: handleSecurityAnomaly, action: "update" },
  // Session & Device Management
  sess_heartbeat: { handler: handleSessionManagement, action: "heartbeat" },
  sess_list: { handler: handleSessionManagement, action: "list" },
  sess_revoke: { handler: handleSessionManagement, action: "revoke" },
  sess_revoke_others: { handler: handleSessionManagement, action: "revoke_others" },
  sess_admin_revoke_user: { handler: handleSessionManagement, action: "admin_revoke_user" },
  // UI translation for tools/translate-ui.mjs (Google Cloud Translation)
  ui_translate: { handler: handleTranslateUi },
  // Admissions > Lead Sources: admin API (the handler authenticates the caller and checks the admin role itself)
  adm_int_create: { handler: handleAdmissionIntegrations, action: "create" },
  adm_int_update: { handler: handleAdmissionIntegrations, action: "update" },
  adm_int_rotate: { handler: handleAdmissionIntegrations, action: "rotate" },
  adm_int_delete: { handler: handleAdmissionIntegrations, action: "delete" },
  adm_int_test: { handler: handleAdmissionIntegrations, action: "test" },
  adm_int_subscribe: { handler: handleAdmissionIntegrations, action: "subscribe" },
  adm_int_sync: { handler: handleAdmissionIntegrations, action: "sync" },
  adm_int_retry: { handler: handleAdmissionIntegrations, action: "retry" },
  // Click-to-Call & telephony (browser operations: start / refresh / recording). Does its own staff authentication.
  tel_call: { handler: handleTelephonyCalls },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Public lead webhook (Meta / Google / Zoho / Zapier / Make / website forms): <this function>?lead_hook=<token>.
  // Must come BEFORE the generic CORS preflight so website forms get the per-integration origin allow-list, and
  // before routeMerged because Meta's subscription handshake is a GET. Each provider authenticates itself
  // (signature / key); the token alone only selects the integration. Without `lead_hook` nothing changes here.
  if (new URL(req.url).searchParams.has("lead_hook")) return handleLeadWebhookRequest(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Telephony provider status callbacks (Exotel posts here). Authenticated by an HMAC token in the URL, not a JWT.
  if (new URL(req.url).searchParams.has("telephony")) return handleTelephonyWebhook(req);

  const merged = await routeMerged(req, MERGED_ROUTES, "mode");
  if (merged) return merged;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { user_id, action, resource_type, resource_id, details } = await req.json();

    if (!action || !resource_type) {
      return new Response(JSON.stringify({ error: "action and resource_type required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ip_address = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
    const user_agent = req.headers.get("user-agent") || "unknown";

    const { error } = await supabase.from("audit_logs").insert({
      user_id,
      action,
      resource_type,
      resource_id,
      details: details || {},
      ip_address,
      user_agent,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});