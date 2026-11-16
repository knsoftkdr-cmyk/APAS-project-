-- Completion certificates: designed templates, bulk issue with conditions, automatic release and public QR verification.
--
-- Security model
--   * Templates: school managers read/write through RLS. A student can read only a template behind a certificate
--     issued to them (the background image is needed to draw their PDF).
--   * Issued certificates: writes only through SECURITY DEFINER functions, so the conditions can't be skipped.
--   * The public gets one function, verify_certificate(), returning only what is printed on the certificate.
--   * An issued certificate keeps its own copy of the text and layout, so editing a template later never changes it.

CREATE TABLE IF NOT EXISTS public.certificate_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  certificate_title  text NOT NULL CHECK (char_length(certificate_title) BETWEEN 1 AND 160),
  design             jsonb NOT NULL,
  background_image   text CHECK (background_image IS NULL OR octet_length(background_image) <= 2097152),
  criteria_type      text NOT NULL DEFAULT 'manual' CHECK (criteria_type IN ('manual', 'course_completion', 'course_score')),
  criteria_course_id uuid,
  min_score          numeric CHECK (min_score IS NULL OR min_score BETWEEN 0 AND 100),
  auto_issue         boolean NOT NULL DEFAULT false,
  is_archived        boolean NOT NULL DEFAULT false,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certificate_course_required CHECK (criteria_type = 'manual' OR criteria_course_id IS NOT NULL),
  CONSTRAINT certificate_score_required CHECK (criteria_type <> 'course_score' OR min_score IS NOT NULL),
  CONSTRAINT certificate_auto_needs_condition CHECK (NOT auto_issue OR criteria_type <> 'manual')
);
CREATE INDEX IF NOT EXISTS idx_certificate_templates_school ON public.certificate_templates (school_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_certificate_templates_auto ON public.certificate_templates (criteria_course_id) WHERE auto_issue AND NOT is_archived;

CREATE TABLE IF NOT EXISTS public.issued_certificates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  template_id       uuid NOT NULL REFERENCES public.certificate_templates(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_name    text NOT NULL,
  certificate_title text NOT NULL,
  school_name       text,
  course_name       text,
  class_label       text,
  design            jsonb NOT NULL,
  verification_code text NOT NULL UNIQUE,
  issued_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_reason    text
);
-- One live certificate per student per template, so a repeated bulk issue can't duplicate. Revoked ones don't count.
CREATE UNIQUE INDEX IF NOT EXISTS uq_issued_certificates_live ON public.issued_certificates (template_id, student_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issued_certificates_student ON public.issued_certificates (student_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_issued_certificates_school ON public.issued_certificates (school_id, issued_at DESC);

ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issued_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read certificate templates" ON public.certificate_templates FOR SELECT TO authenticated
  USING (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']));
CREATE POLICY "Managers add certificate templates" ON public.certificate_templates FOR INSERT TO authenticated
  WITH CHECK (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']));
CREATE POLICY "Managers edit certificate templates" ON public.certificate_templates FOR UPDATE TO authenticated
  USING (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']))
  WITH CHECK (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']));

CREATE POLICY "Students read their certificates" ON public.issued_certificates FOR SELECT TO authenticated
  USING (student_id = auth.uid());
CREATE POLICY "Managers read issued certificates" ON public.issued_certificates FOR SELECT TO authenticated
  USING (public.is_school_manager(school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']));

-- Created after issued_certificates, which it reads.
CREATE POLICY "Students read their certificate templates" ON public.certificate_templates FOR SELECT TO authenticated
  USING (id IN (SELECT c.template_id FROM public.issued_certificates c WHERE c.student_id = auth.uid()));

-- Why a student can't get this certificate yet, or NULL when they can.
CREATE OR REPLACE FUNCTION public.certificate_block_reason(t public.certificate_templates, p_student uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_score numeric;
BEGIN
  IF t.criteria_type = 'manual' THEN RETURN NULL; END IF;
  SELECT status::text, score INTO v_status, v_score FROM public.student_course_progress
  WHERE student_id = p_student AND course_id = t.criteria_course_id;
  IF NOT FOUND THEN RETURN 'Not enrolled in the course'; END IF;
  IF v_status <> 'completed' THEN RETURN 'Course not completed'; END IF;
  IF t.criteria_type = 'course_score' THEN
    IF v_score IS NULL THEN RETURN 'No course score yet'; END IF;
    IF v_score < t.min_score THEN RETURN 'Scored ' || round(v_score, 1) || ', needs ' || round(t.min_score, 1); END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Issues one certificate. Returns 'issued', 'already_issued' or the reason it was blocked. Internal only.
CREATE OR REPLACE FUNCTION public.issue_one_certificate(t public.certificate_templates, p_student uuid, p_issuer uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.profiles%ROWTYPE;
  v_reason text;
  v_course text;
  v_school text;
  v_id uuid;
BEGIN
  SELECT * INTO s FROM public.profiles WHERE id = p_student;
  IF s.id IS NULL OR s.role <> 'student' OR s.school_id IS DISTINCT FROM t.school_id THEN RETURN 'Not a student of this school'; END IF;
  v_reason := public.certificate_block_reason(t, p_student);
  IF v_reason IS NOT NULL THEN RETURN v_reason; END IF;

  IF t.criteria_course_id IS NOT NULL THEN SELECT title INTO v_course FROM public.courses WHERE id = t.criteria_course_id; END IF;
  SELECT name INTO v_school FROM public.schools WHERE id = t.school_id;

  INSERT INTO public.issued_certificates (school_id, template_id, student_id, recipient_name, certificate_title, school_name, course_name, class_label, design, verification_code, issued_by)
  VALUES (t.school_id, t.id, p_student, COALESCE(s.full_name, 'Student'), t.certificate_title, v_school, v_course,
          NULLIF(btrim(COALESCE(s.class_grade, '') || ' ' || COALESCE(s.section, '')), ''), t.design,
          upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)), p_issuer)
  ON CONFLICT (template_id, student_id) WHERE revoked_at IS NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN 'already_issued'; END IF;

  INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
  VALUES (p_student, 'certificate_issued', 'You earned a certificate', t.certificate_title || ' is ready to download.', v_id, 'certificate');
  RETURN 'issued';
END;
$$;
REVOKE ALL ON FUNCTION public.issue_one_certificate(public.certificate_templates, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.certificate_block_reason(public.certificate_templates, uuid) FROM PUBLIC, anon, authenticated;

-- Everyone a manager could issue this template to, with whether each one qualifies right now.
CREATE OR REPLACE FUNCTION public.certificate_candidates(p_template uuid)
RETURNS TABLE (student_id uuid, full_name text, class_label text, block_reason text, already_issued boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.certificate_templates%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.certificate_templates ct WHERE ct.id = p_template;
  IF t.id IS NULL OR NOT public.is_school_manager(t.school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']) THEN
    RAISE EXCEPTION 'Template not found.';
  END IF;
  RETURN QUERY
  SELECT p.id, COALESCE(p.full_name, 'Student')::text,
         NULLIF(btrim(COALESCE(p.class_grade, '') || ' ' || COALESCE(p.section, '')), '')::text,
         public.certificate_block_reason(t, p.id),
         EXISTS (SELECT 1 FROM public.issued_certificates c WHERE c.template_id = t.id AND c.student_id = p.id AND c.revoked_at IS NULL)
  FROM public.profiles p
  WHERE p.school_id = t.school_id AND p.role = 'student'
  ORDER BY p.class_grade NULLS LAST, p.section NULLS LAST, p.full_name;
END;
$$;

-- Bulk issue. One student's problem never stops the rest: every student gets their own result.
CREATE OR REPLACE FUNCTION public.issue_certificates(p_template uuid, p_students uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.certificate_templates%ROWTYPE;
  v_student uuid;
  v_result text;
  v_issued int := 0;
  v_already int := 0;
  v_blocked jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO t FROM public.certificate_templates WHERE id = p_template;
  IF t.id IS NULL OR NOT public.is_school_manager(t.school_id, ARRAY['admin', 'principal', 'hod', 'school_admin']) THEN
    RAISE EXCEPTION 'Template not found.';
  END IF;
  IF t.is_archived THEN RAISE EXCEPTION 'This template is archived.'; END IF;
  IF COALESCE(array_length(p_students, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one student.'; END IF;
  IF array_length(p_students, 1) > 2000 THEN RAISE EXCEPTION 'Please issue at most 2000 certificates at a time.'; END IF;

  FOREACH v_student IN ARRAY p_students LOOP
    v_result := public.issue_one_certificate(t, v_student, auth.uid());
    IF v_result = 'issued' THEN v_issued := v_issued + 1;
    ELSIF v_result = 'already_issued' THEN v_already := v_already + 1;
    ELSE v_blocked := v_blocked || jsonb_build_object('student_id', v_student, 'reason', v_result);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('issued', v_issued, 'already_issued', v_already, 'blocked', v_blocked);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_certificate(p_certificate uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM public.issued_certificates WHERE id = p_certificate;
  IF v_school IS NULL OR NOT public.is_school_manager(v_school, ARRAY['admin', 'principal', 'hod', 'school_admin']) THEN
    RAISE EXCEPTION 'Certificate not found.';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Please give a reason.'; END IF;
  UPDATE public.issued_certificates SET revoked_at = now(), revoked_reason = left(btrim(p_reason), 500)
  WHERE id = p_certificate AND revoked_at IS NULL;
END;
$$;

-- Public check behind the QR code. Returns only what is printed on the certificate, plus whether it's still valid.
CREATE OR REPLACE FUNCTION public.verify_certificate(p_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'recipient_name', c.recipient_name, 'certificate_title', c.certificate_title, 'school_name', c.school_name,
    'course_name', c.course_name, 'issued_at', c.issued_at, 'is_valid', c.revoked_at IS NULL, 'revoked_at', c.revoked_at
  )
  FROM public.issued_certificates c WHERE c.verification_code = upper(btrim(p_code));
$$;

REVOKE ALL ON FUNCTION public.certificate_candidates(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_certificates(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_certificate(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.certificate_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_certificates(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_certificate(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;

-- Automatic release: when a student completes a course, issue every "auto" template that now applies.
-- A certificate problem must never stop a student's course progress from saving, hence the exception block.
CREATE OR REPLACE FUNCTION public.auto_issue_course_certificates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.certificate_templates%ROWTYPE;
BEGIN
  IF NEW.status::text <> 'completed' THEN RETURN NEW; END IF;
  FOR t IN SELECT * FROM public.certificate_templates
           WHERE auto_issue AND NOT is_archived AND criteria_course_id = NEW.course_id LOOP
    BEGIN
      PERFORM public.issue_one_certificate(t, NEW.student_id, NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'auto certificate failed for template %, student %: %', t.id, NEW.student_id, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_issue_course_certificates() FROM PUBLIC, anon, authenticated;

-- student_course_progress was created outside these migration files, so only attach when it's present.
DO $$
BEGIN
  IF to_regclass('public.student_course_progress') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_auto_issue_course_certificates ON public.student_course_progress;
    CREATE TRIGGER trg_auto_issue_course_certificates
      AFTER INSERT OR UPDATE OF status, score ON public.student_course_progress
      FOR EACH ROW EXECUTE FUNCTION public.auto_issue_course_certificates();
  END IF;
END;
$$;
