-- ============================================================================
-- QUESTION QUALITY SCORING (Feature 19)
--
--   question_quality_reviews   one AI quality check of one item - MCQ
--                               (question_bank) or open-ended
--                               (question_bank_extended) - scored on
--                               ambiguity, difficulty match, syllabus
--                               alignment and answer validity.
--
-- Distinct from calibrate-irt's review_flag/review_note on question_bank:
-- that flags items AFTER real students have answered them (statistical -
-- low discrimination, drifted difficulty, suspect key). This is a PRE-USE
-- check an AI reader does by just reading the item - it can run the moment
-- an item is drafted, before a single student ever sees it. Both can end up
-- flagging the same bad item for different reasons; they're kept separate
-- so neither overwrites the other's verdict.
--
-- Additive only - two new nullable columns per existing bank table (for cheap
-- filtering/sorting in a review UI without a join) plus one new detail table
-- that keeps full per-dimension history across re-scores.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Denormalized summary columns for quick filtering
-- ---------------------------------------------------------------------------
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS quality_score numeric CHECK (quality_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS quality_flag text CHECK (quality_flag IN ('pass','minor_issues','needs_revision','reject')),
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz;

ALTER TABLE public.question_bank_extended
  ADD COLUMN IF NOT EXISTS quality_score numeric CHECK (quality_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS quality_flag text CHECK (quality_flag IN ('pass','minor_issues','needs_revision','reject')),
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_qbank_quality_flag ON public.question_bank(quality_flag);
CREATE INDEX IF NOT EXISTS idx_qbx_quality_flag ON public.question_bank_extended(quality_flag);

-- ---------------------------------------------------------------------------
-- 2. Full per-dimension review history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  mcq_item_id uuid REFERENCES public.question_bank(id) ON DELETE CASCADE,
  extended_item_id uuid REFERENCES public.question_bank_extended(id) ON DELETE CASCADE,
  CHECK (num_nonnulls(mcq_item_id, extended_item_id) = 1),

  ambiguity_score numeric NOT NULL CHECK (ambiguity_score BETWEEN 0 AND 10),
  ambiguity_note text,
  difficulty_match_score numeric NOT NULL CHECK (difficulty_match_score BETWEEN 0 AND 10),
  difficulty_match_note text,
  syllabus_alignment_score numeric NOT NULL CHECK (syllabus_alignment_score BETWEEN 0 AND 10),
  syllabus_alignment_note text,
  answer_validity_score numeric NOT NULL CHECK (answer_validity_score BETWEEN 0 AND 10),
  answer_validity_note text,
  -- true = the AI believes the marked correct option / rubric+model-answer is actually
  -- wrong or internally inconsistent. Always forces flag = 'reject' regardless of the
  -- averaged score, and triggers auto-suspend of a live item.
  answer_validity_critical boolean NOT NULL DEFAULT false,

  overall_score numeric NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  flag text NOT NULL CHECK (flag IN ('pass','minor_issues','needs_revision','reject')),
  suggested_fix text,

  model text,
  auto_suspended boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, -- staff member who triggered the check
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qqr_mcq_item ON public.question_quality_reviews(mcq_item_id);
CREATE INDEX IF NOT EXISTS idx_qqr_extended_item ON public.question_quality_reviews(extended_item_id);
CREATE INDEX IF NOT EXISTS idx_qqr_flag ON public.question_quality_reviews(flag);

-- ---------------------------------------------------------------------------
-- 3. RLS - staff only, same shape as the item banks it reviews
-- ---------------------------------------------------------------------------
ALTER TABLE public.question_quality_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage question quality reviews" ON public.question_quality_reviews;
CREATE POLICY "Staff manage question quality reviews" ON public.question_quality_reviews FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));
