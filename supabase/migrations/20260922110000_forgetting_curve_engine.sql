-- ============================================================================
-- FORGETTING CURVE PREDICTION ENGINE
--
--   review_schedule (Spaced Repetition Engine)
--        └── forgetting_half_life_days()   SM-2 interval -> Ebbinghaus half-life
--        └── predict_retention()           R(t) = 2^(-t/half_life)
--        └── predict_forgetting_date()     when R(t) drops to a threshold
--             ├── get_forgetting_forecast()      student-facing: what's about to be forgotten
--             ├── get_retention_curve()          one concept's decay curve, for charting
--             └── get_class_forgetting_risk()    teacher rollup, mirrors get_class_mastery()
--
-- Purely additive and read-only: no new tables, no writes anywhere. Every
-- function here only *reads* review_schedule (Spaced Repetition Engine) plus
-- the same curriculum tables the Mastery/Knowledge-Graph engines already
-- join. Nothing upstream needs to change.
--
-- WHY THIS IS A SEPARATE ENGINE FROM SPACED REPETITION
--   review_schedule's due_at is a *scheduling decision* (SM-2's next-review
--   date). This engine turns that same state into a *continuous probability
--   curve* - "how likely is this student to still remember this concept
--   right now, or on any future date" - which is what lets the product
--   surface early warnings ("you'll likely forget X in 3 days") before an
--   objective is technically "due", and what lets a teacher see which
--   topics are decaying fastest across a whole class.
--
-- THE MODEL
--   SM-2 already implicitly targets ~90% recall probability at due_at (the
--   field's standard assumption behind its interval growth). Modelling
--   memory as the classic exponential (Ebbinghaus) decay curve
--   R(t) = 2^(-t / half_life), we back-solve the half-life implied by each
--   objective's current SM-2 interval: R(interval) = 0.90
--     => half_life = interval_days / -log2(0.90)
--   This ties the curve directly to state the Spaced Repetition Engine
--   already maintains (interval_days, last_reviewed_at) instead of
--   introducing an independent, untethered parameter, and it automatically
--   gets sharper as repetitions accumulate and intervals grow (a
--   well-reinforced concept decays more slowly, exactly as it should).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. half_life_days(interval_days)
--    Pure math, no table access. A brand-new objective (interval_days = 0,
--    not yet through a first successful repetition) is floored to a 1-day
--    half-life so "just seen once" still decays like short-term memory
--    rather than blowing up towards an undefined/zero half-life.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forgetting_half_life_days(p_interval_days int)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT GREATEST(p_interval_days, 1)::numeric / (-log(2::numeric, 0.90::numeric));
$$;

-- ---------------------------------------------------------------------------
-- 2. predict_retention(last_reviewed_at, interval_days, at?)
--    R(t) = 2^(-elapsed_days / half_life). Returns NULL if the objective has
--    never actually been reviewed (nothing to decay from yet).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.predict_retention(
  p_last_reviewed_at timestamptz,
  p_interval_days int,
  p_at timestamptz DEFAULT now()
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_last_reviewed_at IS NULL THEN NULL
    ELSE power(
      2::numeric,
      (-(EXTRACT(EPOCH FROM (p_at - p_last_reviewed_at)) / 86400.0)
        / public.forgetting_half_life_days(p_interval_days))::numeric
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- 3. predict_forgetting_date(last_reviewed_at, interval_days, threshold?)
--    Solves R(t) = threshold for t: t = half_life * -log2(threshold).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.predict_forgetting_date(
  p_last_reviewed_at timestamptz,
  p_interval_days int,
  p_threshold numeric DEFAULT 0.5
)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_last_reviewed_at IS NULL THEN NULL
    ELSE p_last_reviewed_at
      + (public.forgetting_half_life_days(p_interval_days)
          * (-log(2::numeric, LEAST(GREATEST(p_threshold, 0.0001), 0.9999)))
        )::double precision * interval '1 day'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_forgetting_forecast(student, threshold?, horizon_days?, book?)
--    Every actively-scheduled objective with a decay curve, soonest
--    forgetting date first, flagged is_at_risk if it crosses the threshold
--    within the horizon - which can fire well before SM-2's own due_at.
--    SECURITY DEFINER (joins curriculum tables the same way
--    get_student_mastery_tree / get_prerequisite_readiness do); granted to
--    authenticated the same way those are, with the edge function
--    resolving/enforcing which student_id a caller may request.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_forgetting_forecast(
  p_student_id uuid,
  p_threshold numeric DEFAULT 0.5,
  p_horizon_days int DEFAULT 14,
  p_book_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT
      rs.learning_objective_id,
      lo.objective_text, lo.difficulty,
      st.id AS subtopic_id, st.subtopic_name,
      t.id AS topic_id, t.topic_name,
      c.chapter_name, u.book_id, b.subject, b.class_name,
      rs.last_reviewed_at, rs.due_at, rs.interval_days, rs.repetitions, rs.ease_factor,
      public.predict_retention(rs.last_reviewed_at, rs.interval_days, now()) AS retention_now,
      public.predict_forgetting_date(rs.last_reviewed_at, rs.interval_days, p_threshold) AS forgetting_date
    FROM public.review_schedule rs
    JOIN public.learning_objectives lo ON lo.id = rs.learning_objective_id AND lo.status = 'active'
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    WHERE rs.student_id = p_student_id
      AND rs.suspended = false
      AND rs.last_reviewed_at IS NOT NULL
      AND (p_book_id IS NULL OR u.book_id = p_book_id)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'learning_objective_id', learning_objective_id,
    'objective_text', objective_text,
    'difficulty', difficulty,
    'subtopic_id', subtopic_id, 'subtopic_name', subtopic_name,
    'topic_id', topic_id, 'topic_name', topic_name,
    'chapter_name', chapter_name, 'subject', subject, 'class_name', class_name,
    'retention_now', round(retention_now, 3),
    'due_at', due_at,
    'forgetting_date', forgetting_date,
    'days_until_forgotten', round(EXTRACT(EPOCH FROM (forgetting_date - now()))::numeric / 86400, 1),
    'is_at_risk', forgetting_date <= now() + make_interval(days => p_horizon_days),
    'repetitions', repetitions,
    'ease_factor', round(ease_factor, 2)
  ) ORDER BY forgetting_date ASC), '[]'::jsonb)
  FROM scored;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_retention_curve(student, LO, days_ahead?)
--    Day-by-day retention points from today out to days_ahead, for plotting
--    the actual decay curve for one concept. NULL if that objective isn't
--    scheduled yet (nothing reviewed => nothing to curve).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_retention_curve(
  p_student_id uuid,
  p_learning_objective_id bigint,
  p_days_ahead int DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'learning_objective_id', rs.learning_objective_id,
    'last_reviewed_at', rs.last_reviewed_at,
    'due_at', rs.due_at,
    'half_life_days', round(public.forgetting_half_life_days(rs.interval_days), 2),
    'points', (
      SELECT jsonb_agg(jsonb_build_object(
        'day', d,
        'date', rs.last_reviewed_at + (d || ' days')::interval,
        'retention', round(public.predict_retention(
          rs.last_reviewed_at, rs.interval_days, rs.last_reviewed_at + (d || ' days')::interval
        ), 3)
      ) ORDER BY d)
      FROM generate_series(0, GREATEST(1, p_days_ahead)) AS d
    )
  )
  FROM public.review_schedule rs
  WHERE rs.student_id = p_student_id
    AND rs.learning_objective_id = p_learning_objective_id
    AND rs.last_reviewed_at IS NOT NULL;
$$;

-- ---------------------------------------------------------------------------
-- 6. get_class_forgetting_risk(students[], book, threshold?, horizon?)
--    Teacher rollup: which topics have the most students about to forget
--    them. Same per-student-then-aggregate shape as get_class_mastery().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_class_forgetting_risk(
  p_student_ids uuid[],
  p_book_id bigint,
  p_threshold numeric DEFAULT 0.5,
  p_horizon_days int DEFAULT 14
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_student AS (
    SELECT sid AS student_id,
      public.get_forgetting_forecast(sid, p_threshold, p_horizon_days, p_book_id) AS forecast
    FROM unnest(p_student_ids) AS sid
  ),
  rows AS (
    SELECT
      per_student.student_id,
      (f->>'topic_id')::bigint AS topic_id,
      f->>'topic_name' AS topic_name,
      f->>'chapter_name' AS chapter_name,
      (f->>'is_at_risk')::boolean AS is_at_risk
    FROM per_student, jsonb_array_elements(forecast) AS f
  ),
  topic_stats AS (
    SELECT
      topic_id, topic_name, chapter_name,
      COUNT(*) FILTER (WHERE is_at_risk) AS students_at_risk,
      COUNT(DISTINCT student_id) AS students_total
    FROM rows
    GROUP BY topic_id, topic_name, chapter_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'topic_id', topic_id,
    'topic_name', topic_name,
    'chapter_name', chapter_name,
    'students_at_risk', students_at_risk,
    'students_total', students_total,
    'risk_ratio', round(students_at_risk::numeric / NULLIF(students_total, 0), 2)
  ) ORDER BY students_at_risk DESC), '[]'::jsonb)
  FROM topic_stats;
$$;

-- ---------------------------------------------------------------------------
-- 7. GRANTS
--    Pure-math helpers are harmless to expose broadly. The three rollups are
--    SECURITY DEFINER for curriculum-table access, granted to authenticated
--    exactly like get_prerequisite_readiness / get_at_risk_concepts /
--    get_class_mastery already are in this codebase - the corresponding
--    edge function is what actually enforces which student_id / class a
--    caller may request.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.forgetting_half_life_days(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.predict_retention(timestamptz, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.predict_forgetting_date(timestamptz, int, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_forgetting_forecast(uuid, numeric, int, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_curve(uuid, bigint, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_forgetting_risk(uuid[], bigint, numeric, int) TO authenticated;
