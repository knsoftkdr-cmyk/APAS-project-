// supabase/functions/calibrate-open-ended-items-cron/index.ts
//
// Deploy with:
//   supabase functions deploy calibrate-open-ended-items-cron --no-verify-jwt
//
// Reuses the SAME CRON_SECRET already set up for calibrate-irt-cron (see
// 20260923000000_schedule_irt_calibration.sql) - no new secret needed, just
// a new scheduled job pointing at this function (see the accompanying
// migration, 20261002000000_schedule_open_ended_calibration.sql).
//
// Runs runOpenEndedCalibrationForScope() once with scope "all" (bounded to
// MAX_ITEMS_PER_RUN inside the shared module, so one huge bank can't starve
// the rest of the school - it just gets finished across a few nights).
//
// Mirrors calibrate-irt-cron's shape: not staff-authenticated (no signed-in
// user at 2am), shared-secret header instead, and staff get a
// governance_notifications row when anything was actually adjusted.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runOpenEndedCalibrationForScope } from "../_shared/runOpenEndedCalibration.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

serve(async (req) => {
  try {
    const expected = Deno.env.get("CRON_SECRET");
    const given = req.headers.get("x-cron-secret");
    if (!expected || !given || given !== expected) {
      return json({ error: "Not authorized" }, 401);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const result = await runOpenEndedCalibrationForScope(admin, { scopeType: "all", dryRun: false, runBy: null });
    if (!result.ok) return json({ ran_at: new Date().toISOString(), skipped: result.reason });

    if (result.items_adjusted > 0) await notifyStaff(admin, result.items_adjusted, result.items_calibrated);

    return json({
      ran_at: new Date().toISOString(),
      items_scanned: result.items_scanned,
      items_calibrated: result.items_calibrated,
      items_adjusted: result.items_adjusted,
      items_low_sample: result.items_low_sample,
    });
  } catch (e) {
    console.error("calibrate-open-ended-items-cron error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function notifyStaff(admin: ReturnType<typeof createClient>, adjusted: number, calibrated: number) {
  const { data: staff } = await admin.from("profiles").select("id").in("role", ["admin", "teacher", "school_admin"]);
  if (!staff?.length) return;

  const message = `Last night's calibration reviewed ${calibrated} open-ended question${calibrated === 1 ? "" : "s"} against real student scores and corrected the difficulty label on ${adjusted} of them. Check the Item Bank page.`;

  const rows = (staff as Row[]).map((p) => ({
    user_id: p.id,
    event_type: "open_ended_calibration_adjusted",
    title: "Open-ended question difficulty updated",
    message,
    reference_type: "question_bank_extended",
  }));
  const { error } = await admin.from("governance_notifications").insert(rows);
  if (error) console.error("calibrate-open-ended-items-cron: failed to notify staff", error.message);
}
