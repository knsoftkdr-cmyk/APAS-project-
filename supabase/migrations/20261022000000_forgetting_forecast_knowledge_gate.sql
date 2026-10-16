-- 20261022000000_forgetting_forecast_knowledge_gate.sql
--
-- The Forgetting Forecast predicted "89% retention, ~5 days left" for System of Numeration concepts
-- the student had just got WRONG (0% on that topic in the exam). The decay maths was right but the
-- model assumed every answered concept had been learned: a wrong answer resets the SM-2 interval to
-- 1 day, which gives the same ~6.6-day half-life as a right answer, and the curve always started at
-- 100%. Nothing about whether the student actually knew the concept entered the numbers, so every
-- concept answered at the same moment got the same prediction.
--
-- Fix, in two parts:
--
--  1. GATE - only a concept the student has actually learned is forecast. "Learned" means
--     p_mastery >= forgetting_min_mastery() (0.60, the same band the mastery engine uses) AND the
--     most recent answer was correct (last_quality >= 3). Everything else is "still to learn": there
--     is nothing yet to forget. get_forgetting_forecast() keeps its signature and every output key, but
--     now returns only learned concepts - which also stops Learning Path, Next-Best-Action and the
--     teacher's class forgetting-risk view from flagging never-learned concepts as "about to be
--     forgotten". The new get_forgetting_unlearned() lists the rest for the student page.
--
--  2. SCALE - predicted recall = P(knows it) x P(still remembers it) = p_mastery x 2^(-t/half_life),
--     so a shakily-known concept starts below 100% and crosses 50% sooner than a solid one.
--     The curve and the forgetting date use the same formula, so the chart, "retention" and
--     "days left" always agree.
--
-- predict_retention() / predict_forgetting_date() are NOT changed: Exam Readiness uses them directly.

-- ---------------------------------------------------------------------------
-- Single source of truth for "learned"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forgetting_min_mastery()
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 0.60::numeric; $$;

-- ---------------------------------------------------------------------------
-- predicted recall = mastery x memory decay
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.predict_recall(
  p_mastery numeric, p_last_reviewed_at timestamptz, p_interval_days int, p_at timestamptz DEFAULT now()
)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_last_reviewed_at IS NULL THEN NULL
    ELSE LEAST(1, GREATEST(0, COALESCE(p_mastery, 0)))
         * public.predict_retention(p_last_reviewed_at, p_interval_days, p_at)
  END;
$$;

-- When predicted recall reaches the threshold:  m * 2^(-t/h) = thr  =>  t = h * log2(m / thr)
-- (already at/below the threshold -> the review time itself).
CREATE OR REPLACE FUNCTION public.predict_recall_date(
  p_mastery numeric, p_last_reviewed_at timestamptz, p_interval_days int, p_threshold numeric DEFAULT 0.5
)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_last_reviewed_at IS NULL THEN NULL
    ELSE p_last_reviewed_at + (
      public.forgetting_half_life_days(p_interval_days)
      * GREATEST(0, log(2::numeric,
          GREATEST(LEAST(1, COALESCE(p_mastery, 0)), 0.0001)
          / LEAST(GREATEST(p_threshold, 0.0001), 0.9999)))
    )::double precision * interval '1 day'
  END;
$$;

-- ---------------------------------------------------------------------------
-- get_forgetting_forecast: learned concepts only, mastery-scaled (same signature, same keys + extras)
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
      COALESCE(sm.p_mastery, bp.p_init, 0.30) AS p_mastery
    FROM public.review_schedule rs
    JOIN public.learning_objectives lo ON lo.id = rs.learning_objective_id AND lo.status = 'active'
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = lo.id
    LEFT JOIN public.student_mastery sm ON sm.student_id = p_student_id AND sm.learning_objective_id = lo.id
    WHERE rs.student_id = p_student_id
      AND rs.suspended = false
      AND rs.last_reviewed_at IS NOT NULL
      AND COALESCE(rs.last_quality, 0) >= 3                                        -- last answer was correct
      AND COALESCE(sm.p_mastery, bp.p_init, 0.30) >= public.forgetting_min_mastery() -- and it is actually known
      AND (p_book_id IS NULL OR u.book_id = p_book_id)
  ),
  calc AS (
    SELECT s.*,
      public.predict_recall(s.p_mastery, s.last_reviewed_at, s.interval_days, now()) AS retention_now,
      public.predict_recall_date(s.p_mastery, s.last_reviewed_at, s.interval_days, p_threshold) AS forgetting_date
    FROM scored s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'learning_objective_id', learning_objective_id,
    'objective_text', objective_text,
    'difficulty', difficulty,
    'subtopic_id', subtopic_id, 'subtopic_name', subtopic_name,
    'topic_id', topic_id, 'topic_name', topic_name,
    'chapter_name', chapter_name, 'subject', subject, 'class_name', class_name,
    'retention_now', round(retention_now, 3),
    'p_mastery', round(p_mastery, 3),
    'due_at', due_at,
    'forgetting_date', forgetting_date,
    'days_until_forgotten', round(EXTRACT(EPOCH FROM (forgetting_date - now()))::numeric / 86400, 1),
    'is_at_risk', forgetting_date <= now() + make_interval(days => p_horizon_days),
    'repetitions', repetitions,
    'ease_factor', round(ease_factor, 2)
  ) ORDER BY forgetting_date ASC), '[]'::jsonb)
  FROM calc;
$$;

-- ---------------------------------------------------------------------------
-- get_forgetting_unlearned: scheduled concepts that are NOT yet learned (nothing to forget)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_forgetting_unlearned(
  p_student_id uuid,
  p_book_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_student_id AND s.profile_id = auth.uid())
    -- COALESCE: with no logged-in user get_user_role() is NULL, and NOT (... OR NULL) would be NULL = "allowed"
    OR COALESCE(public.get_user_role(auth.uid()) IN ('admin', 'teacher', 'hod', 'principal', 'school_admin'), false)
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  WITH scored AS (
    SELECT
      rs.learning_objective_id,
      lo.objective_text, lo.difficulty,
      st.id AS subtopic_id, st.subtopic_name,
      t.id AS topic_id, t.topic_name,
      c.chapter_name, b.subject, b.class_name,
      rs.last_reviewed_at, COALESCE(rs.last_quality, 0) AS last_quality,
      COALESCE(sm.p_mastery, bp.p_init, 0.30) AS p_mastery
    FROM public.review_schedule rs
    JOIN public.learning_objectives lo ON lo.id = rs.learning_objective_id AND lo.status = 'active'
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = lo.id
    LEFT JOIN public.student_mastery sm ON sm.student_id = p_student_id AND sm.learning_objective_id = lo.id
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
    'p_mastery', round(p_mastery, 3),
    'last_reviewed_at', last_reviewed_at,
    'reason', CASE WHEN last_quality < 3 THEN 'answered_incorrectly' ELSE 'low_mastery' END
  ) ORDER BY p_mastery ASC, last_reviewed_at DESC), '[]'::jsonb)
  INTO v_result
  FROM scored
  WHERE last_quality < 3 OR p_mastery < public.forgetting_min_mastery();

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_retention_curve: same signature, now scaled by mastery (+ returns p_mastery)
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
  WITH base AS (
    SELECT rs.learning_objective_id, rs.last_reviewed_at, rs.due_at, rs.interval_days,
           COALESCE(sm.p_mastery, bp.p_init, 0.30) AS p_mastery
    FROM public.review_schedule rs
    LEFT JOIN public.mastery_bkt_params bp ON bp.learning_objective_id = rs.learning_objective_id
    LEFT JOIN public.student_mastery sm
           ON sm.student_id = rs.student_id AND sm.learning_objective_id = rs.learning_objective_id
    WHERE rs.student_id = p_student_id
      AND rs.learning_objective_id = p_learning_objective_id
      AND rs.last_reviewed_at IS NOT NULL
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'learning_objective_id', b.learning_objective_id,
    'last_reviewed_at', b.last_reviewed_at,
    'due_at', b.due_at,
    'half_life_days', round(public.forgetting_half_life_days(b.interval_days), 2),
    'p_mastery', round(b.p_mastery, 3),
    'points', (
      SELECT jsonb_agg(jsonb_build_object(
        'day', d,
        'date', b.last_reviewed_at + (d || ' days')::interval,
        'retention', round(public.predict_recall(
          b.p_mastery, b.last_reviewed_at, b.interval_days, b.last_reviewed_at + (d || ' days')::interval
        ), 3)
      ) ORDER BY d)
      FROM generate_series(0, GREATEST(1, p_days_ahead)) AS d
    )
  )
  FROM base b;
$$;

-- ---------------------------------------------------------------------------
-- Grants (replaced functions keep theirs)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.forgetting_min_mastery() TO authenticated;
GRANT EXECUTE ON FUNCTION public.predict_recall(numeric, timestamptz, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.predict_recall_date(numeric, timestamptz, int, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.get_forgetting_unlearned(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_forgetting_unlearned(uuid, bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Hardening: get_review_forecast() (20261021) had the same NULL-in-the-access-check flaw fixed above
-- (a caller with no profile row made the check evaluate to NULL, i.e. "allowed"). Re-created here so
-- databases that already ran 20261021 pick up the fix; a fresh database gets the same body twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_review_forecast(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (
    auth.role() = 'service_role'
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_student_id AND s.profile_id = auth.uid())
    -- COALESCE: with no logged-in user get_user_role() is NULL, and NOT (... OR NULL) would be NULL = "allowed"
    OR COALESCE(public.get_user_role(auth.uid()) IN ('admin', 'teacher', 'hod', 'principal', 'school_admin'), false)
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  WITH r AS (
    SELECT
      rs.due_at, rs.interval_days, rs.last_quality, rs.last_reviewed_at,
      EXISTS (
        SELECT 1 FROM public.question_bank q
        WHERE q.learning_objective_id = rs.learning_objective_id AND q.status = 'active'
      ) AS has_item
    FROM public.review_schedule rs
    -- same eligibility joins as get_due_reviews()
    JOIN public.learning_objectives lo ON lo.id = rs.learning_objective_id AND lo.status = 'active'
    JOIN public.subtopics st ON st.id = lo.subtopic_id
    JOIN public.topics t ON t.id = st.topic_id
    JOIN public.curriculum_chapters c ON c.id = t.chapter_id
    JOIN public.units u ON u.id = c.unit_id
    JOIN public.books b ON b.id = u.book_id
    WHERE rs.student_id = p_student_id AND rs.suspended = false
  )
  SELECT jsonb_build_object(
    'due_now',               COUNT(*) FILTER (WHERE has_item AND due_at <= now()),
    'due_today',             COUNT(*) FILTER (WHERE has_item AND due_at > now() AND due_at::date = CURRENT_DATE),
    'due_next_7_days',       COUNT(*) FILTER (WHERE has_item AND due_at::date > CURRENT_DATE AND due_at < now() + interval '7 days'),
    'total_scheduled',       COUNT(*),
    'long_retention_count',  COUNT(*) FILTER (WHERE interval_days >= 21),
    'recent_lapses',         COUNT(*) FILTER (WHERE last_quality < 3 AND last_reviewed_at > now() - interval '7 days'),
    'last_reviewed_at',      MAX(last_reviewed_at),
    'due_without_questions', COUNT(*) FILTER (WHERE NOT has_item AND due_at <= now()),
    'next_due_at',           MIN(due_at) FILTER (WHERE has_item AND due_at > now())
  )
  INTO v_result
  FROM r;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_review_forecast(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_review_forecast(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_class_forgetting_risk: students_at_risk counted at-risk CONCEPT rows, not students, so one
-- student with two at-risk concepts in a topic gave "2 of 1 students" (risk_ratio 2.00). Count
-- distinct students. Everything else is unchanged.
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
      COUNT(DISTINCT student_id) FILTER (WHERE is_at_risk) AS students_at_risk,
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
