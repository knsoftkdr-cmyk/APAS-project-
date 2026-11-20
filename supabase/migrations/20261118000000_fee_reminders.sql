-- ============================================================================
-- Automatic fee reminders (push + email + in-app), with no staff action
--
-- EXTENDS the existing ERP & Fees module and the instalment reminders (20261110000000_fee_instalments.sql):
--   * fee_run_reminders() (pg_cron, hourly) reminds parents about EVERY unpaid fee in public.fee_payments:
--     before the due date (instalment_settings.reminder_days, default 7/3/1 days), on the due date, and then every
--     overdue_repeat_days while it stays overdue. Fees on an active instalment plan are skipped - their instalments
--     already get reminders from instalment_run_reminders().
--   * The in-app notice goes to the existing governance_notifications inbox (same as instalment reminders).
--   * NEW: every fee / instalment reminder is also queued in fee_reminder_outbox and handed to the existing
--     dispatch-message edge function (push + email, respecting each parent's notification_preferences) by the
--     every-minute scheduled-messages worker (calibrate-irt-cron, job "scheduled_messages"). No new edge function.
--   * Parents with no app account: the email goes to students.parent_email instead.
--   * Push / email are only sent between 09:00 and 20:00 India time; anything queued at night waits for the morning.
--   * Schools can switch fee reminders off: instalment_settings.fee_reminders_enabled (ERP & Fees > Instalments >
--     Settings). Default ON.
--
-- WhatsApp is intentionally not included.
-- Safe to run more than once. Nothing existing is dropped or changed.
-- Test by hand:  SELECT public.fee_run_reminders();   then   SELECT * FROM public.fee_reminder_outbox ORDER BY created_at DESC;
-- ============================================================================

-- 1. Setting ----------------------------------------------------------------------------------------------------------
ALTER TABLE public.instalment_settings ADD COLUMN IF NOT EXISTS fee_reminders_enabled boolean NOT NULL DEFAULT true;

-- 2. Tables -----------------------------------------------------------------------------------------------------------
-- One row per reminder actually sent; the primary key makes a repeat impossible even if two runs overlap.
CREATE TABLE IF NOT EXISTS public.fee_reminder_log (
  fee_payment_id uuid NOT NULL REFERENCES public.fee_payments(id) ON DELETE CASCADE,
  kind           text NOT NULL,            -- upcoming_<days> | due_today | overdue_<period>
  occurrence     date NOT NULL,            -- the due date it was for; moving the due date re-arms reminders
  recipient      text NOT NULL,            -- parent user id, or 'email:<address>' for parents with no app account
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fee_payment_id, kind, occurrence, recipient)
);

-- Push / email queue. Claiming a row stamps dispatched_at, so a row is handed out at most once.
CREATE TABLE IF NOT EXISTS public.fee_reminder_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table   text NOT NULL,            -- 'fee_payments' | 'instalment_items'
  source_id      uuid NOT NULL,
  recipient_id   uuid,                     -- parent account: push + email by their preferences
  email          text,                     -- OR a plain address (parent has no app account): email only
  title          text NOT NULL,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  dispatched_at  timestamptz,
  dispatch_error text,
  CHECK (recipient_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_fee_reminder_outbox_pending ON public.fee_reminder_outbox (created_at) WHERE dispatched_at IS NULL;

ALTER TABLE public.fee_reminder_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_reminder_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fee_reminder_log, public.fee_reminder_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fee_reminder_log, public.fee_reminder_outbox TO service_role;

-- 3. Queue push / email for every fee or instalment reminder that reaches the in-app inbox -------------------------------
-- A trigger (instead of editing instalment_run_reminders) so the existing instalment reminders get push + email too.
-- It can never block the in-app notice: any problem is only logged.
CREATE OR REPLACE FUNCTION public.fee_reminder_outbox_from_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.fee_reminder_outbox (source_table, source_id, recipient_id, title, body)
    VALUES (CASE WHEN NEW.event_type LIKE 'instalment%' THEN 'instalment_items' ELSE 'fee_payments' END,
            COALESCE(NEW.reference_id, NEW.id), NEW.user_id, NEW.title, NEW.message);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fee reminder outbox insert failed: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_fee_reminder_outbox ON public.governance_notifications;
CREATE TRIGGER trg_fee_reminder_outbox
  AFTER INSERT ON public.governance_notifications
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL AND NEW.event_type IN (
    'instalment_upcoming', 'instalment_due_today', 'instalment_overdue',
    'fee_upcoming', 'fee_due_today', 'fee_overdue'))
  EXECUTE FUNCTION public.fee_reminder_outbox_from_notification();

-- 4. Reminders for every unpaid fee (pg_cron, hourly) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fee_run_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today   date := public.instalment_today();
  v_hour    integer := extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata');
  r record;
  v_days integer; v_tier integer; v_late integer; v_period integer;
  v_kind text; v_event text; v_title text; v_msg text; v_amount text; v_who text;
  v_parent uuid; v_email text; v_inserted integer; v_has_parent boolean; v_total integer := 0;
BEGIN
  -- Reminders go out in the daytime only (the first run after 9 AM India time sends the day's reminders).
  IF v_hour < 9 OR v_hour >= 20 THEN RETURN 0; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('fee_run_reminders', 0)) THEN RETURN 0; END IF;

  FOR r IN
    SELECT f.id, f.student_id, f.student_name, f.due_date,
           GREATEST(COALESCE(f.amount_due, 0) - COALESCE(f.amount_paid, 0), 0) AS balance,
           COALESCE(s.reminder_days, '{7,3,1}') AS reminder_days,
           COALESCE(s.overdue_repeat_days, 3) AS repeat_days,
           sc.name AS school_name
      FROM public.fee_payments f
      LEFT JOIN public.instalment_settings s ON s.school_id = f.school_id
      LEFT JOIN public.schools sc ON sc.id = f.school_id
     WHERE f.due_date IS NOT NULL
       AND f.student_id IS NOT NULL
       AND COALESCE(f.amount_due, 0) - COALESCE(f.amount_paid, 0) > 0
       AND lower(COALESCE(f.status, '')) NOT IN ('paid', 'cancelled', 'waived', 'refunded')
       AND COALESCE(s.fee_reminders_enabled, true)
       -- stop chasing after 90 days overdue (the fee stays visible as overdue on screen)
       AND f.due_date >= v_today - 90
       -- a fee on an active instalment plan is reminded per instalment instead
       AND NOT EXISTS (SELECT 1 FROM public.instalment_plans p WHERE p.fee_payment_id = f.id AND p.status = 'active')
  LOOP
    v_days := r.due_date - v_today;
    v_kind := NULL;
    v_amount := public.instalment_money(r.balance);
    v_who := COALESCE(NULLIF(trim(r.student_name), ''), 'your child');
    IF v_days > 0 THEN
      SELECT min(d) INTO v_tier FROM unnest(r.reminder_days) d WHERE v_days <= d;   -- closest tier not yet passed
      IF v_tier IS NOT NULL THEN
        v_kind := 'upcoming_' || v_tier; v_event := 'fee_upcoming'; v_title := 'Fee due soon';
        v_msg := 'The fee of ' || v_amount || ' for ' || v_who || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.';
      END IF;
    ELSIF v_days = 0 THEN
      v_kind := 'due_today'; v_event := 'fee_due_today'; v_title := 'Fee due today';
      v_msg := 'The fee of ' || v_amount || ' for ' || v_who || ' is due today.';
    ELSE
      v_late := -v_days;
      v_period := CASE WHEN r.repeat_days > 0 THEN (v_late - 1) / r.repeat_days ELSE 0 END;   -- one notice per period
      v_kind := 'overdue_' || v_period; v_event := 'fee_overdue'; v_title := 'Fee overdue';
      v_msg := 'The fee of ' || v_amount || ' for ' || v_who || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY')
               || ' and is now overdue. Please pay at the earliest.';
    END IF;
    CONTINUE WHEN v_kind IS NULL;
    IF r.school_name IS NOT NULL THEN v_msg := v_msg || ' - ' || r.school_name; END IF;

    -- Parents with an app account: in-app notice (+ push/email through the outbox trigger above).
    v_has_parent := false;
    FOR v_parent IN SELECT public.instalment_parent_ids(r.student_id) LOOP
      v_has_parent := true;
      INSERT INTO public.fee_reminder_log (fee_payment_id, kind, occurrence, recipient)
      VALUES (r.id, v_kind, r.due_date, v_parent::text) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        PERFORM public.instalment_notify(ARRAY[v_parent], v_event, v_title, v_msg, r.id, 'fee_payment');
        v_total := v_total + 1;
      END IF;
    END LOOP;

    -- No parent account linked: email the parent address on the student record instead.
    IF NOT v_has_parent THEN
      SELECT lower(trim(st.parent_email)) INTO v_email FROM public.students st WHERE st.id = r.student_id;
      IF v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        INSERT INTO public.fee_reminder_log (fee_payment_id, kind, occurrence, recipient)
        VALUES (r.id, v_kind, r.due_date, 'email:' || v_email) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        IF v_inserted > 0 THEN
          INSERT INTO public.fee_reminder_outbox (source_table, source_id, email, title, body)
          VALUES ('fee_payments', r.id, v_email, v_title || COALESCE(' - ' || r.school_name, ''), v_msg);
          v_total := v_total + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  DELETE FROM public.fee_reminder_log WHERE sent_at < now() - interval '400 days';
  DELETE FROM public.fee_reminder_outbox WHERE created_at < now() - interval '60 days';
  RETURN v_total;
END $$;

-- 5. Push / email hand-off (used by the scheduled-messages worker) ----------------------------------------------------
-- Claims queued reminders atomically (the claim IS the stamp). Daytime only; rows older than 3 days are never sent
-- (e.g. queued before pg_net was set up), so a late setup cannot flood parents with stale reminders.
CREATE OR REPLACE FUNCTION public.claim_fee_reminder_dispatches(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, source_table text, source_id uuid, recipient_id uuid, email text, title text, body text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_hour integer := extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF v_hour < 9 OR v_hour >= 20 THEN RETURN; END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT o.id AS pid
      FROM public.fee_reminder_outbox o
     WHERE o.dispatched_at IS NULL AND o.created_at > now() - interval '3 days'
     ORDER BY o.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.fee_reminder_outbox o
     SET dispatched_at = now()
    FROM picked
   WHERE o.id = picked.pid AND o.dispatched_at IS NULL
  RETURNING o.id, o.source_table, o.source_id, o.recipient_id, o.email, o.title, o.body;
END $$;

CREATE OR REPLACE FUNCTION public.record_fee_reminder_dispatch_error(p_id uuid, p_error text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.fee_reminder_outbox SET dispatch_error = left(p_error, 500) WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.fee_reminder_outbox_from_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fee_run_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_fee_reminder_dispatches(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_fee_reminder_dispatch_error(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fee_run_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_fee_reminder_dispatches(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_fee_reminder_dispatch_error(uuid, text) TO service_role;

-- 6. Scheduler ---------------------------------------------------------------------------------------------------------
-- Push / email need no new job: the existing every-minute 'dispatch-scheduled-messages' job (20261111000000) also
-- empties fee_reminder_outbox.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'fee-reminders-hourly';
    PERFORM cron.schedule('fee-reminders-hourly', '20 * * * *', 'SELECT public.fee_run_reminders();');
  ELSE
    RAISE NOTICE 'pg_cron is not enabled - enable it, then run: SELECT cron.schedule(''fee-reminders-hourly'', ''20 * * * *'', ''SELECT public.fee_run_reminders();'');';
  END IF;
END $$;
-- Stop:  SELECT cron.unschedule('fee-reminders-hourly');
