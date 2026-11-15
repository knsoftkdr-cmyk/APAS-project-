-- Communication Module: Scheduled Messages.
--
-- A user composes a message in the existing Communication Center, picks recipients and a future date/time, and
-- the message is delivered automatically at that time THROUGH THE EXISTING MESSAGING PIPELINE:
--
--   scheduled_messages (+ scheduled_message_recipients)
--        │  due and still 'scheduled'
--        ▼
--   process_due_scheduled_messages()  ── inserts ordinary rows into public.teacher_messages
--        │                               (one per recipient, exactly like a live send)
--        ├── the delivery-tracking trigger/columns from 20261105 apply unchanged (Pending → Delivered → Read)
--        ├── NotificationContext's existing realtime INSERT listener raises the in-app bell for the recipient
--        └── claim_scheduled_dispatches() hands each recipient to the existing dispatch-message edge function
--            (push + email) exactly once
--
-- Nothing existing is dropped or rewritten. teacher_messages only gains ONE nullable column
-- (scheduled_message_id) and one partial unique index. Safe to re-run.
--
-- ── Exactly-once guarantees (why a retrying background job cannot double-send) ───────────────────────
--  1. process_due_scheduled_messages() claims each due row with SELECT ... FOR UPDATE SKIP LOCKED. Two workers
--     (pg_cron + the edge function, an overlapping run, a retry) can never process the same message at once.
--  2. Inserting the teacher_messages rows and flipping status 'scheduled' -> 'sent' happen in ONE transaction
--     (a savepoint per message). If anything fails, the rows AND the status roll back together, so the next
--     run starts clean; if it succeeded, the status is 'sent' and every later run skips the message.
--  3. Belt and braces: the teacher_messages id is DETERMINISTIC per (scheduled message, recipient) and a partial
--     unique index on (scheduled_message_id, recipient_id) makes a duplicate row physically impossible.
--  4. Push/email: claim_scheduled_dispatches() atomically stamps dispatched_at before anything is sent, so each
--     recipient is handed to dispatch-message at most once, even if the edge function is retried or runs twice.
--     (A failed push is recorded in dispatch_error and NOT retried: push is a best-effort echo of the in-app
--     message, which is the source of truth. This trades a possible missed push for never sending twice.)
--  5. cancel / edit lock the same row, so a cancel racing the worker either wins (nothing is sent) or loses
--     cleanly ("already sent"); an edit can never change a message that is already out.
--
-- BEFORE APPLYING: teacher_messages is not defined in any tracked migration of this repo, so the guard below
-- checks what this migration relies on and aborts with a clear message if the live table differs.

-- ── 0. Fail fast if the live schema is not what the code assumes ─────────────────────────────────────
DO $$
DECLARE
  col text;
BEGIN
  IF to_regclass('public.teacher_messages') IS NULL THEN
    RAISE EXCEPTION 'public.teacher_messages does not exist; nothing to extend';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'public.profiles does not exist';
  END IF;

  FOREACH col IN ARRAY ARRAY['id','school_id','sender_id','recipient_id','recipient_role','message','message_type',
                             'attachment_url','attachment_name','batch_id','broadcast_label','is_read','created_at']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'teacher_messages' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'teacher_messages.% is missing; review this migration before applying', col;
    END IF;
  END LOOP;

  FOREACH col IN ARRAY ARRAY['id','role','school_id','full_name']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'profiles.% is missing; review this migration before applying', col;
    END IF;
  END LOOP;
END $$;

-- ── 1. Tables ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL,
  sender_id        uuid NOT NULL,
  sender_role      text NOT NULL,
  message          text NOT NULL CHECK (length(btrim(message)) > 0 AND length(message) <= 4000),
  message_type     text NOT NULL DEFAULT 'general',
  attachment_url   text,
  attachment_name  text,
  -- Shown as teacher_messages.broadcast_label when it reaches more than one person ("All Parents", "Class 5 - A", ...).
  audience_label   text,
  scheduled_for    timestamptz NOT NULL,
  -- scheduled -> sent | cancelled | failed. 'sent' and 'cancelled' and 'failed' are terminal.
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'cancelled', 'failed')),
  -- teacher_messages.batch_id used when the message has more than one recipient (a broadcast).
  batch_id         uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_count  integer NOT NULL DEFAULT 0,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scheduled_message_recipients (
  scheduled_message_id uuid NOT NULL REFERENCES public.scheduled_messages(id) ON DELETE CASCADE,
  recipient_id         uuid NOT NULL,
  recipient_role       text NOT NULL,
  -- The teacher_messages row created at delivery time (deterministic, see message_id_for()).
  message_id           uuid,
  -- Stamped atomically BEFORE push/email is attempted; NULL = not yet handed to dispatch-message.
  dispatched_at        timestamptz,
  dispatch_error       text,
  PRIMARY KEY (scheduled_message_id, recipient_id)
);

-- The worker's "what is due" scan, and the sender's "my scheduled messages" list.
CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON public.scheduled_messages (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS scheduled_messages_sender_idx
  ON public.scheduled_messages (sender_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS scheduled_messages_school_idx
  ON public.scheduled_messages (school_id, scheduled_for DESC);
-- Push hand-off scan.
CREATE INDEX IF NOT EXISTS scheduled_message_recipients_undispatched_idx
  ON public.scheduled_message_recipients (scheduled_message_id) WHERE dispatched_at IS NULL AND message_id IS NOT NULL;

-- ── 2. teacher_messages: link back to the schedule + hard duplicate guard ───────────────────────────
ALTER TABLE public.teacher_messages ADD COLUMN IF NOT EXISTS scheduled_message_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS teacher_messages_scheduled_once_idx
  ON public.teacher_messages (scheduled_message_id, recipient_id)
  WHERE scheduled_message_id IS NOT NULL;

-- ── 3. Helpers ───────────────────────────────────────────────────────────────────────────────────────
-- Deterministic id of the teacher_messages row for (scheduled message, recipient): the same inputs always give
-- the same id, so a retry can only ever collide with itself (ON CONFLICT DO NOTHING), never add a second row.
CREATE OR REPLACE FUNCTION public.scheduled_message_row_id(p_scheduled uuid, p_recipient uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5('scheduled-message:' || p_scheduled::text || ':' || p_recipient::text)::uuid;
$$;

-- Roles allowed to schedule messages (the roles that already have a composer in the Communication Center).
CREATE OR REPLACE FUNCTION public.scheduled_message_sender_roles()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['teacher', 'admin', 'principal', 'hod', 'school_admin']::text[];
$$;

-- Roles that may VIEW and CANCEL any scheduled message of their own school (moderation). Editing stays with the sender.
CREATE OR REPLACE FUNCTION public.can_manage_school_scheduled_messages(p_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.school_id IS NOT NULL
       AND p.school_id = p_school
       AND p.role IN ('admin', 'principal', 'school_admin')
  );
$$;

-- Validates a recipient list for a sender and returns the de-duplicated rows to store. Raises a readable error on
-- the first problem. SECURITY DEFINER so the checks do not depend on the caller's RLS visibility of other profiles.
--   admin / principal / hod / school_admin -> teacher, parent, student, driver of THEIR OWN school
--   teacher                                -> students of their own classes, those students' parents,
--                                             and the school's administrators (recipient_role 'admin')
CREATE OR REPLACE FUNCTION public.validate_scheduled_recipients(p_sender uuid, p_recipients jsonb)
RETURNS TABLE (recipient_id uuid, recipient_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text;
  v_school uuid;
  v_ids    uuid[];
  v_roles  text[];
  v_bad    uuid;
  v_is_admin_type boolean;
BEGIN
  SELECT p.role, p.school_id INTO v_role, v_school FROM public.profiles p WHERE p.id = p_sender;
  IF v_role IS NULL OR v_school IS NULL OR NOT (v_role = ANY (public.scheduled_message_sender_roles())) THEN
    RAISE EXCEPTION 'You are not allowed to schedule messages' USING ERRCODE = '42501';
  END IF;
  v_is_admin_type := v_role IN ('admin', 'principal', 'hod', 'school_admin');

  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) <> 'array' OR jsonb_array_length(p_recipients) = 0 THEN
    RAISE EXCEPTION 'Select at least one recipient';
  END IF;
  IF jsonb_array_length(p_recipients) > 5000 THEN
    RAISE EXCEPTION 'A scheduled message can have at most 5000 recipients';
  END IF;

  -- Parse + de-duplicate by id into two parallel arrays (no temp table, so the function can stay STABLE).
  BEGIN
    SELECT array_agg(x.rid ORDER BY x.rid), array_agg(x.rrole ORDER BY x.rid)
      INTO v_ids, v_roles
      FROM (
        SELECT DISTINCT ON ((e ->> 'id')::uuid) (e ->> 'id')::uuid AS rid, e ->> 'role' AS rrole
          FROM jsonb_array_elements(p_recipients) AS e
         ORDER BY (e ->> 'id')::uuid
      ) x;
  EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed THEN
    RAISE EXCEPTION 'Recipient list is malformed';
  END;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one recipient';
  END IF;

  IF p_sender = ANY (v_ids) THEN
    RAISE EXCEPTION 'You cannot schedule a message to yourself';
  END IF;

  IF v_is_admin_type THEN
    IF EXISTS (SELECT 1 FROM unnest(v_roles) AS t(rrole) WHERE t.rrole IS NULL OR t.rrole NOT IN ('teacher', 'parent', 'student', 'driver')) THEN
      RAISE EXCEPTION 'Recipients must be teachers, parents, students or drivers';
    END IF;
    SELECT r.rid INTO v_bad
      FROM unnest(v_ids, v_roles) AS r(rid, rrole)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = r.rid AND p.school_id = v_school
          AND (p.role = r.rrole
               OR (r.rrole = 'driver' AND EXISTS (
                     SELECT 1 FROM public.drivers d WHERE d.profile_id = p.id AND d.school_id = v_school)))
     )
     LIMIT 1;
  ELSE
    IF EXISTS (SELECT 1 FROM unnest(v_roles) AS t(rrole) WHERE t.rrole IS NULL OR t.rrole NOT IN ('parent', 'student', 'admin')) THEN
      RAISE EXCEPTION 'Recipients must be parents, students or administrators';
    END IF;
    SELECT r.rid INTO v_bad
      FROM unnest(v_ids, v_roles) AS r(rid, rrole)
     WHERE NOT (
       CASE r.rrole
         WHEN 'admin' THEN EXISTS (
           SELECT 1 FROM public.profiles p
            WHERE p.id = r.rid AND p.school_id = v_school
              AND p.role IN ('admin', 'principal', 'school_admin', 'hod'))
         WHEN 'student' THEN EXISTS (
           SELECT 1
             FROM public.profiles p
             JOIN public.students s ON s.profile_id = p.id
             JOIN public.class_students cs ON cs.student_id = s.id
             JOIN public.class_teachers ct ON ct.class_id = cs.class_id
            WHERE p.id = r.rid AND p.school_id = v_school AND ct.teacher_id = p_sender)
         WHEN 'parent' THEN EXISTS (
           SELECT 1
             FROM public.profiles p
             JOIN public.parent_students ps ON ps.parent_id = p.id
             JOIN public.students s ON s.profile_id = ps.student_id
             JOIN public.class_students cs ON cs.student_id = s.id
             JOIN public.class_teachers ct ON ct.class_id = cs.class_id
            WHERE p.id = r.rid AND p.school_id = v_school AND ct.teacher_id = p_sender)
         ELSE false
       END
     )
     LIMIT 1;
  END IF;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'You are not allowed to message one or more of the selected recipients'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT r.rid, r.rrole FROM unnest(v_ids, v_roles) AS r(rid, rrole) ORDER BY r.rid;
END;
$$;

-- ── 4. Create / edit / cancel (the ONLY way a client writes these tables) ────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_message(
  p_message         text,
  p_scheduled_for   timestamptz,
  p_recipients      jsonb,
  p_message_type    text DEFAULT 'general',
  p_attachment_url  text DEFAULT NULL,
  p_attachment_name text DEFAULT NULL,
  p_audience_label  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_school uuid;
  v_text   text := btrim(COALESCE(p_message, ''));
  v_id     uuid;
  v_count  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT p.role, p.school_id INTO v_role, v_school FROM public.profiles p WHERE p.id = v_uid;
  IF v_role IS NULL OR v_school IS NULL OR NOT (v_role = ANY (public.scheduled_message_sender_roles())) THEN
    RAISE EXCEPTION 'You are not allowed to schedule messages' USING ERRCODE = '42501';
  END IF;

  IF v_text = '' THEN
    IF p_attachment_url IS NULL THEN
      RAISE EXCEPTION 'Write a message or attach a file';
    END IF;
    v_text := '📎 Attachment';
  END IF;
  IF length(v_text) > 4000 THEN
    RAISE EXCEPTION 'Message is too long (4000 characters maximum)';
  END IF;

  IF p_scheduled_for IS NULL OR p_scheduled_for <= now() THEN
    RAISE EXCEPTION 'Choose a date and time in the future';
  END IF;
  IF p_scheduled_for > now() + interval '365 days' THEN
    RAISE EXCEPTION 'Messages can be scheduled at most one year ahead';
  END IF;

  IF COALESCE(p_message_type, 'general') NOT IN ('general', 'appreciation', 'behaviour') THEN
    RAISE EXCEPTION 'Unsupported message type for scheduling';
  END IF;

  INSERT INTO public.scheduled_messages
    (school_id, sender_id, sender_role, message, message_type, attachment_url, attachment_name,
     audience_label, scheduled_for)
  VALUES
    (v_school, v_uid, v_role, v_text, COALESCE(p_message_type, 'general'), p_attachment_url, p_attachment_name,
     NULLIF(btrim(COALESCE(p_audience_label, '')), ''), p_scheduled_for)
  RETURNING id INTO v_id;

  INSERT INTO public.scheduled_message_recipients (scheduled_message_id, recipient_id, recipient_role)
  SELECT v_id, r.recipient_id, r.recipient_role
    FROM public.validate_scheduled_recipients(v_uid, p_recipients) r;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.scheduled_messages SET recipient_count = v_count WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- Edit before it is sent. Only the sender; only while status = 'scheduled'. Every parameter is optional: NULL = keep.
-- p_clear_attachment removes the attachment; p_recipients replaces the recipient list (validated again).
CREATE OR REPLACE FUNCTION public.update_scheduled_message(
  p_id               uuid,
  p_message          text DEFAULT NULL,
  p_scheduled_for    timestamptz DEFAULT NULL,
  p_recipients       jsonb DEFAULT NULL,
  p_clear_attachment boolean DEFAULT false,
  p_attachment_url   text DEFAULT NULL,
  p_attachment_name  text DEFAULT NULL,
  p_audience_label   text DEFAULT NULL
)
RETURNS public.scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.scheduled_messages;
  v_text  text;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Same row lock the delivery worker takes: edit and delivery are strictly serialised.
  SELECT * INTO v_row FROM public.scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.sender_id <> v_uid THEN
    RAISE EXCEPTION 'Scheduled message not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This message is already % and can no longer be edited', v_row.status;
  END IF;

  IF p_message IS NOT NULL THEN
    v_text := btrim(p_message);
    IF v_text = '' THEN
      IF COALESCE(CASE WHEN p_clear_attachment THEN NULL ELSE COALESCE(p_attachment_url, v_row.attachment_url) END, '') = '' THEN
        RAISE EXCEPTION 'Write a message or attach a file';
      END IF;
      v_text := '📎 Attachment';
    END IF;
    IF length(v_text) > 4000 THEN
      RAISE EXCEPTION 'Message is too long (4000 characters maximum)';
    END IF;
    v_row.message := v_text;
  END IF;

  IF p_scheduled_for IS NOT NULL THEN
    IF p_scheduled_for <= now() THEN
      RAISE EXCEPTION 'Choose a date and time in the future';
    END IF;
    IF p_scheduled_for > now() + interval '365 days' THEN
      RAISE EXCEPTION 'Messages can be scheduled at most one year ahead';
    END IF;
    v_row.scheduled_for := p_scheduled_for;
  END IF;

  IF p_clear_attachment THEN
    v_row.attachment_url := NULL;
    v_row.attachment_name := NULL;
  ELSIF p_attachment_url IS NOT NULL THEN
    v_row.attachment_url := p_attachment_url;
    v_row.attachment_name := p_attachment_name;
  END IF;
  IF p_audience_label IS NOT NULL THEN
    v_row.audience_label := NULLIF(btrim(p_audience_label), '');
  END IF;

  IF p_recipients IS NOT NULL THEN
    DELETE FROM public.scheduled_message_recipients WHERE scheduled_message_id = p_id;
    INSERT INTO public.scheduled_message_recipients (scheduled_message_id, recipient_id, recipient_role)
    SELECT p_id, r.recipient_id, r.recipient_role
      FROM public.validate_scheduled_recipients(v_uid, p_recipients) r;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_row.recipient_count := v_count;
  END IF;

  UPDATE public.scheduled_messages
     SET message = v_row.message,
         scheduled_for = v_row.scheduled_for,
         attachment_url = v_row.attachment_url,
         attachment_name = v_row.attachment_name,
         audience_label = v_row.audience_label,
         recipient_count = v_row.recipient_count,
         -- a rescheduled message gets a clean retry budget
         attempts = CASE WHEN p_scheduled_for IS NOT NULL THEN 0 ELSE attempts END,
         last_error = CASE WHEN p_scheduled_for IS NOT NULL THEN NULL ELSE last_error END,
         updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Cancel before it is sent. The sender, or an admin / principal / school_admin of the same school.
-- Idempotent: cancelling an already-cancelled message is a no-op (returns false). A sent message cannot be cancelled.
CREATE OR REPLACE FUNCTION public.cancel_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.scheduled_messages;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT (v_row.sender_id = v_uid OR public.can_manage_school_scheduled_messages(v_row.school_id)) THEN
    RAISE EXCEPTION 'Scheduled message not found' USING ERRCODE = '42501';
  END IF;

  IF v_row.status = 'cancelled' THEN
    RETURN false;
  END IF;
  IF v_row.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This message is already % and can no longer be cancelled', v_row.status;
  END IF;

  UPDATE public.scheduled_messages
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, updated_at = now()
   WHERE id = p_id;
  RETURN true;
END;
$$;

-- ── 5. The worker: deliver everything that is due ────────────────────────────────────────────────────
-- Called by pg_cron every minute and by the edge-function hand-off; also safe to call by hand. Service role / owner
-- only. Returns one row per message it ACTUALLY changed (sent or failed), never for one it skipped.
CREATE OR REPLACE FUNCTION public.process_due_scheduled_messages(p_limit integer DEFAULT 100)
RETURNS TABLE (scheduled_message_id uuid, outcome text, delivered_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m        public.scheduled_messages;
  v_single boolean;
  v_n      integer;
  v_max_attempts constant integer := 5;
BEGIN
  FOR m IN
    SELECT * FROM public.scheduled_messages sm
     WHERE sm.status = 'scheduled' AND sm.scheduled_for <= now()
     ORDER BY sm.scheduled_for
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
     FOR UPDATE SKIP LOCKED          -- another worker (or a cancel/edit in flight) holds it: not ours, skip
  LOOP
    BEGIN  -- savepoint: this message's rows and status change commit or roll back TOGETHER
      v_single := (SELECT count(*) FROM public.scheduled_message_recipients r WHERE r.scheduled_message_id = m.id) = 1;

      IF NOT EXISTS (SELECT 1 FROM public.scheduled_message_recipients r WHERE r.scheduled_message_id = m.id) THEN
        RAISE EXCEPTION 'no recipients' USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO public.teacher_messages
        (id, school_id, sender_id, recipient_id, recipient_role, message, message_type,
         attachment_url, attachment_name, batch_id, broadcast_label, scheduled_message_id)
      SELECT public.scheduled_message_row_id(m.id, r.recipient_id),
             m.school_id, m.sender_id, r.recipient_id, r.recipient_role, m.message, m.message_type,
             m.attachment_url, m.attachment_name,
             CASE WHEN v_single THEN NULL ELSE m.batch_id END,
             CASE WHEN v_single THEN NULL ELSE COALESCE(m.audience_label, 'Scheduled message') END,
             m.id
        FROM public.scheduled_message_recipients r
       WHERE r.scheduled_message_id = m.id
      ON CONFLICT DO NOTHING;

      UPDATE public.scheduled_message_recipients r
         SET message_id = public.scheduled_message_row_id(m.id, r.recipient_id)
       WHERE r.scheduled_message_id = m.id;

      SELECT count(*) INTO v_n FROM public.scheduled_message_recipients r WHERE r.scheduled_message_id = m.id;

      UPDATE public.scheduled_messages
         SET status = 'sent', sent_at = now(), recipient_count = v_n,
             attempts = attempts + 1, last_attempt_at = now(), last_error = NULL, updated_at = now()
       WHERE id = m.id;

      -- Tell the sender it went out (existing notification bell). Never allowed to affect delivery.
      BEGIN
        INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
        VALUES (m.sender_id, 'scheduled_message_sent', 'Scheduled message sent',
                'Your message scheduled for ' || to_char(m.scheduled_for AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI') ||
                ' UTC was sent to ' || v_n || ' recipient(s).',
                m.id, 'scheduled_message');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;

      scheduled_message_id := m.id; outcome := 'sent'; delivered_count := v_n;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Everything this message did above is rolled back. Record the failure; retry on the next run until the
      -- budget is spent, then park it as 'failed' so it is never retried forever.
      UPDATE public.scheduled_messages
         SET attempts = attempts + 1,
             last_attempt_at = now(),
             last_error = left(SQLERRM, 500),
             status = CASE WHEN attempts + 1 >= v_max_attempts OR SQLSTATE = 'P0002' THEN 'failed' ELSE 'scheduled' END,
             updated_at = now()
       WHERE id = m.id;

      IF (SELECT status FROM public.scheduled_messages WHERE id = m.id) = 'failed' THEN
        BEGIN
          INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
          VALUES (m.sender_id, 'scheduled_message_failed', 'Scheduled message could not be sent',
                  'A message scheduled for ' || to_char(m.scheduled_for AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI') ||
                  ' UTC could not be delivered. Open Communication Center to review it.',
                  m.id, 'scheduled_message');
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;

      scheduled_message_id := m.id;
      outcome := CASE WHEN (SELECT status FROM public.scheduled_messages WHERE id = m.id) = 'failed' THEN 'failed' ELSE 'retry' END;
      delivered_count := 0;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

-- ── 6. Push / email hand-off (at most once per recipient) ────────────────────────────────────────────
-- Atomically claims recipients of SENT messages that have not been handed to dispatch-message yet. The claim IS the
-- stamp (dispatched_at), so two overlapping callers get disjoint sets and a retry gets nothing for what was claimed.
CREATE OR REPLACE FUNCTION public.claim_scheduled_dispatches(p_limit integer DEFAULT 200)
RETURNS TABLE (
  scheduled_message_id uuid,
  message_id uuid,
  recipient_id uuid,
  sender_id uuid,
  audience_label text,
  message text,
  attachment_name text,
  recipient_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT r.scheduled_message_id AS sid, r.recipient_id AS rid
      FROM public.scheduled_message_recipients r
      JOIN public.scheduled_messages m ON m.id = r.scheduled_message_id
     WHERE m.status = 'sent' AND r.dispatched_at IS NULL AND r.message_id IS NOT NULL
     ORDER BY m.sent_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
     FOR UPDATE OF r SKIP LOCKED
  ), claimed AS (
    UPDATE public.scheduled_message_recipients r
       SET dispatched_at = now()
      FROM picked
     WHERE r.scheduled_message_id = picked.sid AND r.recipient_id = picked.rid AND r.dispatched_at IS NULL
    RETURNING r.scheduled_message_id, r.message_id, r.recipient_id
  )
  SELECT c.scheduled_message_id, c.message_id, c.recipient_id, m.sender_id, m.audience_label, m.message,
         m.attachment_name, m.recipient_count
    FROM claimed c
    JOIN public.scheduled_messages m ON m.id = c.scheduled_message_id;
$$;

-- Lets the worker record that the push/email hand-off itself failed (the claim is never undone, see header).
CREATE OR REPLACE FUNCTION public.record_scheduled_dispatch_error(p_message_id uuid, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scheduled_message_recipients
     SET dispatch_error = left(p_error, 500)
   WHERE message_id = p_message_id;
$$;

-- ── 7. Row level security ────────────────────────────────────────────────────────────────────────────
-- Clients may only READ. Every write goes through the SECURITY DEFINER functions above (permissions, recipient
-- scope and the "only while scheduled" rule are enforced there, not in the browser).
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_message_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheduled_messages_select" ON public.scheduled_messages;
CREATE POLICY "scheduled_messages_select" ON public.scheduled_messages
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR public.can_manage_school_scheduled_messages(school_id));

DROP POLICY IF EXISTS "scheduled_message_recipients_select" ON public.scheduled_message_recipients;
CREATE POLICY "scheduled_message_recipients_select" ON public.scheduled_message_recipients
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.scheduled_messages m WHERE m.id = scheduled_message_id));

REVOKE ALL ON public.scheduled_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.scheduled_message_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.scheduled_messages TO authenticated;
GRANT SELECT ON public.scheduled_message_recipients TO authenticated;
GRANT ALL ON public.scheduled_messages TO service_role;
GRANT ALL ON public.scheduled_message_recipients TO service_role;

REVOKE ALL ON FUNCTION public.scheduled_message_row_id(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_scheduled_recipients(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_school_scheduled_messages(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_message(text, timestamptz, jsonb, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_scheduled_message(uuid, text, timestamptz, jsonb, boolean, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_scheduled_message(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_due_scheduled_messages(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_scheduled_dispatches(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_scheduled_dispatch_error(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.scheduled_message_row_id(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_school_scheduled_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_message(text, timestamptz, jsonb, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_scheduled_message(uuid, text, timestamptz, jsonb, boolean, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_scheduled_messages(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_dispatches(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_scheduled_dispatch_error(uuid, text) TO service_role;

-- ── 8. Realtime: the Scheduled list flips Scheduled -> Sent without a refresh ───────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scheduled_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_messages;
  END IF;
END $$;

-- ── 9. Schedulers (skipped with a notice where pg_cron / pg_net are not enabled) ─────────────────────
-- Job 1 delivers in-app messages straight from the database: it needs no secret, no network and no edge function.
-- Job 2 calls the already-deployed calibrate-irt-cron function (job "scheduled_messages", same CRON_SECRET as the
-- nightly calibration jobs; no new edge function is created, see supabase/functions/CONSOLIDATION.md) to
-- hand newly delivered messages to dispatch-message for push + email. Both are idempotent and may overlap freely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'deliver-scheduled-messages', '* * * * *',
      $job$ SELECT public.process_due_scheduled_messages(100); $job$
    );
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
      PERFORM cron.schedule(
        'dispatch-scheduled-messages', '* * * * *',
        $job$
        SELECT net.http_post(
          url := 'https://qkclzrscyhzrbixajaiw.functions.supabase.co/calibrate-irt-cron',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', current_setting('app.settings.cron_secret', true)
          ),
          body := '{"job":"scheduled_messages"}'::jsonb,
          timeout_milliseconds := 55000
        );
        $job$
      );
    ELSE
      RAISE NOTICE 'pg_net is not enabled: scheduled messages will be delivered in-app, but push/email hand-off needs pg_net (or call the function manually).';
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron is not enabled: enable it (Database > Extensions) and re-run this migration, or call public.process_due_scheduled_messages() from your own scheduler.';
  END IF;
END $$;
