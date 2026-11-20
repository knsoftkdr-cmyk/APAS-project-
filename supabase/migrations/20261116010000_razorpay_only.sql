-- Razorpay is now the ONLY payment gateway. Stripe, PayU and Cashfree are removed from the app.
-- Run after 20261111000000_payment_gateways.sql. Safe to re-run.
--
--  * every school's gateway switches are reset to "Razorpay on" (a school that had only Stripe/PayU/Cashfree on would otherwise
--    be left with no way for parents to pay online)
--  * the CHECK constraints only allow 'razorpay' for NEW rows; the constraint is NOT VALID on purpose so past Stripe / PayU / Cashfree
--    transactions (receipts, refunds, history) stay in the database untouched
BEGIN;

INSERT INTO public.payment_gateway_settings (school_id, gateway, enabled, sort_order)
SELECT DISTINCT school_id, 'razorpay', true, 1 FROM public.payment_gateway_settings
ON CONFLICT (school_id, gateway) DO UPDATE SET enabled = true, sort_order = 1, updated_at = now();

DELETE FROM public.payment_gateway_settings WHERE gateway <> 'razorpay';

DO $$ DECLARE c record; BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
     WHERE contype = 'c' AND conrelid IN ('public.payment_gateway_settings'::regclass, 'public.payment_transactions'::regclass, 'public.instalment_transactions'::regclass)
       AND pg_get_constraintdef(oid) ILIKE '%gateway%' AND pg_get_constraintdef(oid) ILIKE '%stripe%'
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname); END LOOP;
END $$;

ALTER TABLE public.payment_gateway_settings  ADD CONSTRAINT chk_pgs_razorpay_only            CHECK (gateway = 'razorpay');
ALTER TABLE public.payment_transactions      ADD CONSTRAINT chk_payment_txn_razorpay_only    CHECK (gateway = 'razorpay') NOT VALID;
ALTER TABLE public.instalment_transactions   ADD CONSTRAINT chk_instalment_txn_razorpay_only CHECK (gateway = 'razorpay') NOT VALID;

COMMIT;
