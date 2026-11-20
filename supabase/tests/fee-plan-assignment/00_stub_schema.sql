-- Minimal stand-ins for the pre-existing APAS tables/functions the fee-plan migration depends on. The migration under test is the REAL file.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
-- the "logged in" user is chosen per test with: SELECT set_config('test.uid', '<uuid>', false)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE TABLE public.schools (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), school_id uuid, role text, full_name text, erp_access boolean DEFAULT false);
CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, profile_id uuid, full_name text, "class" text, section text);
CREATE TABLE public.parent_students (parent_id uuid, student_id uuid);
CREATE TABLE public.admission_intakes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, grade text, academic_year text);
CREATE TABLE public.admission_applicants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid, intake_id uuid REFERENCES public.admission_intakes(id),
  full_name text NOT NULL, status text NOT NULL DEFAULT 'under_review', category text);
CREATE TABLE public.fee_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid, student_name text NOT NULL, class_grade text, section text, amount_due numeric NOT NULL DEFAULT 0, amount_paid numeric NOT NULL DEFAULT 0,
  due_date date, status text NOT NULL DEFAULT 'pending', created_by uuid REFERENCES auth.users(id), created_at timestamptz DEFAULT now(),
  course_amount numeric NOT NULL DEFAULT 0, transport_amount numeric NOT NULL DEFAULT 0, other_amount numeric NOT NULL DEFAULT 0,
  uniform_amount numeric NOT NULL DEFAULT 0, material_amount numeric NOT NULL DEFAULT 0, exam_amount numeric NOT NULL DEFAULT 0,
  razorpay_payment_id text);
CREATE TABLE public.instalment_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fee_payment_id uuid, status text DEFAULT 'active');
CREATE TABLE public.instalment_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fee_payment_id uuid, status text DEFAULT 'pending');
CREATE TABLE public.governance_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, event_type text NOT NULL,
  title text NOT NULL, message text NOT NULL, reference_id uuid, reference_type text, channel text DEFAULT 'in_app', is_read boolean DEFAULT false);

-- stand-ins for the instalment migration's helpers (same names/signatures the fee-plan migration calls)
CREATE FUNCTION public.is_fee_staff(p_school uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT p_school IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.school_id = p_school AND (p.role IN ('admin','school_admin') OR p.erp_access)) $$;
CREATE FUNCTION public.is_parent_of_student(p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.students s ON s.profile_id = ps.student_id WHERE s.id = p_student AND ps.parent_id = auth.uid()) $$;
CREATE FUNCTION public.instalment_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;
CREATE FUNCTION public.instalment_money(n numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Rs. ' || n::text $$;
CREATE FUNCTION public.instalment_staff_ids(p_school uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.profiles WHERE school_id = p_school AND (role IN ('admin','school_admin') OR erp_access) $$;
CREATE FUNCTION public.instalment_notify(p_users uuid[], p_event text, p_title text, p_msg text, p_ref uuid, p_ref_type text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type) SELECT u, p_event, p_title, p_msg, p_ref, p_ref_type FROM unnest(p_users) u $$;
CREATE FUNCTION public.create_instalment_plan_for_student(p_student uuid, p_fee uuid, p_items jsonb, p_note text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.instalment_plans (fee_payment_id) VALUES (p_fee) RETURNING id $$;
