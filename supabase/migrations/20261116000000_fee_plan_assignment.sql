-- ============================================================================
-- Automatic Fee Plan Assignment on Admission
--
-- EXTENDS the existing CRM & Admissions + ERP Fees modules. It does NOT create a second fee system:
--   * the student's fee account is still a public.fee_payments row. The assigned plan is written into that row
--     (amount_due + course/transport/other/uniform/material/exam columns), so Razorpay payments, receipts, the
--     parent fee page (get_parent_fee_details), instalments and the ERP Fee Records screen keep working unchanged;
--   * authorisation reuses public.is_fee_staff() / is_parent_of_student() from the instalment migration;
--   * notifications reuse public.instalment_notify() -> governance_notifications.
--
-- New tables : fee_structures        (class + category + academic year price list, incl. optional instalment template)
--              fee_assignments       (one live assignment per applicant per academic year; gross, concession, net)
--              fee_assignment_history(append-only audit trail of every plan change)
-- New column : fee_payments.fee_assignment_id
--
-- Security   : RLS = read-only for school staff; ALL writes to assignments/history go through SECURITY DEFINER
--              functions that re-check the caller. fee_structures is writable by fee staff of that school only.
-- Failure    : the admission trigger NEVER blocks an admission decision; a failure is logged to the history table.
-- Safe to run more than once. Nothing existing is dropped, and no existing column/policy is changed.
--
-- NOTE: APAS has no scholarship/concession feature today. This migration adds the smallest possible one: a manual
--       concession (amount + mandatory reason) on an assignment, recorded in the history.
-- ============================================================================

-- 0. Matching helper ------------------------------------------------------------------------------------------------
-- "Grade 5" = "class 5" = "5"; "Pre-KG" = "pre kg"; "2026-27" = "2026 - 27"; NULL = ''.
CREATE OR REPLACE FUNCTION public.fee_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(regexp_replace(btrim(coalesce(p, '')), '^(grade|class)\s+', '', 'i')), '[\s_-]+', '', 'g')
$$;

-- 1. fee_structures --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_structures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name          text NOT NULL,
  academic_year text NOT NULL,
  class_grade   text NOT NULL,            -- same free-text label as admission_intakes.grade
  category      text,                     -- NULL = "all categories" (used when no category-specific structure exists)
  admission_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (admission_fee >= 0),
  tuition_fee   numeric(12,2) NOT NULL DEFAULT 0 CHECK (tuition_fee   >= 0),
  transport_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
  uniform_fee   numeric(12,2) NOT NULL DEFAULT 0 CHECK (uniform_fee   >= 0),
  material_fee  numeric(12,2) NOT NULL DEFAULT 0 CHECK (material_fee  >= 0),
  exam_fee      numeric(12,2) NOT NULL DEFAULT 0 CHECK (exam_fee      >= 0),
  other_fee     numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_fee     >= 0),
  total_fee     numeric(12,2) GENERATED ALWAYS AS
                  (admission_fee + tuition_fee + transport_fee + uniform_fee + material_fee + exam_fee + other_fee) STORED,
  due_date      date,
  instalment_schedule jsonb,              -- optional template: [{"label":"Term 1","percent":50,"due_date":"2026-06-10"}, ...] (sum = 100)
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_structures_total_positive CHECK (admission_fee + tuition_fee + transport_fee + uniform_fee + material_fee + exam_fee + other_fee > 0)
);
-- One ACTIVE structure per school + year + class + category (deactivate the old one to replace it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_active
  ON public.fee_structures (school_id, public.fee_norm(academic_year), public.fee_norm(class_grade), public.fee_norm(category))
  WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_fee_structures_school ON public.fee_structures (school_id, academic_year);

CREATE OR REPLACE FUNCTION public.fee_structures_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e jsonb; v_sum numeric := 0; v_n integer := 0;
BEGIN
  new.name          := btrim(coalesce(new.name, ''));
  new.academic_year := btrim(coalesce(new.academic_year, ''));
  new.class_grade   := btrim(coalesce(new.class_grade, ''));
  new.category      := nullif(btrim(coalesce(new.category, '')), '');
  IF new.name = '' OR new.academic_year = '' OR new.class_grade = '' THEN
    RAISE EXCEPTION 'Name, academic year and class are required' USING ERRCODE = 'P0001';
  END IF;
  IF new.instalment_schedule IS NOT NULL THEN
    IF jsonb_typeof(new.instalment_schedule) <> 'array' THEN
      RAISE EXCEPTION 'The instalment schedule must be a list' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(new.instalment_schedule) = 0 THEN
      new.instalment_schedule := NULL;
    ELSE
      FOR e IN SELECT jsonb_array_elements(new.instalment_schedule) LOOP
        v_n := v_n + 1;
        IF (e->>'percent') IS NULL OR (e->>'percent')::numeric <= 0 THEN
          RAISE EXCEPTION 'Each instalment needs a percentage above 0' USING ERRCODE = 'P0001';
        END IF;
        IF (e->>'due_date') IS NULL THEN
          RAISE EXCEPTION 'Each instalment needs a due date' USING ERRCODE = 'P0001';
        END IF;
        PERFORM (e->>'due_date')::date;   -- rejects malformed dates
        v_sum := v_sum + (e->>'percent')::numeric;
      END LOOP;
      IF v_n < 2 THEN RAISE EXCEPTION 'An instalment schedule needs at least 2 instalments' USING ERRCODE = 'P0001'; END IF;
      IF v_sum <> 100 THEN RAISE EXCEPTION 'Instalment percentages must add up to 100 (currently %)', v_sum USING ERRCODE = 'P0001'; END IF;
    END IF;
  END IF;
  IF tg_op = 'INSERT' THEN new.created_by := coalesce(new.created_by, auth.uid()); END IF;
  new.updated_at := now();
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS trg_fee_structures_validate ON public.fee_structures;
CREATE TRIGGER trg_fee_structures_validate BEFORE INSERT OR UPDATE ON public.fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.fee_structures_validate();

-- 2. fee_assignments -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  applicant_id   uuid NOT NULL REFERENCES public.admission_applicants(id),
  applicant_name text NOT NULL,                                   -- snapshot (applicant PII may be encrypted at rest)
  student_id     uuid REFERENCES public.students(id) ON DELETE SET NULL,   -- set once the applicant is enrolled
  fee_payment_id uuid REFERENCES public.fee_payments(id) ON DELETE SET NULL,
  structure_id   uuid REFERENCES public.fee_structures(id),
  academic_year  text NOT NULL,
  class_grade    text NOT NULL,
  category       text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unmatched', 'cancelled')),
  source         text NOT NULL DEFAULT 'auto'   CHECK (source IN ('auto', 'manual')),
  match_basis    text CHECK (match_basis IN ('exact', 'default', 'manual')),
  admission_fee  numeric(12,2) NOT NULL DEFAULT 0 CHECK (admission_fee >= 0),
  tuition_fee    numeric(12,2) NOT NULL DEFAULT 0 CHECK (tuition_fee   >= 0),
  transport_fee  numeric(12,2) NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
  uniform_fee    numeric(12,2) NOT NULL DEFAULT 0 CHECK (uniform_fee   >= 0),
  material_fee   numeric(12,2) NOT NULL DEFAULT 0 CHECK (material_fee  >= 0),
  exam_fee       numeric(12,2) NOT NULL DEFAULT 0 CHECK (exam_fee      >= 0),
  other_fee      numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_fee     >= 0),
  gross_total    numeric(12,2) NOT NULL DEFAULT 0,
  concession_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (concession_amount >= 0),
  concession_reason text,
  net_total      numeric(12,2) NOT NULL DEFAULT 0,
  due_date       date,
  instalment_schedule jsonb,                                      -- template copied from the structure at assignment time
  assigned_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fee_assignments_concession_le_gross CHECK (concession_amount <= gross_total),
  CONSTRAINT fee_assignments_net_matches CHECK (net_total = gross_total - concession_amount)
);
-- DUPLICATE PREVENTION: an applicant can have only ONE live (active or awaiting-manual) assignment per academic year,
-- however many times the admission workflow fires.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_assignments_one_live
  ON public.fee_assignments (applicant_id, public.fee_norm(academic_year)) WHERE status IN ('active', 'unmatched');
CREATE INDEX IF NOT EXISTS idx_fee_assignments_school  ON public.fee_assignments (school_id, status);
CREATE INDEX IF NOT EXISTS idx_fee_assignments_student ON public.fee_assignments (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_assignments_fee     ON public.fee_assignments (fee_payment_id) WHERE fee_payment_id IS NOT NULL;

-- 3. fee_assignment_history (append-only: no write policy and no write grant for app roles) ---------------------------
CREATE TABLE IF NOT EXISTS public.fee_assignment_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.fee_assignments(id) ON DELETE SET NULL,
  applicant_id  uuid,                                             -- deliberately no FK: history outlives the applicant row
  action        text NOT NULL CHECK (action IN ('auto_assigned', 'manual_assigned', 'corrected', 'structure_changed',
                  'concession_changed', 'cancelled', 'linked_student', 'instalments_created', 'no_match', 'error')),
  old_values    jsonb,
  new_values    jsonb,
  reason        text,
  actor         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_history_assignment ON public.fee_assignment_history (assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_history_school     ON public.fee_assignment_history (school_id, created_at DESC);

-- 4. Link from the existing ledger ---------------------------------------------------------------------------------
ALTER TABLE public.fee_payments ADD COLUMN IF NOT EXISTS fee_assignment_id uuid REFERENCES public.fee_assignments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fee_payments_assignment ON public.fee_payments (fee_assignment_id) WHERE fee_assignment_id IS NOT NULL;

-- A fee row that belongs to an admission fee plan must not have its AMOUNTS edited, or be deleted, behind the plan's back
-- (the plan screen corrects it and writes a history entry). Payments (amount_paid, status, razorpay_*) are unaffected, so
-- Razorpay verification, offline payments and receipts behave exactly as before. Coexists with the instalment guard trigger.
CREATE OR REPLACE FUNCTION public.fee_payments_plan_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('apas.fee_plan_write', true), '') = 'on' THEN
    RETURN CASE WHEN tg_op = 'DELETE' THEN old ELSE new END;
  END IF;
  IF tg_op = 'DELETE' THEN
    IF old.fee_assignment_id IS NOT NULL THEN
      RAISE EXCEPTION 'This fee comes from an admission fee plan and cannot be deleted here - cancel the fee plan assignment instead' USING ERRCODE = 'P0001';
    END IF;
    RETURN old;
  END IF;
  IF old.fee_assignment_id IS NOT NULL AND (
       new.amount_due       IS DISTINCT FROM old.amount_due
    OR new.course_amount    IS DISTINCT FROM old.course_amount
    OR new.transport_amount IS DISTINCT FROM old.transport_amount
    OR new.other_amount     IS DISTINCT FROM old.other_amount
    OR new.uniform_amount   IS DISTINCT FROM old.uniform_amount
    OR new.material_amount  IS DISTINCT FROM old.material_amount
    OR new.exam_amount      IS DISTINCT FROM old.exam_amount
    OR new.fee_assignment_id IS DISTINCT FROM old.fee_assignment_id) THEN
    RAISE EXCEPTION 'This fee comes from an admission fee plan - correct it from the fee plan (Admission Fee Plans tab) so the change is recorded' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS trg_fee_payments_plan_guard ON public.fee_payments;
CREATE TRIGGER trg_fee_payments_plan_guard BEFORE UPDATE OR DELETE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payments_plan_guard();

-- 5. Internal helpers ----------------------------------------------------------------------------------------------
-- Who may READ fee plans: fee staff, plus the school's principal (read-only).
CREATE OR REPLACE FUNCTION public.fee_can_view(p_school uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_fee_staff(p_school) OR (p_school IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.school_id = p_school AND p.role = 'principal'));
$$;

-- Applicant facts needed for matching. Reads the decrypting view when the optional pgsodium hardening migration was
-- applied, otherwise the base table - so this works in both deployments.
CREATE OR REPLACE FUNCTION public.fee_applicant_info(p_applicant uuid)
RETURNS TABLE (school_id uuid, full_name text, status text, category text, grade text, academic_year text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rel text := CASE WHEN to_regclass('public.decrypted_admission_applicants') IS NOT NULL
                           THEN 'public.decrypted_admission_applicants' ELSE 'public.admission_applicants' END;
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT a.school_id, a.full_name::text, a.status::text, a.category::text, i.grade::text, i.academic_year::text
       FROM %s a JOIN public.admission_intakes i ON i.id = a.intake_id WHERE a.id = $1', v_rel) USING p_applicant;
END $$;

-- Splits a total concession over the fee lines in a fixed order (tuition, admission, other, exam, material, uniform,
-- transport) and returns the six fee_payments columns. They always add up to (gross - concession), which keeps the
-- invariant the existing screens rely on: amount_due = sum of the breakdown columns. Admission + other charges are
-- stored in other_amount because fee_payments has no separate admission column; the assignment keeps them apart.
CREATE OR REPLACE FUNCTION public.fee_ledger_lines(p_lines jsonb, p_concession numeric) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_rem  numeric := coalesce(p_concession, 0);
  v_adm  numeric := coalesce((p_lines->>'admission_fee')::numeric, 0);
  v_tui  numeric := coalesce((p_lines->>'tuition_fee')::numeric, 0);
  v_trn  numeric := coalesce((p_lines->>'transport_fee')::numeric, 0);
  v_uni  numeric := coalesce((p_lines->>'uniform_fee')::numeric, 0);
  v_mat  numeric := coalesce((p_lines->>'material_fee')::numeric, 0);
  v_exm  numeric := coalesce((p_lines->>'exam_fee')::numeric, 0);
  v_oth  numeric := coalesce((p_lines->>'other_fee')::numeric, 0);
  v_take numeric;
BEGIN
  v_take := least(v_tui, v_rem); v_tui := v_tui - v_take; v_rem := v_rem - v_take;
  v_take := least(v_adm, v_rem); v_adm := v_adm - v_take; v_rem := v_rem - v_take;
  v_take := least(v_oth, v_rem); v_oth := v_oth - v_take; v_rem := v_rem - v_take;
  v_take := least(v_exm, v_rem); v_exm := v_exm - v_take; v_rem := v_rem - v_take;
  v_take := least(v_mat, v_rem); v_mat := v_mat - v_take; v_rem := v_rem - v_take;
  v_take := least(v_uni, v_rem); v_uni := v_uni - v_take; v_rem := v_rem - v_take;
  v_take := least(v_trn, v_rem); v_trn := v_trn - v_take; v_rem := v_rem - v_take;
  IF v_rem > 0 THEN RAISE EXCEPTION 'The concession cannot be more than the total fee' USING ERRCODE = 'P0001'; END IF;
  RETURN jsonb_build_object('course_amount', v_tui, 'transport_amount', v_trn, 'other_amount', v_adm + v_oth,
                            'uniform_amount', v_uni, 'material_amount', v_mat, 'exam_amount', v_exm);
END $$;

CREATE OR REPLACE FUNCTION public._fee_snapshot(a public.fee_assignments) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('status', a.status, 'source', a.source, 'structure_id', a.structure_id,
    'admission_fee', a.admission_fee, 'tuition_fee', a.tuition_fee, 'transport_fee', a.transport_fee, 'uniform_fee', a.uniform_fee,
    'material_fee', a.material_fee, 'exam_fee', a.exam_fee, 'other_fee', a.other_fee, 'gross_total', a.gross_total,
    'concession_amount', a.concession_amount, 'concession_reason', a.concession_reason, 'net_total', a.net_total,
    'due_date', a.due_date, 'student_id', a.student_id)
$$;

CREATE OR REPLACE FUNCTION public._fee_log(p_school uuid, p_asg uuid, p_applicant uuid, p_action text, p_old jsonb, p_new jsonb, p_reason text, p_actor uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.fee_assignment_history (school_id, assignment_id, applicant_id, action, old_values, new_values, reason, actor)
  VALUES (p_school, p_asg, p_applicant, p_action, p_old, p_new, nullif(btrim(coalesce(p_reason, '')), ''), p_actor);
$$;

-- THE single write path for an assignment: creates it, converts an "unmatched" one, or corrects an active one, keeping
-- the fee_payments row in step, and always writes the history entry. Used by the auto trigger and the manual RPC.
CREATE OR REPLACE FUNCTION public._fee_upsert_assignment(
  p_applicant uuid, p_school uuid, p_name text, p_grade text, p_year text, p_category text,
  p_struct uuid, p_source text, p_basis text, p_lines jsonb, p_concession numeric, p_conc_reason text,
  p_due date, p_schedule jsonb, p_actor uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_adm numeric := coalesce((p_lines->>'admission_fee')::numeric, 0);
  v_tui numeric := coalesce((p_lines->>'tuition_fee')::numeric, 0);
  v_trn numeric := coalesce((p_lines->>'transport_fee')::numeric, 0);
  v_uni numeric := coalesce((p_lines->>'uniform_fee')::numeric, 0);
  v_mat numeric := coalesce((p_lines->>'material_fee')::numeric, 0);
  v_exm numeric := coalesce((p_lines->>'exam_fee')::numeric, 0);
  v_oth numeric := coalesce((p_lines->>'other_fee')::numeric, 0);
  v_conc numeric := coalesce(p_concession, 0);
  v_gross numeric; v_net numeric; v_ledger jsonb; v_ex public.fee_assignments; v_new public.fee_assignments;
  v_fee public.fee_payments; v_asg uuid; v_feeid uuid; v_action text; v_today date := public.instalment_today(); v_status text;
BEGIN
  IF least(v_adm, v_tui, v_trn, v_uni, v_mat, v_exm, v_oth, v_conc) < 0 THEN
    RAISE EXCEPTION 'Fee amounts cannot be negative' USING ERRCODE = 'P0001';
  END IF;
  IF v_adm <> round(v_adm, 2) OR v_tui <> round(v_tui, 2) OR v_trn <> round(v_trn, 2) OR v_uni <> round(v_uni, 2)
     OR v_mat <> round(v_mat, 2) OR v_exm <> round(v_exm, 2) OR v_oth <> round(v_oth, 2) OR v_conc <> round(v_conc, 2) THEN
    RAISE EXCEPTION 'Fee amounts can have at most 2 decimals' USING ERRCODE = 'P0001';
  END IF;
  v_gross := v_adm + v_tui + v_trn + v_uni + v_mat + v_exm + v_oth;
  IF v_gross <= 0 THEN RAISE EXCEPTION 'The fee plan must have at least one amount above 0' USING ERRCODE = 'P0001'; END IF;
  IF v_conc > v_gross THEN RAISE EXCEPTION 'The concession cannot be more than the total fee' USING ERRCODE = 'P0001'; END IF;
  IF v_conc > 0 AND nullif(btrim(coalesce(p_conc_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for a concession' USING ERRCODE = 'P0001';
  END IF;
  v_net := v_gross - v_conc;
  v_ledger := public.fee_ledger_lines(p_lines, v_conc);

  SELECT * INTO v_ex FROM public.fee_assignments
   WHERE applicant_id = p_applicant AND public.fee_norm(academic_year) = public.fee_norm(p_year) AND status IN ('active', 'unmatched')
   FOR UPDATE;

  IF v_ex.id IS NOT NULL AND v_ex.status = 'active' AND p_source = 'auto' THEN
    RETURN v_ex.id;                                   -- already assigned: the automatic path never changes an existing plan
  END IF;

  PERFORM set_config('apas.fee_plan_write', 'on', true);

  IF v_ex.id IS NULL OR v_ex.status = 'unmatched' THEN
    v_asg := coalesce(v_ex.id, gen_random_uuid());
    IF v_ex.id IS NULL THEN
      INSERT INTO public.fee_assignments (id, school_id, applicant_id, applicant_name, structure_id, academic_year, class_grade, category,
        status, source, match_basis, admission_fee, tuition_fee, transport_fee, uniform_fee, material_fee, exam_fee, other_fee,
        gross_total, concession_amount, concession_reason, net_total, due_date, instalment_schedule, assigned_by)
      VALUES (v_asg, p_school, p_applicant, p_name, p_struct, p_year, p_grade, p_category,
        'active', p_source, p_basis, v_adm, v_tui, v_trn, v_uni, v_mat, v_exm, v_oth,
        v_gross, v_conc, nullif(btrim(coalesce(p_conc_reason, '')), ''), v_net, p_due, p_schedule, p_actor);
    ELSE
      UPDATE public.fee_assignments SET structure_id = p_struct, status = 'active', source = p_source, match_basis = p_basis,
        applicant_name = p_name, class_grade = p_grade, category = p_category,
        admission_fee = v_adm, tuition_fee = v_tui, transport_fee = v_trn, uniform_fee = v_uni, material_fee = v_mat, exam_fee = v_exm, other_fee = v_oth,
        gross_total = v_gross, concession_amount = v_conc, concession_reason = nullif(btrim(coalesce(p_conc_reason, '')), ''), net_total = v_net,
        due_date = p_due, instalment_schedule = p_schedule, assigned_by = p_actor, updated_at = now()
       WHERE id = v_asg;
    END IF;
    v_status := CASE WHEN v_net <= 0 THEN 'paid' WHEN p_due IS NOT NULL AND p_due < v_today THEN 'overdue' ELSE 'pending' END;
    INSERT INTO public.fee_payments (school_id, student_id, student_name, class_grade, section, amount_due, amount_paid, due_date, status, created_by,
      course_amount, transport_amount, other_amount, uniform_amount, material_amount, exam_amount, fee_assignment_id)
    VALUES (p_school, NULL, p_name, p_grade, NULL, v_net, 0, p_due, v_status, p_actor,
      (v_ledger->>'course_amount')::numeric, (v_ledger->>'transport_amount')::numeric, (v_ledger->>'other_amount')::numeric,
      (v_ledger->>'uniform_amount')::numeric, (v_ledger->>'material_amount')::numeric, (v_ledger->>'exam_amount')::numeric, v_asg)
    RETURNING id INTO v_feeid;
    UPDATE public.fee_assignments SET fee_payment_id = v_feeid WHERE id = v_asg RETURNING * INTO v_new;
    PERFORM public._fee_log(p_school, v_asg, p_applicant, CASE WHEN p_source = 'auto' THEN 'auto_assigned' ELSE 'manual_assigned' END,
      CASE WHEN v_ex.id IS NULL THEN NULL ELSE public._fee_snapshot(v_ex) END, public._fee_snapshot(v_new), p_reason, p_actor);
  ELSE
    -- correction of an active plan (manual only)
    v_asg := v_ex.id;
    SELECT * INTO v_fee FROM public.fee_payments WHERE id = v_ex.fee_payment_id FOR UPDATE;
    IF v_fee.id IS NULL THEN RAISE EXCEPTION 'The linked fee record no longer exists - cancel this assignment and assign it again' USING ERRCODE = 'P0001'; END IF;
    IF v_net < v_fee.amount_paid THEN
      RAISE EXCEPTION 'The new payable total (Rs. %) is lower than the amount already paid (Rs. %)', v_net, v_fee.amount_paid USING ERRCODE = 'P0001';
    END IF;
    v_status := CASE WHEN v_fee.amount_paid >= v_net THEN 'paid'
                     WHEN coalesce(p_due, v_fee.due_date) IS NOT NULL AND coalesce(p_due, v_fee.due_date) < v_today THEN 'overdue' ELSE 'pending' END;
    UPDATE public.fee_payments SET amount_due = v_net, status = v_status, due_date = coalesce(p_due, due_date),
      course_amount = (v_ledger->>'course_amount')::numeric, transport_amount = (v_ledger->>'transport_amount')::numeric,
      other_amount = (v_ledger->>'other_amount')::numeric, uniform_amount = (v_ledger->>'uniform_amount')::numeric,
      material_amount = (v_ledger->>'material_amount')::numeric, exam_amount = (v_ledger->>'exam_amount')::numeric
     WHERE id = v_fee.id;
    UPDATE public.fee_assignments SET structure_id = p_struct, source = 'manual', match_basis = p_basis,
        admission_fee = v_adm, tuition_fee = v_tui, transport_fee = v_trn, uniform_fee = v_uni, material_fee = v_mat, exam_fee = v_exm, other_fee = v_oth,
        gross_total = v_gross, concession_amount = v_conc, concession_reason = nullif(btrim(coalesce(p_conc_reason, '')), ''), net_total = v_net,
        due_date = coalesce(p_due, due_date), instalment_schedule = coalesce(p_schedule, instalment_schedule), assigned_by = p_actor, updated_at = now()
     WHERE id = v_asg RETURNING * INTO v_new;
    v_action := CASE WHEN v_new.structure_id IS DISTINCT FROM v_ex.structure_id THEN 'structure_changed'
                     WHEN v_new.gross_total = v_ex.gross_total AND v_new.concession_amount IS DISTINCT FROM v_ex.concession_amount THEN 'concession_changed'
                     ELSE 'corrected' END;
    PERFORM public._fee_log(p_school, v_asg, p_applicant, v_action, public._fee_snapshot(v_ex), public._fee_snapshot(v_new), p_reason, p_actor);
  END IF;

  PERFORM set_config('apas.fee_plan_write', 'off', true);
  RETURN v_asg;
END $$;

-- 6. Automatic assignment ------------------------------------------------------------------------------------------
-- Finds the structure (class + category + academic year; a category-specific structure beats an "all categories" one),
-- assigns it, or records an "unmatched" row + warning for the school's finance staff. Idempotent and race-safe.
CREATE OR REPLACE FUNCTION public.fee_try_auto_assign(p_applicant uuid, p_actor uuid DEFAULT auth.uid()) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a record; v_struct public.fee_structures; v_ex public.fee_assignments; v_asg uuid; v_basis text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('fee_assign:' || p_applicant::text, 0));
  SELECT * INTO a FROM public.fee_applicant_info(p_applicant);
  IF NOT FOUND OR a.school_id IS NULL OR a.status IS DISTINCT FROM 'admitted' THEN RETURN 'skipped'; END IF;

  SELECT * INTO v_ex FROM public.fee_assignments
   WHERE applicant_id = p_applicant AND public.fee_norm(academic_year) = public.fee_norm(a.academic_year) AND status IN ('active', 'unmatched');
  IF v_ex.id IS NOT NULL AND v_ex.status = 'active' THEN RETURN 'exists'; END IF;

  SELECT s.* INTO v_struct FROM public.fee_structures s
   WHERE s.school_id = a.school_id AND s.is_active
     AND public.fee_norm(s.academic_year) = public.fee_norm(a.academic_year)
     AND public.fee_norm(s.class_grade)   = public.fee_norm(a.grade)
     AND (public.fee_norm(s.category) = public.fee_norm(a.category) OR public.fee_norm(s.category) = '')
   ORDER BY (public.fee_norm(s.category) = public.fee_norm(a.category)) DESC
   LIMIT 1;

  IF v_struct.id IS NULL THEN
    IF v_ex.id IS NOT NULL THEN RETURN 'unmatched'; END IF;       -- already flagged: no duplicate row or notification
    v_asg := gen_random_uuid();
    INSERT INTO public.fee_assignments (id, school_id, applicant_id, applicant_name, academic_year, class_grade, category, status, source, assigned_by)
    VALUES (v_asg, a.school_id, p_applicant, a.full_name, a.academic_year, a.grade, nullif(btrim(coalesce(a.category, '')), ''), 'unmatched', 'auto', p_actor);
    PERFORM public._fee_log(a.school_id, v_asg, p_applicant, 'no_match', NULL,
      jsonb_build_object('class_grade', a.grade, 'category', a.category, 'academic_year', a.academic_year),
      'No active fee structure matches this class, category and academic year', p_actor);
    BEGIN
      PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_staff_ids(a.school_id)), 'fee_plan_unmatched',
        'No fee structure for an admitted student',
        a.full_name || ' (' || a.grade || ', ' || a.academic_year || ') was admitted but no fee structure matches. Assign a fee plan manually.',
        v_asg, 'fee_assignment');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'fee_plan_unmatched notify failed: %', sqlerrm; END;
    RETURN 'unmatched';
  END IF;

  v_basis := CASE WHEN public.fee_norm(v_struct.category) = public.fee_norm(a.category) THEN 'exact' ELSE 'default' END;
  v_asg := public._fee_upsert_assignment(p_applicant, a.school_id, a.full_name, a.grade, a.academic_year,
             nullif(btrim(coalesce(a.category, '')), ''), v_struct.id, 'auto', v_basis, to_jsonb(v_struct), 0, NULL,
             v_struct.due_date, v_struct.instalment_schedule, p_actor, 'Automatically assigned on admission');
  BEGIN
    PERFORM public.instalment_notify(ARRAY(SELECT public.instalment_staff_ids(a.school_id)), 'fee_plan_assigned',
      'Fee plan assigned', 'Fee plan "' || v_struct.name || '" (' || public.instalment_money(v_struct.total_fee) || ') was assigned to ' || a.full_name || '.',
      v_asg, 'fee_assignment');
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'fee_plan_assigned notify failed: %', sqlerrm; END;
  RETURN 'assigned';
END $$;

-- The admission workflow hook. It fires only when an applicant BECOMES admitted (update) or is created already admitted
-- (import) - never for an enquiry/application - and it can never block the admission decision itself.
CREATE OR REPLACE FUNCTION public.fee_on_admit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.fee_try_auto_assign(new.id, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fee_on_admit_trigger failed for %: %', new.id, sqlerrm;
    BEGIN
      PERFORM public._fee_log(new.school_id, NULL, new.id, 'error', NULL, NULL, left(sqlerrm, 500), auth.uid());
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fee_assign_on_admit ON public.admission_applicants;
CREATE TRIGGER trg_fee_assign_on_admit AFTER UPDATE OF status ON public.admission_applicants
  FOR EACH ROW WHEN (new.status = 'admitted' AND old.status IS DISTINCT FROM 'admitted')
  EXECUTE FUNCTION public.fee_on_admit_trigger();
DROP TRIGGER IF EXISTS trg_fee_assign_on_admit_ins ON public.admission_applicants;
CREATE TRIGGER trg_fee_assign_on_admit_ins AFTER INSERT ON public.admission_applicants
  FOR EACH ROW WHEN (new.status = 'admitted')
  EXECUTE FUNCTION public.fee_on_admit_trigger();

-- 7. Admin actions (all re-check the caller) ------------------------------------------------------------------------
-- Assign (no plan yet / unmatched) or CORRECT (active plan) from a structure and/or custom amounts.
-- p_lines = NULL -> use the structure's amounts. p_lines = {"tuition_fee":..,"admission_fee":..,...} -> custom amounts.
CREATE OR REPLACE FUNCTION public.fee_assign_manual(
  p_applicant uuid, p_structure uuid DEFAULT NULL, p_lines jsonb DEFAULT NULL, p_concession numeric DEFAULT 0,
  p_concession_reason text DEFAULT NULL, p_reason text DEFAULT NULL, p_due_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; v_struct public.fee_structures; v_lines jsonb; v_live public.fee_assignments; v_schedule jsonb; v_basis text;
BEGIN
  SELECT * INTO a FROM public.fee_applicant_info(p_applicant);
  IF NOT FOUND OR a.school_id IS NULL THEN RAISE EXCEPTION 'Applicant not found'; END IF;
  IF NOT public.is_fee_staff(a.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  IF a.status IS DISTINCT FROM 'admitted' THEN
    RAISE EXCEPTION 'A fee plan can only be assigned after the admission is confirmed (status Admitted)' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fee_assign:' || p_applicant::text, 0));

  IF p_structure IS NOT NULL THEN
    SELECT * INTO v_struct FROM public.fee_structures WHERE id = p_structure AND school_id = a.school_id;
    IF v_struct.id IS NULL THEN RAISE EXCEPTION 'Fee structure not found for this school'; END IF;
  END IF;
  IF p_lines IS NOT NULL THEN
    v_lines := p_lines;
    v_basis := 'manual';
  ELSIF v_struct.id IS NOT NULL THEN
    v_lines := to_jsonb(v_struct);
    v_basis := 'manual';
  ELSE
    RAISE EXCEPTION 'Choose a fee structure or enter the fee amounts' USING ERRCODE = 'P0001';
  END IF;
  v_schedule := CASE WHEN p_lines IS NULL AND v_struct.id IS NOT NULL THEN v_struct.instalment_schedule ELSE NULL END;

  SELECT * INTO v_live FROM public.fee_assignments
   WHERE applicant_id = p_applicant AND public.fee_norm(academic_year) = public.fee_norm(a.academic_year) AND status IN ('active', 'unmatched');
  IF v_live.id IS NOT NULL AND v_live.status = 'active' AND nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to correct an existing fee plan' USING ERRCODE = 'P0001';
  END IF;

  RETURN public._fee_upsert_assignment(p_applicant, a.school_id, a.full_name, a.grade, a.academic_year,
           nullif(btrim(coalesce(a.category, '')), ''), v_struct.id, 'manual', v_basis, v_lines, p_concession, p_concession_reason,
           coalesce(p_due_date, v_struct.due_date), v_schedule, auth.uid(), p_reason);
END $$;

-- Cancel a plan that has no payments yet (removes its fee record). With payments, correct the plan instead.
CREATE OR REPLACE FUNCTION public.fee_assignment_cancel(p_assignment uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.fee_assignments; v_fee public.fee_payments; v_new public.fee_assignments;
BEGIN
  SELECT * INTO v_a FROM public.fee_assignments WHERE id = p_assignment FOR UPDATE;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'Fee plan assignment not found'; END IF;
  IF NOT public.is_fee_staff(v_a.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  IF v_a.status = 'cancelled' THEN RAISE EXCEPTION 'This assignment is already cancelled'; END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'A reason is required' USING ERRCODE = 'P0001'; END IF;
  IF v_a.fee_payment_id IS NOT NULL THEN
    SELECT * INTO v_fee FROM public.fee_payments WHERE id = v_a.fee_payment_id FOR UPDATE;
    IF v_fee.id IS NOT NULL THEN
      IF v_fee.amount_paid > 0 THEN
        RAISE EXCEPTION 'Payments (Rs. %) are already recorded against this fee, so it cannot be cancelled - correct the plan instead', v_fee.amount_paid USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.instalment_plans WHERE fee_payment_id = v_fee.id AND status <> 'cancelled')
         OR EXISTS (SELECT 1 FROM public.instalment_requests WHERE fee_payment_id = v_fee.id AND status = 'pending') THEN
        RAISE EXCEPTION 'This fee has an instalment plan or a pending instalment request - cancel that first' USING ERRCODE = 'P0001';
      END IF;
      PERFORM set_config('apas.fee_plan_write', 'on', true);
      DELETE FROM public.fee_payments WHERE id = v_fee.id;
      PERFORM set_config('apas.fee_plan_write', 'off', true);
    END IF;
  END IF;
  UPDATE public.fee_assignments SET status = 'cancelled', fee_payment_id = NULL, updated_at = now() WHERE id = v_a.id RETURNING * INTO v_new;
  PERFORM public._fee_log(v_a.school_id, v_a.id, v_a.applicant_id, 'cancelled', public._fee_snapshot(v_a), public._fee_snapshot(v_new), p_reason, auth.uid());
END $$;

-- Attach the enrolled student to the plan: the fee record then appears under that student in ERP Fees, the student
-- profile and the parent fee page.
CREATE OR REPLACE FUNCTION public.fee_assignment_link_student(p_assignment uuid, p_student uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.fee_assignments; v_s record; v_new public.fee_assignments;
BEGIN
  SELECT * INTO v_a FROM public.fee_assignments WHERE id = p_assignment FOR UPDATE;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'Fee plan assignment not found'; END IF;
  IF NOT public.is_fee_staff(v_a.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  IF v_a.status <> 'active' OR v_a.fee_payment_id IS NULL THEN RAISE EXCEPTION 'Only an active fee plan can be linked to a student'; END IF;
  SELECT id, school_id, "class" AS cls, section INTO v_s FROM public.students WHERE id = p_student;
  IF v_s.id IS NULL OR v_s.school_id IS DISTINCT FROM v_a.school_id THEN RAISE EXCEPTION 'Student not found in this school'; END IF;
  PERFORM set_config('apas.fee_plan_write', 'on', true);
  UPDATE public.fee_payments SET student_id = v_s.id, class_grade = coalesce(v_s.cls, class_grade), section = v_s.section WHERE id = v_a.fee_payment_id;
  PERFORM set_config('apas.fee_plan_write', 'off', true);
  UPDATE public.fee_assignments SET student_id = v_s.id, updated_at = now() WHERE id = v_a.id RETURNING * INTO v_new;
  PERFORM public._fee_log(v_a.school_id, v_a.id, v_a.applicant_id, 'linked_student', public._fee_snapshot(v_a), public._fee_snapshot(v_new), NULL, auth.uid());
END $$;

-- Re-run automatic assignment: (a) for admitted applicants still flagged "no structure" - call it after adding a structure;
-- (b) optionally (p_include_unassigned) for applicants admitted BEFORE this feature that have no plan at all.
CREATE OR REPLACE FUNCTION public.fee_resolve_unmatched(p_school uuid, p_include_unassigned boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_out text; v_assigned integer := 0; v_unmatched integer := 0; v_failed integer := 0;
BEGIN
  IF NOT public.is_fee_staff(p_school) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  FOR r IN
    SELECT DISTINCT applicant_id FROM public.fee_assignments WHERE school_id = p_school AND status = 'unmatched'
    UNION
    SELECT a.id FROM public.admission_applicants a
     WHERE p_include_unassigned AND a.school_id = p_school AND a.status = 'admitted'
       AND NOT EXISTS (SELECT 1 FROM public.fee_assignments f WHERE f.applicant_id = a.id AND f.status IN ('active', 'unmatched'))
  LOOP
    BEGIN
      v_out := public.fee_try_auto_assign(r.applicant_id, auth.uid());
      IF v_out = 'assigned' THEN v_assigned := v_assigned + 1; ELSIF v_out = 'unmatched' THEN v_unmatched := v_unmatched + 1; END IF;
    EXCEPTION WHEN OTHERS THEN v_failed := v_failed + 1; RAISE WARNING 'fee_resolve_unmatched failed for %: %', r.applicant_id, sqlerrm; END;
  END LOOP;
  RETURN jsonb_build_object('assigned', v_assigned, 'still_unmatched', v_unmatched, 'failed', v_failed);
END $$;

-- Create the existing instalment plan from the structure's optional template, once the student is linked.
-- Reuses create_instalment_plan_for_student (so all instalment rules, notifications and payments stay as they are).
CREATE OR REPLACE FUNCTION public.fee_assignment_create_instalments(p_assignment uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_a public.fee_assignments; v_fee public.fee_payments; v_out numeric; v_items jsonb := '[]'::jsonb; v_n integer; v_i integer := 0;
        v_alloc numeric := 0; v_amt numeric; e jsonb; v_plan uuid;
BEGIN
  SELECT * INTO v_a FROM public.fee_assignments WHERE id = p_assignment FOR UPDATE;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'Fee plan assignment not found'; END IF;
  IF NOT public.is_fee_staff(v_a.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  IF v_a.status <> 'active' OR v_a.instalment_schedule IS NULL THEN RAISE EXCEPTION 'This fee plan has no instalment template'; END IF;
  IF v_a.student_id IS NULL THEN RAISE EXCEPTION 'Link the enrolled student to this fee plan first' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_fee FROM public.fee_payments WHERE id = v_a.fee_payment_id;
  v_out := v_fee.amount_due - v_fee.amount_paid;
  IF v_out <= 0 THEN RAISE EXCEPTION 'This fee has no outstanding balance'; END IF;
  v_n := jsonb_array_length(v_a.instalment_schedule);
  FOR e IN SELECT jsonb_array_elements(v_a.instalment_schedule) LOOP
    v_i := v_i + 1;
    v_amt := CASE WHEN v_i = v_n THEN v_out - v_alloc ELSE round(v_out * (e->>'percent')::numeric / 100, 2) END;
    v_alloc := v_alloc + v_amt;
    v_items := v_items || jsonb_build_array(jsonb_build_object('amount', v_amt, 'due_date', e->>'due_date'));
  END LOOP;
  v_plan := public.create_instalment_plan_for_student(v_a.student_id, v_a.fee_payment_id, v_items, 'Created from fee plan');
  PERFORM public._fee_log(v_a.school_id, v_a.id, v_a.applicant_id, 'instalments_created', NULL, jsonb_build_object('plan_id', v_plan, 'items', v_items), NULL, auth.uid());
  RETURN v_plan;
END $$;

-- 8. Read models --------------------------------------------------------------------------------------------------
-- Money view of an assignment: fees, concession, net payable, paid (from the live fee record), outstanding.
CREATE OR REPLACE FUNCTION public._fee_view(a public.fee_assignments) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', a.id, 'applicant_id', a.applicant_id, 'applicant_name', a.applicant_name, 'student_id', a.student_id, 'fee_payment_id', a.fee_payment_id,
    'structure_id', a.structure_id, 'structure_name', (SELECT s.name FROM public.fee_structures s WHERE s.id = a.structure_id),
    'academic_year', a.academic_year, 'class_grade', a.class_grade, 'category', a.category, 'status', a.status, 'source', a.source, 'match_basis', a.match_basis,
    'admission_fee', a.admission_fee, 'tuition_fee', a.tuition_fee, 'transport_fee', a.transport_fee, 'uniform_fee', a.uniform_fee,
    'material_fee', a.material_fee, 'exam_fee', a.exam_fee, 'other_fee', a.other_fee,
    'gross_total', a.gross_total, 'concession_amount', a.concession_amount, 'concession_reason', a.concession_reason, 'net_total', a.net_total,
    'paid', coalesce(f.amount_paid, 0), 'outstanding', greatest(a.net_total - coalesce(f.amount_paid, 0), 0),
    'fee_status', f.status, 'due_date', coalesce(f.due_date, a.due_date), 'instalment_schedule', a.instalment_schedule,
    'has_instalment_plan', EXISTS (SELECT 1 FROM public.instalment_plans pl WHERE pl.fee_payment_id = a.fee_payment_id AND pl.status = 'active'),
    'created_at', a.created_at, 'updated_at', a.updated_at)
  FROM (SELECT 1) x LEFT JOIN public.fee_payments f ON f.id = a.fee_payment_id;
$$;

CREATE OR REPLACE FUNCTION public.list_fee_assignments(p_school uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fee_can_view(p_school) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(public._fee_view(a) ORDER BY a.created_at DESC)
                     FROM (SELECT * FROM public.fee_assignments WHERE school_id = p_school AND status <> 'cancelled'
                            ORDER BY created_at DESC LIMIT 2000) a), '[]'::jsonb);
END $$;

-- Admitted applicants that have no live plan (admitted before this feature, or cancelled) so staff can assign them.
CREATE OR REPLACE FUNCTION public.fee_unassigned_admitted(p_school uuid)
RETURNS TABLE (applicant_id uuid, full_name text, grade text, academic_year text, category text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rel text := CASE WHEN to_regclass('public.decrypted_admission_applicants') IS NOT NULL
                           THEN 'public.decrypted_admission_applicants' ELSE 'public.admission_applicants' END;
BEGIN
  IF NOT public.fee_can_view(p_school) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  RETURN QUERY EXECUTE format(
    'SELECT a.id, a.full_name::text, i.grade::text, i.academic_year::text, a.category::text
       FROM %s a JOIN public.admission_intakes i ON i.id = a.intake_id
      WHERE a.school_id = $1 AND a.status = ''admitted''
        AND NOT EXISTS (SELECT 1 FROM public.fee_assignments f WHERE f.applicant_id = a.id AND f.status IN (''active'', ''unmatched''))
      ORDER BY a.full_name', v_rel) USING p_school;
END $$;

CREATE OR REPLACE FUNCTION public.get_applicant_fee_plan(p_applicant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; v_asg public.fee_assignments;
BEGIN
  SELECT * INTO a FROM public.fee_applicant_info(p_applicant);
  IF NOT FOUND OR a.school_id IS NULL THEN RAISE EXCEPTION 'Applicant not found'; END IF;
  IF NOT public.fee_can_view(a.school_id) THEN RAISE EXCEPTION 'Not authorised' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_asg FROM public.fee_assignments
   WHERE applicant_id = p_applicant AND public.fee_norm(academic_year) = public.fee_norm(a.academic_year) AND status IN ('active', 'unmatched');
  RETURN jsonb_build_object(
    'applicant_status', a.status, 'class_grade', a.grade, 'academic_year', a.academic_year, 'category', a.category,
    'assignment', CASE WHEN v_asg.id IS NULL THEN NULL ELSE public._fee_view(v_asg) END,
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'old_values', h.old_values, 'new_values', h.new_values,
                  'reason', h.reason, 'actor', h.actor, 'actor_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = h.actor), 'created_at', h.created_at)
                  ORDER BY h.created_at DESC)
                  FROM public.fee_assignment_history h WHERE h.applicant_id = p_applicant), '[]'::jsonb));
END $$;

-- Student profile read model: staff of the school, the child's parents, or the student themself. The history is staff-only.
CREATE OR REPLACE FUNCTION public.get_student_fee_plan(p_student uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid; v_staff boolean;
BEGIN
  SELECT school_id INTO v_school FROM public.students WHERE id = p_student;
  v_staff := public.fee_can_view(v_school);
  IF NOT (v_staff OR public.is_parent_of_student(p_student)
          OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_student AND s.profile_id = auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised for this student' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'plans', coalesce((SELECT jsonb_agg(public._fee_view(a) ORDER BY a.created_at DESC)
                         FROM public.fee_assignments a WHERE a.student_id = p_student AND a.status = 'active'), '[]'::jsonb),
    'history', CASE WHEN NOT v_staff THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'action', h.action, 'old_values', h.old_values,
                  'new_values', h.new_values, 'reason', h.reason, 'actor_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = h.actor), 'created_at', h.created_at)
                  ORDER BY h.created_at DESC)
                  FROM public.fee_assignment_history h
                  WHERE h.assignment_id IN (SELECT id FROM public.fee_assignments WHERE student_id = p_student)), '[]'::jsonb) END);
END $$;

-- 9. RLS + grants ---------------------------------------------------------------------------------------------------
ALTER TABLE public.fee_structures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_assignments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fee_structures_select ON public.fee_structures;
CREATE POLICY fee_structures_select ON public.fee_structures FOR SELECT TO authenticated USING (public.fee_can_view(school_id));
DROP POLICY IF EXISTS fee_structures_insert ON public.fee_structures;
CREATE POLICY fee_structures_insert ON public.fee_structures FOR INSERT TO authenticated WITH CHECK (public.is_fee_staff(school_id));
DROP POLICY IF EXISTS fee_structures_update ON public.fee_structures;
CREATE POLICY fee_structures_update ON public.fee_structures FOR UPDATE TO authenticated USING (public.is_fee_staff(school_id)) WITH CHECK (public.is_fee_staff(school_id));
DROP POLICY IF EXISTS fee_structures_delete ON public.fee_structures;
CREATE POLICY fee_structures_delete ON public.fee_structures FOR DELETE TO authenticated USING (public.is_fee_staff(school_id));

DROP POLICY IF EXISTS fee_assignments_select ON public.fee_assignments;
CREATE POLICY fee_assignments_select ON public.fee_assignments FOR SELECT TO authenticated USING (public.fee_can_view(school_id));
DROP POLICY IF EXISTS fee_history_select ON public.fee_assignment_history;
CREATE POLICY fee_history_select ON public.fee_assignment_history FOR SELECT TO authenticated USING (public.fee_can_view(school_id));

-- assignments + history are written ONLY by the SECURITY DEFINER functions above
REVOKE INSERT, UPDATE, DELETE ON public.fee_assignments, public.fee_assignment_history FROM anon, authenticated;
REVOKE ALL ON public.fee_structures, public.fee_assignments, public.fee_assignment_history FROM anon;
GRANT SELECT ON public.fee_assignments, public.fee_assignment_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_structures TO authenticated;

-- internal engine: not callable by clients
REVOKE EXECUTE ON FUNCTION
  public.fee_try_auto_assign(uuid, uuid), public.fee_on_admit_trigger(), public.fee_applicant_info(uuid),
  public._fee_upsert_assignment(uuid, uuid, text, text, text, text, uuid, text, text, jsonb, numeric, text, date, jsonb, uuid, text),
  public._fee_log(uuid, uuid, uuid, text, jsonb, jsonb, text, uuid), public._fee_snapshot(public.fee_assignments),
  public._fee_view(public.fee_assignments), public.fee_ledger_lines(jsonb, numeric), public.fee_payments_plan_guard()
  FROM PUBLIC, anon, authenticated;

-- client-callable (each re-checks the caller)
REVOKE EXECUTE ON FUNCTION
  public.fee_assign_manual(uuid, uuid, jsonb, numeric, text, text, date), public.fee_assignment_cancel(uuid, text),
  public.fee_assignment_link_student(uuid, uuid), public.fee_resolve_unmatched(uuid, boolean), public.fee_assignment_create_instalments(uuid),
  public.list_fee_assignments(uuid), public.fee_unassigned_admitted(uuid), public.get_applicant_fee_plan(uuid), public.get_student_fee_plan(uuid),
  public.fee_can_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.fee_assign_manual(uuid, uuid, jsonb, numeric, text, text, date), public.fee_assignment_cancel(uuid, text),
  public.fee_assignment_link_student(uuid, uuid), public.fee_resolve_unmatched(uuid, boolean), public.fee_assignment_create_instalments(uuid),
  public.list_fee_assignments(uuid), public.fee_unassigned_admitted(uuid), public.get_applicant_fee_plan(uuid), public.get_student_fee_plan(uuid),
  public.fee_can_view(uuid) TO authenticated;
