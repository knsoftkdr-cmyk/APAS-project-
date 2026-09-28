-- ============================================================================
-- ASSIGN + TAKE A GENERATED ASSESSMENT PAPER
--
--   generated_assessment_paper_assignments   one row per teacher-triggered
--                                             "give this paper to this class
--                                             (or these students)" action.
--   generated_assessment_paper_attempts      one row per student per
--                                             assignment - their answers,
--                                             scores, and status.
--
-- Answers to MCQ items are scored immediately on submit (the key is known
-- and objective). Answers to open-ended items go through the exact same
-- AI-first-pass-then-teacher-reviews pipeline as feature 18
-- (open_response_submissions, source='test', source_id = the attempt id) -
-- nothing new invented for grading, just pointed at from an exam context.
--
-- An attempt's status auto-advances from "submitted" to "graded" the moment
-- every one of its open-ended submissions reaches "teacher_reviewed" (see the
-- trigger at the bottom) - no separate "finalize this attempt" step for a
-- teacher to remember.
-- ============================================================================

-- Both MCQ and open-ended answers submitted through an assessment paper feed
-- BKT (record_mastery_evidence) like every other engine already does -
-- widen the source vocabulary once, same pattern module 16 used.
ALTER TABLE public.mastery_evidence_log DROP CONSTRAINT IF EXISTS mastery_evidence_log_source_check;
ALTER TABLE public.mastery_evidence_log ADD CONSTRAINT mastery_evidence_log_source_check
  CHECK (source IN ('mcq','homework','worksheet','ai_tutor','diagnostic','manual','spaced_review','learning_path','adaptive_homework','assessment_paper'));

-- ---------------------------------------------------------------------------
-- 1. Assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_assessment_paper_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.generated_assessment_papers(id) ON DELETE CASCADE,
  title text NOT NULL,

  -- Assign to a whole class roster, or to specific students, or both (union of the two).
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  student_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(student_ids) = 'array'),
  CHECK (class_id IS NOT NULL OR jsonb_array_length(student_ids) > 0),

  due_at timestamptz,
  -- Minutes once a student starts; null = no limit. Defaults from the blueprint's
  -- duration_minutes at assignment time but can be overridden per assignment.
  time_limit_minutes int CHECK (time_limit_minutes > 0),

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  student_count int NOT NULL DEFAULT 0,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_assign_paper ON public.generated_assessment_paper_assignments(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_assign_class ON public.generated_assessment_paper_assignments(class_id);

-- ---------------------------------------------------------------------------
-- 2. Attempts (one per student per assignment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_assessment_paper_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.generated_assessment_paper_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- assigned    -> not opened yet
  -- in_progress -> opened, timer (if any) running
  -- submitted   -> answers in, MCQs scored, open-ended items awaiting/under AI+teacher review
  -- graded      -> every open-ended item has a teacher-reviewed score (or there were none)
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','submitted','graded')),

  mcq_answers jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{"item_id":"...","selected_option":"B"}]
  mcq_score numeric,
  mcq_max_marks numeric NOT NULL DEFAULT 0,

  open_ended_ai_score numeric,      -- sum of AI first-pass scores (provisional)
  open_ended_teacher_score numeric, -- sum of teacher-finalized scores (set once all reviewed)
  open_ended_max_marks numeric NOT NULL DEFAULT 0,

  -- Best-known total: teacher score where available, AI score as a provisional
  -- stand-in otherwise. Recomputed on submit and again by the trigger below.
  total_score numeric,
  total_max_marks numeric NOT NULL DEFAULT 0,

  started_at timestamptz,
  submitted_at timestamptz,
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_attempts_assignment ON public.generated_assessment_paper_attempts(assignment_id);
CREATE INDEX IF NOT EXISTS idx_paper_attempts_student ON public.generated_assessment_paper_attempts(student_id, status);

CREATE OR REPLACE FUNCTION public.paper_attempts_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_paper_attempts_touch ON public.generated_assessment_paper_attempts;
CREATE TRIGGER trg_paper_attempts_touch
BEFORE UPDATE ON public.generated_assessment_paper_attempts
FOR EACH ROW EXECUTE FUNCTION public.paper_attempts_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Auto-finalize: once every open-ended submission tied to an attempt has
--    been teacher-reviewed, roll the attempt itself to "graded".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_assessment_attempt_grade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt RECORD;
  v_total int;
  v_reviewed int;
  v_teacher_sum numeric;
BEGIN
  IF NEW.source <> 'test' OR NEW.status <> 'teacher_reviewed' OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt FROM public.generated_assessment_paper_attempts WHERE id = NEW.source_id;
  IF NOT FOUND OR v_attempt.status = 'graded' THEN
    RETURN NEW; -- not one of ours (source_id collision from another 'test' context), or already done
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'teacher_reviewed'), COALESCE(sum(teacher_score), 0)
    INTO v_total, v_reviewed, v_teacher_sum
  FROM public.open_response_submissions
  WHERE source = 'test' AND source_id = NEW.source_id;

  IF v_total > 0 AND v_reviewed = v_total THEN
    UPDATE public.generated_assessment_paper_attempts
    SET open_ended_teacher_score = v_teacher_sum,
        total_score = COALESCE(v_attempt.mcq_score, 0) + v_teacher_sum,
        status = 'graded',
        graded_at = now()
    WHERE id = NEW.source_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_assessment_attempt_grade ON public.open_response_submissions;
CREATE TRIGGER trg_sync_assessment_attempt_grade
AFTER UPDATE OF status ON public.open_response_submissions
FOR EACH ROW EXECUTE FUNCTION public.sync_assessment_attempt_grade();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.generated_assessment_paper_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_assessment_paper_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage paper assignments" ON public.generated_assessment_paper_assignments;
CREATE POLICY "Staff manage paper assignments" ON public.generated_assessment_paper_assignments FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

-- Students can see (but not directly write) assignments targeting their own class or themselves,
-- so a "my assignments" list can query this table straight from the client.
DROP POLICY IF EXISTS "Students read own paper assignments" ON public.generated_assessment_paper_assignments;
CREATE POLICY "Students read own paper assignments" ON public.generated_assessment_paper_assignments FOR SELECT
  USING (
    class_id IN (
      SELECT cs.class_id FROM public.class_students cs
      JOIN public.students s ON s.id = cs.student_id
      WHERE s.profile_id = auth.uid()
    )
    OR student_ids @> to_jsonb(ARRAY[(SELECT id FROM public.students WHERE profile_id = auth.uid())]::uuid[])
  );

DROP POLICY IF EXISTS "Staff manage paper attempts" ON public.generated_assessment_paper_attempts;
CREATE POLICY "Staff manage paper attempts" ON public.generated_assessment_paper_attempts FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

-- Students can read their own attempt (status/score/progress); all writes to
-- this table happen through the edge functions (service role) so the answer
-- key/rubric never has to be exposed to the browser to compute a score.
DROP POLICY IF EXISTS "Students read own paper attempts" ON public.generated_assessment_paper_attempts;
CREATE POLICY "Students read own paper attempts" ON public.generated_assessment_paper_attempts FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));
