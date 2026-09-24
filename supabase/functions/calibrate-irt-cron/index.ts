// supabase/functions/calibrate-irt-cron/index.ts
//
// Deploy with:
//   supabase functions deploy calibrate-irt-cron --no-verify-jwt
//
// Also required (see the accompanying migration, 20260923000000_schedule_irt_calibration.sql):
//   supabase secrets set CRON_SECRET=<a long random value>
// and the SAME value set as `app.settings.cron_secret` on the database (the
// migration explains exactly how, since it can't set a real secret for you).
//
// Not staff-authenticated - there's no signed-in user at 2am. Instead this
// checks a shared secret header that only pg_cron (via pg_net) is expected
// to know, so it must be deployed with --no-verify-jwt (Supabase's normal
// per-request JWT check would otherwise reject pg_net's service call before
// this code even runs).
//
// Runs runCalibrationForScope() - the exact same estimator calibrate-irt
// uses - once per subject that has any answered items, so one huge subject
// can't crowd out or blow the response-count cap for the rest of the school.
// A subject calibration failing (e.g. hitting the 250k-response cap) is
// logged and skipped rather than aborting the whole run.
//
// If anything gets auto-suspended (looks mis-keyed) or flagged in another
// way, every admin and teacher gets a governance_notifications row so it
// doesn't sit unnoticed until someone happens to open the Item Bank page.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runCalibrationForScope } from "../_shared/runCalibration.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

serve(async (req) => {
  try {
    const expected = Deno.env.get("CRON_SECRET");
    const given = req.headers.get("x-cron-secret");
    if (!expected || !given || given !== expected) {
      // Deliberately identical response whether the secret is merely wrong
      // or not configured at all, so a probing request can't tell which.
      return json({ error: "Not authorized" }, 401);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: books, error: booksErr } = await admin.from("books").select("id, subject, class_name").eq("is_active", true);
    if (booksErr) throw new Error(booksErr.message);

    const perSubject: Row[] = [];
    let totalFlagged = 0;
    let totalNewlyFlagged = 0;
    let totalSuspended = 0;
    let totalCalibrated = 0;

    for (const book of books ?? []) {
      try {
        const result = await runCalibrationForScope(admin, {
          scopeType: "subject", scopeId: book.id, dryRun: false, autoSuspend: true, runBy: null,
        });
        if (!result.ok) {
          perSubject.push({ book_id: book.id, subject: book.subject, skipped: result.reason });
          continue;
        }
        totalFlagged += result.flagged_count;
        totalNewlyFlagged += result.newly_flagged_count;
        totalSuspended += result.auto_suspended_count;
        totalCalibrated += result.items_calibrated;
        perSubject.push({
          book_id: book.id, subject: book.subject, items_calibrated: result.items_calibrated,
          flagged_count: result.flagged_count, newly_flagged_count: result.newly_flagged_count,
          auto_suspended_count: result.auto_suspended_count, converged: result.converged,
        });
      } catch (e) {
        // One subject's failure (e.g. a transient DB error) shouldn't take down the rest of the night's run.
        perSubject.push({ book_id: book.id, subject: book.subject, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Notify on what's NEW, not the running total - an item that was flagged
    // last night and still hasn't been reviewed shouldn't re-page every staff
    // member again tonight and every night after. It stays visible on the
    // Item Bank page in the meantime regardless.
    if (totalNewlyFlagged > 0) {
      await notifyStaff(admin, perSubject.filter((s) => (s.newly_flagged_count ?? 0) > 0), totalNewlyFlagged, totalSuspended);
    }

    return json({
      ran_at: new Date().toISOString(),
      subjects_considered: (books ?? []).length,
      items_calibrated: totalCalibrated,
      flagged_count: totalFlagged,
      newly_flagged_count: totalNewlyFlagged,
      auto_suspended_count: totalSuspended,
      per_subject: perSubject,
    });
  } catch (e) {
    console.error("calibrate-irt-cron error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function notifyStaff(admin: ReturnType<typeof createClient>, flaggedSubjects: Row[], newlyFlagged: number, totalSuspended: number) {
  const { data: staff } = await admin.from("profiles").select("id").in("role", ["admin", "teacher", "school_admin"]);
  if (!staff?.length) return;

  const subjectList = flaggedSubjects.map((s) => s.subject).join(", ");
  const message = totalSuspended > 0
    ? `Last night's calibration flagged ${newlyFlagged} new question${newlyFlagged === 1 ? "" : "s"} across ${subjectList} and automatically pulled ${totalSuspended} likely mis-keyed question${totalSuspended === 1 ? "" : "s"} out of use. Review them on the Item Bank page.`
    : `Last night's calibration flagged ${newlyFlagged} new question${newlyFlagged === 1 ? "" : "s"} across ${subjectList} for review. Check the Item Bank page.`;

  const rows = staff.map((p: Row) => ({
    user_id: p.id,
    event_type: "irt_calibration_flagged",
    title: "Adaptive test questions need review",
    message,
    reference_type: "question_bank",
  }));
  // Best-effort: a notification failure shouldn't fail the whole cron run, which has already
  // written the calibration results either way.
  const { error } = await admin.from("governance_notifications").insert(rows);
  if (error) console.error("calibrate-irt-cron: failed to notify staff", error.message);
}