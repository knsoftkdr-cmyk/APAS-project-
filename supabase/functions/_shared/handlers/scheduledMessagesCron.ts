// supabase/functions/_shared/handlers/scheduledMessagesCron.ts
//
// Scheduled Messages worker (hand-off half). Routed through the already-deployed `calibrate-irt-cron` function with
// body {"job":"scheduled_messages"}, so NO new edge function exists (see supabase/functions/CONSOLIDATION.md).
// Same shared secret as the nightly calibration jobs: header x-cron-secret must equal the CRON_SECRET function secret.
//
// What it does each minute (invoked by pg_cron through pg_net, see 20261111000000_scheduled_messages.sql):
//   1. public.process_due_scheduled_messages()  - delivers every due message into teacher_messages. This is the
//      SAME function pg_cron also runs directly, so calling it here too is harmless: rows are claimed with
//      FOR UPDATE SKIP LOCKED and the insert + status flip is one transaction (exactly once).
//   2. public.claim_scheduled_dispatches()      - atomically claims recipients that were not yet handed to push/email.
//      The claim is the stamp, so a retried or overlapping invocation can never hand the same recipient out twice.
//   3. For each claimed recipient it calls the EXISTING `dispatch-message` function (push + email, respecting each
//      recipient's notification_preferences, logging to notification_channel_log).
//
//   4. Automatic fee / instalment reminders (20261118000000_fee_reminders.sql): queued reminders are handed to push +
//      email the same way (see ../feeReminderDispatch.ts).
//
// The in-app notification does not go through here at all: the recipient's NotificationContext already reacts to the
// teacher_messages INSERT in real time, and its catch-up poll covers anyone who was offline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDispatchBody,
  dispatchFailure,
  isAuthorizedCron,
  runPool,
  type DispatchClaim,
} from "../scheduledMessagesDispatch.ts";
import { dispatchFeeReminders } from "../feeReminderDispatch.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BATCH = 50;               // recipients claimed at a time (a claimed batch is always finished)
const CONCURRENCY = 8;          // parallel dispatch-message calls
const BUDGET_MS = 40_000;       // stop CLAIMING new batches after this; cron timeout is 55s
const FEE_BUDGET_MS = 48_000;   // fee reminders may claim until this point (from the start of the run)

export async function handleScheduledMessagesCron(req: Request): Promise<Response> {
  try {
    const expected = Deno.env.get("CRON_SECRET");
    const given = req.headers.get("x-cron-secret");
    if (!isAuthorizedCron(expected, given)) {
      // Identical response whether the secret is wrong or not configured, so a probe learns nothing.
      return json({ error: "Not authorized" }, 401);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const startedAt = Date.now();

    // 1. Deliver anything due (idempotent; usually pg_cron already did it this minute).
    const { data: processed, error: processError } = await admin.rpc("process_due_scheduled_messages", { p_limit: 100 });
    if (processError) console.error("process_due_scheduled_messages failed", processError);

    // 2 + 3. Hand newly delivered messages to push/email, at most once per recipient.
    let claimed = 0;
    let dispatched = 0;
    let failed = 0;
    const nameCache = new Map<string, string>();

    while (Date.now() - startedAt < BUDGET_MS) {
      const { data: claims, error: claimError } = await admin.rpc("claim_scheduled_dispatches", { p_limit: BATCH });
      if (claimError) {
        console.error("claim_scheduled_dispatches failed", claimError);
        break;
      }
      const batch = (claims ?? []) as DispatchClaim[];
      if (batch.length === 0) break;
      claimed += batch.length;

      const unknown = [...new Set(batch.map((c) => c.sender_id))].filter((id) => !nameCache.has(id));
      if (unknown.length > 0) {
        const { data: people } = await admin.from("profiles").select("id, full_name").in("id", unknown);
        for (const p of (people ?? []) as { id: string; full_name: string | null }[]) nameCache.set(p.id, p.full_name ?? "");
        for (const id of unknown) if (!nameCache.has(id)) nameCache.set(id, "");
      }

      const result = await runPool(batch, CONCURRENCY, async (claim) => {
        const body = buildDispatchBody(claim, nameCache.get(claim.sender_id));
        const { data, error } = await admin.functions.invoke("dispatch-message", { body });
        const problem = dispatchFailure(error, data as { success?: boolean; message?: string } | null);
        if (problem) throw new Error(problem);
      });

      dispatched += result.ok;
      failed += result.errors.length;
      // A failed hand-off is recorded but NOT retried: the claim is final, so a retry can never double-send.
      for (const e of result.errors) {
        const claim = e.item as DispatchClaim;
        await admin.rpc("record_scheduled_dispatch_error", {
          p_message_id: claim.message_id,
          p_error: e.error instanceof Error ? e.error.message : String(e.error),
        });
      }

      if (batch.length < BATCH) break;
    }

    // 4. Fee reminders: push + email (own try, so a problem here never affects scheduled messages).
    let feeReminders: { claimed: number; dispatched: number; failed: number } | null = null;
    try {
      feeReminders = await dispatchFeeReminders(admin, startedAt + FEE_BUDGET_MS);
    } catch (e) {
      console.error("fee reminder dispatch failed", e);
    }

    return json({
      ran_at: new Date().toISOString(),
      processed: processed ?? [],
      claimed,
      dispatched,
      failed,
      fee_reminders: feeReminders,
    });
  } catch (error) {
    console.error("scheduled messages cron failed", error);
    return json({ error: "Internal error" }, 500);
  }
}
