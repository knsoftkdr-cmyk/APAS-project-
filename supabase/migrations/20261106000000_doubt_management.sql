-- Doubt management: every student doubt is a ticket that moves New -> In Progress -> Resolved.
--
-- Security model
--   * Reads go through RLS: a student sees their own doubts, a teacher the doubts assigned to them, and school
--     managers (admin / principal / hod / school_admin) every doubt in their school.
--   * All writes go through the SECURITY DEFINER functions below (there are deliberately no write policies), so
--     school_id, names and timestamps are always set by the server and a status can't be forged by the client.
--   * Names are copied onto the row because a student's RLS may not allow reading a teacher's profile (and vice versa).

CREATE OR REPLACE FUNCTION public.is_school_manager(p_school uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.role = ANY (p_roles)
       AND (p.school_id = p_school
            OR EXISTS (SELECT 1 FROM public.school_admin_schools s WHERE s.school_admin_id = p.id AND s.school_id = p_school))
    FROM public.profiles p WHERE p.id = auth.uid()
  ), false);
$$;
REVOKE ALL ON FUNCTION public.is_school_manager(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_school_manager(uuid, text[]) TO authenticated;

CREATE TABLE IF NOT EXISTS public.doubts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name      text NOT NULL,
  teacher_name      text NOT NULL,
  class_label       text,
  subject           text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
  question          text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 4000),
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_tutor')),
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  first_response_at timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doubts_teacher ON public.doubts (teacher_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doubts_student ON public.doubts (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doubts_school ON public.doubts (school_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.doubt_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doubt_id    uuid NOT NULL REFERENCES public.doubts(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  is_student  boolean NOT NULL,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doubt_replies_doubt ON public.doubt_replies (doubt_id, created_at);

ALTER TABLE public.doubts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doubt_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Doubts are visible to their student, teacher and school managers" ON public.doubts
  FOR SELECT TO authenticated USING (
    student_id = auth.uid() OR teacher_id = auth.uid()
    OR public.is_school_manager(school_id, ARRAY['admin', 'principal', 'hod', 'school_admin'])
  );

-- The sub-select is itself filtered by the policy above, so replies are visible exactly when the doubt is.
CREATE POLICY "Doubt replies follow their doubt" ON public.doubt_replies
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.doubts d WHERE d.id = doubt_id));

CREATE OR REPLACE FUNCTION public.ask_doubt(p_teacher uuid, p_subject text, p_question text, p_source text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me public.profiles%ROWTYPE;
  v_teacher_name text;
  v_id uuid;
BEGIN
  SELECT * INTO me FROM public.profiles WHERE id = auth.uid();
  IF me.id IS NULL OR me.role <> 'student' THEN RAISE EXCEPTION 'Only students can ask doubts.'; END IF;
  IF me.school_id IS NULL THEN RAISE EXCEPTION 'Your profile has no school.'; END IF;
  IF COALESCE(btrim(p_question), '') = '' THEN RAISE EXCEPTION 'Please type your doubt.'; END IF;
  IF COALESCE(btrim(p_subject), '') = '' THEN RAISE EXCEPTION 'Please choose a subject.'; END IF;

  SELECT full_name INTO v_teacher_name FROM public.profiles
  WHERE id = p_teacher AND school_id = me.school_id AND role IN ('teacher', 'hod', 'principal', 'admin', 'school_admin');
  IF NOT FOUND THEN RAISE EXCEPTION 'That teacher is not at your school.'; END IF;

  INSERT INTO public.doubts (school_id, student_id, teacher_id, student_name, teacher_name, class_label, subject, question, source)
  VALUES (me.school_id, me.id, p_teacher, COALESCE(me.full_name, 'Student'), COALESCE(v_teacher_name, 'Teacher'),
          NULLIF(btrim(COALESCE(me.class_grade, '') || ' ' || COALESCE(me.section, '')), ''),
          btrim(p_subject), btrim(p_question), CASE WHEN p_source = 'ai_tutor' THEN 'ai_tutor' ELSE 'manual' END)
  RETURNING id INTO v_id;

  INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
  VALUES (p_teacher, 'doubt_new', 'New student doubt',
          COALESCE(me.full_name, 'A student') || ' asked a doubt in ' || btrim(p_subject), v_id, 'doubt');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reply_doubt(p_doubt uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.doubts%ROWTYPE;
  v_name text;
  v_is_student boolean;
  v_id uuid;
BEGIN
  SELECT * INTO d FROM public.doubts WHERE id = p_doubt FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Doubt not found.'; END IF;
  v_is_student := d.student_id = auth.uid();
  IF NOT (v_is_student OR d.teacher_id = auth.uid()
          OR public.is_school_manager(d.school_id, ARRAY['admin', 'principal', 'hod', 'school_admin'])) THEN
    RAISE EXCEPTION 'You cannot reply to this doubt.';
  END IF;
  IF COALESCE(btrim(p_body), '') = '' THEN RAISE EXCEPTION 'Please type a reply.'; END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.doubt_replies (doubt_id, author_id, author_name, is_student, body)
  VALUES (p_doubt, auth.uid(), COALESCE(v_name, CASE WHEN v_is_student THEN 'Student' ELSE 'Teacher' END), v_is_student, btrim(p_body))
  RETURNING id INTO v_id;

  IF v_is_student THEN
    -- A student replying to a resolved doubt means it isn't resolved after all.
    UPDATE public.doubts SET updated_at = now(),
      status = CASE WHEN status = 'resolved' THEN 'in_progress' ELSE status END,
      resolved_at = NULL
    WHERE id = p_doubt;
    INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (d.teacher_id, 'doubt_reply', 'Reply on a doubt', d.student_name || ' replied on a doubt in ' || d.subject, p_doubt, 'doubt');
  ELSE
    UPDATE public.doubts SET updated_at = now(),
      status = CASE WHEN status = 'new' THEN 'in_progress' ELSE status END,
      first_response_at = COALESCE(first_response_at, now())
    WHERE id = p_doubt;
    INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (d.student_id, 'doubt_reply', 'Your doubt has a reply', COALESCE(v_name, 'Your teacher') || ' replied on your ' || d.subject || ' doubt', p_doubt, 'doubt');
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_doubt_status(p_doubt uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.doubts%ROWTYPE;
  v_is_student boolean;
BEGIN
  IF p_status NOT IN ('new', 'in_progress', 'resolved') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
  SELECT * INTO d FROM public.doubts WHERE id = p_doubt FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Doubt not found.'; END IF;
  v_is_student := d.student_id = auth.uid();
  IF NOT (v_is_student OR d.teacher_id = auth.uid()
          OR public.is_school_manager(d.school_id, ARRAY['admin', 'principal', 'hod', 'school_admin'])) THEN
    RAISE EXCEPTION 'You cannot change this doubt.';
  END IF;
  -- Students may close their own doubt or reopen it, but can't send it back to "new".
  IF v_is_student AND p_status = 'new' THEN RAISE EXCEPTION 'You cannot change this doubt to that status.'; END IF;

  UPDATE public.doubts SET status = p_status, updated_at = now(),
    resolved_at = CASE WHEN p_status = 'resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END
  WHERE id = p_doubt;

  IF p_status = 'resolved' AND d.status <> 'resolved' AND NOT v_is_student THEN
    INSERT INTO public.governance_notifications (user_id, event_type, title, message, reference_id, reference_type)
    VALUES (d.student_id, 'doubt_resolved', 'Your doubt was resolved', 'Your ' || d.subject || ' doubt was marked resolved. Reply if you still need help.', p_doubt, 'doubt');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ask_doubt(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reply_doubt(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_doubt_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ask_doubt(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reply_doubt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_doubt_status(uuid, text) TO authenticated;
