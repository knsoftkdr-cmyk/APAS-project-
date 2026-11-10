-- Communication Module: delivery + read tracking (Pending / Delivered / Read).
--
-- Reuses the existing public.teacher_messages table. That table already stores ONE ROW PER RECIPIENT
-- (a broadcast is N rows sharing a batch_id), so every recipient already has an independent record and no
-- new table is needed. This migration only ADDS columns, one trigger, two indexes and three functions.
-- Nothing is dropped or rewritten, existing RLS policies are untouched, and message history is preserved.
--
-- Status model
--   pending    the message exists but the recipient's APAS app has not confirmed receiving it
--   delivered  the recipient's own client fetched the row and confirmed it (ack_message_delivery)
--   read       the recipient opened it (the existing is_read = true update every Communication Center
--              page already performs)
--
-- delivery_status is a GENERATED column derived from is_read + delivered_at, so it can never disagree
-- with is_read and cannot be written by any client. A row is NOT "delivered" just because it was inserted,
-- and a push-provider (FCM) acceptance is NOT counted as delivery: FCM only confirms it accepted the
-- request, not that a device received it. Push attempts stay in notification_channel_log.
--
-- Safe to re-run (IF NOT EXISTS / CREATE OR REPLACE throughout).
--
-- BEFORE APPLYING: teacher_messages is not defined in any tracked migration of this repo, so the guard
-- below checks the columns this migration relies on and aborts with a clear message if they differ.

-- ── 0. Fail fast if the live table is not what the code assumes ───────────────────────────────────────
DO $$
DECLARE
  col text;
  expected text;
  actual text;
BEGIN
  IF to_regclass('public.teacher_messages') IS NULL THEN
    RAISE EXCEPTION 'public.teacher_messages does not exist; nothing to extend';
  END IF;

  FOR col, expected IN
    SELECT * FROM (VALUES
      ('id', 'uuid'), ('sender_id', 'uuid'), ('recipient_id', 'uuid'),
      ('is_read', 'boolean'), ('created_at', 'timestamp with time zone')
    ) AS t(c, ty)
  LOOP
    SELECT data_type INTO actual
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'teacher_messages' AND column_name = col;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'teacher_messages.% is % (expected %); review this migration before applying',
        col, COALESCE(actual, 'missing'), expected;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'teacher_messages' AND column_name = 'batch_id'
  ) THEN
    RAISE EXCEPTION 'teacher_messages.batch_id is missing (broadcast rows are grouped by it)';
  END IF;
END $$;

-- ── 1. Columns ────────────────────────────────────────────────────────────────────────────────────────
-- sent_at       when the row was created (the message was sent). NULL on history; readers fall back to created_at.
-- delivered_at  when the recipient's client confirmed receipt. NULL = not confirmed.
-- read_at       when the recipient opened it. NULL on history that was read before this migration.
ALTER TABLE public.teacher_messages
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;
-- Default added AFTER the column so existing rows stay NULL instead of all being stamped with the migration time.
ALTER TABLE public.teacher_messages ALTER COLUMN sent_at SET DEFAULT now();

-- Derived, never written. History that was already read becomes 'read' immediately (is_read = true);
-- history that was never read stays 'pending' until the recipient's app next confirms it.
ALTER TABLE public.teacher_messages
  ADD COLUMN IF NOT EXISTS delivery_status text GENERATED ALWAYS AS (
    CASE
      WHEN is_read THEN 'read'
      WHEN delivered_at IS NOT NULL THEN 'delivered'
      ELSE 'pending'
    END
  ) STORED;

-- ── 2. Indexes ────────────────────────────────────────────────────────────────────────────────────────
-- Sender-side reports: all rows of one sender, grouped by batch.
CREATE INDEX IF NOT EXISTS teacher_messages_sender_batch_idx
  ON public.teacher_messages (sender_id, batch_id);
-- Recipient-side catch-up: "which of my messages has my app not confirmed yet".
CREATE INDEX IF NOT EXISTS teacher_messages_recipient_undelivered_idx
  ON public.teacher_messages (recipient_id, created_at DESC) WHERE delivered_at IS NULL;

-- ── 3. Guard + auto-timestamp trigger ─────────────────────────────────────────────────────────────────
-- Clients keep doing exactly what they do today (INSERT a row, UPDATE is_read = true). The trigger:
--   * stamps sent_at on insert and refuses client-supplied delivered_at / read_at,
--   * on UPDATE freezes sent_at / delivered_at / read_at against direct client writes (only the
--     ack_message_delivery function below may set delivered_at),
--   * when is_read flips false -> true by the RECIPIENT, stamps read_at and (if never confirmed)
--     delivered_at, because a message that was opened has necessarily been delivered,
--   * ignores an is_read change made by anyone who is not the recipient, so a sender cannot forge "Read".
-- "Trusted" means no end-user in the session (auth.uid() IS NULL): service role, SQL editor, cron.
CREATE OR REPLACE FUNCTION public.teacher_messages_delivery_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_trusted boolean := auth.uid() IS NULL;
  v_via_ack boolean := COALESCE(current_setting('apas.delivery_ack', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.sent_at := now();
    IF NOT v_trusted THEN
      NEW.delivered_at := NULL;
      NEW.read_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT v_trusted AND NOT v_via_ack THEN
    NEW.sent_at := OLD.sent_at;
    NEW.delivered_at := OLD.delivered_at;
    NEW.read_at := OLD.read_at;
  END IF;

  IF NEW.is_read IS DISTINCT FROM OLD.is_read THEN
    IF v_trusted OR auth.uid() = NEW.recipient_id THEN
      IF NEW.is_read THEN
        NEW.read_at := COALESCE(OLD.read_at, now());
        NEW.delivered_at := COALESCE(NEW.delivered_at, OLD.delivered_at, now());
      ELSE
        NEW.read_at := NULL;
      END IF;
    ELSE
      NEW.is_read := OLD.is_read;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teacher_messages_delivery_guard_trg ON public.teacher_messages;
CREATE TRIGGER teacher_messages_delivery_guard_trg
  BEFORE INSERT OR UPDATE ON public.teacher_messages
  FOR EACH ROW EXECUTE FUNCTION public.teacher_messages_delivery_guard();

-- ── 4. Delivery confirmation (called by the RECIPIENT's own client) ───────────────────────────────────
-- Idempotent: only rows that belong to the caller and are not yet confirmed are touched, and an existing
-- delivered_at is never overwritten, so duplicate realtime events, retries and repeated catch-up polls are
-- harmless. Returns how many rows were newly confirmed.
CREATE OR REPLACE FUNCTION public.ack_message_delivery(p_message_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_message_ids IS NULL OR cardinality(p_message_ids) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('apas.delivery_ack', 'on', true);  -- transaction-local; lets the guard allow delivered_at

  UPDATE public.teacher_messages
     SET delivered_at = now()
   WHERE id = ANY (p_message_ids[1:1000])
     AND recipient_id = auth.uid()
     AND delivered_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

-- ── 5. Sender-side reports ────────────────────────────────────────────────────────────────────────────
-- Report key: batch_id for a broadcast, the message id for a direct message. Only the SENDER of a message
-- can see its report (sender_id = auth.uid()); recipients never see other recipients' status. SECURITY
-- DEFINER with that explicit check, so the result does not depend on how teacher_messages RLS is written.
CREATE OR REPLACE FUNCTION public.get_message_delivery_summaries(p_keys text[])
RETURNS TABLE (
  report_key text,
  total_recipients bigint,
  pending_count bigint,
  delivered_count bigint,
  read_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(m.batch_id::text, m.id::text) AS report_key,
         count(*)                                              AS total_recipients,
         count(*) FILTER (WHERE m.delivery_status = 'pending')   AS pending_count,
         count(*) FILTER (WHERE m.delivery_status = 'delivered') AS delivered_count,
         count(*) FILTER (WHERE m.delivery_status = 'read')      AS read_count
    FROM public.teacher_messages m
   WHERE auth.uid() IS NOT NULL
     AND m.sender_id = auth.uid()
     AND COALESCE(m.batch_id::text, m.id::text) = ANY (p_keys[1:200])
   GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.get_message_delivery_report(p_key text)
RETURNS TABLE (
  message_id uuid,
  recipient_id uuid,
  recipient_role text,
  delivery_status text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.recipient_id, m.recipient_role, m.delivery_status,
         COALESCE(m.sent_at, m.created_at), m.delivered_at, m.read_at, m.created_at
    FROM public.teacher_messages m
   WHERE auth.uid() IS NOT NULL
     AND m.sender_id = auth.uid()
     AND COALESCE(m.batch_id::text, m.id::text) = p_key
   ORDER BY m.created_at, m.id
   LIMIT 5000;
$$;

REVOKE ALL ON FUNCTION public.ack_message_delivery(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_message_delivery_summaries(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_message_delivery_report(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_message_delivery(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_message_delivery_summaries(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_message_delivery_report(text) TO authenticated;

-- ── 6. Realtime ───────────────────────────────────────────────────────────────────────────────────────
-- The sender's report listens for UPDATEs on their own rows so Pending -> Delivered -> Read appears without
-- a refresh. Only added if the table is not already published (the INSERT listener in NotificationContext
-- suggests it usually is). The client also polls, so the report still converges if realtime is off.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'teacher_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.teacher_messages;
  END IF;
END $$;
