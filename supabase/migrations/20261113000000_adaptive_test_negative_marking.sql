-- ============================================================================
-- ADAPTIVE TEST - NEGATIVE MARKING
--
--   adaptive_test_settings   one row per school: the marking rules (OFF by default)
--   cat_session_scoring      the rules a test started under (one row per marked test)
--
-- Same overlay idea as Daily Review's negative marking (20261112000000), with its OWN switch and numbers
-- so a school can mark Daily Review and Adaptive Tests differently.
--
-- WHAT IS (AND ISN'T) AFFECTED
--   * Marks are DERIVED, not stored per answer: item_responses already holds one immutable row per answered
--     question (UNIQUE (session_id, item_id)), so   marks = correct * marks_per_correct - wrong * penalty.
--   * Nothing that drives the adaptive engine is read or written differently: theta / se (EAP estimate),
--     item selection, the stopping rule, student_ability, the scaled score and band, BKT mastery and
--     apply_cat_response() are all untouched. Marks never feed back into them.
--   * Only tests started on the Adaptive Test page (cat_sessions.mode = 'assessment') are marked. Short
--     practice rounds launched from homework / worksheets / the AI tutor are not.
--   * Regular assessments, quizzes, tests, exams and Daily Review are not affected by these rules.
--
-- RULES SNAPSHOT
--   The rules are copied into cat_session_scoring when the test STARTS, so an admin changing them mid-test
--   can't change that test's marks. A test with no snapshot (started before this feature, or while marking
--   was off) simply has no marks.
--
-- SECURITY (same model as daily_review_*)
--   RLS is read-only for clients; the cat-session edge function (service role) is the only writer, after it
--   has resolved the caller from the verified JWT. Only the principal of a school can change that school's
--   rules (they apply to the whole school).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.adaptive_test_settings (
  school_id uuid PRIMARY KEY,
  negative_marking_enabled boolean NOT NULL DEFAULT false,
  marks_per_correct numeric(5,2) NOT NULL DEFAULT 1 CHECK (marks_per_correct > 0 AND marks_per_correct <= 10),
  negative_marks_per_wrong numeric(5,2) NOT NULL DEFAULT 0.25 CHECK (negative_marks_per_wrong >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (negative_marks_per_wrong <= marks_per_correct)
);

CREATE TABLE IF NOT EXISTS public.cat_session_scoring (
  session_id uuid PRIMARY KEY REFERENCES public.cat_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id uuid,
  marks_per_correct numeric(5,2) NOT NULL CHECK (marks_per_correct > 0 AND marks_per_correct <= 10),
  negative_marks_per_wrong numeric(5,2) NOT NULL CHECK (negative_marks_per_wrong >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (negative_marks_per_wrong <= marks_per_correct)
);

CREATE INDEX IF NOT EXISTS idx_cat_session_scoring_student ON public.cat_session_scoring(student_id);

ALTER TABLE public.adaptive_test_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cat_session_scoring ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own school adaptive test settings" ON public.adaptive_test_settings;
CREATE POLICY "Read own school adaptive test settings" ON public.adaptive_test_settings FOR SELECT
  USING (school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "Admins read adaptive test settings" ON public.adaptive_test_settings;
CREATE POLICY "Admins read adaptive test settings" ON public.adaptive_test_settings FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Students read own adaptive test scoring" ON public.cat_session_scoring;
CREATE POLICY "Students read own adaptive test scoring" ON public.cat_session_scoring FOR SELECT
  USING (student_id IN (SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid()));

DROP POLICY IF EXISTS "Staff read school adaptive test scoring" ON public.cat_session_scoring;
CREATE POLICY "Staff read school adaptive test scoring" ON public.cat_session_scoring FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin')
    AND school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins read adaptive test scoring" ON public.cat_session_scoring;
CREATE POLICY "Admins read adaptive test scoring" ON public.cat_session_scoring FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

-- Clients never write: the edge function (service role) is the only writer.
REVOKE INSERT, UPDATE, DELETE ON public.adaptive_test_settings, public.cat_session_scoring FROM anon, authenticated;
