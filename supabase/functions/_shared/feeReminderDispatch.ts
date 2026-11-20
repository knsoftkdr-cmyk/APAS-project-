// supabase/functions/_shared/feeReminderDispatch.ts
//
// Push + email for automatic fee / instalment reminders (migration 20261118000000_fee_reminders.sql).
// Runs inside the every-minute scheduled-messages worker (handlers/scheduledMessagesCron.ts), so no new edge function
// or cron job is needed.
//   - Reminders for a parent ACCOUNT go to the existing `dispatch-message` function (push + email, respecting that
//     parent's notification_preferences, logged in notification_channel_log).
//   - Reminders for a parent with NO account (students.parent_email) are emailed directly.
// A claimed reminder is never retried, so a parent can never get the same reminder twice; failures are recorded on
// the outbox row (fee_reminder_outbox.dispatch_error).

import { sendEmail } from "./email.ts";
import { dispatchFailure, runPool } from "./scheduledMessagesDispatch.ts";

interface FeeReminderClaim {
  id: string;
  source_table: string;
  source_id: string;
  recipient_id: string | null;
  email: string | null;
  title: string;
  body: string;
}

const BATCH = 50;
const CONCURRENCY = 6;

/** Email text for a parent without an app account (adds where to pay, when APP_URL is configured). */
function emailBody(body: string): string {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const pay = appUrl ? `\n\nYou can pay online here: ${appUrl}/parent/fee-payment` : "\n\nPlease pay at the school fee counter or online through the school app.";
  return `Dear Parent,\n\n${body}${pay}\n\nIf you have already paid, please ignore this message.\n\nThank you.`;
}

// deno-lint-ignore no-explicit-any
export async function dispatchFeeReminders(admin: any, deadline: number): Promise<{ claimed: number; dispatched: number; failed: number }> {
  let claimed = 0;
  let dispatched = 0;
  let failed = 0;

  while (Date.now() < deadline) {
    const { data, error } = await admin.rpc("claim_fee_reminder_dispatches", { p_limit: BATCH });
    if (error) {
      // Missing migration or outside sending hours -> nothing to do this minute.
      console.error("claim_fee_reminder_dispatches failed", error.message ?? error);
      break;
    }
    const batch = (data ?? []) as FeeReminderClaim[];
    if (batch.length === 0) break;
    claimed += batch.length;

    const result = await runPool(batch, CONCURRENCY, async (c) => {
      if (c.recipient_id) {
        const { data: res, error: invokeError } = await admin.functions.invoke("dispatch-message", {
          body: { source_table: "fee_reminder_outbox", source_id: c.id, recipient_id: c.recipient_id, title: c.title, body: c.body },
        });
        const problem = dispatchFailure(invokeError, res as { success?: boolean; message?: string } | null);
        if (problem) throw new Error(problem);
        // dispatch-message reports success even when a channel was skipped (no device / no email / turned off) or
        // failed (SMTP), so keep the per-channel outcome on the outbox row where staff can see it.
        const results = (res as { results?: Record<string, { status: string; error?: string }>; message?: string } | null)?.results;
        const summary = results
          ? Object.entries(results).map(([ch, r]) => `${ch}: ${r.status}${r.error ? ` (${r.error})` : ""}`).join("; ")
          : (res as { message?: string } | null)?.message ?? "";
        if (summary) await admin.rpc("record_fee_reminder_dispatch_error", { p_id: c.id, p_error: summary });
      } else if (c.email) {
        await sendEmail({ to: c.email, subject: c.title, body: emailBody(c.body) });
      }
    });

    dispatched += result.ok;
    failed += result.errors.length;
    for (const e of result.errors) {
      await admin.rpc("record_fee_reminder_dispatch_error", {
        p_id: (e.item as FeeReminderClaim).id,
        p_error: e.error instanceof Error ? e.error.message : String(e.error),
      });
    }
    if (batch.length < BATCH) break;
  }

  return { claimed, dispatched, failed };
}
