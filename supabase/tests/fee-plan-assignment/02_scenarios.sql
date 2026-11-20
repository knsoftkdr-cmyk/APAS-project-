-- Scenarios for Automatic Fee Plan Assignment. Run by run.sh against the REAL migration. Every check logs PASS/FAIL into t.log.
\set sa '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set sb '\'bbbbbbbb-0000-0000-0000-000000000002\''
\set ua '\'11111111-0000-0000-0000-000000000001\''
\set ub '\'22222222-0000-0000-0000-000000000002\''
\set ut '\'33333333-0000-0000-0000-000000000003\''

INSERT INTO public.schools (id, name) VALUES (:sa, 'School A'), (:sb, 'School B');
INSERT INTO auth.users (id) VALUES (:ua), (:ub), (:ut);
INSERT INTO public.profiles (id, school_id, role, full_name) VALUES (:ua, :sa, 'admin', 'Admin A'), (:ub, :sb, 'admin', 'Admin B'), (:ut, :sa, 'teacher', 'Teacher A');
INSERT INTO public.admission_intakes (id, school_id, grade, academic_year) VALUES
  ('a1000000-0000-0000-0000-000000000005', :sa, 'Grade 5', '2026-27'),
  ('a1000000-0000-0000-0000-000000000006', :sa, 'Grade 6', '2026-27'),
  ('a1000000-0000-0000-0000-000000000007', :sa, 'Grade 7', '2026-27');   -- never gets a structure: used for the manual-assignment scenario

-- Staff create structures through the real RLS path
SELECT t.as_user(:ua);
SET ROLE authenticated;
INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, category, admission_fee, tuition_fee, transport_fee, due_date)
  VALUES (:sa, 'Grade 5 Standard', '2026 - 27', 'class 5', NULL, 5000, 50000, 8000, current_date + 30);      -- loose labels on purpose
INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, category, tuition_fee)
  VALUES (:sa, 'Grade 5 Staff Ward', '2026-27', 'Grade 5', 'Staff Ward', 20000);
RESET ROLE;
SELECT t.ok('structure total is generated and correct', (SELECT total_fee FROM public.fee_structures WHERE name = 'Grade 5 Standard') = 63000);
SELECT t.raises('second ACTIVE structure for the same year+class+category is rejected',
  format($q$INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, tuition_fee) VALUES (%L, 'dup', '2026-27', 'Grade 5', 1)$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'uq_fee_structures_active');
SELECT t.raises('instalment template not adding to 100 is rejected',
  format($q$INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, tuition_fee, instalment_schedule) VALUES (%L, 'bad', '2026-27', 'Grade 9', 1000, '[{"percent":50,"due_date":"2026-06-01"},{"percent":40,"due_date":"2026-09-01"}]')$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'add up to 100');

-- 1. NOT assigned on enquiry/application creation
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status, category)
  VALUES ('c0000000-0000-0000-0000-000000000001', :sa, 'a1000000-0000-0000-0000-000000000005', 'Asha Rao', 'under_review', NULL);
SELECT t.ok('no fee plan when an applicant is created (enquiry/application)', (SELECT count(*) FROM public.fee_assignments) = 0 AND (SELECT count(*) FROM public.fee_payments) = 0);
UPDATE public.admission_applicants SET status = 'shortlisted' WHERE id = 'c0000000-0000-0000-0000-000000000001';
UPDATE public.admission_applicants SET status = 'selected'    WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t.ok('no fee plan for shortlisted / selected', (SELECT count(*) FROM public.fee_assignments) = 0);

-- 2. Admission confirmed -> automatic assignment (default structure, loose label matching)
SELECT t.as_user(:ua);
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT t.ok('admitted -> exactly one active assignment', (SELECT count(*) FROM public.fee_assignments WHERE status = 'active') = 1);
SELECT t.ok('default structure matched on class/year despite label differences', (SELECT s.name FROM public.fee_assignments a JOIN public.fee_structures s ON s.id = a.structure_id) = 'Grade 5 Standard');
SELECT t.ok('match basis recorded as default', (SELECT match_basis FROM public.fee_assignments) = 'default');
SELECT t.ok('fee_payments row created in the EXISTING ledger with the net amount', (SELECT amount_due FROM public.fee_payments) = 63000 AND (SELECT amount_paid FROM public.fee_payments) = 0);
SELECT t.ok('ledger breakdown columns add up to amount_due', (SELECT course_amount + transport_amount + other_amount + uniform_amount + material_amount + exam_amount = amount_due FROM public.fee_payments));
SELECT t.ok('admission fee is kept in other_amount of the ledger', (SELECT other_amount FROM public.fee_payments) = 5000);
SELECT t.ok('fee row is linked to its assignment', (SELECT f.fee_assignment_id = a.id AND a.fee_payment_id = f.id FROM public.fee_payments f, public.fee_assignments a));
SELECT t.ok('history has one auto_assigned entry', (SELECT count(*) FROM public.fee_assignment_history WHERE action = 'auto_assigned') = 1);
SELECT t.ok('finance staff were notified', (SELECT count(*) FROM public.governance_notifications WHERE event_type = 'fee_plan_assigned' AND user_id = :ua) = 1);

-- 3. DUPLICATE PREVENTION when the workflow fires again
UPDATE public.admission_applicants SET status = 'withdrawn' WHERE id = 'c0000000-0000-0000-0000-000000000001';
UPDATE public.admission_applicants SET status = 'admitted'  WHERE id = 'c0000000-0000-0000-0000-000000000001';
SELECT public.fee_try_auto_assign('c0000000-0000-0000-0000-000000000001');
SELECT public.fee_try_auto_assign('c0000000-0000-0000-0000-000000000001');
SELECT t.ok('re-admitting / re-running creates no second assignment', (SELECT count(*) FROM public.fee_assignments WHERE status IN ('active','unmatched')) = 1);
SELECT t.ok('...and no second fee record', (SELECT count(*) FROM public.fee_payments) = 1);
SELECT t.ok('...and no second auto_assigned history entry', (SELECT count(*) FROM public.fee_assignment_history WHERE action = 'auto_assigned') = 1);
SELECT t.ok('fee_try_auto_assign says exists on repeat', public.fee_try_auto_assign('c0000000-0000-0000-0000-000000000001') = 'exists');

-- 4. Category-specific structure beats the default
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status, category)
  VALUES ('c0000000-0000-0000-0000-000000000002', :sa, 'a1000000-0000-0000-0000-000000000005', 'Ravi Kumar', 'under_review', 'staff ward');
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000002';
SELECT t.ok('category-specific structure chosen (exact)', (SELECT s.name || '/' || a.match_basis FROM public.fee_assignments a JOIN public.fee_structures s ON s.id = a.structure_id WHERE a.applicant_id = 'c0000000-0000-0000-0000-000000000002') = 'Grade 5 Staff Ward/exact');
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status, category)
  VALUES ('c0000000-0000-0000-0000-000000000003', :sa, 'a1000000-0000-0000-0000-000000000005', 'Meena Das', 'under_review', 'sports quota');
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000003';
SELECT t.ok('unknown category falls back to the all-categories structure', (SELECT s.name FROM public.fee_assignments a JOIN public.fee_structures s ON s.id = a.structure_id WHERE a.applicant_id = 'c0000000-0000-0000-0000-000000000003') = 'Grade 5 Standard');

-- 5. No matching structure -> warning row, no fee record, one notification, manual assignment
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status)
  VALUES ('c0000000-0000-0000-0000-000000000004', :sa, 'a1000000-0000-0000-0000-000000000006', 'Zoya Khan', 'under_review');
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000004';
SELECT t.ok('no structure -> assignment flagged unmatched', (SELECT status FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000004') = 'unmatched');
SELECT t.ok('no structure -> NO fee record created', (SELECT count(*) FROM public.fee_payments WHERE student_name = 'Zoya Khan') = 0);
SELECT t.ok('no_match history entry written', (SELECT count(*) FROM public.fee_assignment_history WHERE action = 'no_match' AND applicant_id = 'c0000000-0000-0000-0000-000000000004') = 1);
SELECT t.ok('warning notification sent', (SELECT count(*) FROM public.governance_notifications WHERE event_type = 'fee_plan_unmatched') = 1);
SELECT public.fee_try_auto_assign('c0000000-0000-0000-0000-000000000004');
SELECT t.ok('repeat does not duplicate the unmatched row or warning', (SELECT count(*) FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000004') = 1
  AND (SELECT count(*) FROM public.governance_notifications WHERE event_type = 'fee_plan_unmatched') = 1);
-- structure added later, then Re-check
INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, tuition_fee) VALUES (:sa, 'Grade 6 Standard', '2026-27', 'Grade 6', 55000);
SELECT t.ok('re-check assigns the waiting student', (public.fee_resolve_unmatched(:sa)->>'assigned')::int = 1);
SELECT t.ok('unmatched row became active (same row, not a new one)', (SELECT count(*) || status FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000004' GROUP BY status) = '1active');
SELECT t.ok('and now has its fee record', (SELECT amount_due FROM public.fee_payments WHERE student_name = 'Zoya Khan') = 55000);

-- 6. Manual assignment + concession + correction + history
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status)
  VALUES ('c0000000-0000-0000-0000-000000000005', :sa, 'a1000000-0000-0000-0000-000000000007', 'Imran Ali', 'under_review');
SELECT t.raises('manual assignment before admission is refused', format($q$SELECT public.fee_assign_manual(%L, NULL, '{"tuition_fee":1000}'::jsonb)$q$, 'c0000000-0000-0000-0000-000000000005'), 'after the admission is confirmed');
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000005';
SELECT public.fee_assign_manual('c0000000-0000-0000-0000-000000000005', NULL, '{"tuition_fee":40000,"admission_fee":10000}'::jsonb, 6000, 'Merit scholarship', NULL, NULL);
SELECT t.ok('concession applied: net = gross - concession', (SELECT amount_due FROM public.fee_payments WHERE student_name = 'Imran Ali') = 44000);
SELECT t.ok('concession taken from tuition first; ledger still sums to amount_due', (SELECT course_amount = 34000 AND other_amount = 10000 AND course_amount + other_amount = amount_due FROM public.fee_payments WHERE student_name = 'Imran Ali'));
SELECT t.ok('assignment keeps gross, concession, reason and net', (SELECT gross_total = 50000 AND concession_amount = 6000 AND concession_reason = 'Merit scholarship' AND net_total = 44000 FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000005'));
SELECT t.raises('concession without a reason is refused', format($q$SELECT public.fee_assign_manual(%L, NULL, '{"tuition_fee":1000}'::jsonb, 100, NULL, 'x')$q$, 'c0000000-0000-0000-0000-000000000005'), 'reason is required for a concession');
SELECT t.raises('correction without a reason is refused', format($q$SELECT public.fee_assign_manual(%L, NULL, '{"tuition_fee":1000}'::jsonb)$q$, 'c0000000-0000-0000-0000-000000000005'), 'reason is required to correct');
UPDATE public.fee_payments SET amount_paid = 20000, status = 'pending' WHERE student_name = 'Imran Ali';    -- a payment (what Razorpay verification does) is NOT blocked
SELECT t.ok('payments can still be recorded on a plan-managed fee', (SELECT amount_paid FROM public.fee_payments WHERE student_name = 'Imran Ali') = 20000);
SELECT t.raises('correction below the amount already paid is refused', format($q$SELECT public.fee_assign_manual(%L, NULL, '{"tuition_fee":15000}'::jsonb, 0, NULL, 'fix')$q$, 'c0000000-0000-0000-0000-000000000005'), 'lower than the amount already paid');
SELECT public.fee_assign_manual('c0000000-0000-0000-0000-000000000005', NULL, '{"tuition_fee":40000,"admission_fee":10000}'::jsonb, 10000, 'Sibling + merit', 'Added sibling discount', NULL);
SELECT t.ok('correction updates the fee record and keeps what was paid', (SELECT amount_due = 40000 AND amount_paid = 20000 FROM public.fee_payments WHERE student_name = 'Imran Ali'));
SELECT t.ok('history shows assign, then concession_changed with old/new values and the reason',
  (SELECT string_agg(action, ',' ORDER BY created_at) FROM public.fee_assignment_history WHERE applicant_id = 'c0000000-0000-0000-0000-000000000005' AND action <> 'no_match') = 'manual_assigned,concession_changed'
  AND (SELECT reason = 'Added sibling discount' AND (old_values->>'net_total')::numeric = 44000 AND (new_values->>'net_total')::numeric = 40000
         FROM public.fee_assignment_history WHERE action = 'concession_changed'));

-- 7. Guard: amounts of a plan-managed fee cannot be edited/deleted behind the plan's back
SELECT t.raises('direct edit of amount_due on a plan fee is blocked', $q$UPDATE public.fee_payments SET amount_due = 1 WHERE student_name = 'Imran Ali'$q$, 'admission fee plan');
SELECT t.raises('direct edit of a breakdown column is blocked', $q$UPDATE public.fee_payments SET transport_amount = 99 WHERE student_name = 'Imran Ali'$q$, 'admission fee plan');
SELECT t.raises('direct delete of a plan fee is blocked', $q$DELETE FROM public.fee_payments WHERE student_name = 'Imran Ali'$q$, 'cancel the fee plan');
INSERT INTO public.fee_payments (school_id, student_name, amount_due) VALUES (:sa, 'Plain Fee Student', 100);
UPDATE public.fee_payments SET amount_due = 200 WHERE student_name = 'Plain Fee Student';
DELETE FROM public.fee_payments WHERE student_name = 'Plain Fee Student';
SELECT t.ok('a normal ERP fee row can still be edited and deleted', (SELECT count(*) FROM public.fee_payments WHERE student_name = 'Plain Fee Student') = 0);

-- 8. Cancel rules
SELECT t.raises('cancel with payments recorded is refused', format($q$SELECT public.fee_assignment_cancel((SELECT id FROM public.fee_assignments WHERE applicant_id = %L), 'oops')$q$, 'c0000000-0000-0000-0000-000000000005'), 'Payments');
SELECT public.fee_assignment_cancel((SELECT id FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000003'), 'Admission withdrawn by parent');
SELECT t.ok('cancel with no payments removes the fee record and marks the assignment cancelled',
  (SELECT status FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000003') = 'cancelled' AND (SELECT count(*) FROM public.fee_payments WHERE student_name = 'Meena Das') = 0);
SELECT t.ok('cancel is in the history with its reason', (SELECT reason FROM public.fee_assignment_history WHERE action = 'cancelled') = 'Admission withdrawn by parent');

-- 9. Link to an enrolled student; instalment template
INSERT INTO public.students (id, school_id, profile_id, full_name, "class", section) VALUES ('d0000000-0000-0000-0000-000000000001', :sa, :ut, 'Asha Rao', '5', 'A');
SELECT public.fee_assignment_link_student((SELECT id FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000001'), 'd0000000-0000-0000-0000-000000000001');
SELECT t.ok('linking sets student, class and section on the existing fee record', (SELECT student_id = 'd0000000-0000-0000-0000-000000000001' AND section = 'A' FROM public.fee_payments WHERE student_name = 'Asha Rao'));
SELECT t.ok('student profile read model returns the plan', jsonb_array_length(public.get_student_fee_plan('d0000000-0000-0000-0000-000000000001')->'plans') = 1);

-- 10. An internal failure must NEVER block the admission decision
ALTER TABLE public.fee_payments ADD CONSTRAINT boom CHECK (amount_due < 0) NOT VALID;   -- NOT VALID: existing rows are fine, every NEW fee row fails
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status)
  VALUES ('c0000000-0000-0000-0000-000000000006', :sa, 'a1000000-0000-0000-0000-000000000005', 'Failing Case', 'under_review');
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000006';
ALTER TABLE public.fee_payments DROP CONSTRAINT boom;
SELECT t.ok('admission still succeeds when fee assignment fails', (SELECT status FROM public.admission_applicants WHERE id = 'c0000000-0000-0000-0000-000000000006') = 'admitted');
SELECT t.ok('...and the failure is recorded in the history', (SELECT count(*) FROM public.fee_assignment_history WHERE action = 'error' AND applicant_id = 'c0000000-0000-0000-0000-000000000006') = 1);
SELECT t.ok('...with no half-created assignment or fee record', (SELECT count(*) FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000006') = 0 AND (SELECT count(*) FROM public.fee_payments WHERE student_name = 'Failing Case') = 0);
SELECT t.ok('re-check recovers it', (public.fee_resolve_unmatched(:sa, true)->>'assigned')::int >= 1);

-- 11. School isolation and roles
SELECT t.as_user(:ub);                                                          -- admin of ANOTHER school
SELECT t.raises('other school cannot assign', format($q$SELECT public.fee_assign_manual(%L, NULL, '{"tuition_fee":1}'::jsonb)$q$, 'c0000000-0000-0000-0000-000000000005'), 'Not authorised');
SELECT t.raises('other school cannot cancel', format($q$SELECT public.fee_assignment_cancel((SELECT id FROM public.fee_assignments LIMIT 1), 'x')$q$), 'Not authorised');
SELECT t.raises('other school cannot list', format($q$SELECT public.list_fee_assignments(%L)$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'Not authorised');
SELECT t.raises('other school cannot read an applicant plan', format($q$SELECT public.get_applicant_fee_plan(%L)$q$, 'c0000000-0000-0000-0000-000000000001'), 'Not authorised');
SELECT t.raises('other school cannot read a student plan', $q$SELECT public.get_student_fee_plan('d0000000-0000-0000-0000-000000000001')$q$, 'Not authorised');
SET ROLE authenticated;
SELECT t.ok('RLS: other school sees none of this school''s structures', (SELECT count(*) FROM public.fee_structures) = 0);
SELECT t.ok('RLS: ...nor its assignments', (SELECT count(*) FROM public.fee_assignments) = 0);
SELECT t.ok('RLS: ...nor its history', (SELECT count(*) FROM public.fee_assignment_history) = 0);
RESET ROLE;
SELECT t.raises('other school cannot insert a structure into this school', format($q$SET ROLE authenticated; INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, tuition_fee) VALUES (%L,'x','2026-27','G1',1)$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'row-level security');
RESET ROLE;

SELECT t.as_user(:ut);                                                          -- a TEACHER of this school (no fee permission)
SELECT t.raises('non-fee staff cannot assign', format($q$SELECT public.fee_assign_manual(%L, NULL, '{"tuition_fee":1}'::jsonb)$q$, 'c0000000-0000-0000-0000-000000000005'), 'Not authorised');
SELECT t.raises('non-fee staff cannot resolve', format($q$SELECT public.fee_resolve_unmatched(%L)$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'Not authorised');
SELECT t.ok('the student themself can read their own plan (history hidden)', jsonb_array_length(public.get_student_fee_plan('d0000000-0000-0000-0000-000000000001')->'plans') = 1
  AND jsonb_array_length(public.get_student_fee_plan('d0000000-0000-0000-0000-000000000001')->'history') = 0);

-- 12. History / assignments are append-only for app roles; the engine is not callable by clients
SELECT t.as_user(:ua);
SET ROLE authenticated;
SELECT t.raises('app role cannot insert history', format($q$INSERT INTO public.fee_assignment_history (school_id, action) VALUES (%L,'corrected')$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'permission denied');
SELECT t.raises('app role cannot update history', $q$UPDATE public.fee_assignment_history SET reason = 'tampered'$q$, 'permission denied');
SELECT t.raises('app role cannot delete history', $q$DELETE FROM public.fee_assignment_history$q$, 'permission denied');
SELECT t.raises('app role cannot write assignments directly', $q$UPDATE public.fee_assignments SET net_total = 0, gross_total = 0$q$, 'permission denied');
SELECT t.raises('app role cannot call the internal engine', format($q$SELECT public.fee_try_auto_assign(%L)$q$, 'c0000000-0000-0000-0000-000000000001'), 'permission denied');
RESET ROLE;
SELECT t.raises('anon cannot call the admin RPCs', format($q$SET ROLE anon; SELECT public.list_fee_assignments(%L)$q$, 'aaaaaaaa-0000-0000-0000-000000000001'), 'permission denied');
RESET ROLE;

-- 13. Instalment template -> existing instalment plan (needs a linked student)
SELECT t.as_user(:ua);
INSERT INTO public.admission_applicants (id, school_id, intake_id, full_name, status)
  VALUES ('c0000000-0000-0000-0000-000000000007', :sa, 'a1000000-0000-0000-0000-000000000005', 'Template Kid', 'under_review');
UPDATE public.fee_structures SET is_active = false WHERE name = 'Grade 5 Standard';
INSERT INTO public.fee_structures (school_id, name, academic_year, class_grade, tuition_fee, instalment_schedule)
  VALUES (:sa, 'Grade 5 Standard v2', '2026-27', 'Grade 5', 10000, '[{"label":"T1","percent":50,"due_date":"2026-12-01"},{"label":"T2","percent":50,"due_date":"2027-03-01"}]');
UPDATE public.admission_applicants SET status = 'admitted' WHERE id = 'c0000000-0000-0000-0000-000000000007';
SELECT t.ok('deactivated structure is not used; the new active one is', (SELECT s.name FROM public.fee_assignments a JOIN public.fee_structures s ON s.id = a.structure_id WHERE a.applicant_id = 'c0000000-0000-0000-0000-000000000007') = 'Grade 5 Standard v2');
SELECT t.raises('instalments need a linked student first', format($q$SELECT public.fee_assignment_create_instalments((SELECT id FROM public.fee_assignments WHERE applicant_id = %L))$q$, 'c0000000-0000-0000-0000-000000000007'), 'Link the enrolled student');
SELECT public.fee_assignment_link_student((SELECT id FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000007'), 'd0000000-0000-0000-0000-000000000001');
SELECT t.ok('instalment plan is created through the existing function', public.fee_assignment_create_instalments((SELECT id FROM public.fee_assignments WHERE applicant_id = 'c0000000-0000-0000-0000-000000000007')) IS NOT NULL);
