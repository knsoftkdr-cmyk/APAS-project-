-- ============================================================================
-- DAILY REVIEW - NEGATIVE MARKING
--
--   daily_review_settings   one row per school: the marking rules (OFF by default)
--   daily_review_marks      append-only marks ledger, one row per scheduled Daily Review question
--
-- Scope: Daily Review ONLY. Nothing here is read by assessments, quizzes, tests, exams, adaptive
-- tests or mock exams, and no existing table / function / trigger is altered.
--
-- HOW IT STAYS OUT OF THE SPACED-REPETITION ENGINE
--   Marks are a scoring OVERLAY. A Daily Review answer is still graded as correct / incorrect and
--   still goes through record_mastery_evidence() unchanged, so BKT mastery, the SM-2 trigger
--   (schedule_next_review), review_schedule and mastery_evidence_log behave exactly as before.
--   The marks only decide the score the student sees for the session.
--
-- RULES (per school, configurable by an authorised admin)
--   correct   -> + marks_per_correct
--   incorrect -> - negative_marks_per_wrong   (0 <= penalty <= marks_per_correct)
--   skipped / not answered -> 0
--
-- ANTI-FARMING
--   A question can earn / lose marks once per scheduled review: UNIQUE (student_id, schedule_id, due_at).
--   After an answer the SM-2 trigger moves due_at forward, so re-submitting a different option for the
--   same question can never turn a -penalty into a +mark.
--
-- SECURITY (same model as review_schedule / flashcards)
--   RLS is read-only for clients; every write is made by the cat-session edge function (service role)
--   after it has resolved the caller from the verified JWT. Only the principal of that school can change
--   the rules (they apply to the whole school).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.daily_review_settings (
  school_id uuid PRIMARY KEY,
  negative_marking_enabled boolean NOT NULL DEFAULT false,
  marks_per_correct numeric(5,2) NOT NULL DEFAULT 1 CHECK (marks_per_correct > 0 AND marks_per_correct <= 10),
  negative_marks_per_wrong numeric(5,2) NOT NULL DEFAULT 0.25 CHECK (negative_marks_per_wrong >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (negative_marks_per_wrong <= marks_per_correct)
);

CREATE TABLE IF NOT EXISTS public.daily_review_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id uuid,
  session_id text CHECK (session_id IS NULL OR length(session_id) <= 64),
  schedule_id uuid NOT NULL,                         -- review_schedule.id (kept without FK so history survives a schedule reset)
  learning_objective_id bigint NOT NULL,
  item_id uuid,                                      -- NULL for a skipped question that was never answered
  due_at timestamptz NOT NULL,                       -- the scheduled instance this row scores
  outcome text NOT NULL CHECK (outcome IN ('correct','wrong','skipped')),
  selected_option text CHECK (selected_option IS NULL OR selected_option IN ('A','B','C','D')),
  marks_for_correct numeric(5,2) NOT NULL,           -- the rules that applied when it was scored
  penalty numeric(5,2) NOT NULL,
  marks numeric(6,2) NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, schedule_id, due_at),
  CHECK (
    (outcome = 'correct' AND marks = marks_for_correct) OR
    (outcome = 'wrong'   AND marks = -penalty) OR
    (outcome = 'skipped' AND marks = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_dr_marks_student_time ON public.daily_review_marks(student_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_marks_session ON public.daily_review_marks(student_id, session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.daily_review_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_review_marks ENABLE ROW LEVEL SECURITY;

-- Rules are visible to everyone in the same school (students need them to see "+1 / -0.25").
DROP POLICY IF EXISTS "Read own school daily review settings" ON public.daily_review_settings;
CREATE POLICY "Read own school daily review settings" ON public.daily_review_settings FOR SELECT
  USING (school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "Admins read daily review settings" ON public.daily_review_settings;
CREATE POLICY "Admins read daily review settings" ON public.daily_review_settings FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Students read own daily review marks" ON public.daily_review_marks;
CREATE POLICY "Students read own daily review marks" ON public.daily_review_marks FOR SELECT
  USING (student_id IN (SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid()));

DROP POLICY IF EXISTS "Staff read school daily review marks" ON public.daily_review_marks;
CREATE POLICY "Staff read school daily review marks" ON public.daily_review_marks FOR SELECT
  USING (
    public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin')
    AND school_id = (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins read daily review marks" ON public.daily_review_marks;
CREATE POLICY "Admins read daily review marks" ON public.daily_review_marks FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'admin');

-- Clients never write: the edge function (service role) is the only writer.
REVOKE INSERT, UPDATE, DELETE ON public.daily_review_settings, public.daily_review_marks FROM anon, authenticated;
