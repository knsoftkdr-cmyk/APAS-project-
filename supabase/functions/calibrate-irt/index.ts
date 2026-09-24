// supabase/functions/calibrate-irt/index.ts
//
// Deploy with:
//   supabase functions deploy calibrate-irt
//
// Staff only, on demand. Re-estimates item difficulty (b) - and, once an
// item has enough data, discrimination (a) - from the accumulated response
// log, and flags items that look mis-keyed or badly behaved.
//
//   Body: {
//     scope_type?: "concept"|"topic"|"chapter"|"subject", scope_id?: number
//                                  omit both to calibrate the whole bank
//     dry_run?: boolean            report what WOULD change, write nothing
//     min_n_rasch?: number         default 30  - responses before b is estimated
//     min_n_2pl?: number           default 200 - responses before a is estimated too
//     auto_suspend?: boolean       default true - items flagged "review_key" are moved
//                                  back to "draft" so they stop being served until a
//                                  teacher re-checks the key and re-approves them
//   }
//
// The actual estimation lives in ../_shared/runCalibration.ts (which wraps
// the MML-EM fit in ../_shared/irt.ts), shared with calibrate-irt-cron so
// the nightly scheduled run and this on-demand endpoint can never drift
// apart. This file is just: authenticate the caller, validate the body,
// call it, translate the result to an HTTP response.
//
// SCALE NOTE: each run fixes the population prior at N(0,1) over the
// responses it sees, so θ and b are expressed relative to *this cohort of
// examinees*. It is a relative scale, not an absolute one. If you calibrate
// different classes/grades separately their scales are not comparable until
// the items are linked across cohorts.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runCalibrationForScope, SCOPE_TYPES, type ScopeType } from "../_shared/runCalibration.ts";

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
    if (!profile || !STAFF_ROLES.includes(profile.role)) return json({ error: "Not permitted to calibrate items" }, 403);

    const body = await req.json().catch(() => ({}));

    let scopeType: ScopeType | null = null;
    let scopeId: number | null = null;
    if (body.scope_type != null || body.scope_id != null) {
      scopeType = String(body.scope_type) as ScopeType;
      scopeId = Number(body.scope_id);
      if (!SCOPE_TYPES.includes(scopeType) || !Number.isFinite(scopeId)) {
        return json({ error: "scope_type (concept|topic|chapter|subject) and numeric scope_id must be given together" }, 400);
      }
    }

    const result = await runCalibrationForScope(admin, {
      scopeType, scopeId,
      dryRun: body.dry_run === true,
      autoSuspend: body.auto_suspend !== false,
      minRasch: Number(body.min_n_rasch ?? 30),
      min2pl: Number(body.min_n_2pl ?? 200),
      runBy: user.id,
    });

    if (!result.ok) {
      return json({ error: result.message }, result.reason === "too_many_responses" ? 413 : 404);
    }
    const { ok, ...payload } = result;
    return json(payload);
  } catch (e) {
    console.error("calibrate-irt error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});