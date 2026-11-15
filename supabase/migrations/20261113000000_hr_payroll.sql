-- HR & Payroll (ERP > People).
--
-- Builds on the existing `employees` table (ERP People page): extends it, and adds only what was missing.
--   employees (extended)      employee id / code, DOB, gender, address, employment type, last working day
--   employee_hr_private       PAN, UAN, ESIC no., bank details, tax regime, PF/ESI enrolment  (HR staff only)
--   salary_structures         versioned by effective date: basic, HRA, DA + extra allowances / deductions
--   staff_attendance          daily Present / Absent / Half-day / Leave
--   payroll_adjustments       one-off bonus / extra earning / extra deduction for one month
--   statutory_config          EPF, ESI, TDS, wage-definition and attendance rules - EFFECTIVE-DATED, per school
--                             (organization_id NULL = platform default; a school's own row overrides it)
--   payroll_runs / payroll_items   the monthly payroll and each employee's salary slip data
--
-- Isolation: `employees.organization_id` holds the SCHOOL id in this app (see ERPPeople.tsx), so every table below uses the
-- same column and is gated by is_hr_staff(organization_id): ERP-enabled users, school admins and admins of THAT school -
-- the same people who may use Fee Management. Payroll tables are READ-ONLY for browsers; runs are written by the
-- `get-mastery-history` edge function (hr_* actions) after it recomputes everything on the server.

-- 1. helper ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_hr_staff(p_school uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_school IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid() AND p.school_id = p_school
               AND (COALESCE(p.erp_access, false) OR p.role IN ('admin', 'school_admin')))
    OR EXISTS (SELECT 1 FROM public.school_admin_schools sas
                WHERE sas.school_admin_id = auth.uid() AND sas.school_id = p_school)
  );
$$;

-- 2. employees: extend, do not replace ------------------------------------------------------------------------------
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS emergency_contact text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'permanent';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS last_working_date date;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_employment_type_chk') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_employment_type_chk CHECK (employment_type IN ('permanent', 'contract', 'part_time', 'probation'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_gender_chk') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_gender_chk CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_org_code ON public.employees (organization_id, lower(employee_code)) WHERE employee_code IS NOT NULL;

-- HR staff of the school may manage the school's employees (added next to the existing policies, which stay as they are).
DROP POLICY IF EXISTS employees_hr_staff_all ON public.employees;
CREATE POLICY employees_hr_staff_all ON public.employees FOR ALL
  USING (public.is_hr_staff(organization_id)) WITH CHECK (public.is_hr_staff(organization_id));

-- 3. sensitive personal / statutory details -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_hr_private (
  employee_id     uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  pan             text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  uan             text CHECK (uan IS NULL OR uan ~ '^[0-9]{12}$'),
  esic_ip_number  text CHECK (esic_ip_number IS NULL OR esic_ip_number ~ '^[0-9]{10,17}$'),
  bank_name       text,
  bank_account_number text CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9]{6,20}$'),
  ifsc            text CHECK (ifsc IS NULL OR ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  tax_regime      text NOT NULL DEFAULT 'new' CHECK (tax_regime IN ('new', 'old')),
  declared_deductions_annual numeric(12, 2) NOT NULL DEFAULT 0 CHECK (declared_deductions_annual >= 0),  -- old regime: 80C/80D... as verified by HR
  pf_mode         text NOT NULL DEFAULT 'auto' CHECK (pf_mode IN ('auto', 'enrolled', 'exempt')),        -- auto = enrol when wages <= ceiling
  pf_on_actual_wage boolean NOT NULL DEFAULT false,                                                     -- contribute on full wages instead of the ceiling
  eps_member      boolean NOT NULL DEFAULT true,
  esi_mode        text NOT NULL DEFAULT 'auto' CHECK (esi_mode IN ('auto', 'enrolled', 'exempt')),
  is_disabled     boolean NOT NULL DEFAULT false,                                                       -- higher ESI wage ceiling
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_private_org ON public.employee_hr_private (organization_id);

-- 4. salary structures (a revision = a new row with a later effective_from; history is kept) ------------------------
CREATE TABLE IF NOT EXISTS public.salary_structures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  effective_from  date NOT NULL,
  basic           numeric(12, 2) NOT NULL CHECK (basic >= 0),
  hra             numeric(12, 2) NOT NULL DEFAULT 0 CHECK (hra >= 0),
  da              numeric(12, 2) NOT NULL DEFAULT 0 CHECK (da >= 0),
  -- [{ "name": "Transport", "kind": "earning"|"deduction", "type": "fixed"|"percent_basic", "value": 1600,
  --    "counts_as_wages": false, "taxable": true }]
  components      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(components) = 'array' AND jsonb_array_length(components) <= 30),
  notes           text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_salary_structures_emp ON public.salary_structures (employee_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_salary_structures_org ON public.salary_structures (organization_id);

-- 5. staff attendance -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  att_date        date NOT NULL,
  status          text NOT NULL CHECK (status IN ('present', 'absent', 'half_day', 'leave')),
  leave_type      text CHECK (leave_type IS NULL OR length(leave_type) <= 40),
  note            text CHECK (note IS NULL OR length(note) <= 300),
  marked_by       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, att_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_org_date ON public.staff_attendance (organization_id, att_date);

-- 6. one-off monthly adjustments ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year            smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  kind            text NOT NULL CHECK (kind IN ('bonus', 'earning', 'deduction')),
  name            text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 80),
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  taxable         boolean NOT NULL DEFAULT true,
  note            text CHECK (note IS NULL OR length(note) <= 300),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_period ON public.payroll_adjustments (organization_id, year, month);

-- 7. statutory configuration (effective-dated) ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.statutory_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,                                   -- NULL = platform default
  scheme          text NOT NULL CHECK (scheme IN ('epf', 'esi', 'tds', 'wages', 'attendance')),
  effective_from  date NOT NULL,
  params          jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  source_note     text CHECK (source_note IS NULL OR length(source_note) <= 600),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_statutory_config ON public.statutory_config
  (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), scheme, effective_from);

-- 8. payroll runs and salary slips ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  year            smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  working_days    numeric(5, 1),
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,     -- the exact rates used, so an old slip can always be explained
  totals          jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by    uuid,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  finalized_by    uuid,
  finalized_at    timestamptz,
  UNIQUE (organization_id, year, month)
);

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  employee_id     uuid REFERENCES public.employees(id) ON DELETE SET NULL,   -- history survives an employee being removed
  employee_name   text NOT NULL,
  employee_code   text,
  designation     text,
  department      text,
  joining_date    date,
  pan             text,
  uan             text,
  bank_account_masked text,
  attendance      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- working_days, paid_days, lop_days, present, absent, half_day, leave, unmarked
  earnings        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{name, amount, counts_as_wages}]
  deduction_lines jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{name, amount}] (structure + one-off deductions)
  gross           numeric(12, 2) NOT NULL DEFAULT 0,
  epf_employee    numeric(12, 2) NOT NULL DEFAULT 0,
  esi_employee    numeric(12, 2) NOT NULL DEFAULT 0,
  tds             numeric(12, 2) NOT NULL DEFAULT 0,
  other_deductions numeric(12, 2) NOT NULL DEFAULT 0,
  total_deductions numeric(12, 2) NOT NULL DEFAULT 0,
  net_pay         numeric(12, 2) NOT NULL DEFAULT 0,
  employer        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- epf, eps, edli, admin, esi
  employer_total  numeric(12, 2) NOT NULL DEFAULT 0,
  wages           numeric(12, 2) NOT NULL DEFAULT 0,    -- statutory "wages" (labour-code definition)
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- pf_wage, esi_wage, TDS workings, per-item warnings
  payment_status  text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'on_hold')),
  paid_on         date,
  payment_mode    text CHECK (payment_mode IS NULL OR payment_mode IN ('bank_transfer', 'cash', 'cheque', 'upi', 'other')),
  payment_reference text CHECK (payment_reference IS NULL OR length(payment_reference) <= 80),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON public.payroll_items (run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_emp ON public.payroll_items (employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_org ON public.payroll_items (organization_id);

-- 9. RLS ------------------------------------------------------------------------------------------------------------
ALTER TABLE public.employee_hr_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_structures   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statutory_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items       ENABLE ROW LEVEL SECURITY;

-- Full access for HR staff of the same school.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_hr_private', 'salary_structures', 'staff_attendance', 'payroll_adjustments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_hr_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.is_hr_staff(organization_id)) WITH CHECK (public.is_hr_staff(organization_id))', t || '_hr_all', t);
  END LOOP;
END $$;

-- Payroll runs / slips: HR staff can READ; only the server (service role) writes them.
DROP POLICY IF EXISTS payroll_runs_hr_read ON public.payroll_runs;
CREATE POLICY payroll_runs_hr_read ON public.payroll_runs FOR SELECT USING (public.is_hr_staff(organization_id));
DROP POLICY IF EXISTS payroll_items_hr_read ON public.payroll_items;
CREATE POLICY payroll_items_hr_read ON public.payroll_items FOR SELECT USING (public.is_hr_staff(organization_id));

-- Statutory config: everyone in HR can read the platform defaults and their school's rows; writes go through the server (validated).
DROP POLICY IF EXISTS statutory_config_read ON public.statutory_config;
CREATE POLICY statutory_config_read ON public.statutory_config FOR SELECT
  USING (auth.uid() IS NOT NULL AND (organization_id IS NULL OR public.is_hr_staff(organization_id)));

-- 10. platform defaults (as published at the time of writing; effective-dated, editable per school) -----------------
-- These are DATA, not code: when a rate changes, add a new row with the new effective_from (Payroll > Statutory settings).
-- VERIFY against the official notifications / your CA before relying on them for filing.
INSERT INTO public.statutory_config (organization_id, scheme, effective_from, params, source_note) VALUES
 (NULL, 'epf', '2014-09-01', jsonb_build_object(
    'enabled', true, 'wage_ceiling', 15000, 'employee_rate', 12, 'employer_rate', 12, 'eps_rate', 8.33, 'eps_wage_cap', 15000,
    'edli_rate', 0.5, 'edli_wage_cap', 15000, 'admin_rate', 0.5, 'admin_min_per_establishment', 500),
    'EPF wage ceiling Rs 15,000 (until 16 Sep 2026). 12% employee, 12% employer (8.33% EPS + 3.67% EPF), EDLI 0.5%, admin 0.5%.'),
 (NULL, 'epf', '2026-09-17', jsonb_build_object(
    'enabled', true, 'wage_ceiling', 25000, 'employee_rate', 12, 'employer_rate', 12, 'eps_rate', 8.33, 'eps_wage_cap', 25000,
    'edli_rate', 0.5, 'edli_wage_cap', 25000, 'admin_rate', 0.5, 'admin_min_per_establishment', 500),
    'EPF wage ceiling raised to Rs 25,000 from 17 Sep 2026 (S.O. 5109(E)); rates unchanged. A month uses the rates in force on its LAST day.'),
 (NULL, 'esi', '2019-07-01', jsonb_build_object(
    'enabled', true, 'wage_ceiling', 21000, 'wage_ceiling_disabled', 25000, 'employee_rate', 0.75, 'employer_rate', 3.25,
    'employee_exempt_daily_wage', 176, 'wage_basis', 'code_wages'),
    'ESI 0.75% employee + 3.25% employer on wages up to Rs 21,000 (Rs 25,000 for persons with disability). Rounded UP to the next rupee. Coverage continues to the end of the Apr-Sep / Oct-Mar contribution period.'),
 (NULL, 'wages', '2025-11-21', jsonb_build_object('apply_fifty_percent_rule', true, 'minimum_wage_share_pct', 50),
    'Labour-code wage definition: basic + DA (+ retaining allowance) count as wages; if the excluded pay exceeds 50% of total remuneration the excess is added back.'),
 (NULL, 'tds', '2025-04-01', jsonb_build_object(
    'enabled', true, 'cess_rate', 4,
    'new', jsonb_build_object('standard_deduction', 75000, 'rebate_limit', 1200000, 'rebate_max', 60000, 'marginal_relief', true,
        'slabs', jsonb_build_array(
          jsonb_build_object('upto', 400000, 'rate', 0), jsonb_build_object('upto', 800000, 'rate', 5), jsonb_build_object('upto', 1200000, 'rate', 10),
          jsonb_build_object('upto', 1600000, 'rate', 15), jsonb_build_object('upto', 2000000, 'rate', 20), jsonb_build_object('upto', 2400000, 'rate', 25),
          jsonb_build_object('upto', NULL, 'rate', 30))),
    'old', jsonb_build_object('standard_deduction', 50000, 'rebate_limit', 500000, 'rebate_max', 12500, 'marginal_relief', false,
        'slabs', jsonb_build_array(
          jsonb_build_object('upto', 250000, 'rate', 0), jsonb_build_object('upto', 500000, 'rate', 5), jsonb_build_object('upto', 1000000, 'rate', 20),
          jsonb_build_object('upto', NULL, 'rate', 30)))),
    'Resident individual, below 60, salary income only. New regime: slabs 0/5/10/15/20/25/30%, standard deduction Rs 75,000, rebate to Rs 12 lakh (unchanged for FY 2026-27). Surcharge is NOT applied.'),
 (NULL, 'attendance', '2020-01-01', jsonb_build_object('weekly_off_days', jsonb_build_array(0), 'leave_is_paid', true, 'unmarked_days', 'present'),
    'Weekly off = Sunday (0). Leave is paid; Absent is loss of pay; half-day counts 0.5. Days with no attendance entry count as present.')
ON CONFLICT DO NOTHING;
