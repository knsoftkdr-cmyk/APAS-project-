-- Gateway-neutral payment ledger (originally Razorpay, Stripe, PayU, Cashfree; now Razorpay only - see 20261116010000_razorpay_only.sql) for the existing ERP & Fees module.
-- Builds on 20261110000000_fee_instalments.sql. Safe to re-run.
--
--  * payment_gateway_settings : which gateways each school has switched on (NO credentials here - those are Supabase secrets)
--  * payment_transactions     : unified ledger for ONE-SHOT fee payments, any gateway (instalments keep instalment_transactions,
--                               which now also records the gateway; get_payment_history() shows both together)
--  * payment_* functions      : gateway-neutral entry points (service_role only) that route to the instalment or one-shot-fee logic,
--                               so success / failure / pending / refund / duplicate handling exists exactly once per kind.
-- Money is only credited by payment_apply_success(), which the edge functions call after the GATEWAY has confirmed the payment.

-- 1. Per-school gateway switches ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_gateway_settings (
  school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  gateway    text NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'payu', 'cashfree')),
  enabled    boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, gateway)
);
ALTER TABLE public.payment_gateway_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pgs_read ON public.payment_gateway_settings;
DROP POLICY IF EXISTS pgs_insert ON public.payment_gateway_settings;
DROP POLICY IF EXISTS pgs_update ON public.payment_gateway_settings;
CREATE POLICY pgs_read   ON public.payment_gateway_settings FOR SELECT TO authenticated USING (public.is_fee_staff(school_id));
CREATE POLICY pgs_insert ON public.payment_gateway_settings FOR INSERT TO authenticated WITH CHECK (public.is_fee_staff(school_id));
CREATE POLICY pgs_update ON public.payment_gateway_settings FOR UPDATE TO authenticated USING (public.is_fee_staff(school_id)) WITH CHECK (public.is_fee_staff(school_id));
REVOKE ALL ON public.payment_gateway_settings FROM anon;
REVOKE DELETE ON public.payment_gateway_settings FROM authenticated;

-- Enabled gateways of a school, in display order. A school that has never saved a choice keeps working exactly as before: Razorpay only.
CREATE OR REPLACE FUNCTION public.payment_gateway_enabled(p_school uuid, p_gateway text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.payment_gateway_settings WHERE school_id = p_school) THEN p_gateway = 'razorpay'
              ELSE COALESCE((SELECT enabled FROM public.payment_gateway_settings WHERE school_id = p_school AND gateway = p_gateway), false) END;
$$;

CREATE OR REPLACE FUNCTION public.payment_enabled_gateways(p_school uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_school_member(p_school) OR public.is_fee_staff(p_school)
          OR EXISTS (SELECT 1 FROM public.students s WHERE s.school_id = p_school AND public.is_parent_of_student(s.id))) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_gateway_settings WHERE school_id = p_school) THEN RETURN ARRAY['razorpay']; END IF;
  RETURN COALESCE((SELECT array_agg(gateway ORDER BY sort_order, gateway) FROM public.payment_gateway_settings WHERE school_id = p_school AND enabled), '{}'::text[]);
END $$;
REVOKE ALL ON FUNCTION public.payment_gateway_enabled(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_gateway_enabled(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.payment_enabled_gateways(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_enabled_gateways(uuid) TO authenticated;

-- 2. Unified ledger for one-shot fee payments ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id         uuid REFERENCES public.students(id) ON DELETE RESTRICT,
  fee_payment_id     uuid REFERENCES public.fee_payments(id) ON DELETE SET NULL,   -- the legacy parent screen deletes abandoned fee rows; the history must survive
  student_name       text,
  gateway            text NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'payu', 'cashfree')),
  gateway_order_id   text NOT NULL,          -- Razorpay order id | Stripe Checkout Session id | PayU txnid | Cashfree order_id
  gateway_payment_id text,                   -- Razorpay payment id | Stripe PaymentIntent id | PayU mihpayid | Cashfree cf_payment_id
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  currency           text NOT NULL DEFAULT 'INR',
  status             text NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created', 'pending', 'success', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
  failure_reason     text,
  refunded_amount    numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  receipt_no         text UNIQUE,
  method             text,
  needs_review       boolean NOT NULL DEFAULT false,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_txn_gateway_order UNIQUE (gateway, gateway_order_id)
);
-- a gateway payment can never create two records (duplicate callbacks)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_txn_gateway_payment ON public.payment_transactions (gateway, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_txn_school  ON public.payment_transactions (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_txn_student ON public.payment_transactions (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_txn_fee     ON public.payment_transactions (fee_payment_id);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_txn_read ON public.payment_transactions;
CREATE POLICY payment_txn_read ON public.payment_transactions FOR SELECT TO authenticated USING (public.is_fee_staff(school_id) OR public.is_parent_of_student(student_id));
REVOKE ALL ON public.payment_transactions FROM anon, authenticated;
GRANT SELECT ON public.payment_transactions TO authenticated;

CREATE OR REPLACE FUNCTION public.payment_txn_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Payment transactions cannot be deleted' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_payment_txn_no_delete ON public.payment_transactions;
CREATE TRIGGER trg_payment_txn_no_delete BEFORE DELETE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.payment_txn_no_delete();

-- 3. Instalment transactions learn which gateway took the money -------------------------------------------------------
-- razorpay_order_id / razorpay_payment_id now hold the GATEWAY's order / payment id whichever gateway was used
-- (renaming them would break the instalment functions and screens that already work).
ALTER TABLE public.instalment_transactions ADD COLUMN IF NOT EXISTS gateway text NOT NULL DEFAULT 'razorpay';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_instalment_txn_gateway') THEN
    ALTER TABLE public.instalment_transactions ADD CONSTRAINT chk_instalment_txn_gateway CHECK (gateway IN ('razorpay', 'stripe', 'payu', 'cashfree'));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.instalment_record_order(uuid, text, numeric, uuid);
CREATE OR REPLACE FUNCTION public.instalment_record_order(p_item_id uuid, p_order_id text, p_amount numeric, p_user uuid, p_gateway text DEFAULT 'razorpay', p_currency text DEFAULT 'INR')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_i public.instalment_items; v_id uuid;
BEGIN
  SELECT * INTO v_i FROM public.instalment_items WHERE id = p_item_id;
  INSERT INTO public.instalment_transactions (school_id, student_id, plan_id, item_id, amount, razorpay_order_id, created_by, gateway, currency)
  VALUES (v_i.school_id, v_i.student_id, v_i.plan_id, v_i.id, p_amount, p_order_id, p_user, p_gateway, p_currency)
  ON CONFLICT (razorpay_order_id) DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.instalment_record_order(uuid, text, numeric, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instalment_record_order(uuid, text, numeric, uuid, text, text) TO service_role;

-- an instalment can only be paid through a gateway the school has switched on
CREATE OR REPLACE FUNCTION public.instalment_check_gateway(p_item_id uuid, p_gateway text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM public.instalment_items WHERE id = p_item_id;
  IF NOT public.payment_gateway_enabled(v_school, p_gateway) THEN RAISE EXCEPTION 'This payment method is not enabled for your school'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.instalment_check_gateway(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instalment_check_gateway(uuid, text) TO service_role;

-- 4. One-shot fee payments ---------------------------------------------------------------------------------------------
-- Same trust model as the instalment functions: callable ONLY by the server (service_role), idempotent, amount from the database.
CREATE OR REPLACE FUNCTION public.fee_prepare_order(p_fee_id uuid, p_user uuid, p_gateway text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_f public.fee_payments; v_auth boolean; v_balance numeric;
BEGIN
  SELECT * INTO v_f FROM public.fee_payments WHERE id = p_fee_id FOR UPDATE;
  IF v_f.id IS NULL THEN RAISE EXCEPTION 'Fee record not found'; END IF;
  IF v_f.student_id IS NULL THEN RAISE EXCEPTION 'This fee record is not linked to a student'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.students s JOIN public.parent_students ps ON ps.student_id IN (s.profile_id, s.id)
                  WHERE s.id = v_f.student_id AND ps.parent_id = p_user) INTO v_auth;
  IF NOT v_auth THEN RAISE EXCEPTION 'Not authorised for this student' USING ERRCODE = '42501'; END IF;
  IF NOT public.payment_gateway_enabled(v_f.school_id, p_gateway) THEN RAISE EXCEPTION 'This payment method is not enabled for your school'; END IF;
  v_balance := v_f.amount_due - v_f.amount_paid;
  IF v_balance <= 0 THEN RAISE EXCEPTION 'This fee record has no outstanding balance'; END IF;
  IF EXISTS (SELECT 1 FROM public.instalment_plans WHERE fee_payment_id = v_f.id AND status = 'active') THEN
    RAISE EXCEPTION 'This fee is on an instalment plan - please pay its instalments instead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE fee_payment_id = v_f.id AND status = 'pending' AND created_at > now() - interval '30 minutes') THEN
    RAISE EXCEPTION 'A payment for this fee is still being confirmed - please wait a moment';
  END IF;
  UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now()
   WHERE fee_payment_id = v_f.id AND status IN ('created', 'pending', 'failed') AND gateway_payment_id IS NULL;
  RETURN jsonb_build_object('amount', v_balance, 'school_id', v_f.school_id, 'student_id', v_f.student_id, 'student_name', v_f.student_name, 'currency', 'INR');
END $$;

CREATE OR REPLACE FUNCTION public.fee_record_order(p_fee_id uuid, p_gateway text, p_order_id text, p_amount numeric, p_currency text, p_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_f public.fee_payments; v_id uuid;
BEGIN
  SELECT * INTO v_f FROM public.fee_payments WHERE id = p_fee_id;
  INSERT INTO public.payment_transactions (school_id, student_id, fee_payment_id, student_name, gateway, gateway_order_id, amount, currency, created_by)
  VALUES (v_f.school_id, v_f.student_id, v_f.id, v_f.student_name, p_gateway, p_order_id, p_amount, COALESCE(p_currency, 'INR'), p_user)
  ON CONFLICT (gateway, gateway_order_id) DO NOTHING RETURNING id INTO v_id;
  IF p_gateway = 'razorpay' THEN UPDATE public.fee_payments SET razorpay_order_id = p_order_id WHERE id = v_f.id; END IF;   -- keeps existing ERP screens/receipts working
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.fee_apply_payment_success(p_gateway text, p_order_id text, p_payment_id text, p_amount_minor bigint, p_method text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t public.payment_transactions; v_f public.fee_payments; v_receipt text; v_credit numeric; v_new_paid numeric;
  v_cols text[] := ARRAY['course_amount', 'transport_amount', 'other_amount', 'uniform_amount', 'material_amount', 'exam_amount'];
  v_rem jsonb := '{}'; v_col text; v_row public.fee_payments; v_rj jsonb; v_deduct numeric; v_reduce numeric; v_have numeric;
BEGIN
  SELECT * INTO v_t FROM public.payment_transactions WHERE gateway = p_gateway AND gateway_order_id = p_order_id FOR UPDATE;   -- serialises duplicate callbacks
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'Unknown order'; END IF;
  IF v_t.status IN ('success', 'partially_refunded', 'refunded') THEN
    IF v_t.gateway_payment_id IS DISTINCT FROM p_payment_id THEN RAISE EXCEPTION 'Order is already settled by a different payment'; END IF;
    RETURN jsonb_build_object('already_processed', true, 'kind', 'fee', 'transaction_id', v_t.id, 'receipt_no', v_t.receipt_no);
  END IF;
  IF p_amount_minor <> round(v_t.amount * 100) THEN RAISE EXCEPTION 'Paid amount does not match the order'; END IF;

  v_receipt := 'RCT-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-' || lpad(nextval('public.instalment_receipt_seq')::text, 6, '0');
  SELECT * INTO v_f FROM public.fee_payments WHERE id = v_t.fee_payment_id FOR UPDATE;
  v_credit := CASE WHEN v_f.id IS NULL THEN 0 ELSE LEAST(v_t.amount, GREATEST(v_f.amount_due - v_f.amount_paid, 0)) END;
  UPDATE public.payment_transactions SET status = 'success', gateway_payment_id = p_payment_id, method = p_method, paid_at = now(), updated_at = now(),
         receipt_no = v_receipt, failure_reason = NULL, needs_review = (v_credit < v_t.amount) WHERE id = v_t.id;

  IF v_credit > 0 THEN
    v_new_paid := v_f.amount_paid + v_credit;
    UPDATE public.fee_payments SET amount_paid = v_new_paid, status = CASE WHEN v_new_paid >= amount_due THEN 'paid' ELSE status END,
           razorpay_payment_id = p_payment_id WHERE id = v_f.id;   -- column predates multi-gateway; holds the gateway payment id for receipts
    -- Existing behaviour (previously in verify-razorpay-payment): once the parent's fee row is fully paid, the same categories are
    -- deducted from the student's other pending rows so "still owed" goes down.
    IF v_new_paid >= v_f.amount_due AND v_f.student_id IS NOT NULL THEN
      FOREACH v_col IN ARRAY v_cols LOOP v_rem := v_rem || jsonb_build_object(v_col, COALESCE((to_jsonb(v_f) ->> v_col)::numeric, 0)); END LOOP;
      FOR v_row IN SELECT * FROM public.fee_payments fp WHERE fp.student_id = v_f.student_id AND fp.status = 'pending' AND fp.id <> v_f.id
                      -- a fee that carries an instalment plan / request is governed by its schedule: never touch its total here
                      AND NOT EXISTS (SELECT 1 FROM public.instalment_plans pl WHERE pl.fee_payment_id = fp.id AND pl.status = 'active')
                      AND NOT EXISTS (SELECT 1 FROM public.instalment_requests rq WHERE rq.fee_payment_id = fp.id AND rq.status = 'pending')
                    ORDER BY fp.created_at LOOP
        v_rj := to_jsonb(v_row); v_reduce := 0;
        FOREACH v_col IN ARRAY v_cols LOOP
          IF (v_rem ->> v_col)::numeric > 0 THEN
            v_have := COALESCE((v_rj ->> v_col)::numeric, 0);
            v_deduct := LEAST(v_have, (v_rem ->> v_col)::numeric);
            IF v_deduct > 0 THEN
              v_rj := v_rj || jsonb_build_object(v_col, v_have - v_deduct);
              v_rem := v_rem || jsonb_build_object(v_col, (v_rem ->> v_col)::numeric - v_deduct);
              v_reduce := v_reduce + v_deduct;
            END IF;
          END IF;
        END LOOP;
        IF v_reduce > 0 THEN
          UPDATE public.fee_payments SET course_amount = (v_rj ->> 'course_amount')::numeric, transport_amount = (v_rj ->> 'transport_amount')::numeric,
                 other_amount = (v_rj ->> 'other_amount')::numeric, uniform_amount = (v_rj ->> 'uniform_amount')::numeric,
                 material_amount = (v_rj ->> 'material_amount')::numeric, exam_amount = (v_rj ->> 'exam_amount')::numeric,
                 amount_due = GREATEST(amount_due - v_reduce, 0) WHERE id = v_row.id;
        END IF;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_rem) e WHERE e.value::numeric > 0);
      END LOOP;
    END IF;
  END IF;

  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_t.student_id)), 'fee_payment_success', 'Payment successful',
    'We received ' || public.instalment_money(v_t.amount) || ' for ' || COALESCE(v_t.student_name, 'your child') || '. Receipt ' || v_receipt || '.', v_t.id, 'payment_transaction');
  IF v_credit < v_t.amount THEN
    PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_staff_ids(v_t.school_id)), 'fee_payment_review', 'Payment needs review',
      public.instalment_money(v_t.amount) || ' was received for ' || COALESCE(v_t.student_name, 'a student') || ' but the fee record had changed. Please review.', v_t.id, 'payment_transaction');
  END IF;
  RETURN jsonb_build_object('already_processed', false, 'kind', 'fee', 'transaction_id', v_t.id, 'receipt_no', v_receipt, 'needs_review', v_credit < v_t.amount);
END $$;

CREATE OR REPLACE FUNCTION public.fee_apply_payment_failure(p_gateway text, p_order_id text, p_payment_id text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t public.payment_transactions;
BEGIN
  SELECT * INTO v_t FROM public.payment_transactions WHERE gateway = p_gateway AND gateway_order_id = p_order_id FOR UPDATE;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'Unknown order'; END IF;
  IF v_t.status IN ('success', 'partially_refunded', 'refunded', 'failed') THEN RETURN jsonb_build_object('ignored', true, 'status', v_t.status); END IF;
  UPDATE public.payment_transactions SET status = 'failed', failure_reason = left(COALESCE(p_reason, 'Payment failed'), 500), updated_at = now() WHERE id = v_t.id;
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_t.student_id)), 'fee_payment_failed', 'Payment failed',
    'Your payment of ' || public.instalment_money(v_t.amount) || ' did not go through. No money was recorded - please try again.', v_t.id, 'payment_transaction');
  RETURN jsonb_build_object('ignored', false, 'status', 'failed');
END $$;

CREATE OR REPLACE FUNCTION public.fee_apply_payment_pending(p_gateway text, p_order_id text, p_payment_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.payment_transactions SET status = 'pending', gateway_payment_id = COALESCE(gateway_payment_id, p_payment_id), updated_at = now()
   WHERE gateway = p_gateway AND gateway_order_id = p_order_id AND status IN ('created', 'failed', 'cancelled');
$$;

CREATE OR REPLACE FUNCTION public.fee_apply_refund(p_gateway text, p_payment_id text, p_total_refunded_minor bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t public.payment_transactions; v_new numeric; v_delta numeric;
BEGIN
  SELECT * INTO v_t FROM public.payment_transactions WHERE gateway = p_gateway AND gateway_payment_id = p_payment_id FOR UPDATE;
  IF v_t.id IS NULL THEN RETURN jsonb_build_object('ignored', true); END IF;
  v_new := LEAST(v_t.amount, p_total_refunded_minor / 100.0);   -- cumulative figure from the gateway: repeats are no-ops
  v_delta := v_new - v_t.refunded_amount;
  IF v_delta <= 0 OR v_t.status NOT IN ('success', 'partially_refunded') THEN RETURN jsonb_build_object('ignored', true); END IF;
  UPDATE public.payment_transactions SET refunded_amount = v_new, status = CASE WHEN v_new >= amount THEN 'refunded' ELSE 'partially_refunded' END, updated_at = now() WHERE id = v_t.id;
  UPDATE public.fee_payments f SET amount_paid = GREATEST(f.amount_paid - v_delta, 0),
         status = CASE WHEN GREATEST(f.amount_paid - v_delta, 0) >= f.amount_due THEN f.status ELSE 'pending' END
   WHERE f.id = v_t.fee_payment_id;
  PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_parent_ids(v_t.student_id)), 'fee_payment_refunded', 'Payment refunded',
    public.instalment_money(v_delta) || ' was refunded. The fee balance has been updated.', v_t.id, 'payment_transaction');
  RETURN jsonb_build_object('ignored', false, 'refunded', v_delta);
END $$;

-- 5. Gateway-neutral entry points (the edge functions call ONLY these) ------------------------------------------------
-- Find a transaction by the gateway's order id. When p_user is given the caller must be the child's parent or finance staff.
CREATE OR REPLACE FUNCTION public.payment_lookup_order(p_gateway text, p_order_id text, p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_student uuid; v_school uuid; v_ok boolean;
BEGIN
  SELECT jsonb_build_object('kind', 'instalment', 'transaction_id', id, 'amount', amount, 'amount_minor', round(amount * 100), 'currency', currency,
                            'status', status, 'student_id', student_id, 'school_id', school_id, 'gateway', gateway, 'payment_id', razorpay_payment_id), student_id, school_id
    INTO v, v_student, v_school FROM public.instalment_transactions WHERE gateway = p_gateway AND razorpay_order_id = p_order_id;
  IF v IS NULL THEN
    SELECT jsonb_build_object('kind', 'fee', 'transaction_id', id, 'amount', amount, 'amount_minor', round(amount * 100), 'currency', currency,
                              'status', status, 'student_id', student_id, 'school_id', school_id, 'gateway', gateway, 'payment_id', gateway_payment_id), student_id, school_id
      INTO v, v_student, v_school FROM public.payment_transactions WHERE gateway = p_gateway AND gateway_order_id = p_order_id;
  END IF;
  IF v IS NULL THEN RETURN NULL; END IF;
  IF p_user IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.students s JOIN public.parent_students ps ON ps.student_id IN (s.profile_id, s.id) WHERE s.id = v_student AND ps.parent_id = p_user)
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user AND pr.school_id = v_school AND (COALESCE(pr.erp_access, false) OR pr.role IN ('admin', 'school_admin')))
      INTO v_ok;
    IF NOT v_ok THEN RETURN NULL; END IF;
  END IF;
  RETURN v;
END $$;

-- Find a transaction by the gateway's payment id (refund webhooks).
CREATE OR REPLACE FUNCTION public.payment_lookup_payment(p_gateway text, p_payment_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object('kind', 'instalment', 'order_id', razorpay_order_id, 'amount_minor', round(amount * 100)) INTO v FROM public.instalment_transactions WHERE gateway = p_gateway AND razorpay_payment_id = p_payment_id;
  IF v IS NULL THEN SELECT jsonb_build_object('kind', 'fee', 'order_id', gateway_order_id, 'amount_minor', round(amount * 100)) INTO v FROM public.payment_transactions WHERE gateway = p_gateway AND gateway_payment_id = p_payment_id; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.payment_apply_success(p_gateway text, p_order_id text, p_payment_id text, p_amount_minor bigint, p_method text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.instalment_transactions WHERE gateway = p_gateway AND razorpay_order_id = p_order_id) THEN
    r := public.instalment_apply_payment_success(p_order_id, p_payment_id, p_amount_minor, p_method);
    RETURN r || jsonb_build_object('kind', 'instalment');
  END IF;
  RETURN public.fee_apply_payment_success(p_gateway, p_order_id, p_payment_id, p_amount_minor, p_method);
END $$;

CREATE OR REPLACE FUNCTION public.payment_apply_failure(p_gateway text, p_order_id text, p_payment_id text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.instalment_transactions WHERE gateway = p_gateway AND razorpay_order_id = p_order_id) THEN
    RETURN public.instalment_apply_payment_failure(p_order_id, p_payment_id, p_reason);
  END IF;
  RETURN public.fee_apply_payment_failure(p_gateway, p_order_id, p_payment_id, p_reason);
END $$;

CREATE OR REPLACE FUNCTION public.payment_apply_pending(p_gateway text, p_order_id text, p_payment_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.instalment_transactions WHERE gateway = p_gateway AND razorpay_order_id = p_order_id) THEN
    PERFORM public.instalment_apply_payment_pending(p_order_id, p_payment_id);
  ELSE
    PERFORM public.fee_apply_payment_pending(p_gateway, p_order_id, p_payment_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.payment_apply_refund(p_gateway text, p_payment_id text, p_total_refunded_minor bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.instalment_transactions WHERE gateway = p_gateway AND razorpay_payment_id = p_payment_id) THEN
    RETURN public.instalment_apply_refund(p_payment_id, p_total_refunded_minor);
  END IF;
  RETURN public.fee_apply_refund(p_gateway, p_payment_id, p_total_refunded_minor);
END $$;

-- 6. Unified transaction history (one-shot fees + instalments, every gateway) -------------------------------------------
-- Parents: their child's rows. Finance staff: their whole school. Nobody else gets anything.
CREATE OR REPLACE FUNCTION public.get_payment_history(p_school uuid DEFAULT NULL, p_student uuid DEFAULT NULL, p_limit integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid := p_school; v_out jsonb;
BEGIN
  IF p_student IS NOT NULL THEN
    SELECT school_id INTO v_school FROM public.students WHERE id = p_student;
    IF NOT (public.is_parent_of_student(p_student) OR public.is_fee_staff(v_school)) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  ELSIF NOT public.is_fee_staff(v_school) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT * FROM (
      SELECT t.id, 'fee'::text AS kind, t.gateway, t.gateway_order_id AS order_id, t.gateway_payment_id AS payment_id, t.amount, t.currency, t.status,
             t.refunded_amount, t.receipt_no, t.method, t.failure_reason, t.needs_review, t.student_id, t.student_name, 'Fee payment'::text AS label, t.created_at, t.paid_at
        FROM public.payment_transactions t
       WHERE t.school_id = v_school AND (p_student IS NULL OR t.student_id = p_student) AND t.status NOT IN ('created', 'cancelled')
      UNION ALL
      SELECT x.id, 'instalment', x.gateway, x.razorpay_order_id, x.razorpay_payment_id, x.amount, x.currency, x.status,
             x.refunded_amount, x.receipt_no, x.method, x.failure_reason, x.needs_review, x.student_id, p.student_name, 'Instalment ' || i.seq, x.created_at, x.paid_at
        FROM public.instalment_transactions x
        JOIN public.instalment_plans p ON p.id = x.plan_id JOIN public.instalment_items i ON i.id = x.item_id
       WHERE x.school_id = v_school AND (p_student IS NULL OR x.student_id = p_student) AND x.status NOT IN ('created', 'cancelled')
    ) u ORDER BY u.created_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  ) h;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.get_payment_history(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_history(uuid, uuid, integer) TO authenticated;

-- 7. Grants: the server-only functions ---------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.fee_prepare_order(uuid, uuid, text), public.fee_record_order(uuid, text, text, numeric, text, uuid),
  public.fee_apply_payment_success(text, text, text, bigint, text), public.fee_apply_payment_failure(text, text, text, text),
  public.fee_apply_payment_pending(text, text, text), public.fee_apply_refund(text, text, bigint),
  public.payment_lookup_order(text, text, uuid), public.payment_lookup_payment(text, text),
  public.payment_apply_success(text, text, text, bigint, text), public.payment_apply_failure(text, text, text, text),
  public.payment_apply_pending(text, text, text), public.payment_apply_refund(text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.fee_prepare_order(uuid, uuid, text), public.fee_record_order(uuid, text, text, numeric, text, uuid),
  public.fee_apply_payment_success(text, text, text, bigint, text), public.fee_apply_payment_failure(text, text, text, text),
  public.fee_apply_payment_pending(text, text, text), public.fee_apply_refund(text, text, bigint),
  public.payment_lookup_order(text, text, uuid), public.payment_lookup_payment(text, text),
  public.payment_apply_success(text, text, text, bigint, text), public.payment_apply_failure(text, text, text, text),
  public.payment_apply_pending(text, text, text), public.payment_apply_refund(text, text, bigint) TO service_role;
