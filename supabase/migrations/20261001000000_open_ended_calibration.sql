-- ============================================================================
-- AUTOMATIC OPEN-ENDED QUESTION CALIBRATION (Feature 20, open-ended half)
--
-- MCQ calibration already exists (calibrate-irt / calibrate-irt-cron): real
-- CAT responses re-estimate IRT a/b/c for question_bank every night. That
-- estimator assumes a single objectively-correct key, which open-ended items
-- (question_bank_extended) don't have - they're rubric-scored with partial
-- credit. This is the same idea adapted to that shape: once enough graded
-- open_response_submissions exist for an item, its empirical difficulty
-- (how well students actually score against the rubric) is computed and the
-- item's declared "difficulty" is corrected to match reality - the same
-- prior -> real-estimate promotion calibrate-irt does for irt_b, just for a
-- coarse easy/medium/hard label instead of a continuous parameter.
--
--   open_ended_calibration_runs   audit trail, one row per scope per run -
--                                  same purpose as irt_calibration_runs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Calibration columns on question_bank_extended
-- ---------------------------------------------------------------------------
ALTER TABLE public.question_bank_extended
  -- What students actually score, independent of what the item claims:
  ADD COLUMN IF NOT EXISTS empirical_difficulty text CHECK (empirical_difficulty IN ('easy','medium','hard')),
  ADD COLUMN IF NOT EXISTS empirical_avg_score_pct numeric CHECK (empirical_avg_score_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS n_graded_responses int NOT NULL DEFAULT 0,
  -- prior      = never calibrated (or too few responses yet) - "difficulty" is still just the author's declared guess
  -- calibrated = "difficulty" has been set/confirmed from real response statistics at least once
  ADD COLUMN IF NOT EXISTS calibration_status text NOT NULL DEFAULT 'prior' CHECK (calibration_status IN ('prior','calibrated')),
  ADD COLUMN IF NOT EXISTS calibration_flag text CHECK (calibration_flag IN ('ok','adjusted_easier','adjusted_harder','low_sample')),
  ADD COLUMN IF NOT EXISTS last_calibrated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_qbx_calibration_status ON public.question_bank_extended(calibration_status);
CREATE INDEX IF NOT EXISTS idx_qbx_calibration_flag ON public.question_bank_extended(calibration_flag);

-- ---------------------------------------------------------------------------
-- 2. Audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.open_ended_calibration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('subtopic','topic','competency','all')),
  scope_id text, -- subtopic/topic id or competency uuid, stored as text since it's one of two id types; null for 'all'
  items_scanned int NOT NULL DEFAULT 0,
  items_calibrated int NOT NULL DEFAULT 0,  -- moved prior -> calibrated, or re-confirmed, this run
  items_adjusted int NOT NULL DEFAULT 0,    -- of those, how many actually had their difficulty label changed
  items_low_sample int NOT NULL DEFAULT 0,  -- had some graded responses but not enough to calibrate yet
  run_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, -- null = scheduled/cron run
  details jsonb NOT NULL DEFAULT '[]'::jsonb, -- per-item breakdown: [{"item_id":...,"before":"medium","after":"easy","n":12,"avg_pct":88}]
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oecr_created ON public.open_ended_calibration_runs(created_at DESC);

ALTER TABLE public.open_ended_calibration_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read open-ended calibration runs" ON public.open_ended_calibration_runs;
CREATE POLICY "Staff read open-ended calibration runs" ON public.open_ended_calibration_runs FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));
