/**
 * useMessageDelivery.ts
 * Client side of Communication Module delivery + read tracking.
 *
 * Recipient side  : ackMessageDeliveries / ackPendingDeliveries - called by the recipient's own app AFTER it has
 *                   actually received the rows (realtime INSERT or a catch-up fetch). That confirmation is what
 *                   moves a message from Pending to Delivered. Read is set by the existing is_read update.
 * Sender side     : useSentMessageDelivery - per-message summaries and the recipient-wise report, kept fresh by a
 *                   realtime UPDATE listener with a polling fallback.
 *
 * Every call is failure-tolerant: if the migration is not applied yet, or the network drops, messaging itself is
 * untouched and the message simply stays Pending until the next attempt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  chunkIds, summaryFromRpc, normalizeStatus,
  type DeliveryRow, type DeliverySummary,
} from "@/lib/messageDeliveryModel";

const db = supabase as any; // the delivery columns/functions are not in the generated types

/** Confirm to the server that THIS user's client received these message rows. Idempotent. */
export async function ackMessageDeliveries(ids: string[]): Promise<number> {
  let confirmed = 0;
  for (const chunk of chunkIds(ids)) {
    try {
      const { data, error } = await db.rpc("ack_message_delivery", { p_message_ids: chunk });
      if (!error && typeof data === "number") confirmed += data;
    } catch {
      /* stays Pending, retried by the next catch-up */
    }
  }
  return confirmed;
}

/**
 * Catch-up for messages that arrived while this user was offline or the app was closed: fetch the rows the
 * server has not yet seen confirmed, then confirm exactly those. Fetching first is what proves receipt.
 */
export async function ackPendingDeliveries(userId: string): Promise<number> {
  try {
    const { data, error } = await db
      .from("teacher_messages")
      .select("id")
      .eq("recipient_id", userId)
      .is("delivered_at", null)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data || data.length === 0) return 0;
    return await ackMessageDeliveries((data as { id: string }[]).map((r) => r.id));
  } catch {
    return 0;
  }
}

const SUMMARY_POLL_MS = 20_000;
const REPORT_POLL_MS = 8_000;
const MAX_KEYS = 200;

const isMissingFunction = (e: any) =>
  !!e && (e.code === "42883" || e.code === "PGRST202" || /could not find the function/i.test(e.message || ""));

export interface SentMessageDelivery {
  /** Per report key (batch_id or message id) summaries for the keys passed in. */
  summaries: Map<string, DeliverySummary>;
  /** False once the server reports the tracking functions are not installed. */
  available: boolean;
  /** Recipient-wise rows for `openKey`. */
  report: DeliveryRow[];
  reportLoading: boolean;
  reportError: string | null;
  refresh: () => void;
}

export function useSentMessageDelivery(
  userId: string | undefined,
  keys: string[],
  openKey: string | null,
): SentMessageDelivery {
  const [summaries, setSummaries] = useState<Map<string, DeliverySummary>>(new Map());
  const [available, setAvailable] = useState(true);
  const [report, setReport] = useState<DeliveryRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const keysSig = useMemo(() => Array.from(new Set(keys.filter(Boolean))).slice(0, MAX_KEYS).join("|"), [keys]);
  const keysRef = useRef<string[]>([]);
  keysRef.current = keysSig ? keysSig.split("|") : [];
  const openKeyRef = useRef<string | null>(null);
  openKeyRef.current = openKey;
  const availableRef = useRef(true);
  const summarySeq = useRef(0);
  const reportSeq = useRef(0);
  const instance = useRef(Math.random().toString(36).slice(2));

  const loadSummaries = useCallback(async () => {
    if (!userId || !availableRef.current || keysRef.current.length === 0) return;
    const seq = ++summarySeq.current;
    const { data, error } = await db.rpc("get_message_delivery_summaries", { p_keys: keysRef.current });
    if (seq !== summarySeq.current) return; // a newer request superseded this one
    if (error) {
      if (isMissingFunction(error)) {
        availableRef.current = false;
        setAvailable(false);
      }
      return;
    }
    const next = new Map<string, DeliverySummary>();
    for (const r of (data || []) as any[]) next.set(String(r.report_key), summaryFromRpc(r));
    setSummaries(next);
  }, [userId]);

  const loadReport = useCallback(async (quiet = false) => {
    const key = openKeyRef.current;
    if (!userId || !key || !availableRef.current) return;
    const seq = ++reportSeq.current;
    if (!quiet) setReportLoading(true);
    const { data, error } = await db.rpc("get_message_delivery_report", { p_key: key });
    if (seq !== reportSeq.current) return;
    setReportLoading(false);
    if (error) {
      if (isMissingFunction(error)) {
        availableRef.current = false;
        setAvailable(false);
      }
      setReportError(error.message || "Could not load the delivery report");
      return;
    }
    setReportError(null);
    setReport(
      ((data || []) as any[]).map((r) => ({
        message_id: r.message_id,
        recipient_id: r.recipient_id,
        recipient_role: r.recipient_role ?? null,
        delivery_status: normalizeStatus(r.delivery_status),
        sent_at: r.sent_at ?? null,
        delivered_at: r.delivered_at ?? null,
        read_at: r.read_at ?? null,
        created_at: r.created_at ?? null,
      })),
    );
  }, [userId]);

  const refresh = useCallback(() => {
    void loadSummaries();
    void loadReport(true);
  }, [loadSummaries, loadReport]);

  // Initial / key-change load
  useEffect(() => { void loadSummaries(); }, [loadSummaries, keysSig]);
  useEffect(() => {
    if (!openKey) { setReport([]); setReportError(null); return; }
    setReport([]);
    void loadReport(false);
  }, [openKey, loadReport]);

  // Realtime: the recipient's ack / read UPDATEs this sender's rows. Debounced so a 100-row broadcast
  // being confirmed does not trigger 100 refetches.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 600);
    };
    const ch = supabase
      .channel(`delivery_updates_${userId}_${instance.current}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "teacher_messages", filter: `sender_id=eq.${userId}` },
        schedule,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [userId, refresh]);

  // Polling fallback (realtime may be off for the table, or the socket may have dropped)
  useEffect(() => {
    if (!userId) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const s = setInterval(() => { if (visible()) void loadSummaries(); }, SUMMARY_POLL_MS);
    const r = setInterval(() => { if (visible() && openKeyRef.current) void loadReport(true); }, REPORT_POLL_MS);
    return () => { clearInterval(s); clearInterval(r); };
  }, [userId, loadSummaries, loadReport]);

  return { summaries, available, report, reportLoading, reportError, refresh };
}
