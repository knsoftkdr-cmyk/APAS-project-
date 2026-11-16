-- Public admission enquiry form: a parent fills a web form (no login) and the enquiry appears in the Admissions page.
--
-- Security model
--   * anon can't touch the table. It can only call two SECURITY DEFINER functions: one returns the school's public
--     name and open grades, the other validates and files one enquiry. Neither ever returns enquiry data.
--   * Staff access is RLS: admin / principal / school_admin of that school (same roles as the /admissions route).
--   * Abuse limits: hidden honeypot field, same family within 24h is not filed twice, per-school cap per hour.

CREATE TABLE IF NOT EXISTS public.admission_enquiries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_name           text NOT NULL CHECK (char_length(student_name) BETWEEN 2 AND 120),
  parent_name            text NOT NULL CHECK (char_length(parent_name) BETWEEN 2 AND 120),
  parent_phone           text NOT NULL CHECK (char_length(parent_phone) BETWEEN 7 AND 20),
  parent_email           text CHECK (parent_email IS NULL OR char_length(parent_email) <= 200),
  grade_interested       text CHECK (grade_interested IS NULL OR char_length(grade_interested) <= 60),
  message                text CHECK (message IS NULL OR char_length(message) <= 1000),
  source_channel         text NOT NULL DEFAULT 'web_form' CHECK (char_length(source_channel) <= 60),
  status                 text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  staff_notes            text,
  converted_applicant_id uuid,
  handled_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admission_enquiries_school ON public.admission_enquiries (school_id, status, created_at DESC);

ALTER TABLE public.admission_enquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admission staff read enquiries" ON public.admission_enquiries
  FOR SELECT TO authenticated USING (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'school_admin']));
CREATE POLICY "Admission staff update enquiries" ON public.admission_enquiries
  FOR UPDATE TO authenticated
  USING (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'school_admin']))
  WITH CHECK (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'school_admin']));

CREATE OR REPLACE FUNCTION public.get_enquiry_form(p_school uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'school_name', s.name,
    'grades', COALESCE((SELECT jsonb_agg(DISTINCT i.grade) FROM public.admission_intakes i WHERE i.school_id = s.id AND i.is_open), '[]'::jsonb)
  )
  FROM public.schools s WHERE s.id = p_school;
$$;

CREATE OR REPLACE FUNCTION public.submit_admission_enquiry(
  p_school uuid, p_student_name text, p_parent_name text, p_parent_phone text,
  p_parent_email text DEFAULT NULL, p_grade text DEFAULT NULL, p_message text DEFAULT NULL,
  p_source text DEFAULT NULL, p_website text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_parent_phone, ''), '[^0-9+]', '', 'g');
  v_student text := btrim(COALESCE(p_student_name, ''));
  v_parent text := btrim(COALESCE(p_parent_name, ''));
  v_email text := NULLIF(btrim(COALESCE(p_parent_email, '')), '');
  v_grade text := NULLIF(left(btrim(COALESCE(p_grade, '')), 60), '');
  v_source text := COALESCE(NULLIF(left(regexp_replace(COALESCE(p_source, ''), '[^a-zA-Z0-9_ -]', '', 'g'), 60), ''), 'web_form');
  v_id uuid;
BEGIN
  -- Bots fill every field, people never see this one. Report success so the bot learns nothing.
  IF COALESCE(p_website, '') <> '' THEN RETURN true; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school) THEN RAISE EXCEPTION 'This enquiry link is not valid.'; END IF;
  IF char_length(v_student) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Please enter the student''s name.'; END IF;
  IF char_length(v_parent) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Please enter the parent''s name.'; END IF;
  IF v_phone !~ '^\+?[0-9]{7,15}$' THEN RAISE EXCEPTION 'Please enter a valid phone number.'; END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN RAISE EXCEPTION 'Please enter a valid email address.'; END IF;
  IF char_length(COALESCE(p_message, '')) > 1000 THEN RAISE EXCEPTION 'Your message is too long.'; END IF;

  IF (SELECT count(*) FROM public.admission_enquiries WHERE school_id = p_school AND created_at > now() - interval '1 hour') >= 200 THEN
    RAISE EXCEPTION 'Too many enquiries right now. Please try again later.';
  END IF;

  -- Double-click or a second visit: the family is already on the list.
  IF EXISTS (SELECT 1 FROM public.admission_enquiries WHERE school_id = p_school AND parent_phone = v_phone
             AND lower(student_name) = lower(v_student) AND created_at > now() - interval '24 hours') THEN
    RETURN true;
  END IF;

  INSERT INTO public.admission_enquiries (school_id, student_name, parent_name, parent_phone, parent_email, grade_interested, message, source_channel)
  VALUES (p_school, v_student, v_parent, v_phone, v_email, v_grade, NULLIF(btrim(COALESCE(p_message, '')), ''), v_source)
  RETURNING id INTO v_id;

  INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
  SELECT r.id, 'admission_enquiry', 'New admission enquiry',
         v_parent || ' enquired about ' || v_student || COALESCE(' for ' || v_grade, ''),
         v_id, 'admission_enquiry'
  FROM public.school_admin_recipients(p_school) r;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_enquiry_form(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_admission_enquiry(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_enquiry_form(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_admission_enquiry(uuid, text, text, text, text, text, text, text, text) TO anon, authenticated;
