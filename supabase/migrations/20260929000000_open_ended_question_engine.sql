-- ============================================================================
-- OPEN-ENDED / HIGHER-ORDER QUESTION ENGINE  (Feature 18, non-MCQ half)
--
--   question_bank_extended     descriptive / case_based / hots / competency /
--                               scenario items, tagged to a learning_objective
--                               and/or a competency, each carrying a rubric.
--   open_response_submissions  a student's answer to one of the above, an AI
--                               first-pass score against the rubric, and the
--                               teacher's final score/edits.
--
-- Deliberately a SEPARATE pool from question_bank / cat_sessions / IRT:
-- IRT/CAT assumes objectively auto-gradable, single-key items. These items
-- are free-response and need a rubric + human judgement, so they are surfaced
-- to homework / worksheets / teacher-assigned tests instead of the adaptive
-- test engine. They still reuse the same curriculum context (learning
-- objectives, subtopics, misconceptions) so generation quality matches the
-- MCQ item bank, and can additionally hang off a `competencies` row for
-- competency-style items.
--
-- SECURITY MODEL (mirrors question_bank in 20260922090000_irt_cat_engine.sql)
--   * question_bank_extended holds the rubric and model answer. Students get
--     NO policy on it - an edge function (service role) serves students only
--     the stem/context/sub-questions, never the rubric or model answer.
--   * open_response_submissions: students may insert/read their own answers;
--     the AI first-pass score is written by a service-role edge function;
--     staff can read/update everything to finalize a grade.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. OPEN-ENDED ITEM BANK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_bank_extended (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  learning_objective_id bigint REFERENCES public.learning_objectives(id) ON DELETE CASCADE,
  competency_id uuid REFERENCES public.competencies(id) ON DELETE CASCADE,
  -- Denormalized from learning_objective_id (trigger), same pattern as question_bank.
  subtopic_id bigint REFERENCES public.subtopics(id) ON DELETE CASCADE,

  question_type text NOT NULL CHECK (question_type IN ('descriptive','case_based','hots','competency','scenario')),

  stem text NOT NULL CHECK (length(btrim(stem)) > 0),
  -- Shared reading passage / real-world setup for case_based & scenario items. Null for descriptive/hots/competency.
  context_passage text,
  -- For case_based items with multiple parts: [{"id":"a","text":"...","max_marks":2}, ...].
  -- Empty array for single-part items (descriptive/hots/competency/scenario with one ask).
  sub_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sub_questions) = 'array'),
  -- Scoring criteria the grader (AI or teacher) checks off:
  -- [{"criterion":"...", "description":"...", "max_marks":2}, ...]. Keyed by sub_question id
  -- for multi-part items via an optional "sub_question_id" field on each entry.
  rubric jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rubric) = 'array'),
  -- Ideal / model answer used as the AI grader's reference - never shown to students.
  model_answer text,
  max_marks numeric NOT NULL DEFAULT 5 CHECK (max_marks > 0),

  bloom_level text CHECK (bloom_level IN ('remember','understand','apply','analyze','evaluate','create')),
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),

  -- draft   = AI-authored, awaiting teacher review (never served to students)
  -- active  = approved, eligible for homework/worksheets/tests
  -- retired = withdrawn (kept for submission history)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),

  ai_generated boolean NOT NULL DEFAULT true,
  generation_model text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (learning_objective_id IS NOT NULL OR competency_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_qbx_lo ON public.question_bank_extended(learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_qbx_competency ON public.question_bank_extended(competency_id);
CREATE INDEX IF NOT EXISTS idx_qbx_subtopic_status ON public.question_bank_extended(subtopic_id, status);
CREATE INDEX IF NOT EXISTS idx_qbx_type_status ON public.question_bank_extended(question_type, status);

-- Same stem under the same objective/competency is a duplicate; lets the generator top-up safely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbx_lo_stem ON public.question_bank_extended(learning_objective_id, md5(stem))
  WHERE learning_objective_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbx_competency_stem ON public.question_bank_extended(competency_id, md5(stem))
  WHERE competency_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.qbx_sync_subtopic()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.learning_objective_id IS NOT NULL THEN
    SELECT subtopic_id INTO NEW.subtopic_id
    FROM public.learning_objectives WHERE id = NEW.learning_objective_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qbx_sync_subtopic ON public.question_bank_extended;
CREATE TRIGGER trg_qbx_sync_subtopic
BEFORE INSERT OR UPDATE OF learning_objective_id ON public.question_bank_extended
FOR EACH ROW EXECUTE FUNCTION public.qbx_sync_subtopic();

-- ---------------------------------------------------------------------------
-- 2. STUDENT SUBMISSIONS + AI-ASSISTED GRADING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.open_response_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.question_bank_extended(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- What this answer was attached to, e.g. 'homework' + homework id, 'practice', 'test'.
  -- Left free-form so it can be wired into whichever assignment surface calls it.
  source text NOT NULL DEFAULT 'practice' CHECK (source IN ('homework','practice','test','worksheet')),
  source_id uuid,

  answer_text text NOT NULL CHECK (length(btrim(answer_text)) > 0),

  -- AI first-pass grading (written by grade-open-response edge function).
  ai_suggested_score numeric,
  ai_rubric_scores jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{"criterion":"...","max_marks":2,"awarded":1.5,"met":false,"reasoning":"..."}]
  ai_feedback text,
  ai_model text,
  ai_graded_at timestamptz,

  -- Teacher's final word. Starts null; once set this is the score of record.
  teacher_score numeric,
  teacher_feedback text,

  status text NOT NULL DEFAULT 'pending_ai' CHECK (status IN ('pending_ai','ai_graded','teacher_reviewed','flagged')),
  graded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  graded_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ors_item ON public.open_response_submissions(item_id);
CREATE INDEX IF NOT EXISTS idx_ors_student ON public.open_response_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_ors_status ON public.open_response_submissions(status);
CREATE INDEX IF NOT EXISTS idx_ors_source ON public.open_response_submissions(source, source_id);

CREATE OR REPLACE FUNCTION public.ors_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ors_touch ON public.open_response_submissions;
CREATE TRIGGER trg_ors_touch
BEFORE UPDATE ON public.open_response_submissions
FOR EACH ROW EXECUTE FUNCTION public.ors_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.question_bank_extended ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_response_submissions ENABLE ROW LEVEL SECURITY;

-- Item bank: staff only, same shape as "Staff manage question bank". Deliberately
-- NO student policy - it holds the rubric and model answer. Students see items
-- only through an edge function that strips those fields.
DROP POLICY IF EXISTS "Staff manage open-ended item bank" ON public.question_bank_extended;
CREATE POLICY "Staff manage open-ended item bank" ON public.question_bank_extended FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));

-- Submissions: students manage their own answer text and can read the grade once it lands;
-- they can never write the AI/teacher scoring columns directly (only an edge function /
-- staff can - enforced by only exposing those columns through service-role calls).
DROP POLICY IF EXISTS "Students insert own open responses" ON public.open_response_submissions;
CREATE POLICY "Students insert own open responses" ON public.open_response_submissions FOR INSERT
  WITH CHECK (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

DROP POLICY IF EXISTS "Students read own open responses" ON public.open_response_submissions;
CREATE POLICY "Students read own open responses" ON public.open_response_submissions FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

DROP POLICY IF EXISTS "Staff manage open responses" ON public.open_response_submissions;
CREATE POLICY "Staff manage open responses" ON public.open_response_submissions FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));
