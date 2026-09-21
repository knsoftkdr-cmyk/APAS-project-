-- ============================================================================
-- BAYESIAN KNOWLEDGE TRACING — HISTORY + CALIBRATION
--
-- The BKT engine itself (record_mastery_evidence) already exists from the
-- Student Mastery Engine 2.0 migration. This migration adds the two things
-- that were still missing:
--   1. Mastery-over-time queries, reading the evidence log that engine has
--      been writing to all along.
--   2. Real parameter calibration — fitting P(T)/P(S)/P(G)/P(init) per
--      learning objective from actual student response sequences, instead
--      of the fixed difficulty-based defaults seeded at creation.
--
-- Calibration approach: grid-search maximum likelihood, not full Baum-Welch
-- EM. This is a well-established simplification in the BKT literature
-- (full EM for 4-parameter BKT is prone to degenerate/identifiability
-- issues — e.g. Baker et al. 2008 — and bounded grid search is a common,
-- more stable alternative). For each candidate (p_init, p_transit, p_slip,
-- p_guess) combination, we compute the log-likelihood of every student's
-- observed correct/incorrect sequence for that objective under the exact
-- same forward-update formula record_mastery_evidence() uses in production,
-- and keep the combination that maximizes total log-likelihood. That
-- consistency matters: calibration and live updates use one formula.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Calibration bookkeeping columns on the existing BKT params table
-- ---------------------------------------------------------------------------
ALTER TABLE public.mastery_bkt_params ADD COLUMN IF NOT EXISTS is_calibrated boolean NOT NULL DEFAULT false;
ALTER TABLE public.mastery_bkt_params ADD COLUMN IF NOT EXISTS calibrated_at timestamptz;
ALTER TABLE public.mastery_bkt_params ADD COLUMN IF NOT EXISTS calibration_sample_size int;
ALTER TABLE public.mastery_bkt_params ADD COLUMN IF NOT EXISTS calibration_log_likelihood numeric;

-- ---------------------------------------------------------------------------
-- 1. MASTERY-OVER-TIME: raw history for one objective
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mastery_history(
  p_student_id uuid,
  p_learning_objective_id bigint
)
RETURNS TABLE (
  responded_at timestamptz,
  is_correct boolean,
  source text,
  p_mastery_before numeric,
  p_mastery_after numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT responded_at, is_correct, source, p_mastery_before, p_mastery_after
  FROM public.mastery_evidence_log
  WHERE student_id = p_student_id AND learning_objective_id = p_learning_objective_id
  ORDER BY responded_at ASC;
$$;

-- ---------------------------------------------------------------------------
-- 2. MASTERY-OVER-TIME: concept-level trend (average across every objective
--    under a concept, resnapshotted after each evidence event from any of
--    them). Walks events chronologically maintaining a running "current
--    mastery per objective" map, so the trend reflects the concept's whole
--    state at each point in time, not just one objective in isolation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_concept_mastery_trend(
  p_student_id uuid,
  p_subtopic_id bigint
)
RETURNS TABLE (
  responded_at timestamptz,
  learning_objective_id bigint,
  event_p_mastery numeric,
  is_correct boolean,
  concept_p_mastery numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_state jsonb := '{}'::jsonb;
  v_obj RECORD;
  v_evt RECORD;
  v_avg numeric;
BEGIN
  FOR v_obj IN
    SELECT lo.id, COALESCE(bp.p_init, 0.30) AS p_init
    FROM public.learning_objectives lo
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = lo.id
    WHERE lo.subtopic_id = p_subtopic_id AND lo.status = 'active'
  LOOP
    v_state := v_state || jsonb_build_object(v_obj.id::text, v_obj.p_init);
  END LOOP;

  IF v_state = '{}'::jsonb THEN
    RETURN;
  END IF;

  FOR v_evt IN
    SELECT mel.responded_at, mel.learning_objective_id, mel.p_mastery_after, mel.is_correct
    FROM public.mastery_evidence_log mel
    WHERE mel.student_id = p_student_id
      AND mel.learning_objective_id IN (
        SELECT lo.id FROM public.learning_objectives lo WHERE lo.subtopic_id = p_subtopic_id
      )
    ORDER BY mel.responded_at ASC
  LOOP
    v_state := jsonb_set(v_state, ARRAY[v_evt.learning_objective_id::text], to_jsonb(v_evt.p_mastery_after));
    SELECT AVG(value::numeric) INTO v_avg FROM jsonb_each_text(v_state);

    responded_at := v_evt.responded_at;
    learning_objective_id := v_evt.learning_objective_id;
    event_p_mastery := v_evt.p_mastery_after;
    is_correct := v_evt.is_correct;
    concept_p_mastery := round(v_avg, 3);
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Forward-pass log-likelihood of ONE sequence under ONE parameter set.
--    Uses the identical Bayes-update + transition formula as
--    record_mastery_evidence(), so calibration optimizes exactly the model
--    that will run in production.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bkt_sequence_loglik(
  p_events boolean[],
  p_init numeric,
  p_transit numeric,
  p_slip numeric,
  p_guess numeric
)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_pl numeric := p_init;
  v_loglik numeric := 0;
  v_p_event numeric;
  v_posterior numeric;
  v_denom numeric;
  i int;
  n int := COALESCE(array_length(p_events, 1), 0);
BEGIN
  FOR i IN 1..n LOOP
    IF p_events[i] THEN
      v_denom := v_pl * (1 - p_slip) + (1 - v_pl) * p_guess;
      v_p_event := v_denom;
      v_posterior := CASE WHEN v_denom = 0 THEN v_pl ELSE (v_pl * (1 - p_slip)) / v_denom END;
    ELSE
      v_denom := v_pl * p_slip + (1 - v_pl) * (1 - p_guess);
      v_p_event := v_denom;
      v_posterior := CASE WHEN v_denom = 0 THEN v_pl ELSE (v_pl * p_slip) / v_denom END;
    END IF;

    v_loglik := v_loglik + ln(GREATEST(v_p_event, 0.0001));
    v_pl := LEAST(0.99, GREATEST(0.01, v_posterior + (1 - v_posterior) * p_transit));
  END LOOP;
  RETURN v_loglik;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. calibrate_bkt_params(learning_objective_id) — the grid-search fit.
--    Needs a minimum amount of real data before it touches anything (fewer
--    than 5 students or 20 total attempts and it declines rather than
--    overfitting on noise). On success, overwrites that objective's row in
--    mastery_bkt_params and marks it calibrated.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bkt_student_sequence') THEN
    CREATE TYPE public.bkt_student_sequence AS (student_id uuid, seq boolean[]);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.calibrate_bkt_params(p_learning_objective_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sequences public.bkt_student_sequence[] := '{}';
  v_rec RECORD;
  v_total_events int := 0;
  v_student_count int := 0;

  v_init numeric; v_t numeric; v_s numeric; v_g numeric;
  v_ll numeric;
  v_best_ll numeric; -- NULL until the first grid point is evaluated
  v_best_init numeric; v_best_t numeric; v_best_s numeric; v_best_g numeric;
  v_seq_elem public.bkt_student_sequence;
BEGIN
  FOR v_rec IN
    SELECT student_id, array_agg(is_correct ORDER BY responded_at) AS seq, COUNT(*) AS n
    FROM public.mastery_evidence_log
    WHERE learning_objective_id = p_learning_objective_id
    GROUP BY student_id
  LOOP
    v_sequences := v_sequences || ROW(v_rec.student_id, v_rec.seq)::public.bkt_student_sequence;
    v_total_events := v_total_events + v_rec.n;
    v_student_count := v_student_count + 1;
  END LOOP;

  IF v_student_count < 5 OR v_total_events < 20 THEN
    RETURN jsonb_build_object(
      'calibrated', false, 'reason', 'insufficient_data',
      'student_count', v_student_count, 'event_count', v_total_events,
      'minimum_required', jsonb_build_object('students', 5, 'events', 20)
    );
  END IF;

  FOR v_init IN SELECT unnest(ARRAY[0.10, 0.20, 0.30, 0.40]) LOOP
    FOR v_t IN SELECT unnest(ARRAY[0.05, 0.10, 0.15, 0.20, 0.30]) LOOP
      FOR v_s IN SELECT unnest(ARRAY[0.05, 0.10, 0.15, 0.20]) LOOP
        FOR v_g IN SELECT unnest(ARRAY[0.10, 0.15, 0.20, 0.25, 0.30]) LOOP
          v_ll := 0;
          FOREACH v_seq_elem IN ARRAY v_sequences LOOP
            v_ll := v_ll + public.bkt_sequence_loglik(v_seq_elem.seq, v_init, v_t, v_s, v_g);
          END LOOP;
          IF v_best_ll IS NULL OR v_ll > v_best_ll THEN
            v_best_ll := v_ll; v_best_init := v_init; v_best_t := v_t; v_best_s := v_s; v_best_g := v_g;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  UPDATE public.mastery_bkt_params SET
    p_init = v_best_init,
    p_transit = v_best_t,
    p_slip = v_best_s,
    p_guess = v_best_g,
    is_calibrated = true,
    calibrated_at = now(),
    calibration_sample_size = v_total_events,
    calibration_log_likelihood = v_best_ll,
    updated_at = now()
  WHERE learning_objective_id = p_learning_objective_id;

  RETURN jsonb_build_object(
    'calibrated', true,
    'learning_objective_id', p_learning_objective_id,
    'p_init', v_best_init, 'p_transit', v_best_t, 'p_slip', v_best_s, 'p_guess', v_best_g,
    'log_likelihood', round(v_best_ll, 2),
    'student_count', v_student_count, 'event_count', v_total_events
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mastery_history(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_concept_mastery_trend(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calibrate_bkt_params(bigint) TO authenticated;
