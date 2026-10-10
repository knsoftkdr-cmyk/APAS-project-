import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeMerged, type RouteTable } from "../_shared/mergedRouter.ts";
import { handleSecurityAnomaly } from "../_shared/handlers/securityAnomaly.ts";
import { handleSessionManagement } from "../_shared/handlers/sessionManagement.ts";

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
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
