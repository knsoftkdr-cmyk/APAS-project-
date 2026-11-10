-- ============================================================================
-- Automatic Fee Instalment Management
--
-- EXTENDS the existing ERP & Fees module. It does NOT create a second fee system:
--   * the fee being paid in instalments is an existing public.fee_payments row;
--   * every successful instalment payment credits that same row (amount_paid / status), so the existing
--     parent fee page (get_parent_fee_details) and the ERP Fee Records screen show the right balance with no change;
--   * payments go through the existing Razorpay account (new edge functions, same RAZORPAY_* secrets);
--   * notifications are written to the existing public.governance_notifications inbox, reminders run from pg_cron
--     exactly like calendar_run_reminders().
--
-- New tables      : instalment_settings, instalment_requests, instalment_plans, instalment_items,
--                   instalment_transactions, instalment_reminder_log
-- Security model  : RLS = read-only for school staff / the child's parents. ALL writes go through SECURITY DEFINER
--                   functions that re-check the caller, or (payment results) through functions only service_role can run.
-- Safe to run more than once. Nothing existing is dropped or has a column/policy removed.
-- ============================================================================

-- 0. Columns the application already reads/writes on fee_payments but that were never in a migration ---------------
ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS student_id uuid;
ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS razorpay_order_id text;
ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS razorpay_signature text;

-- 1. Helpers --------------------------------------------------------------------------------------------------------
-- "Today" for the school (India). Due dates are plain dates, so overdue is decided on the Indian calendar day.
CREATE OR REPLACE FUNCTION public.instalment_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Finance staff of THIS school: ERP-enabled users, school admins and admins whose profile belongs to the school
-- (or, for multi-school admins, who are mapped to it in school_admin_schools).
CREATE OR REPLACE FUNCTION public.is_fee_staff(p_school uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_school IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid() AND p.school_id = p_school
               AND (COALESCE(p.erp_access, false) OR p.role IN ('admin', 'school_admin')))
    OR EXISTS (SELECT 1 FROM public.school_admin_schools sas
                WHERE sas.school_admin_id = auth.uid() AND sas.school_id = p_school)
  );
$$;

-- The caller is a parent linked to this ERP student (students.id). parent_students.student_id is the student's PROFILE id
-- (students.profile_id) by the existing convention; students.id is also accepted for legacy rows.
CREATE OR REPLACE FUNCTION public.is_parent_of_student(p_student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_student IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.parent_students ps ON ps.student_id IN (s.profile_id, s.id)
    WHERE s.id = p_student AND ps.parent_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_school_member(p_school uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_school IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.school_id = p_school);
$$;

-- 2. Tables ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instalment_settings (
  school_id             uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,            -- plans are OPTIONAL and off until the school turns them on
  allowed_counts        integer[] NOT NULL DEFAULT '{2,3,4,6}',    -- permitted numbers of instalments
  allow_flexible        boolean NOT NULL DEFAULT true,             -- false = parents get default_count only
  default_count         integer NOT NULL DEFAULT 4 CHECK (default_count >= 2),
  min_instalment_amount numeric(12,2) CHECK (min_instalment_amount IS NULL OR min_instalment_amount >= 0),
  max_instalment_amount numeric(12,2) CHECK (max_instalment_amount IS NULL OR max_instalment_amount > 0),
  default_interval_days integer NOT NULL DEFAULT 30 CHECK (default_interval_days > 0),
  reminder_days         integer[] NOT NULL DEFAULT '{7,3,1}',      -- days before the due date to remind
  overdue_repeat_days   integer NOT NULL DEFAULT 3 CHECK (overdue_repeat_days >= 0), -- 0 = a single overdue notice
  updated_by            uuid REFERENCES auth.users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (min_instalment_amount IS NULL OR max_instalment_amount IS NULL OR min_instalment_amount <= max_instalment_amount),
  CHECK (cardinality(allowed_counts) > 0)
);

CREATE TABLE IF NOT EXISTS public.instalment_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  fee_payment_id   uuid REFERENCES public.fee_payments(id) ON DELETE SET NULL,
  requested_amount numeric(12,2) NOT NULL CHECK (requested_amount > 0),
  requested_count  integer NOT NULL CHECK (requested_count >= 2),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_amount  numeric(12,2),
  requested_by     uuid REFERENCES auth.users(id),
  reviewed_by      uuid REFERENCES auth.users(id),
  reviewed_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR length(btrim(COALESCE(rejection_reason, ''))) > 0)
);
-- one open request per fee: no double submissions
CREATE UNIQUE INDEX IF NOT EXISTS uq_instalment_requests_one_pending
  ON public.instalment_requests (fee_payment_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_instalment_requests_school_status ON public.instalment_requests (school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instalment_requests_student ON public.instalment_requests (student_id);

CREATE TABLE IF NOT EXISTS public.instalment_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  fee_payment_id uuid NOT NULL REFERENCES public.fee_payments(id) ON DELETE RESTRICT,
  request_id     uuid NOT NULL UNIQUE REFERENCES public.instalment_requests(id) ON DELETE RESTRICT, -- UNIQUE = no duplicate schedule per request
  student_name   text NOT NULL,        -- snapshot, so parents can read plans without needing access to students/fee_payments
  class_grade    text,
  section        text,
  total_amount   numeric(12,2) NOT NULL CHECK (total_amount > 0),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- a fee can only have one live plan at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_instalment_plans_one_active_per_fee
  ON public.instalment_plans (fee_payment_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_instalment_plans_school ON public.instalment_plans (school_id, status);
CREATE INDEX IF NOT EXISTS idx_instalment_plans_student ON public.instalment_plans (student_id);

CREATE TABLE IF NOT EXISTS public.instalment_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- the instalment's unique identifier
  plan_id     uuid NOT NULL REFERENCES public.instalment_plans(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  seq         integer NOT NULL CHECK (seq >= 1),
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  amount_paid numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'cancelled')),
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_instalment_items_plan_seq UNIQUE (plan_id, seq),   -- no duplicate instalments
  CONSTRAINT chk_instalment_items_paid_le_amount CHECK (amount_paid <= amount)
);
CREATE INDEX IF NOT EXISTS idx_instalment_items_due ON public.instalment_items (school_id, due_date) WHERE status IN ('pending', 'partially_paid');
CREATE INDEX IF NOT EXISTS idx_instalment_items_student ON public.instalment_items (student_id);

CREATE TABLE IF NOT EXISTS public.instalment_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id          uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  plan_id             uuid NOT NULL REFERENCES public.instalment_plans(id) ON DELETE RESTRICT,
  item_id             uuid NOT NULL REFERENCES public.instalment_items(id) ON DELETE RESTRICT,
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  currency            text NOT NULL DEFAULT 'INR',
  razorpay_order_id   text NOT NULL UNIQUE,
  razorpay_payment_id text UNIQUE,            -- UNIQUE = a gateway payment can never create two records (duplicate callbacks)
  razorpay_signature  text,
  status              text NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'pending', 'success', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  failure_reason      text,
  refunded_amount     numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  receipt_no          text UNIQUE,
  method              text,
  needs_review        boolean NOT NULL DEFAULT false,   -- money arrived but could not be fully applied (schedule changed mid-payment)
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_instalment_txn_item ON public.instalment_transactions (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instalment_txn_school ON public.instalment_transactions (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instalment_txn_student ON public.instalment_transactions (student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.instalment_reminder_log (
  item_id      uuid NOT NULL REFERENCES public.instalment_items(id) ON DELETE CASCADE,
  kind         text NOT NULL,                 -- upcoming_7 | due_today | overdue_0 ...
  occurrence   date NOT NULL,                 -- the due date the reminder was for; moving the due date re-arms reminders
  recipient_id uuid NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, kind, occurrence, recipient_id)
);

CREATE SEQUENCE IF NOT EXISTS public.instalment_receipt_seq;

-- 3. Row level security: READ ONLY for users; every write goes through the functions below --------------------------
ALTER TABLE public.instalment_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instalment_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instalment_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instalment_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instalment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instalment_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instalment_settings_read   ON public.instalment_settings;
DROP POLICY IF EXISTS instalment_settings_insert ON public.instalment_settings;
DROP POLICY IF EXISTS instalment_settings_update ON public.instalment_settings;
CREATE POLICY instalment_settings_read   ON public.instalment_settings FOR SELECT TO authenticated USING (public.is_school_member(school_id) OR public.is_fee_staff(school_id));
CREATE POLICY instalment_settings_insert ON public.instalment_settings FOR INSERT TO authenticated WITH CHECK (public.is_fee_staff(school_id));
CREATE POLICY instalment_settings_update ON public.instalment_settings FOR UPDATE TO authenticated USING (public.is_fee_staff(school_id)) WITH CHECK (public.is_fee_staff(school_id));

DROP POLICY IF EXISTS instalment_requests_read ON public.instalment_requests;
DROP POLICY IF EXISTS instalment_plans_read ON public.instalment_plans;
DROP POLICY IF EXISTS instalment_items_read ON public.instalment_items;
DROP POLICY IF EXISTS instalment_txn_read ON public.instalment_transactions;
CREATE POLICY instalment_requests_read ON public.instalment_requests FOR SELECT TO authenticated USING (public.is_fee_staff(school_id) OR public.is_parent_of_student(student_id));
CREATE POLICY instalment_plans_read    ON public.instalment_plans        FOR SELECT TO authenticated USING (public.is_fee_staff(school_id) OR public.is_parent_of_student(student_id));
CREATE POLICY instalment_items_read    ON public.instalment_items        FOR SELECT TO authenticated USING (public.is_fee_staff(school_id) OR public.is_parent_of_student(student_id));
CREATE POLICY instalment_txn_read      ON public.instalment_transactions FOR SELECT TO authenticated USING (public.is_fee_staff(school_id) OR public.is_parent_of_student(student_id));

REVOKE ALL ON public.instalment_requests, public.instalment_plans, public.instalment_items,
              public.instalment_transactions, public.instalment_reminder_log FROM anon, authenticated;
GRANT SELECT ON public.instalment_requests, public.instalment_plans, public.instalment_items, public.instalment_transactions TO authenticated;
REVOKE ALL ON public.instalment_settings FROM anon;
REVOKE DELETE ON public.instalment_settings FROM authenticated;

-- 4. Display status view (overdue is CALCULATED, never stored) ----------------------------------------------------
CREATE OR REPLACE VIEW public.instalment_items_v WITH (security_invoker = true) AS
SELECT i.*,
       p.fee_payment_id, p.student_name, p.class_grade, p.section,
       (SELECT count(*) FROM public.instalment_items x WHERE x.plan_id = i.plan_id AND x.status <> 'cancelled')::int AS plan_item_count,
       (i.amount - i.amount_paid) AS balance,
       CASE
         WHEN i.status = 'cancelled' THEN 'cancelled'
         WHEN i.status = 'paid' THEN 'paid'
         WHEN i.due_date < public.instalment_today() THEN 'overdue'
         WHEN (SELECT t.status FROM public.instalment_transactions t WHERE t.item_id = i.id ORDER BY t.created_at DESC LIMIT 1) = 'failed' THEN 'failed'
         WHEN i.due_date <= public.instalment_today() + 7 THEN 'upcoming'
         WHEN i.status = 'partially_paid' THEN 'partially_paid'
         ELSE 'pending'
       END AS display_status
FROM public.instalment_items i
JOIN public.instalment_plans p ON p.id = i.plan_id;
GRANT SELECT ON public.instalment_items_v TO authenticated;

-- 5. Integrity guards ---------------------------------------------------------------------------------------------
-- Paid instalments can never be edited/deleted by accident; payment history survives schedule changes.
CREATE OR REPLACE FUNCTION public.instalment_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('paid', 'partially_paid') OR OLD.amount_paid > 0 THEN
      RAISE EXCEPTION 'A paid instalment cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'paid' AND (NEW.amount <> OLD.amount OR NEW.due_date <> OLD.due_date OR NEW.seq <> OLD.seq OR NEW.plan_id <> OLD.plan_id) THEN
    RAISE EXCEPTION 'A paid instalment cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.amount_paid > 0 THEN
    RAISE EXCEPTION 'An instalment with payments cannot be cancelled' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_instalment_items_guard ON public.instalment_items;
CREATE TRIGGER trg_instalment_items_guard BEFORE UPDATE OR DELETE ON public.instalment_items
  FOR EACH ROW EXECUTE FUNCTION public.instalment_items_guard();

-- Transactions are an audit trail: never deleted.
CREATE OR REPLACE FUNCTION public.instalment_txn_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Payment transactions cannot be deleted' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_instalment_txn_no_delete ON public.instalment_transactions;
CREATE TRIGGER trg_instalment_txn_no_delete BEFORE DELETE ON public.instalment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.instalment_txn_no_delete();

-- The existing fee_payments screens must not silently break a schedule: the fee a live plan/request covers can't be deleted
-- or have its total changed behind the plan's back (change the schedule instead).
CREATE OR REPLACE FUNCTION public.fee_payments_instalment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.instalment_plans WHERE fee_payment_id = OLD.id AND status <> 'cancelled')
       OR EXISTS (SELECT 1 FROM public.instalment_requests WHERE fee_payment_id = OLD.id AND status = 'pending') THEN
      RAISE EXCEPTION 'This fee has an instalment plan or a pending instalment request and cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.amount_due IS DISTINCT FROM OLD.amount_due
     AND EXISTS (SELECT 1 FROM public.instalment_plans WHERE fee_payment_id = OLD.id AND status = 'active') THEN
    RAISE EXCEPTION 'The amount of a fee with an active instalment plan cannot be changed - edit the instalment schedule instead' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fee_payments_instalment_guard ON public.fee_payments;
CREATE TRIGGER trg_fee_payments_instalment_guard BEFORE UPDATE OR DELETE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payments_instalment_guard();

-- 6. Notification helpers (write to the existing governance_notifications inbox) ----------------------------------
CREATE OR REPLACE FUNCTION public.instalment_staff_ids(p_school uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE school_id = p_school AND (COALESCE(erp_access, false) OR role IN ('admin', 'school_admin'));
$$;

CREATE OR REPLACE FUNCTION public.instalment_parent_ids(p_student uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ps.parent_id FROM public.students s
  JOIN public.parent_students ps ON ps.student_id IN (s.profile_id, s.id) WHERE s.id = p_student;
$$;

CREATE OR REPLACE FUNCTION public.instalment_notify(p_users uuid[], p_event text, p_title text, p_message text, p_ref uuid, p_ref_type text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type, channel)
  SELECT DISTINCT u, p_event, p_title, p_message, p_ref, p_ref_type, 'in_app' FROM unnest(p_users) u WHERE u IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.instalment_money(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'Rs. ' || trim(to_char(p, 'FM9,99,99,990.00')) $$;

-- 7. Schedule maths ------------------------------------------------------------------------------------------------
-- Split total into n parts at 2 decimals; the LAST part absorbs rounding so the parts sum EXACTLY to the total.
CREATE OR REPLACE FUNCTION public.instalment_split(p_total numeric, p_n integer) RETURNS numeric[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_base numeric := floor(p_total / p_n * 100) / 100; v_out numeric[] := '{}'; i integer;
BEGIN
  IF p_n < 1 THEN RAISE EXCEPTION 'Number of instalments must be at least 1'; END IF;
  FOR i IN 1 .. p_n - 1 LOOP v_out := v_out || v_base; END LOOP;
  RETURN v_out || (p_total - v_base * (p_n - 1));
END $$;

-- Validates + inserts a plan (and its items) for an approved request. Internal: callers have already authorised the user.
CREATE OR REPLACE FUNCTION public._instalment_build_plan(p_request_id uuid, p_items jsonb, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.instalment_requests; v_fee public.fee_payments; v_balance numeric; v_sum numeric := 0; v_n integer := 0;
  v_plan uuid; v_amts numeric[] := '{}'; v_dates date[] := '{}'; r record; i integer;
BEGIN
  SELECT * INTO v_req FROM public.instalment_requests WHERE id = p_request_id;
  SELECT * INTO v_fee FROM public.fee_payments WHERE id = v_req.fee_payment_id FOR UPDATE;
  IF v_fee.id IS NULL THEN RAISE EXCEPTION 'The fee record for this request no longer exists'; END IF;
  v_balance := v_fee.amount_due - v_fee.amount_paid;
  IF v_balance <= 0 THEN RAISE EXCEPTION 'This fee has no outstanding balance'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 2 THEN
    RAISE EXCEPTION 'A schedule needs at least 2 instalments';
  END IF;

  FOR r IN SELECT (e->>'amount')::numeric AS amt, (e->>'due_date')::date AS dd
             FROM jsonb_array_elements(p_items) WITH ORDINALITY t(e, ord) ORDER BY (e->>'due_date')::date, ord LOOP
    IF r.amt IS NULL OR r.amt <= 0 OR r.amt <> round(r.amt, 2) THEN RAISE EXCEPTION 'Each instalment amount must be positive with at most 2 decimals'; END IF;
    IF r.dd IS NULL THEN RAISE EXCEPTION 'Each instalment needs a due date'; END IF;
    IF r.dd < public.instalment_today() THEN RAISE EXCEPTION 'Instalment due dates cannot be in the past'; END IF;
    v_amts := v_amts || r.amt; v_dates := v_dates || r.dd; v_sum := v_sum + r.amt; v_n := v_n + 1;
  END LOOP;
  IF v_sum <> v_balance THEN
    RAISE EXCEPTION 'Instalments total % but the fee balance is % - they must match exactly', v_sum, v_balance;
  END IF;

  INSERT INTO public.instalment_plans (school_id, student_id, fee_payment_id, request_id, student_name, class_grade, section, total_amount, created_by)
  VALUES (v_req.school_id, v_req.student_id, v_fee.id, v_req.id, v_fee.student_name, v_fee.class_grade, v_fee.section, v_balance, p_actor)
  RETURNING id INTO v_plan;   -- UNIQUE(request_id) / one-active-plan-per-fee indexes stop duplicate schedules
  FOR i IN 1 .. v_n LOOP
    INSERT INTO public.instalment_items (plan_id, school_id, student_id, seq, amount, due_date) VALUES (v_plan, v_req.school_id, v_req.student_id, i, v_amts[i], v_dates[i]);
  END LOOP;

  UPDATE public.instalment_requests SET approved_amount = v_balance WHERE id = v_req.id;
  RETURN v_plan;
END $$;

-- 8. Parent: request a plan ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_instalment_plan(p_student_id uuid, p_fee_payment_id uuid, p_count integer, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee public.fee_payments; v_set public.instalment_settings; v_bal numeric; v_count integer; v_id uuid; v_avg numeric;
BEGIN
  IF NOT public.is_parent_of_student(p_student_id) THEN RAISE EXCEPTION 'Not authorised for this student' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_fee FROM public.fee_payments WHERE id = p_fee_payment_id AND student_id = p_student_id FOR UPDATE;
  IF v_fee.id IS NULL THEN RAISE EXCEPTION 'Fee record not found for this student'; END IF;
  SELECT * INTO v_set FROM public.instalment_settings WHERE school_id = v_fee.school_id;
  IF v_set.school_id IS NULL OR NOT v_set.enabled THEN RAISE EXCEPTION 'Instalment plans are not available at this school'; END IF;
  v_bal := v_fee.amount_due - v_fee.amount_paid;
  IF v_bal <= 0 THEN RAISE EXCEPTION 'This fee has no outstanding balance'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'Please enter a reason for the request'; END IF;

  v_count := CASE WHEN v_set.allow_flexible THEN COALESCE(p_count, v_set.default_count) ELSE v_set.default_count END;
  IF v_set.allow_flexible AND NOT (v_count = ANY (v_set.allowed_counts)) THEN
    RAISE EXCEPTION 'The school allows % instalments only', array_to_string(v_set.allowed_counts, ', ');
  END IF;
  v_avg := v_bal / v_count;
  IF v_set.min_instalment_amount IS NOT NULL AND v_avg < v_set.min_instalment_amount THEN
    RAISE EXCEPTION 'Each instalment would be below the school minimum of %; choose fewer instalments', v_set.min_instalment_amount;
  END IF;
  IF v_set.max_instalment_amount IS NOT NULL AND v_avg > v_set.max_instalment_amount THEN
    RAISE EXCEPTION 'Each instalment would be above the school maximum of %; choose more instalments', v_set.max_instalment_amount;
  END IF;
  IF EXISTS (SELECT 1 FROM public.instalment_plans WHERE fee_payment_id = v_fee.id AND status = 'active') THEN
    RAISE EXCEPTION 'This fee already has an instalment plan';
  END IF;
  IF EXISTS (SELECT 1 FROM public.instalment_requests WHERE fee_payment_id = v_fee.id AND status = 'pending') THEN
    RAISE EXCEPTION 'An instalment request for this fee is already pending';
  END IF;

  INSERT INTO public.instalment_requests (school_id, student_id, fee_payment_id, requested_amount, requested_count, reason, requested_by)
  VALUES (v_fee.school_id, p_student_id, v_fee.id, v_bal, v_count, btrim(p_reason), auth.uid()) RETURNING id INTO v_id;

  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_staff_ids(v_fee.school_id)), 'instalment_request_submitted',
    'New instalment request', v_fee.student_name || ' - ' || v_count || ' instalments for ' || public.instalment_money(v_bal) || ' requested.', v_id, 'instalment_request');
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(p_student_id)), 'instalment_request_submitted',
    'Instalment request submitted', 'Your request for ' || v_count || ' instalments for ' || v_fee.student_name || ' has been sent to the school.', v_id, 'instalment_request');
  RETURN v_id;
END $$;

-- 9. Staff: approve / reject -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_instalment_request(
  p_request_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL, p_items jsonb DEFAULT NULL, p_first_due date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.instalment_requests; v_set public.instalment_settings; v_fee public.fee_payments; v_plan uuid;
  v_items jsonb; v_amts numeric[]; v_first date; v_interval integer; i integer;
BEGIN
  SELECT * INTO v_req FROM public.instalment_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.is_fee_staff(v_req.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;   -- parents can never approve
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been %', v_req.status; END IF;

  IF p_decision = 'reject' THEN
    IF p_rejection_reason IS NULL OR length(btrim(p_rejection_reason)) = 0 THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
    UPDATE public.instalment_requests SET status = 'rejected', rejection_reason = btrim(p_rejection_reason), reviewed_by = auth.uid(), reviewed_at = now() WHERE id = v_req.id;
    PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_req.student_id)), 'instalment_request_rejected',
      'Instalment request rejected', 'Your instalment request was not approved. Reason: ' || btrim(p_rejection_reason), v_req.id, 'instalment_request');
    RETURN NULL;
  ELSIF p_decision <> 'approve' THEN
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  SELECT * INTO v_fee FROM public.fee_payments WHERE id = v_req.fee_payment_id FOR UPDATE;
  IF v_fee.id IS NULL THEN RAISE EXCEPTION 'The fee record for this request no longer exists'; END IF;
  v_items := p_items;
  IF v_items IS NULL THEN                      -- automatic schedule
    SELECT * INTO v_set FROM public.instalment_settings WHERE school_id = v_req.school_id;
    v_interval := COALESCE(v_set.default_interval_days, 30);
    v_first := COALESCE(p_first_due, public.instalment_today() + v_interval);
    v_amts := public.instalment_split(v_fee.amount_due - v_fee.amount_paid, v_req.requested_count);
    SELECT jsonb_agg(jsonb_build_object('amount', v_amts[g], 'due_date', (v_first + (g - 1) * v_interval)::text) ORDER BY g)
      INTO v_items FROM generate_series(1, v_req.requested_count) g;
  END IF;

  UPDATE public.instalment_requests SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = v_req.id;
  v_plan := public._instalment_build_plan(v_req.id, v_items, auth.uid());

  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_req.student_id)), 'instalment_request_approved',
    'Instalment request approved', 'Your instalment request for ' || v_fee.student_name || ' was approved.', v_req.id, 'instalment_request');
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_req.student_id)), 'instalment_schedule_created',
    'New payment schedule', 'A payment schedule of ' || jsonb_array_length(v_items) || ' instalments is ready for ' || v_fee.student_name || '.', v_plan, 'instalment_plan');
  RETURN v_plan;
END $$;

-- Staff: create a plan directly for a student's fee (no parent request). Recorded as an auto-approved request.
CREATE OR REPLACE FUNCTION public.create_instalment_plan_for_student(p_student_id uuid, p_fee_payment_id uuid, p_items jsonb, p_note text DEFAULT 'Created by school')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fee public.fee_payments; v_req uuid; v_plan uuid;
BEGIN
  SELECT * INTO v_fee FROM public.fee_payments WHERE id = p_fee_payment_id AND student_id = p_student_id FOR UPDATE;
  IF v_fee.id IS NULL THEN RAISE EXCEPTION 'Fee record not found for this student'; END IF;
  IF NOT public.is_fee_staff(v_fee.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  IF v_fee.amount_due - v_fee.amount_paid <= 0 THEN RAISE EXCEPTION 'This fee has no outstanding balance'; END IF;
  IF EXISTS (SELECT 1 FROM public.instalment_requests WHERE fee_payment_id = v_fee.id AND status = 'pending') THEN
    RAISE EXCEPTION 'A parent request for this fee is pending - review it instead';
  END IF;
  INSERT INTO public.instalment_requests (school_id, student_id, fee_payment_id, requested_amount, requested_count, reason, status, requested_by, reviewed_by, reviewed_at)
  VALUES (v_fee.school_id, p_student_id, v_fee.id, v_fee.amount_due - v_fee.amount_paid, GREATEST(jsonb_array_length(COALESCE(p_items, '[]'::jsonb)), 2),
          COALESCE(NULLIF(btrim(p_note), ''), 'Created by school'), 'approved', auth.uid(), auth.uid(), now()) RETURNING id INTO v_req;
  v_plan := public._instalment_build_plan(v_req, p_items, auth.uid());
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(p_student_id)), 'instalment_schedule_created',
    'New payment schedule', 'The school created an instalment schedule for ' || v_fee.student_name || '.', v_plan, 'instalment_plan');
  RETURN v_plan;
END $$;

-- 10. Staff: edit an approved schedule WITHOUT touching paid history -------------------------------------------------
-- p_items = the complete list of UNPAID instalments after the change: [{id?, amount, due_date}].
-- Items with an id are updated; items without are added; unpaid items left out are cancelled (only if nothing was paid on them).
CREATE OR REPLACE FUNCTION public.update_instalment_schedule(p_plan_id uuid, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.instalment_plans; r record; v_it public.instalment_items; v_max integer; v_total numeric; v_kept uuid[] := '{}'; v_today date := public.instalment_today();
BEGIN
  SELECT * INTO v_plan FROM public.instalment_plans WHERE id = p_plan_id FOR UPDATE;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF NOT public.is_fee_staff(v_plan.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  IF v_plan.status <> 'active' THEN RAISE EXCEPTION 'Only an active plan can be changed'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Schedule items are required'; END IF;

  FOR r IN SELECT NULLIF(e->>'id', '')::uuid AS id, (e->>'amount')::numeric AS amt, (e->>'due_date')::date AS dd FROM jsonb_array_elements(p_items) e LOOP
    IF r.amt IS NULL OR r.amt <= 0 OR r.amt <> round(r.amt, 2) THEN RAISE EXCEPTION 'Each instalment amount must be positive with at most 2 decimals'; END IF;
    IF r.dd IS NULL THEN RAISE EXCEPTION 'Each instalment needs a due date'; END IF;
    IF r.id IS NOT NULL THEN
      SELECT * INTO v_it FROM public.instalment_items WHERE id = r.id AND plan_id = p_plan_id FOR UPDATE;
      IF v_it.id IS NULL THEN RAISE EXCEPTION 'Instalment % does not belong to this plan', r.id; END IF;
      IF v_it.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'Instalment % is % and cannot be changed', v_it.seq, v_it.status; END IF;
      IF r.amt < v_it.amount_paid THEN RAISE EXCEPTION 'Instalment % already has % paid; its amount cannot be lower', v_it.seq, v_it.amount_paid; END IF;
      IF r.dd <> v_it.due_date AND r.dd < v_today THEN RAISE EXCEPTION 'A due date cannot be moved into the past'; END IF;
      IF r.amt <> v_it.amount THEN   -- any open gateway order for the old amount must not be paid against the new one
        UPDATE public.instalment_transactions SET status = 'cancelled', updated_at = now() WHERE item_id = v_it.id AND status IN ('created', 'pending') AND razorpay_payment_id IS NULL;
      END IF;
      UPDATE public.instalment_items SET amount = r.amt, due_date = r.dd,
             status = CASE WHEN amount_paid >= r.amt THEN 'paid' WHEN amount_paid > 0 THEN 'partially_paid' ELSE 'pending' END
       WHERE id = r.id;
      v_kept := v_kept || r.id;
    END IF;
  END LOOP;

  -- unpaid items the caller dropped
  FOR v_it IN SELECT * FROM public.instalment_items WHERE plan_id = p_plan_id AND status IN ('pending', 'partially_paid') AND NOT (id = ANY (v_kept)) FOR UPDATE LOOP
    IF v_it.amount_paid > 0 THEN RAISE EXCEPTION 'Instalment % has a payment and cannot be removed', v_it.seq; END IF;
    UPDATE public.instalment_transactions SET status = 'cancelled', updated_at = now() WHERE item_id = v_it.id AND status IN ('created', 'pending') AND razorpay_payment_id IS NULL;
    UPDATE public.instalment_items SET status = 'cancelled' WHERE id = v_it.id;
  END LOOP;

  SELECT COALESCE(max(seq), 0) INTO v_max FROM public.instalment_items WHERE plan_id = p_plan_id;
  FOR r IN SELECT (e->>'amount')::numeric AS amt, (e->>'due_date')::date AS dd FROM jsonb_array_elements(p_items) e WHERE NULLIF(e->>'id', '') IS NULL ORDER BY (e->>'due_date')::date LOOP
    IF r.dd < v_today THEN RAISE EXCEPTION 'A new instalment cannot be due in the past'; END IF;
    v_max := v_max + 1;
    INSERT INTO public.instalment_items (plan_id, school_id, student_id, seq, amount, due_date) VALUES (p_plan_id, v_plan.school_id, v_plan.student_id, v_max, r.amt, r.dd);
  END LOOP;

  SELECT COALESCE(sum(amount), 0) INTO v_total FROM public.instalment_items WHERE plan_id = p_plan_id AND status <> 'cancelled';
  IF v_total <> v_plan.total_amount THEN
    RAISE EXCEPTION 'Instalments total % but the plan total is % - they must match exactly', v_total, v_plan.total_amount;
  END IF;
  UPDATE public.instalment_plans SET updated_at = now() WHERE id = p_plan_id;
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_plan.student_id)), 'instalment_schedule_updated',
    'Payment schedule updated', 'The school updated the instalment schedule for ' || v_plan.student_name || '. Please review the new dates.', p_plan_id, 'instalment_plan');
END $$;

-- 11. Payment results: callable ONLY by the server (service_role), idempotent ---------------------------------------
CREATE OR REPLACE FUNCTION public.instalment_apply_payment_success(p_order_id text, p_payment_id text, p_amount_paise bigint, p_method text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t public.instalment_transactions; v_i public.instalment_items; v_credit numeric; v_new_paid numeric; v_receipt text; v_fee public.fee_payments;
BEGIN
  SELECT * INTO v_t FROM public.instalment_transactions WHERE razorpay_order_id = p_order_id FOR UPDATE;   -- serialises duplicate callbacks
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'Unknown order'; END IF;
  IF v_t.status IN ('success', 'partially_refunded', 'refunded') THEN
    IF v_t.razorpay_payment_id IS DISTINCT FROM p_payment_id THEN RAISE EXCEPTION 'Order is already settled by a different payment'; END IF;
    RETURN jsonb_build_object('already_processed', true, 'transaction_id', v_t.id, 'receipt_no', v_t.receipt_no, 'item_id', v_t.item_id);
  END IF;
  IF p_amount_paise <> round(v_t.amount * 100) THEN RAISE EXCEPTION 'Paid amount does not match the order'; END IF;

  SELECT * INTO v_i FROM public.instalment_items WHERE id = v_t.item_id FOR UPDATE;
  v_credit := LEAST(v_t.amount, v_i.amount - v_i.amount_paid);
  v_receipt := 'RCT-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-' || lpad(nextval('public.instalment_receipt_seq')::text, 6, '0');
  UPDATE public.instalment_transactions SET status = 'success', razorpay_payment_id = p_payment_id, method = p_method, paid_at = now(), updated_at = now(),
         receipt_no = v_receipt, failure_reason = NULL, needs_review = (v_credit < v_t.amount) WHERE id = v_t.id;

  IF v_credit > 0 THEN
    v_new_paid := v_i.amount_paid + v_credit;
    UPDATE public.instalment_items SET amount_paid = v_new_paid, status = CASE WHEN v_new_paid >= amount THEN 'paid' ELSE 'partially_paid' END,
           paid_at = CASE WHEN v_new_paid >= amount THEN now() ELSE paid_at END WHERE id = v_i.id;
    -- the student's outstanding balance lives on the existing fee record
    UPDATE public.fee_payments f SET amount_paid = LEAST(f.amount_due, f.amount_paid + v_credit),
           status = CASE WHEN f.amount_paid + v_credit >= f.amount_due THEN 'paid' ELSE f.status END
     WHERE f.id = (SELECT fee_payment_id FROM public.instalment_plans WHERE id = v_t.plan_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.instalment_items WHERE plan_id = v_t.plan_id AND status NOT IN ('paid', 'cancelled')) THEN
    UPDATE public.instalment_plans SET status = 'completed', updated_at = now() WHERE id = v_t.plan_id AND status = 'active';
  END IF;

  SELECT * INTO v_i FROM public.instalment_items WHERE id = v_t.item_id;
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_t.student_id)), 'instalment_payment_success', 'Payment successful',
    'We received ' || public.instalment_money(v_t.amount) || ' for instalment ' || v_i.seq || '. Receipt ' || v_receipt || '.', v_t.item_id, 'instalment_item');
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_staff_ids(v_t.school_id)), 'instalment_payment_success', 'Instalment payment received',
    public.instalment_money(v_t.amount) || ' received (instalment ' || v_i.seq || ').', v_t.item_id, 'instalment_item')
    WHERE v_credit < v_t.amount;   -- staff only hear about the unusual case needing review
  RETURN jsonb_build_object('already_processed', false, 'transaction_id', v_t.id, 'receipt_no', v_receipt, 'item_id', v_t.item_id, 'needs_review', v_credit < v_t.amount);
END $$;

CREATE OR REPLACE FUNCTION public.instalment_apply_payment_failure(p_order_id text, p_payment_id text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t public.instalment_transactions; v_seq integer;
BEGIN
  SELECT * INTO v_t FROM public.instalment_transactions WHERE razorpay_order_id = p_order_id FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'Unknown order'; END IF;
  -- a failed attempt must never downgrade a settled payment, and repeated failure callbacks notify once
  IF v_t.status IN ('success', 'partially_refunded', 'refunded', 'failed') THEN RETURN jsonb_build_object('ignored', true, 'status', v_t.status); END IF;
  UPDATE public.instalment_transactions SET status = 'failed', failure_reason = left(COALESCE(p_reason, 'Payment failed'), 500), updated_at = now() WHERE id = v_t.id;
  SELECT seq INTO v_seq FROM public.instalment_items WHERE id = v_t.item_id;
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_t.student_id)), 'instalment_payment_failed', 'Payment failed',
    'Your payment of ' || public.instalment_money(v_t.amount) || ' for instalment ' || v_seq || ' did not go through. No money was recorded - please try again.', v_t.item_id, 'instalment_item');
  RETURN jsonb_build_object('ignored', false, 'status', 'failed');
END $$;

CREATE OR REPLACE FUNCTION public.instalment_apply_payment_pending(p_order_id text, p_payment_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.instalment_transactions SET status = 'pending', razorpay_payment_id = COALESCE(razorpay_payment_id, p_payment_id), updated_at = now()
   WHERE razorpay_order_id = p_order_id AND status IN ('created', 'failed', 'cancelled');
$$;

-- Refunds: p_total_refunded_paise is the CUMULATIVE refunded amount reported by the gateway, so repeated callbacks are no-ops.
CREATE OR REPLACE FUNCTION public.instalment_apply_refund(p_payment_id text, p_total_refunded_paise bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t public.instalment_transactions; v_new numeric; v_delta numeric; v_i public.instalment_items; v_paid numeric;
BEGIN
  SELECT * INTO v_t FROM public.instalment_transactions WHERE razorpay_payment_id = p_payment_id FOR UPDATE;
  IF v_t.id IS NULL THEN RETURN jsonb_build_object('ignored', true); END IF;
  v_new := LEAST(v_t.amount, p_total_refunded_paise / 100.0);
  v_delta := v_new - v_t.refunded_amount;
  IF v_delta <= 0 OR v_t.status NOT IN ('success', 'partially_refunded') THEN RETURN jsonb_build_object('ignored', true); END IF;

  UPDATE public.instalment_transactions SET refunded_amount = v_new, status = CASE WHEN v_new >= amount THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now() WHERE id = v_t.id;
  SELECT * INTO v_i FROM public.instalment_items WHERE id = v_t.item_id FOR UPDATE;
  v_paid := GREATEST(v_i.amount_paid - v_delta, 0);
  UPDATE public.instalment_items SET amount_paid = v_paid, status = CASE WHEN v_paid >= amount THEN 'paid' WHEN v_paid > 0 THEN 'partially_paid' ELSE 'pending' END,
         paid_at = CASE WHEN v_paid >= amount THEN paid_at ELSE NULL END WHERE id = v_i.id;
  UPDATE public.fee_payments f SET amount_paid = GREATEST(f.amount_paid - v_delta, 0),
         status = CASE WHEN GREATEST(f.amount_paid - v_delta, 0) >= f.amount_due THEN f.status ELSE 'pending' END
   WHERE f.id = (SELECT fee_payment_id FROM public.instalment_plans WHERE id = v_t.plan_id);
  UPDATE public.instalment_plans SET status = 'active', updated_at = now() WHERE id = v_t.plan_id AND status = 'completed';
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_t.student_id)), 'instalment_payment_refunded', 'Payment refunded',
    public.instalment_money(v_delta) || ' was refunded for instalment ' || v_i.seq || '. The instalment balance has been updated.', v_t.item_id, 'instalment_item');
  RETURN jsonb_build_object('ignored', false, 'refunded', v_delta);
END $$;

-- Open an order record BEFORE the gateway is opened (called by create-instalment-order). Retries are safe: any earlier
-- unpaid order for the same instalment is retired, and an already-paid instalment cannot be ordered again.
CREATE OR REPLACE FUNCTION public.instalment_prepare_order(p_item_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_i public.instalment_items; v_p public.instalment_plans; v_amount numeric; v_auth boolean;
BEGIN
  SELECT * INTO v_i FROM public.instalment_items WHERE id = p_item_id FOR UPDATE;
  IF v_i.id IS NULL THEN RAISE EXCEPTION 'Instalment not found'; END IF;
  SELECT * INTO v_p FROM public.instalment_plans WHERE id = v_i.plan_id;
  SELECT EXISTS (SELECT 1 FROM public.students s JOIN public.parent_students ps ON ps.student_id IN (s.profile_id, s.id)
                  WHERE s.id = v_i.student_id AND ps.parent_id = p_user) INTO v_auth;
  IF NOT v_auth THEN RAISE EXCEPTION 'Not authorised for this student' USING ERRCODE = '42501'; END IF;
  IF v_p.status <> 'active' OR v_i.status NOT IN ('pending', 'partially_paid') THEN RAISE EXCEPTION 'This instalment is not payable'; END IF;
  v_amount := v_i.amount - v_i.amount_paid;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'This instalment has no outstanding balance'; END IF;
  -- a payment that is already being settled must finish first
  IF EXISTS (SELECT 1 FROM public.instalment_transactions WHERE item_id = v_i.id AND status = 'pending' AND created_at > now() - interval '30 minutes') THEN
    RAISE EXCEPTION 'A payment for this instalment is still being confirmed - please wait a moment';
  END IF;
  UPDATE public.instalment_transactions SET status = 'cancelled', updated_at = now() WHERE item_id = v_i.id AND status IN ('created', 'pending', 'failed') AND razorpay_payment_id IS NULL;
  RETURN jsonb_build_object('amount', v_amount, 'school_id', v_i.school_id, 'student_id', v_i.student_id, 'plan_id', v_i.plan_id, 'seq', v_i.seq, 'student_name', v_p.student_name);
END $$;

CREATE OR REPLACE FUNCTION public.instalment_record_order(p_item_id uuid, p_order_id text, p_amount numeric, p_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_i public.instalment_items; v_id uuid;
BEGIN
  SELECT * INTO v_i FROM public.instalment_items WHERE id = p_item_id;
  INSERT INTO public.instalment_transactions (school_id, student_id, plan_id, item_id, amount, razorpay_order_id, created_by)
  VALUES (v_i.school_id, v_i.student_id, v_i.plan_id, v_i.id, p_amount, p_order_id, p_user)
  ON CONFLICT (razorpay_order_id) DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.instalment_apply_payment_success(text, text, bigint, text), public.instalment_apply_payment_failure(text, text, text),
  public.instalment_apply_payment_pending(text, text), public.instalment_apply_refund(text, bigint),
  public.instalment_prepare_order(uuid, uuid), public.instalment_record_order(uuid, text, numeric, uuid),
  public._instalment_build_plan(uuid, jsonb, uuid), public.instalment_notify(uuid[], text, text, text, uuid, text),
  public.instalment_staff_ids(uuid), public.instalment_parent_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instalment_apply_payment_success(text, text, bigint, text), public.instalment_apply_payment_failure(text, text, text),
  public.instalment_apply_payment_pending(text, text), public.instalment_apply_refund(text, bigint),
  public.instalment_prepare_order(uuid, uuid), public.instalment_record_order(uuid, text, numeric, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.request_instalment_plan(uuid, uuid, integer, text), public.review_instalment_request(uuid, text, text, jsonb, date),
  public.create_instalment_plan_for_student(uuid, uuid, jsonb, text), public.update_instalment_schedule(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_instalment_plan(uuid, uuid, integer, text), public.review_instalment_request(uuid, text, text, jsonb, date),
  public.create_instalment_plan_for_student(uuid, uuid, jsonb, text), public.update_instalment_schedule(uuid, jsonb) TO authenticated;

-- 12. Read models --------------------------------------------------------------------------------------------------
-- Parent overview: fee records of ONE child (parents cannot read fee_payments directly) + instalment eligibility.
CREATE OR REPLACE FUNCTION public.get_parent_instalment_overview(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid; v_set public.instalment_settings; v_fees jsonb; v_today date := public.instalment_today();
BEGIN
  IF NOT public.is_parent_of_student(p_student_id) THEN RAISE EXCEPTION 'Not authorised for this student' USING ERRCODE = '42501'; END IF;
  SELECT school_id INTO v_school FROM public.students WHERE id = p_student_id;
  SELECT * INTO v_set FROM public.instalment_settings WHERE school_id = v_school;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'fee_payment_id', f.id, 'amount_due', f.amount_due, 'amount_paid', f.amount_paid,
      'balance', GREATEST(f.amount_due - f.amount_paid, 0), 'due_date', f.due_date, 'status', f.status,
      'overdue', (f.due_date IS NOT NULL AND f.due_date < v_today AND f.amount_due - f.amount_paid > 0),
      'course_amount', f.course_amount, 'transport_amount', f.transport_amount, 'other_amount', f.other_amount,
      'uniform_amount', f.uniform_amount, 'material_amount', f.material_amount, 'exam_amount', f.exam_amount,
      'plan_id', (SELECT id FROM public.instalment_plans pl WHERE pl.fee_payment_id = f.id AND pl.status IN ('active', 'completed') ORDER BY created_at DESC LIMIT 1),
      'pending_request_id', (SELECT id FROM public.instalment_requests r WHERE r.fee_payment_id = f.id AND r.status = 'pending' LIMIT 1),
      'eligible', (COALESCE(v_set.enabled, false) AND f.amount_due - f.amount_paid > 0
                   AND NOT EXISTS (SELECT 1 FROM public.instalment_plans pl WHERE pl.fee_payment_id = f.id AND pl.status = 'active')
                   AND NOT EXISTS (SELECT 1 FROM public.instalment_requests r WHERE r.fee_payment_id = f.id AND r.status = 'pending'))
    ) ORDER BY f.created_at), '[]'::jsonb) INTO v_fees
  FROM public.fee_payments f WHERE f.student_id = p_student_id;
  RETURN jsonb_build_object(
    'school_id', v_school,
    'settings', jsonb_build_object('enabled', COALESCE(v_set.enabled, false), 'allowed_counts', COALESCE(v_set.allowed_counts, '{}'),
        'allow_flexible', COALESCE(v_set.allow_flexible, true), 'default_count', COALESCE(v_set.default_count, 4),
        'min_instalment_amount', v_set.min_instalment_amount, 'max_instalment_amount', v_set.max_instalment_amount),
    'fees', v_fees);
END $$;
GRANT EXECUTE ON FUNCTION public.get_parent_instalment_overview(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_parent_instalment_overview(uuid) FROM PUBLIC, anon;

-- Admin dashboard numbers (all schools' data stays behind is_fee_staff).
CREATE OR REPLACE FUNCTION public.instalment_admin_summary(p_school uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_fee_staff(p_school) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  WITH it AS (
    SELECT i.*, p.class_grade, p.section, p.student_name, p.status AS plan_status,
           (i.status IN ('pending', 'partially_paid') AND i.due_date < public.instalment_today()) AS is_overdue
      FROM public.instalment_items i JOIN public.instalment_plans p ON p.id = i.plan_id
     WHERE i.school_id = p_school AND i.status <> 'cancelled' AND p.status <> 'cancelled'),
  cls AS (
    SELECT COALESCE(class_grade, '-') AS class_grade, COALESCE(section, '-') AS section,
           count(DISTINCT student_id) AS students, sum(amount) AS scheduled, sum(amount_paid) AS collected,
           sum(amount - amount_paid) AS pending, count(*) FILTER (WHERE is_overdue) AS overdue_count,
           COALESCE(sum(amount - amount_paid) FILTER (WHERE is_overdue), 0) AS overdue_amount
      FROM it GROUP BY 1, 2)
  SELECT jsonb_build_object(
    'students', (SELECT count(DISTINCT student_id) FROM it),
    'active_plans', (SELECT count(DISTINCT plan_id) FROM it WHERE plan_status = 'active'),
    'total_scheduled', COALESCE((SELECT sum(amount) FROM it), 0),
    'collected', COALESCE((SELECT sum(amount_paid) FROM it), 0),
    'pending', COALESCE((SELECT sum(amount - amount_paid) FROM it), 0),
    'overdue_count', (SELECT count(*) FROM it WHERE is_overdue),
    'overdue_amount', COALESCE((SELECT sum(amount - amount_paid) FROM it WHERE is_overdue), 0),
    'partially_paid_count', (SELECT count(*) FROM it WHERE status = 'partially_paid'),
    'pending_requests', (SELECT count(*) FROM public.instalment_requests WHERE school_id = p_school AND status = 'pending'),
    'by_class', COALESCE((SELECT jsonb_agg(to_jsonb(cls) ORDER BY class_grade, section) FROM cls), '[]'::jsonb)) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.instalment_admin_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instalment_admin_summary(uuid) TO authenticated;

-- 13. Reminders (pg_cron, hourly, inside the database - same pattern as calendar_run_reminders) -------------------
-- upcoming: once per configured "days before" tier   due today: once   overdue: first day, then every overdue_repeat_days.
-- instalment_reminder_log's primary key makes a repeat impossible, even if two runs overlap.
CREATE OR REPLACE FUNCTION public.instalment_run_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.instalment_today(); r record; v_kind text; v_days integer; v_tier integer; v_late integer; v_period integer;
  v_title text; v_msg text; v_total integer := 0; v_parent uuid; v_inserted integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('instalment_run_reminders', 0)) THEN RETURN 0; END IF;
  -- gateway orders nobody completed (closed checkout) are retired so they never look "in progress"
  UPDATE public.instalment_transactions SET status = 'cancelled', updated_at = now() WHERE status = 'created' AND created_at < now() - interval '24 hours';

  FOR r IN
    SELECT i.id, i.student_id, i.seq, i.amount, i.amount_paid, i.due_date, p.student_name, p.id AS plan_id,
           (SELECT count(*) FROM public.instalment_items x WHERE x.plan_id = i.plan_id AND x.status <> 'cancelled') AS n,
           COALESCE(s.reminder_days, '{7,3,1}') AS reminder_days, COALESCE(s.overdue_repeat_days, 3) AS repeat_days
      FROM public.instalment_items i
      JOIN public.instalment_plans p ON p.id = i.plan_id AND p.status = 'active'
      LEFT JOIN public.instalment_settings s ON s.school_id = i.school_id
     WHERE i.status IN ('pending', 'partially_paid')
  LOOP
    v_days := r.due_date - v_today; v_kind := NULL;
    IF v_days > 0 THEN
      SELECT min(d) INTO v_tier FROM unnest(r.reminder_days) d WHERE v_days <= d;   -- closest tier not yet passed
      IF v_tier IS NOT NULL THEN
        v_kind := 'upcoming_' || v_tier;
        v_title := 'Instalment due soon';
        v_msg := 'Instalment ' || r.seq || ' of ' || r.n || ' (' || public.instalment_money(r.amount - r.amount_paid) || ') for ' || r.student_name || ' is due on ' || to_char(r.due_date, 'DD Mon YYYY') || '.';
      END IF;
    ELSIF v_days = 0 THEN
      v_kind := 'due_today'; v_title := 'Instalment due today';
      v_msg := 'Instalment ' || r.seq || ' of ' || r.n || ' (' || public.instalment_money(r.amount - r.amount_paid) || ') for ' || r.student_name || ' is due today.';
    ELSE
      v_late := -v_days;
      v_period := CASE WHEN r.repeat_days > 0 THEN (v_late - 1) / r.repeat_days ELSE 0 END;   -- one notice per period
      v_kind := 'overdue_' || v_period; v_title := 'Instalment overdue';
      v_msg := 'Instalment ' || r.seq || ' of ' || r.n || ' (' || public.instalment_money(r.amount - r.amount_paid) || ') for ' || r.student_name || ' was due on ' || to_char(r.due_date, 'DD Mon YYYY') || ' and is overdue.';
    END IF;
    CONTINUE WHEN v_kind IS NULL;

    FOR v_parent IN SELECT public.instalment_parent_ids(r.student_id) LOOP
      INSERT INTO public.instalment_reminder_log (item_id, kind, occurrence, recipient_id) VALUES (r.id, v_kind, r.due_date, v_parent) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        PERFORM public.instalment_notify(ARRAY[v_parent], CASE WHEN v_kind LIKE 'overdue%' THEN 'instalment_overdue' WHEN v_kind = 'due_today' THEN 'instalment_due_today' ELSE 'instalment_upcoming' END,
                                         v_title, v_msg, r.id, 'instalment_item');
        v_total := v_total + 1;
      END IF;
    END LOOP;
  END LOOP;
  DELETE FROM public.instalment_reminder_log WHERE sent_at < now() - interval '400 days';
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.instalment_run_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instalment_run_reminders() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'instalment-reminders-hourly';
    PERFORM cron.schedule('instalment-reminders-hourly', '10 * * * *', 'SELECT public.instalment_run_reminders();');
  ELSE
    RAISE NOTICE 'pg_cron is not enabled - enable it, then run: SELECT cron.schedule(''instalment-reminders-hourly'', ''10 * * * *'', ''SELECT public.instalment_run_reminders();'');';
  END IF;
END $$;
-- Test by hand:  SELECT public.instalment_run_reminders();      Stop:  SELECT cron.unschedule('instalment-reminders-hourly');
