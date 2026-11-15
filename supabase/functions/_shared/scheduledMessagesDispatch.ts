// supabase/functions/_shared/scheduledMessagesDispatch.ts
//
// Pure helpers for the scheduled-message push/email hand-off. No Deno, no Supabase, no I/O, so they can be unit
// tested from vitest (src/test/scheduledMessagesDispatch.test.ts) and reused by the cron handler.
//
// The payload mirrors what TeacherCommunicationCenter already sends to the existing `dispatch-message` function
// for a live message, so a scheduled message looks identical to the recipient's phone/email.

export interface DispatchClaim {
  scheduled_message_id: string;
  message_id: string;
  recipient_id: string;
  sender_id: string;
  audience_label: string | null;
  message: string | null;
  attachment_name: string | null;
  recipient_count: number;
}

export interface DispatchMessageBody {
  source_table: "teacher_messages";
  source_id: string;
  recipient_id: string;
  title: string;
  body: string;
}

const MAX_BODY = 500;

/** Same wording rules as the live send: direct = "New message from X", broadcast = "X sent a message to <audience>". */
export function buildDispatchBody(claim: DispatchClaim, senderName: string | null | undefined): DispatchMessageBody {
  const name = (senderName ?? "").trim() || "Your school";
  const text = (claim.message ?? "").trim();
  const attachment = (claim.attachment_name ?? "").trim();
  let body = text || (attachment ? `📎 ${attachment}` : "New message");
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 1)}…`;

  const isBroadcast = (claim.recipient_count ?? 0) > 1;
  const label = (claim.audience_label ?? "").trim();
  const title = isBroadcast
    ? `${name} sent a message${label ? ` to ${label}` : ""}`
    : `New message from ${name}`;

  return {
    source_table: "teacher_messages",
    source_id: claim.message_id,
    recipient_id: claim.recipient_id,
    title,
    body,
  };
}

/** Constant-time string comparison for the shared cron secret. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only when a secret is configured AND the caller presented exactly it. */
export function isAuthorizedCron(expected: string | null | undefined, given: string | null | undefined): boolean {
  if (!expected || !given) return false;
  return safeEqual(expected, given);
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. Never rejects: a worker that throws is reported in
 * `errors`, so one bad recipient cannot abandon the rest of an already-claimed batch.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<{ ok: number; errors: { item: T; error: unknown }[] }> {
  const errors: { item: T; error: unknown }[] = [];
  let ok = 0;
  let next = 0;
  const lanes = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try {
          await worker(items[i]);
          ok++;
        } catch (error) {
          errors.push({ item: items[i], error });
        }
      }
    }),
  );
  return { ok, errors };
}

/** Interprets dispatch-message's reply: it answers 200 {success:false} / 4xx-5xx on error. */
export function dispatchFailure(
  invokeError: { message?: string } | null | undefined,
  data: { success?: boolean; message?: string } | null | undefined,
): string | null {
  if (invokeError) return invokeError.message || "dispatch-message call failed";
  if (data && data.success === false) return data.message || "dispatch-message reported failure";
  return null;
}
