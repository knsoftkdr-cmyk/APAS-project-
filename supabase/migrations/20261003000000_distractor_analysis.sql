-- ============================================================================
-- DISTRACTOR ANALYSIS (Feature 21)
--
--   question_option_stats   latest per-option (A/B/C/D) functioning snapshot
--                            for every calibrated MCQ item.
--
-- Rides on the exact same evidence calibrate-irt already gathers to run
-- detectMiskey() (which option each student picked, and their ability at
-- that time) - it's the difference between collapsing that evidence into one
-- item-level "mis-keyed? yes/no" boolean and reporting it per option instead.
-- So this is populated by runCalibration.ts (calibrate-irt / calibrate-irt-cron)
-- as a side effect of the calibration run it already does nightly, not a
-- separate scan.
--
-- Latest-snapshot semantics (upsert per item+option each run), same
-- reasoning as calibrate-irt overwriting irt_a/b directly rather than
-- keeping a row per historical estimate - irt_calibration_runs is already
-- the audit trail for when/why a run happened.
-- ============================================================================

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS distractor_flag text CHECK (distractor_flag IN ('ok','has_non_functioning','has_overperforming','insufficient_data')),
  ADD COLUMN IF NOT EXISTS distractor_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_qbank_distractor_flag ON public.question_bank(distractor_flag);

CREATE TABLE IF NOT EXISTS public.question_option_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  option_label text NOT NULL CHECK (option_label IN ('A','B','C','D')),
  is_correct_option boolean NOT NULL,

  n_selected int NOT NULL DEFAULT 0,
  selection_rate numeric NOT NULL DEFAULT 0 CHECK (selection_rate BETWEEN 0 AND 1),
  mean_theta numeric, -- average ability (θ) of students who chose this option; null if nobody has

  -- Denormalized from distractor_misconceptions on question_bank, so a report
  -- can show "this distractor tied to misconception X is/isn't pulling
  -- students" without a second lookup.
  misconception_id bigint REFERENCES public.concept_misconceptions(id) ON DELETE SET NULL,

  status text NOT NULL CHECK (status IN ('functioning','non_functioning','overperforming','insufficient_data','correct_option')),
  note text,

  last_analyzed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (item_id, option_label)
);

CREATE INDEX IF NOT EXISTS idx_qos_item ON public.question_option_stats(item_id);
CREATE INDEX IF NOT EXISTS idx_qos_status ON public.question_option_stats(status);

ALTER TABLE public.question_option_stats ENABLE ROW LEVEL SECURITY;

-- Same shape as "Staff manage question bank" - this is diagnostic detail
-- about the item bank, not something students have any reason to see.
DROP POLICY IF EXISTS "Staff manage question option stats" ON public.question_option_stats;
CREATE POLICY "Staff manage question option stats" ON public.question_option_stats FOR ALL
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));
