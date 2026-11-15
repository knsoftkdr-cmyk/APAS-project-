-- Multi-gateway scenarios. Runs AFTER 02_scenarios.sql (re-uses its schools / users / students) and the 20261111 migration.
-- ===== fixtures =====
DO $$ DECLARE sa uuid := t.u('schoolA'); BEGIN
  PERFORM t.as_super();
  INSERT INTO public.fee_payments (id, school_id, student_id, student_name, class_grade, section, amount_due, due_date, course_amount, other_amount, status)
    VALUES (gen_random_uuid(), sa, t.u('sA2'), 'Diya A2', '8', 'B', 5000, current_date + 5, 3000, 2000, 'pending');
  PERFORM t.set('feeG1', (SELECT id FROM public.fee_payments WHERE student_id = t.u('sA2') AND amount_due = 5000)::text);
  -- an older admin-created row the parent's payment must reduce (existing behaviour)
  INSERT INTO public.fee_payments (id, school_id, student_id, student_name, class_grade, section, amount_due, due_date, course_amount, other_amount, status)
    VALUES (gen_random_uuid(), sa, t.u('sA2'), 'Diya A2', '8', 'B', 10000, current_date + 9, 10000, 0, 'pending');
  PERFORM t.set('feeG0', (SELECT id FROM public.fee_payments WHERE student_id = t.u('sA2') AND amount_due = 10000)::text);
  INSERT INTO public.fee_payments (id, school_id, student_id, student_name, class_grade, section, amount_due, due_date, course_amount, status)
    VALUES (gen_random_uuid(), t.u('schoolB'), t.u('sB1'), 'Ishan B1', '9', 'A', 7000, current_date + 5, 7000, 'pending');
  UPDATE public.fee_payments SET status = 'paid' WHERE id = t.u('feeA2');   -- keep this student's only open row the one under test
  UPDATE public.fee_payments SET course_amount = 100000.01 WHERE id = t.u('feeA1b');   -- a row with an ACTIVE plan that has a course amount
  INSERT INTO public.fee_payments (id, school_id, student_id, student_name, class_grade, section, amount_due, due_date, course_amount, status)
    VALUES (gen_random_uuid(), sa, t.u('sA1'), 'Aarav A1', '8', 'A', 1000, current_date + 5, 1000, 'pending');
  PERFORM t.set('feeG3', (SELECT id FROM public.fee_payments WHERE student_id = t.u('sA1') AND amount_due = 1000)::text);
  PERFORM t.set('feeGB', (SELECT id FROM public.fee_payments WHERE student_id = t.u('sB1') AND amount_due = 7000)::text);
END $$;

-- ===== G1. which gateways are on =====
DO $$ BEGIN
  PERFORM t.as_user(t.u('parent2'));
  PERFORM t.ok('G1a a school that never chose keeps working: Razorpay only', public.payment_enabled_gateways(t.u('schoolA')) = ARRAY['razorpay']);
  PERFORM t.as_user(t.u('parentB'));
  PERFORM t.err('G1b a parent of another school cannot read this school''s gateways', format('SELECT public.payment_enabled_gateways(%L)', t.u('schoolA')), 'Not authorised');
  PERFORM t.err('G1c parent cannot switch gateways on', format('INSERT INTO public.payment_gateway_settings (school_id, gateway, enabled) VALUES (%L, %L, true)', t.u('schoolB'), 'stripe'), 'row-level security|permission denied');
  PERFORM t.as_user(t.u('teacherA'));
  PERFORM t.err('G1d non-finance staff cannot switch gateways on', format('INSERT INTO public.payment_gateway_settings (school_id, gateway, enabled) VALUES (%L, %L, true)', t.u('schoolA'), 'stripe'), 'row-level security|permission denied');
  PERFORM t.as_user(t.u('adminB'));
  PERFORM t.err('G1e admin of ANOTHER school cannot configure this school', format('INSERT INTO public.payment_gateway_settings (school_id, gateway, enabled) VALUES (%L, %L, true)', t.u('schoolA'), 'stripe'), 'row-level security');
  PERFORM t.as_user(t.u('adminA'));
  INSERT INTO public.payment_gateway_settings (school_id, gateway, enabled, sort_order) VALUES
    (t.u('schoolA'), 'razorpay', true, 1), (t.u('schoolA'), 'stripe', true, 2), (t.u('schoolA'), 'payu', false, 3), (t.u('schoolA'), 'cashfree', true, 4);
  PERFORM t.err('G1f unknown gateway rejected', format('INSERT INTO public.payment_gateway_settings (school_id, gateway, enabled) VALUES (%L, %L, true)', t.u('schoolA'), 'paypal'), 'check constraint|violates');
  UPDATE public.payment_gateway_settings SET enabled = false WHERE school_id = t.u('schoolA') AND gateway = 'cashfree';
  PERFORM t.as_user(t.u('parent2'));
  PERFORM t.ok('G1g parent sees exactly the enabled gateways, in order', public.payment_enabled_gateways(t.u('schoolA')) = ARRAY['razorpay', 'stripe']);
  PERFORM t.as_user(t.u('parentB'));
  PERFORM t.ok('G1h school B is unaffected (Razorpay default)', public.payment_enabled_gateways(t.u('schoolB')) = ARRAY['razorpay']);
END $$;

-- ===== G2. creating an order =====
DO $$ BEGIN
  PERFORM t.as_service();
  PERFORM t.err('G2a a gateway the school switched off is refused', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeG1'), t.u('parent2'), 'payu'), 'not enabled');
  PERFORM t.err('G2b ... also cashfree after it was switched off', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeG1'), t.u('parent2'), 'cashfree'), 'not enabled');
  PERFORM t.err('G2c another parent cannot pay this child''s fee', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeG1'), t.u('parent1'), 'stripe'), 'Not authorised');
  PERFORM t.err('G2d unknown fee', format('SELECT public.fee_prepare_order(%L,%L,%L)', gen_random_uuid(), t.u('parent2'), 'stripe'), 'not found');
  PERFORM t.err('G2e a fee on an active instalment plan must be paid by instalments', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeA1b'), t.u('parent1'), 'razorpay'), 'instalment plan');
  PERFORM t.ok('G2f amount is read from the database', (public.fee_prepare_order(t.u('feeG1'), t.u('parent2'), 'stripe')->>'amount')::numeric = 5000);
END $$;

-- ===== G3. failure, retry, success =====
DO $$ DECLARE r jsonb; BEGIN
  PERFORM t.as_service();
  PERFORM t.ok('G3a order recorded', public.fee_record_order(t.u('feeG1'), 'stripe', 'cs_test_1', 5000, 'INR', t.u('parent2')) IS NOT NULL);
  PERFORM t.ok('G3b recording the same order twice creates nothing new', public.fee_record_order(t.u('feeG1'), 'stripe', 'cs_test_1', 5000, 'INR', t.u('parent2')) IS NULL);
  r := public.payment_apply_failure('stripe', 'cs_test_1', 'pi_1', 'card declined');
  PERFORM t.ok('G3c failed payment is recorded as failed', (SELECT status = 'failed' AND failure_reason = 'card declined' FROM public.payment_transactions WHERE gateway='stripe' AND gateway_order_id='cs_test_1'));
  PERFORM t.ok('G3d ... and the fee balance did NOT change', (SELECT amount_paid = 0 AND status = 'pending' FROM public.fee_payments WHERE id = t.u('feeG1')));
  r := public.payment_apply_failure('stripe', 'cs_test_1', 'pi_1', 'card declined');
  PERFORM t.ok('G3e repeated failure callback is a no-op', (r->>'ignored')::boolean);
  PERFORM t.ok('G3f parent was notified once of the failure', t.cnt(format('SELECT count(*) FROM public.governance_notifications WHERE event_type=%L AND user_id=%L', 'fee_payment_failed', t.u('parent2'))) = 1);
  -- retry: new order retires the failed one
  PERFORM public.fee_prepare_order(t.u('feeG1'), t.u('parent2'), 'stripe');
  PERFORM public.fee_record_order(t.u('feeG1'), 'stripe', 'cs_test_2', 5000, 'INR', t.u('parent2'));
  PERFORM t.ok('G3g the abandoned failed order was retired (cancelled)', (SELECT status = 'cancelled' FROM public.payment_transactions WHERE gateway_order_id='cs_test_1'));
  PERFORM public.payment_apply_pending('stripe', 'cs_test_2', 'pi_2');
  PERFORM t.ok('G3h pending payment is recorded and balance still untouched', (SELECT status='pending' FROM public.payment_transactions WHERE gateway_order_id='cs_test_2') AND (SELECT amount_paid = 0 FROM public.fee_payments WHERE id = t.u('feeG1')));
  PERFORM t.err('G3i a payment already being confirmed blocks a new order', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeG1'), t.u('parent2'), 'razorpay'), 'still being confirmed');
  PERFORM t.err('G3j wrong amount is never credited', format('SELECT public.payment_apply_success(%L,%L,%L,%s,%L)', 'stripe', 'cs_test_2', 'pi_2', 499900, 'card'), 'does not match');
  PERFORM t.ok('G3k ... still not credited', (SELECT amount_paid = 0 FROM public.fee_payments WHERE id = t.u('feeG1')));
  r := public.payment_apply_success('stripe', 'cs_test_2', 'pi_2', 500000, 'card');
  PERFORM t.ok('G3l verified success credits the fee, issues a receipt', NOT (r->>'already_processed')::boolean AND r->>'receipt_no' LIKE 'RCT-%' AND r->>'kind' = 'fee');
  PERFORM t.ok('G3m fee is paid in full and carries the gateway payment id', (SELECT amount_paid = 5000 AND status = 'paid' AND razorpay_payment_id = 'pi_2' FROM public.fee_payments WHERE id = t.u('feeG1')));
  PERFORM t.ok('G3n legacy behaviour kept: other pending row reduced by the paid categories', (SELECT amount_due = 7000 AND course_amount = 7000 FROM public.fee_payments WHERE id = t.u('feeG0')));
  r := public.payment_apply_success('stripe', 'cs_test_2', 'pi_2', 500000, 'card');
  PERFORM t.ok('G3o duplicate success callback creates nothing (same receipt)', (r->>'already_processed')::boolean AND (SELECT count(*) = 1 FROM public.payment_transactions WHERE status='success' AND gateway_order_id='cs_test_2'));
  PERFORM t.ok('G3p ... and does not credit twice', (SELECT amount_paid = 5000 FROM public.fee_payments WHERE id = t.u('feeG1')) AND (SELECT amount_due = 7000 FROM public.fee_payments WHERE id = t.u('feeG0')));
  PERFORM t.err('G3q a DIFFERENT payment cannot settle an already-paid order', format('SELECT public.payment_apply_success(%L,%L,%L,%s,%L)', 'stripe', 'cs_test_2', 'pi_other', 500000, 'card'), 'different payment');
  r := public.payment_apply_failure('stripe', 'cs_test_2', 'pi_9', 'late failure webhook');
  PERFORM t.ok('G3r a late failure event cannot downgrade a paid order', (r->>'ignored')::boolean AND (SELECT status = 'success' FROM public.payment_transactions WHERE gateway_order_id='cs_test_2'));
  PERFORM t.ok('G3s parent notified of the success exactly once', t.cnt(format('SELECT count(*) FROM public.governance_notifications WHERE event_type=%L AND user_id=%L', 'fee_payment_success', t.u('parent2'))) = 1);
  PERFORM t.err('G3t paying an already-paid fee again is refused', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeG1'), t.u('parent2'), 'stripe'), 'no outstanding balance');
END $$;

-- ===== G3b. paying must never disturb a fee that has an instalment plan =====
DO $$ DECLARE r jsonb; BEGIN
  PERFORM t.as_service();
  PERFORM public.fee_prepare_order(t.u('feeG3'), t.u('parent1'), 'razorpay');
  PERFORM public.fee_record_order(t.u('feeG3'), 'razorpay', 'order_rzp_1', 1000, 'INR', t.u('parent1'));
  PERFORM t.ok('G3u razorpay (existing gateway) one-shot payment still works and writes the legacy order id', (SELECT razorpay_order_id = 'order_rzp_1' FROM public.fee_payments WHERE id = t.u('feeG3')));
  r := public.payment_apply_success('razorpay', 'order_rzp_1', 'pay_rzp_1', 100000, 'upi');
  PERFORM t.ok('G3v success does not fail because the student has a planned fee', r->>'kind' = 'fee' AND (SELECT status = 'paid' FROM public.fee_payments WHERE id = t.u('feeG3')));
  PERFORM t.ok('G3w ... and the planned fee''s total is untouched', (SELECT amount_due = 100000.01 AND course_amount = 100000.01 FROM public.fee_payments WHERE id = t.u('feeA1b')));
END $$;

-- ===== G4. refunds =====
DO $$ DECLARE r jsonb; BEGIN
  PERFORM t.as_service();
  r := public.payment_apply_refund('stripe', 'pi_2', 200000);
  PERFORM t.ok('G4a partial refund recorded', (SELECT status = 'partially_refunded' AND refunded_amount = 2000 FROM public.payment_transactions WHERE gateway_order_id='cs_test_2'));
  PERFORM t.ok('G4b ... fee balance goes back up', (SELECT amount_paid = 3000 AND status = 'pending' FROM public.fee_payments WHERE id = t.u('feeG1')));
  r := public.payment_apply_refund('stripe', 'pi_2', 200000);
  PERFORM t.ok('G4c repeating the same refund event changes nothing', (r->>'ignored')::boolean AND (SELECT amount_paid = 3000 FROM public.fee_payments WHERE id = t.u('feeG1')));
  r := public.payment_apply_refund('stripe', 'pi_2', 500000);
  PERFORM t.ok('G4d full refund', (SELECT status = 'refunded' AND refunded_amount = 5000 FROM public.payment_transactions WHERE gateway_order_id='cs_test_2') AND (SELECT amount_paid = 0 FROM public.fee_payments WHERE id = t.u('feeG1')));
  r := public.payment_apply_refund('stripe', 'pi_unknown', 100);
  PERFORM t.ok('G4e refund for an unknown payment is ignored safely', (r->>'ignored')::boolean);
END $$;

-- ===== G5. instalments through another gateway =====
DO $$ DECLARE v_item uuid; r jsonb; BEGIN
  PERFORM t.as_super();
  SELECT i.id INTO v_item FROM public.instalment_items i WHERE i.plan_id = t.u('plan1b') AND i.status = 'pending' ORDER BY i.seq LIMIT 1;
  PERFORM t.ok('G5-0 fixture: an open instalment exists', v_item IS NOT NULL); PERFORM t.set('itemG', v_item::text);
  PERFORM t.as_service();
  PERFORM t.err('G5a instalment on a gateway the school switched off is refused', format('SELECT public.instalment_check_gateway(%L,%L)', v_item, 'payu'), 'not enabled');
  PERFORM t.as_super();
  UPDATE public.payment_gateway_settings SET enabled = true WHERE school_id = t.u('schoolA') AND gateway = 'cashfree';
  PERFORM t.as_service();
  PERFORM public.instalment_check_gateway(v_item, 'cashfree');
  PERFORM t.ok('G5b prepare works for the instalment', (public.instalment_prepare_order(v_item, t.u('parent1'))->>'amount')::numeric > 0);
  PERFORM public.instalment_record_order(v_item, 'cf_order_1', (SELECT amount FROM public.instalment_items WHERE id = v_item), t.u('parent1'), 'cashfree', 'INR');
  PERFORM t.ok('G5c the gateway is stored on the instalment transaction', (SELECT gateway = 'cashfree' FROM public.instalment_transactions WHERE razorpay_order_id = 'cf_order_1'));
  PERFORM t.ok('G5d lookup is gateway-aware (same id under another gateway = not found)', public.payment_lookup_order('payu', 'cf_order_1') IS NULL AND public.payment_lookup_order('cashfree', 'cf_order_1')->>'kind' = 'instalment');
  r := public.payment_apply_success('cashfree', 'cf_order_1', 'cfp_1', (SELECT round(amount * 100) FROM public.instalment_items WHERE id = v_item)::bigint, 'upi');
  PERFORM t.ok('G5e success routes to the instalment logic', r->>'kind' = 'instalment' AND (SELECT status = 'paid' FROM public.instalment_items WHERE id = v_item));
  r := public.payment_apply_success('cashfree', 'cf_order_1', 'cfp_1', (SELECT round(amount * 100) FROM public.instalment_items WHERE id = v_item)::bigint, 'upi');
  PERFORM t.ok('G5f duplicate callback is a no-op', (r->>'already_processed')::boolean);
  r := public.payment_apply_refund('cashfree', 'cfp_1', 1000);
  PERFORM t.ok('G5g refund routes to the instalment logic', (SELECT status = 'partially_refunded' FROM public.instalment_transactions WHERE razorpay_order_id = 'cf_order_1'));
END $$;

-- ===== G6. who can look things up / see history =====
DO $$ DECLARE h jsonb; BEGIN
  PERFORM t.as_service();
  PERFORM t.ok('G6a the child''s parent can look up their own order', public.payment_lookup_order('stripe', 'cs_test_2', t.u('parent2')) IS NOT NULL);
  PERFORM t.ok('G6b another parent gets nothing', public.payment_lookup_order('stripe', 'cs_test_2', t.u('parent1')) IS NULL);
  PERFORM t.ok('G6c admin of another school gets nothing', public.payment_lookup_order('stripe', 'cs_test_2', t.u('adminB')) IS NULL);
  PERFORM t.ok('G6d finance staff of the school can', public.payment_lookup_order('stripe', 'cs_test_2', t.u('adminA')) IS NOT NULL);

  PERFORM t.as_user(t.u('parent2'));
  h := public.get_payment_history(NULL, t.u('sA2'));
  PERFORM t.ok('G6e parent sees their child''s unified history (both stripe rows, fee kind)', jsonb_array_length(h) = 1 AND h->0->>'gateway' = 'stripe' AND h->0->>'kind' = 'fee');
  PERFORM t.err('G6f parent cannot read another child''s history', format('SELECT public.get_payment_history(NULL,%L)', t.u('sA1')), 'Not authorised');
  PERFORM t.err('G6g parent cannot read school-wide history', format('SELECT public.get_payment_history(%L)', t.u('schoolA')), 'Not authorised');
  PERFORM t.as_user(t.u('adminA'));
  h := public.get_payment_history(t.u('schoolA'));
  PERFORM t.ok('G6h finance staff see all 3 gateways used so far and both kinds together', (SELECT count(DISTINCT gateway) FROM jsonb_to_recordset(h) AS x(gateway text)) = 3 AND (SELECT count(DISTINCT kind) FROM jsonb_to_recordset(h) AS x(kind text)) = 2);
  PERFORM t.ok('G6i created/cancelled placeholders are not shown', NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(h) AS x(status text) WHERE status IN ('created', 'cancelled')));
  PERFORM t.as_user(t.u('adminB'));
  PERFORM t.err('G6j staff of another school cannot read this school''s history', format('SELECT public.get_payment_history(%L)', t.u('schoolA')), 'Not authorised');
  PERFORM t.ok('G6k ... and their own school''s history has none of it', jsonb_array_length(public.get_payment_history(t.u('schoolB'))) = 0);
END $$;

-- ===== G7. nobody can fake a payment =====
DO $$ BEGIN
  PERFORM t.as_user(t.u('parent2'));
  PERFORM t.err('G7a parent cannot insert a transaction', format('INSERT INTO public.payment_transactions (school_id, student_id, gateway, gateway_order_id, amount, status) VALUES (%L,%L,%L,%L,1,%L)', t.u('schoolA'), t.u('sA2'), 'stripe', 'x', 'success'), 'permission denied|row-level security');
  PERFORM t.err('G7b parent cannot mark a payment successful', format('UPDATE public.payment_transactions SET status = %L', 'success'), 'permission denied');
  PERFORM t.err('G7c parent cannot call the success function', format('SELECT public.payment_apply_success(%L,%L,%L,500000)', 'stripe', 'cs_test_2', 'pi_2'), 'permission denied');
  PERFORM t.err('G7d parent cannot call fee_prepare_order directly', format('SELECT public.fee_prepare_order(%L,%L,%L)', t.u('feeG1'), t.u('parent2'), 'stripe'), 'permission denied');
  PERFORM t.as_user(t.u('adminA'));
  PERFORM t.err('G7e even finance staff cannot write transactions directly', format('UPDATE public.payment_transactions SET status = %L', 'success'), 'permission denied');
  PERFORM t.as_super();
  PERFORM t.err('G7f transactions can never be deleted', 'DELETE FROM public.payment_transactions', 'cannot be deleted');
  DELETE FROM public.fee_payments WHERE id = t.u('feeG1');
  PERFORM t.ok('G7g deleting a fee row (legacy cleanup) keeps the payment history', (SELECT count(*) = 1 AND bool_and(fee_payment_id IS NULL) FROM public.payment_transactions WHERE gateway_order_id IN ('cs_test_2')));
END $$;

SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM t.log;
