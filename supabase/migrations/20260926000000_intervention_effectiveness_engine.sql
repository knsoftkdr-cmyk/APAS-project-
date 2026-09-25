-- ============================================================================
-- INTERVENTION EFFECTIVENESS TRACKING (module 15)
-- "Checks whether an intervention actually improved the student's outcome."
--
-- Additive on top of the existing (untracked, per module 13/14's own notes)
-- student_interventions table that InterventionDrawer already reads/writes.
-- This migration only ADDS COLUMNS to it (IF NOT EXISTS) plus a companion
-- CREATE TABLE IF NOT EXISTS safety net, the same convention module 12's
-- mastery engine migration uses for tables that live outside tracked SQL.
--
-- Approach (deterministic, not a trained model - exactly like modules
-- 11/13/14's own checklists):
--   - BEFORE INSERT on student_interventions snapshots the same
--     ledger-derived signals modules 1/3/12/13 already compute (average
--     mastery, 14-day correctness rate, engagement volume, and the count of
--     strong/moderate risk causes from module 13's get_student_risk_core)
--     into baseline_metrics, at the moment the intervention starts.
--   - BEFORE UPDATE, the instant status flips to 'completed', snapshots the
--     exact same signals into followup_metrics and diffs the two into a
--     verdict: improved / no_change / worsened / insufficient_data.
--   - If a completed intervention is reopened, the stale followup/verdict
--     is cleared so it recomputes cleanly on the next completion.
--
-- Attendance is deliberately left out of the automatic snapshot, for the
-- same reason module 13 gives: calculate_attendance_risk is a Supabase RPC
-- that isn't part of any tracked migration in this repo, and it reports a
-- rolling "last 30 days from now" window that can't be replayed for a past
-- baseline date. The mastery/correctness/risk-signal trio below is fully
-- computable from tables this repo does track, at any point in time.
--
-- get_intervention_effectiveness_summary() at the bottom answers module
-- 15's real point: not just "did THIS intervention work", but "which
-- actions/tiers/priorities actually work" across a teacher's or school's
-- interventions - the same aggregate lens SchoolBenchmarking.tsx and the
-- executive-report edge function currently fake with a raw
-- status = 'completed' count.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. SAFETY NET (no-op on your real project - the table already exists live)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid,
  student_id uuid NOT NULL,
  teacher_id uuid NOT NULL,
  reason text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  tier int NOT NULL DEFAULT 2 CHECK (tier IN (2, 3)),
  action_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_outcome text,
  outcome text,
  review_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1. NEW COLUMNS: baseline / follow-up snapshots + computed verdict
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_interventions
  ADD COLUMN IF NOT EXISTS baseline_metrics jsonb,
  ADD COLUMN IF NOT EXISTS baseline_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS followup_metrics jsonb,
  ADD COLUMN IF NOT EXISTS followup_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS effectiveness text
    CHECK (effectiveness IN ('improved', 'no_change', 'worsened', 'insufficient_data')),
  ADD COLUMN IF NOT EXISTS effectiveness_detail jsonb,
  ADD COLUMN IF NOT EXISTS effectiveness_computed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_student_interventions_effectiveness
  ON public.student_interventions(effectiveness) WHERE effectiveness IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. CORE METRICS SNAPSHOT — same ledger signals modules 1/3/12/13 compute
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_intervention_effectiveness_metrics(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg_mastery numeric;
  v_mastery_objectives int;
  v_attempts_14d int;
  v_correct_14d int;
  v_correctness_rate_14d numeric;
  v_risk_core jsonb;
  v_risk_signal_count int := 0;
  v_cause jsonb;
BEGIN
  -- Module 1's BKT mastery state, averaged across every objective touched so far.
  SELECT round(avg(p_mastery), 3), count(*)
  INTO v_avg_mastery, v_mastery_objectives
  FROM public.student_mastery
  WHERE student_id = p_student_id;

  -- Module 3's evidence ledger, same 14-day window module 13 uses.
  SELECT count(*), count(*) FILTER (WHERE is_correct)
  INTO v_attempts_14d, v_correct_14d
  FROM public.mastery_evidence_log
  WHERE student_id = p_student_id AND responded_at >= now() - interval '14 days';

  v_correctness_rate_14d := CASE
    WHEN COALESCE(v_attempts_14d, 0) > 0 THEN round(v_correct_14d::numeric / v_attempts_14d, 3)
    ELSE NULL
  END;

  -- Module 13's risk core (academic_decline, disengagement, stalled_progress).
  -- Wrapped so a missing module-13 install can't break baseline capture.
  BEGIN
    v_risk_core := public.get_student_risk_core(p_student_id);
  EXCEPTION WHEN OTHERS THEN
    v_risk_core := NULL;
  END;

  IF v_risk_core IS NOT NULL THEN
    FOR v_cause IN SELECT * FROM jsonb_array_elements(v_risk_core -> 'causes') LOOP
      IF v_cause ->> 'evidence_strength' IN ('strong', 'moderate') THEN
        v_risk_signal_count := v_risk_signal_count + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'captured_at', now(),
    'avg_mastery', v_avg_mastery,
    'mastery_objectives_tracked', COALESCE(v_mastery_objectives, 0),
    'correctness_rate_14d', v_correctness_rate_14d,
    'attempts_14d', COALESCE(v_attempts_14d, 0),
    'risk_signal_count', v_risk_signal_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_intervention_effectiveness_metrics(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. VERDICT: diff baseline vs follow-up into improved / no_change / worsened
--    Vote-based checklist: each comparable signal casts +1 (improved),
--    0 (flat) or -1 (worsened) against a fixed noise threshold; the verdict
--    is the sign of the vote total. Needs at least one comparable signal or
--    the verdict is 'insufficient_data' (mirrors modules 11/13's own path).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_intervention_effectiveness(
  p_baseline jsonb,
  p_followup jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_votes int := 0;
  v_signals_compared int := 0;
  v_deltas jsonb := '{}'::jsonb;
  v_mastery_delta numeric;
  v_correctness_delta numeric;
  v_risk_delta int;
  v_engagement_delta int;
  v_verdict text;
BEGIN
  IF p_baseline IS NULL OR p_followup IS NULL THEN
    RETURN jsonb_build_object('verdict', 'insufficient_data', 'signals_compared', 0, 'votes', 0, 'deltas', '{}'::jsonb);
  END IF;

  -- avg mastery: +/- 0.03 (3 pts of probability) is treated as noise.
  IF (p_baseline ->> 'avg_mastery') IS NOT NULL AND (p_followup ->> 'avg_mastery') IS NOT NULL THEN
    v_mastery_delta := round((p_followup ->> 'avg_mastery')::numeric - (p_baseline ->> 'avg_mastery')::numeric, 3);
    v_signals_compared := v_signals_compared + 1;
    v_votes := v_votes + CASE WHEN v_mastery_delta >= 0.03 THEN 1 WHEN v_mastery_delta <= -0.03 THEN -1 ELSE 0 END;
    v_deltas := v_deltas || jsonb_build_object('avg_mastery_delta', v_mastery_delta);
  END IF;

  -- 14-day correctness rate: +/- 5 pts is treated as noise.
  IF (p_baseline ->> 'correctness_rate_14d') IS NOT NULL AND (p_followup ->> 'correctness_rate_14d') IS NOT NULL THEN
    v_correctness_delta := round((p_followup ->> 'correctness_rate_14d')::numeric - (p_baseline ->> 'correctness_rate_14d')::numeric, 3);
    v_signals_compared := v_signals_compared + 1;
    v_votes := v_votes + CASE WHEN v_correctness_delta >= 0.05 THEN 1 WHEN v_correctness_delta <= -0.05 THEN -1 ELSE 0 END;
    v_deltas := v_deltas || jsonb_build_object('correctness_rate_14d_delta', v_correctness_delta);
  END IF;

  -- risk signal count always exists (defaults to 0) - fewer strong/moderate causes is better.
  v_risk_delta := COALESCE((p_followup ->> 'risk_signal_count')::int, 0) - COALESCE((p_baseline ->> 'risk_signal_count')::int, 0);
  v_signals_compared := v_signals_compared + 1;
  v_votes := v_votes + CASE WHEN v_risk_delta < 0 THEN 1 WHEN v_risk_delta > 0 THEN -1 ELSE 0 END;
  v_deltas := v_deltas || jsonb_build_object('risk_signal_count_delta', v_risk_delta);

  -- engagement volume is reported for context but doesn't cast a vote on its
  -- own - a student can get MORE accurate while making fewer, more confident
  -- attempts, so a drop here isn't necessarily bad.
  v_engagement_delta := COALESCE((p_followup ->> 'attempts_14d')::int, 0) - COALESCE((p_baseline ->> 'attempts_14d')::int, 0);
  v_deltas := v_deltas || jsonb_build_object('attempts_14d_delta', v_engagement_delta);

  v_verdict := CASE
    WHEN v_signals_compared = 0 THEN 'insufficient_data'
    WHEN v_votes > 0 THEN 'improved'
    WHEN v_votes < 0 THEN 'worsened'
    ELSE 'no_change'
  END;

  RETURN jsonb_build_object('verdict', v_verdict, 'signals_compared', v_signals_compared, 'votes', v_votes, 'deltas', v_deltas);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS: capture baseline on insert; follow-up + verdict on completion;
--    clear a stale verdict if a completed intervention is reopened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_capture_intervention_baseline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.baseline_metrics IS NULL THEN
    NEW.baseline_metrics := public.get_intervention_effectiveness_metrics(NEW.student_id);
    NEW.baseline_captured_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_insert_intervention_baseline ON public.student_interventions;
CREATE TRIGGER before_insert_intervention_baseline
  BEFORE INSERT ON public.student_interventions
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_intervention_baseline();

CREATE OR REPLACE FUNCTION public.trg_capture_intervention_followup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW.followup_metrics := public.get_intervention_effectiveness_metrics(NEW.student_id);
    NEW.followup_captured_at := now();
    NEW.effectiveness_detail := public.compute_intervention_effectiveness(NEW.baseline_metrics, NEW.followup_metrics);
    NEW.effectiveness := NEW.effectiveness_detail ->> 'verdict';
    NEW.effectiveness_computed_at := now();
  ELSIF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed' THEN
    NEW.followup_metrics := NULL;
    NEW.followup_captured_at := NULL;
    NEW.effectiveness := NULL;
    NEW.effectiveness_detail := NULL;
    NEW.effectiveness_computed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_update_intervention_followup ON public.student_interventions;
CREATE TRIGGER before_update_intervention_followup
  BEFORE UPDATE ON public.student_interventions
  FOR EACH ROW EXECUTE FUNCTION public.trg_capture_intervention_followup();

-- ---------------------------------------------------------------------------
-- 5. BACKFILL: give existing ACTIVE interventions a baseline now, so they
--    become measurable the next time they're completed. This is really a
--    "since tracking began" baseline rather than a true pre-intervention
--    one - unavoidable for anything created before this migration. Already-
--    completed interventions are left alone (effectiveness stays NULL and
--    they're excluded from the aggregate below - they were never fairly
--    measurable and backdating a verdict for them would be misleading).
-- ---------------------------------------------------------------------------
UPDATE public.student_interventions
SET baseline_metrics = public.get_intervention_effectiveness_metrics(student_id),
    baseline_captured_at = created_at
WHERE baseline_metrics IS NULL AND status = 'active';

-- ---------------------------------------------------------------------------
-- 6. AGGREGATE RPC: "which interventions actually work"
--    Scoped by teacher, school and/or class (all optional, ANDed together).
--    Only completed + measured interventions count toward the breakdowns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_intervention_effectiveness_summary(
  p_teacher_id uuid DEFAULT NULL,
  p_school_id uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH class_roster AS (
    SELECT student_id FROM public.class_students WHERE p_class_id IS NOT NULL AND class_id = p_class_id
  ),
  scoped AS (
    SELECT si.*
    FROM public.student_interventions si
    WHERE (p_teacher_id IS NULL OR si.teacher_id = p_teacher_id)
      AND (p_school_id IS NULL OR si.school_id = p_school_id)
      AND (p_class_id IS NULL OR si.student_id IN (SELECT student_id FROM class_roster))
  ),
  measured AS (
    SELECT * FROM scoped WHERE status = 'completed' AND effectiveness IS NOT NULL
  ),
  totals AS (
    SELECT
      count(*) FILTER (WHERE status = 'completed') AS total_completed,
      count(*) FILTER (WHERE effectiveness = 'improved') AS improved,
      count(*) FILTER (WHERE effectiveness = 'no_change') AS no_change,
      count(*) FILTER (WHERE effectiveness = 'worsened') AS worsened,
      count(*) FILTER (WHERE status = 'completed' AND effectiveness IS NULL) AS unmeasured
    FROM scoped
  ),
  by_action_rows AS (
    SELECT action,
      count(*) AS measured_count,
      count(*) FILTER (WHERE effectiveness = 'improved') AS improved_count,
      count(*) FILTER (WHERE effectiveness = 'no_change') AS no_change_count,
      count(*) FILTER (WHERE effectiveness = 'worsened') AS worsened_count
    FROM measured, jsonb_array_elements_text(action_plan) AS action
    GROUP BY action
  ),
  by_action AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'action', action, 'measured', measured_count, 'improved', improved_count,
        'no_change', no_change_count, 'worsened', worsened_count,
        'improved_pct', round(100.0 * improved_count / measured_count, 1)
      ) ORDER BY improved_count::numeric / measured_count DESC, measured_count DESC), '[]'::jsonb) AS json
    FROM by_action_rows
  ),
  by_tier_rows AS (
    SELECT tier,
      count(*) AS measured_count,
      count(*) FILTER (WHERE effectiveness = 'improved') AS improved_count
    FROM measured GROUP BY tier
  ),
  by_tier AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tier', tier, 'measured', measured_count, 'improved', improved_count,
        'improved_pct', round(100.0 * improved_count / measured_count, 1)
      ) ORDER BY tier), '[]'::jsonb) AS json
    FROM by_tier_rows
  ),
  by_priority_rows AS (
    SELECT priority,
      count(*) AS measured_count,
      count(*) FILTER (WHERE effectiveness = 'improved') AS improved_count
    FROM measured GROUP BY priority
  ),
  by_priority AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'priority', priority, 'measured', measured_count, 'improved', improved_count,
        'improved_pct', round(100.0 * improved_count / measured_count, 1)
      ) ORDER BY improved_count::numeric / measured_count DESC), '[]'::jsonb) AS json
    FROM by_priority_rows
  )
  SELECT jsonb_build_object(
    'total_completed', totals.total_completed,
    'improved', totals.improved,
    'no_change', totals.no_change,
    'worsened', totals.worsened,
    'unmeasured', totals.unmeasured,
    'improved_pct', CASE WHEN (totals.total_completed - totals.unmeasured) > 0
      THEN round(100.0 * totals.improved / (totals.total_completed - totals.unmeasured), 1) ELSE NULL END,
    'by_action', by_action.json,
    'by_tier', by_tier.json,
    'by_priority', by_priority.json,
    'generated_at', now()
  )
  FROM totals, by_action, by_tier, by_priority;
$$;

GRANT EXECUTE ON FUNCTION public.get_intervention_effectiveness_summary(uuid, uuid, uuid) TO authenticated;