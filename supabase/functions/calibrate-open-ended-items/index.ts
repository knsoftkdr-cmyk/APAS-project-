// supabase/functions/calibrate-open-ended-items/index.ts
//
// Deploy with:
//   supabase functions deploy calibrate-open-ended-items
//
// Staff only, interactive equivalent of calibrate-irt but for
// question_bank_extended (descriptive/case-based/HOTS/scenario/competency
// items). Re-estimates each item's real-world difficulty from graded
// open_response_submissions and corrects the item's declared difficulty to
// match, once enough students have answered it.
//
//   Body: {
//     scope_type?: "subtopic" | "topic" | "competency" | "all"   default "all"
//     scope_id?: number | uuid    required unless scope_type is "all"
//     min_sample?: number          default 5 - responses needed before an
//                                   item's difficulty is trusted enough to touch
//     dry_run?: boolean            default false - compute and return what
//                                   WOULD change without writing anything
//   }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runOpenEndedCalibrationForScope, type ScopeType } from "../_shared/runOpenEndedCalibration.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAFF_ROLES = ["admin", "teacher", "school_admin", "principal", "hod"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to run calibration" }, 403);

    const body = await req.json().catch(() => ({}));
    const scopeType: ScopeType = ["subtopic", "topic", "competency", "all"].includes(body.scope_type) ? body.scope_type : "all";
    if (scopeType !== "all" && body.scope_id == null) {
      return json({ error: `scope_id is required when scope_type is "${scopeType}"` }, 400);
    }

    const result = await runOpenEndedCalibrationForScope(admin, {
      scopeType, scopeId: body.scope_id ?? null,
      minSample: body.min_sample, dryRun: body.dry_run === true, runBy: user.id,
    });

    if (!result.ok) return json({ error: result.reason }, 404);
    return json(result);
  } catch (e) {
    console.error("calibrate-open-ended-items error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
