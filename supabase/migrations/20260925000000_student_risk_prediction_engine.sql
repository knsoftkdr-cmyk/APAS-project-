-- ============================================================================
-- STUDENT RISK PREDICTION ENGINE (module 13)
-- "Early warning for academic decline, chronic absenteeism, disengagement
--  or dropout risk"
--
-- This is a DIFFERENT, additive engine from the older ad hoc
-- public.student_predictions / predict-performance function (which reads
-- academic_tests + homework_submissions and writes an LLM-adjacent
-- percentage score). That one is left completely untouched. This module
-- instead composes signals the *rigorous* engines already computed:
--
--   academic_decline    <- Mastery Engine (1) / BKT (3): recent vs prior
--                          correctness-rate window on mastery_evidence_log
--   disengagement        <- same ledger: attempt frequency + recency
--   stalled_progress      <- Learning Velocity Engine (12):
--                          student_velocity_snapshots slow/slowing ratio
--   chronic_absenteeism   <- NOT computed here, for the exact reason
--                          module 11's root-cause engine gives: the live
--                          calculate_attendance_risk RPC isn't part of any
--                          tracked migration in this repo, so its shape
--                          can't be verified from SQL. The
--                          get-student-risk-profile / get-class-risk-roster
--                          EDGE FUNCTIONS fetch it via the JS client, the
--                          same way root-cause-analysis already does, and
--                          merge it in as a fourth cause.
--
-- Deliberately NOT a cached/triggered snapshot table (unlike module 12's
-- velocity snapshots). Disengagement is fundamentally "nothing happened
-- recently" - a fact that becomes true purely by the passage of time, with
-- no new row ever being written to trigger a refresh. So, like the
-- Forgetting Curve engine (7), this is a live, STABLE rollup computed
-- against now() on every read.
--
-- Each cause gets an evidence_strength ('strong'/'moderate'/'none') from a
-- fixed, documented threshold - a differential checklist, not a trained
-- model, exactly like module 11's causes. Additive only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CORE ENGINE: get_student_risk_core()
--    Returns the two ledger-derived causes (academic_decline,
--    disengagement) plus the velocity-derived one (stalled_progress) for a
--    single student. Attendance is added later, in the edge function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_risk_core(
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_attempts int;
  v_recent_correct int;
  v_prior_attempts int;
  v_prior_correct int;
  v_recent_rate numeric;
  v_prior_rate numeric;
  v_decline_delta numeric;
  v_decline_strength text;

  v_total_attempts_ever int;
  v_last_activity_at timestamptz;
  v_days_since_activity numeric;
  v_recent_14d_attempts int;
  v_prior_14d_attempts int;
  v_disengagement_strength text;

  v_slow_concepts int;
  v_slowing_concepts int;
  v_concepts_with_data int;
  v_stalled_ratio numeric;
  v_stalled_strength text;

  v_causes jsonb := '[]'::jsonb;
BEGIN
  -- ── Signal 1: academic decline - correctness rate, last 14d vs prior 28d ──
  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct)
  INTO v_recent_attempts, v_recent_correct
  FROM public.mastery_evidence_log
  WHERE student_id = p_student_id AND responded_at >= now() - interval '14 days';

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct)
  INTO v_prior_attempts, v_prior_correct
  FROM public.mastery_evidence_log
  WHERE student_id = p_student_id
    AND responded_at >= now() - interval '42 days'
    AND responded_at < now() - interval '14 days';

  IF COALESCE(v_recent_attempts, 0) < 5 OR COALESCE(v_prior_attempts, 0) < 5 THEN
    v_decline_strength := 'insufficient_data';
    v_causes := v_causes || jsonb_build_array(jsonb_build_object(
      'cause_type', 'academic_decline',
      'evidence_strength', 'insufficient_data',
      'explanation', 'Not enough graded attempts in both the last 14 days and the 28 days before that to compare performance over time yet',
      'evidence', jsonb_build_object('recent_attempts', COALESCE(v_recent_attempts, 0), 'prior_attempts', COALESCE(v_prior_attempts, 0))
    ));
  ELSE
    v_recent_rate := v_recent_correct::numeric / v_recent_attempts;
    v_prior_rate := v_prior_correct::numeric / v_prior_attempts;
    v_decline_delta := v_recent_rate - v_prior_rate;
    v_decline_strength := CASE
      WHEN v_decline_delta <= -0.20 THEN 'strong'
      WHEN v_decline_delta <= -0.10 THEN 'moderate'
      ELSE 'none'
    END;
    v_causes := v_causes || jsonb_build_array(jsonb_build_object(
      'cause_type', 'academic_decline',
      'evidence_strength', v_decline_strength,
      'explanation', CASE
        WHEN v_decline_strength = 'none' THEN format('Correctness is steady (%s%% recently vs %s%% before) - no sign of academic decline', round(v_recent_rate * 100), round(v_prior_rate * 100))
        ELSE format('Correctness has dropped from %s%% to %s%% over the last two weeks - a real slide, not noise', round(v_prior_rate * 100), round(v_recent_rate * 100))
      END,
      'evidence', jsonb_build_object(
        'recent_correct_rate', round(v_recent_rate, 3), 'prior_correct_rate', round(v_prior_rate, 3),
        'recent_attempts', v_recent_attempts, 'prior_attempts', v_prior_attempts
      )
    ));
  END IF;

  -- ── Signal 2: disengagement - activity recency + frequency drop-off ──────
  SELECT COUNT(*), MAX(responded_at) INTO v_total_attempts_ever, v_last_activity_at
  FROM public.mastery_evidence_log WHERE student_id = p_student_id;

  IF COALESCE(v_total_attempts_ever, 0) < 5 THEN
    v_disengagement_strength := 'insufficient_data';
    v_causes := v_causes || jsonb_build_array(jsonb_build_object(
      'cause_type', 'disengagement',
      'evidence_strength', 'insufficient_data',
      'explanation', 'Too little activity history yet to tell whether engagement is dropping off',
      'evidence', jsonb_build_object('total_attempts_ever', COALESCE(v_total_attempts_ever, 0))
    ));
  ELSE
    v_days_since_activity := EXTRACT(EPOCH FROM (now() - v_last_activity_at)) / 86400.0;

    SELECT COUNT(*) INTO v_recent_14d_attempts
    FROM public.mastery_evidence_log
    WHERE student_id = p_student_id AND responded_at >= now() - interval '14 days';

    SELECT COUNT(*) INTO v_prior_14d_attempts
    FROM public.mastery_evidence_log
    WHERE student_id = p_student_id
      AND responded_at >= now() - interval '28 days'
      AND responded_at < now() - interval '14 days';

    v_disengagement_strength := CASE
      WHEN v_days_since_activity >= 14 THEN 'strong'
      WHEN v_days_since_activity >= 7 THEN 'moderate'
      WHEN v_prior_14d_attempts >= 5 AND v_recent_14d_attempts < v_prior_14d_attempts * 0.4 THEN 'moderate'
      ELSE 'none'
    END;

    v_causes := v_causes || jsonb_build_array(jsonb_build_object(
      'cause_type', 'disengagement',
      'evidence_strength', v_disengagement_strength,
      'explanation', CASE
        WHEN v_disengagement_strength = 'strong' THEN format('No graded activity in %s days - has effectively gone quiet', round(v_days_since_activity))
        WHEN v_days_since_activity >= 7 THEN format('%s days since the last graded activity - going quiet', round(v_days_since_activity))
        WHEN v_disengagement_strength = 'moderate' THEN format('Activity has dropped from %s attempts to %s attempts over the last two 14-day windows', v_prior_14d_attempts, v_recent_14d_attempts)
        ELSE 'Activity is active and steady - no disengagement signal'
      END,
      'evidence', jsonb_build_object(
        'days_since_last_activity', round(v_days_since_activity, 1),
        'recent_14d_attempts', v_recent_14d_attempts, 'prior_14d_attempts', v_prior_14d_attempts
      )
    ));
  END IF;

  -- ── Signal 3: stalled progress - Learning Velocity Engine (module 12) ────
  SELECT
    COUNT(*) FILTER (WHERE velocity_label = 'slow'),
    COUNT(*) FILTER (WHERE trend = 'slowing'),
    COUNT(*) FILTER (WHERE velocity_label <> 'insufficient_data')
  INTO v_slow_concepts, v_slowing_concepts, v_concepts_with_data
  FROM public.student_velocity_snapshots
  WHERE student_id = p_student_id;

  IF COALESCE(v_concepts_with_data, 0) < 3 THEN
    v_stalled_strength := 'insufficient_data';
    v_causes := v_causes || jsonb_build_array(jsonb_build_object(
      'cause_type', 'stalled_progress',
      'evidence_strength', 'insufficient_data',
      'explanation', 'Not enough concepts with a measured learning pace yet to say whether progress is stalling',
      'evidence', jsonb_build_object('concepts_with_data', COALESCE(v_concepts_with_data, 0))
    ));
  ELSE
    v_stalled_ratio := (COALESCE(v_slow_concepts, 0) + COALESCE(v_slowing_concepts, 0))::numeric / (2.0 * v_concepts_with_data);
    v_stalled_strength := CASE
      WHEN v_stalled_ratio >= 0.6 THEN 'strong'
      WHEN v_stalled_ratio >= 0.35 THEN 'moderate'
      ELSE 'none'
    END;
    v_causes := v_causes || jsonb_build_array(jsonb_build_object(
      'cause_type', 'stalled_progress',
      'evidence_strength', v_stalled_strength,
      'explanation', CASE
        WHEN v_stalled_strength = 'none' THEN format('%s of %s tracked concepts show a healthy learning pace', v_concepts_with_data - v_slow_concepts, v_concepts_with_data)
        ELSE format('%s of %s tracked concepts are progressing slowly, and %s are trending slower over time - consistent with disengagement or a widening gap', v_slow_concepts, v_concepts_with_data, v_slowing_concepts)
      END,
      'evidence', jsonb_build_object(
        'slow_concepts', COALESCE(v_slow_concepts, 0), 'slowing_concepts', COALESCE(v_slowing_concepts, 0),
        'concepts_with_data', v_concepts_with_data
      )
    ));
  END IF;

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'causes', v_causes,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_risk_core(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. ROSTER VERSION: get_class_risk_roster()
--    Same three ledger/velocity-derived causes, for every student in a
--    roster at once. The edge function adds attendance in bulk on top of
--    this (one calculate_attendance_risk call for the whole class) and
--    computes each student's final composite risk level.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_class_risk_roster(
  p_student_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(public.get_student_risk_core(sid)), '[]'::jsonb)
  FROM unnest(p_student_ids) AS sid;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_risk_roster(uuid[]) TO authenticated;
