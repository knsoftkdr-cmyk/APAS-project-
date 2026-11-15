/**
 * useScheduledMessages.ts
 * Client side of Communication Module "Scheduled Messages".
 *
 * Reads go straight to public.scheduled_messages (RLS: the sender, plus admin / principal / school_admin of the same
 * school). Every write goes through the SECURITY DEFINER RPCs schedule_message / update_scheduled_message /
 * cancel_scheduled_message, which enforce permissions, recipient scope and "only while scheduled" on the server.
 * The list refreshes on realtime changes and by polling, so Scheduled -> Sent appears without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  friendlyError, isMissingBackend, normalizeRecipients, normalizeStatus,
  type RecipientRef, type ScheduledMessage,
} from "@/lib/scheduledMessagesModel";

const db = supabase as any; // the scheduled_* tables/functions are not in the generated types
const POLL_MS = 30_000;

export interface ScheduleInput {
  message: string;
  scheduledFor: Date;
  recipients: { id: string; role: string }[];
  messageType?: string;
  attachment?: { url: string; name: string } | null;
  audienceLabel?: string | null;
}

export interface UpdateInput {
  message?: string;
  scheduledFor?: Date;
  recipients?: { id: string; role: string }[];
  clearAttachment?: boolean;
  attachment?: { url: string; name: string } | null;
  audienceLabel?: string | null;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const toRow = (r: any): ScheduledMessage => ({ ...r, status: normalizeStatus(r.status), recipient_count: Number(r.recipient_count) || 0 });

export function useScheduledMessages(userId: string | undefined) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [senderNames, setSenderNames] = useState<Map<string, string>>(new Map());
  const [singleMessageIds, setSingleMessageIds] = useState<Map<string, string>>(new Map());
  const seq = useRef(0);
  const availableRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!userId || !availableRef.current) { setLoading(false); return; }
    const mine = ++seq.current;
    const { data, error: err } = await db
      .from("scheduled_messages")
      .select("*")
      .order("scheduled_for", { ascending: true })
      .limit(500);
    if (mine !== seq.current) return; // a newer request superseded this one
    if (err) {
      if (isMissingBackend(err)) { availableRef.current = false; setAvailable(false); }
      else setError(friendlyError(err));
      setLoading(false);
      return;
    }
    const rows = ((data || []) as any[]).map(toRow);
    setItems(rows);
    setError(null);
    setLoading(false);

    // Names of other people's messages (a school admin sees their school's).
    const unknown = [...new Set(rows.filter((r) => r.sender_id !== userId).map((r) => r.sender_id))];
    if (unknown.length > 0) {
      const { data: people } = await db.from("profiles").select("id, full_name").in("id", unknown);
      if (mine === seq.current && people) {
        setSenderNames(new Map((people as any[]).map((p) => [p.id, p.full_name || "Unknown"])));
      }
    }

    // A sent single-recipient message's delivery report is keyed by its teacher_messages row id.
    const singles = rows.filter((r) => r.status === "sent" && r.recipient_count === 1).map((r) => r.id);
    if (singles.length > 0) {
      const { data: recs } = await db
        .from("scheduled_message_recipients")
        .select("scheduled_message_id, message_id")
        .in("scheduled_message_id", singles);
      if (mine === seq.current && recs) {
        setSingleMessageIds(new Map((recs as any[]).filter((r) => r.message_id).map((r) => [r.scheduled_message_id, r.message_id])));
      }
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    const ch = supabase
      .channel(`scheduled_messages_${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_messages" }, () => void refresh())
      .subscribe();
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [userId, refresh]);

  const run = useCallback(async (fn: () => Promise<{ error: any }>): Promise<ActionResult> => {
    try {
      const { error: err } = await fn();
      if (err) return { ok: false, error: friendlyError(err) };
      await refresh();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: friendlyError(e) };
    }
  }, [refresh]);

  const schedule = useCallback((input: ScheduleInput) => run(() => db.rpc("schedule_message", {
    p_message: input.message,
    p_scheduled_for: input.scheduledFor.toISOString(),
    p_recipients: normalizeRecipients(input.recipients),
    p_message_type: input.messageType ?? "general",
    p_attachment_url: input.attachment?.url ?? null,
    p_attachment_name: input.attachment?.name ?? null,
    p_audience_label: input.audienceLabel ?? null,
  })), [run]);

  const update = useCallback((id: string, input: UpdateInput) => run(() => db.rpc("update_scheduled_message", {
    p_id: id,
    p_message: input.message ?? null,
    p_scheduled_for: input.scheduledFor ? input.scheduledFor.toISOString() : null,
    p_recipients: input.recipients ? normalizeRecipients(input.recipients) : null,
    p_clear_attachment: !!input.clearAttachment,
    p_attachment_url: input.attachment?.url ?? null,
    p_attachment_name: input.attachment?.name ?? null,
    p_audience_label: input.audienceLabel ?? null,
  })), [run]);

  const cancel = useCallback((id: string) => run(() => db.rpc("cancel_scheduled_message", { p_id: id })), [run]);

  /** Recipients of one message, for the edit dialog. */
  const fetchRecipients = useCallback(async (id: string): Promise<RecipientRef[]> => {
    const { data, error: err } = await db
      .from("scheduled_message_recipients")
      .select("recipient_id, recipient_role")
      .eq("scheduled_message_id", id);
    if (err) throw err;
    return ((data || []) as any[]).map((r) => ({ id: r.recipient_id, role: r.recipient_role }));
  }, []);

  const pendingCount = useMemo(() => items.filter((m) => m.status === "scheduled").length, [items]);

  return { items, loading, available, error, pendingCount, senderNames, singleMessageIds, refresh, schedule, update, cancel, fetchRecipients };
}

export type ScheduledMessagesApi = ReturnType<typeof useScheduledMessages>;
