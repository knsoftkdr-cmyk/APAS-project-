-- ============================================================================
-- LEARNING VELOCITY TRACKING ENGINE (module 12)
--
-- "How quickly does each student learn and retain concepts" - measured
-- directly off the same append-only ledger the BKT engine (module 3)
-- already writes to: public.mastery_evidence_log. Every graded attempt in
-- that table carries p_mastery_before/p_mastery_after, so the empirical
-- mastery gain per attempt IS a per-student, per-concept estimate of the
-- BKT learning-transition rate P(T) - distinct from the fixed default
-- (0.15) that mastery_bkt_params ships with. This migration does not touch
-- BKT params (they stay global/objective-level); it adds a *measured*,
-- student-level pace signal alongside them.
--
-- Grain: subtopic ("concept" - same level module 11's root-cause engine and
-- module 2's knowledge graph operate at), so velocity can be read directly
-- alongside mastery and prerequisite state without a unit mismatch.
--
-- Additive only - no existing table/function is altered.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SNAPSHOT TABLE (denormalized, refreshed by trigger - see below)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_velocity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subtopic_id bigint NOT NULL REFERENCES public.subtopics(id) ON DELETE CASCADE,
  attempts_count int NOT NULL DEFAULT 0,
  days_active numeric,
  mastery_gain_total numeric,
  mastery_gain_per_attempt numeric,
  mastery_gain_per_day numeric,
  velocity_label text NOT NULL DEFAULT 'insufficient_data'
    CHECK (velocity_label IN ('insufficient_data', 'slow', 'average', 'fast')),
  trend text NOT NULL DEFAULT 'insufficient_data'
    CHECK (trend IN ('insufficient_data', 'accelerating', 'steady', 'slowing')),
  projected_days_to_mastery numeric,
  projected_attempts_to_mastery int,
  current_mastery numeric,
  first_evidence_at timestamptz,
  last_evidence_at timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, subtopic_id)
);

CREATE INDEX IF NOT EXISTS idx_velocity_snapshots_student ON public.student_velocity_snapshots(student_id);
CREATE INDEX IF NOT EXISTS idx_velocity_snapshots_subtopic ON public.student_velocity_snapshots(subtopic_id);

-- ---------------------------------------------------------------------------
-- 2. CORE ENGINE: compute_concept_velocity()
--    Pure, read-only computation off mastery_evidence_log. Thresholds
--    (0.20 / 0.08 mastery-points gained per attempt) are anchored on the
--    same scale as mastery_bkt_params.p_transit defaults (0.15), so "fast"
--    means "learning faster than the model's own default assumption" and
--    "slow" means meaningfully under it - not an arbitrary cutoff.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_concept_velocity(
  p_student_id uuid,
  p_subtopic_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts int;
  v_first_before numeric;
  v_last_after numeric;
  v_first_at timestamptz;
  v_last_at timestamptz;
  v_days_active numeric;
  v_gain_total numeric;
  v_gain_per_attempt numeric;
  v_gain_per_day numeric;
  v_first_half_avg numeric;
  v_second_half_avg numeric;
  v_trend text;
  v_label text;
  v_projected_days numeric;
  v_projected_attempts numeric;
  v_current_mastery numeric;
BEGIN
  SELECT COUNT(*), MIN(mel.responded_at), MAX(mel.responded_at)
  INTO v_attempts, v_first_at, v_last_at
  FROM public.mastery_evidence_log mel
  JOIN public.learning_objectives lo ON lo.id = mel.learning_objective_id
  WHERE mel.student_id = p_student_id AND lo.subtopic_id = p_subtopic_id;

  v_attempts := COALESCE(v_attempts, 0);

  -- Same "not enough reps to say anything" bar the root-cause engine (11)
  -- uses for practice_deficiency: <=1 strong, <=3 moderate.
  IF v_attempts < 3 THEN
    RETURN jsonb_build_object(
      'subtopic_id', p_subtopic_id,
      'attempts_count', v_attempts,
      'days_active', null,
      'mastery_gain_total', null,
      'mastery_gain_per_attempt', null,
      'mastery_gain_per_day', null,
      'velocity_label', 'insufficient_data',
      'trend', 'insufficient_data',
      'projected_days_to_mastery', null,
      'projected_attempts_to_mastery', null,
      'current_mastery', null,
      'first_evidence_at', v_first_at,
      'last_evidence_at', v_last_at
    );
  END IF;

  SELECT mel.p_mastery_before INTO v_first_before
  FROM public.mastery_evidence_log mel
  JOIN public.learning_objectives lo ON lo.id = mel.learning_objective_id
  WHERE mel.student_id = p_student_id AND lo.subtopic_id = p_subtopic_id
  ORDER BY mel.responded_at ASC LIMIT 1;

  SELECT mel.p_mastery_after INTO v_last_after
  FROM public.mastery_evidence_log mel
  JOIN public.learning_objectives lo ON lo.id = mel.learning_objective_id
  WHERE mel.student_id = p_student_id AND lo.subtopic_id = p_subtopic_id
  ORDER BY mel.responded_at DESC LIMIT 1;

  v_days_active := GREATEST(EXTRACT(EPOCH FROM (v_last_at - v_first_at)) / 86400.0, 0);
  v_gain_total := v_last_after - v_first_before;
  v_gain_per_attempt := v_gain_total / v_attempts;
  v_gain_per_day := CASE WHEN v_days_active >= 0.5 THEN v_gain_total / v_days_active ELSE NULL END;

  -- Trend: chronological first half vs second half of attempts, by
  -- per-attempt delta. Needs >=4 attempts to split meaningfully.
  WITH ordered AS (
    SELECT
      mel.p_mastery_after - mel.p_mastery_before AS delta,
      ROW_NUMBER() OVER (ORDER BY mel.responded_at) AS rn,
      COUNT(*) OVER () AS total
    FROM public.mastery_evidence_log mel
    JOIN public.learning_objectives lo ON lo.id = mel.learning_objective_id
    WHERE mel.student_id = p_student_id AND lo.subtopic_id = p_subtopic_id
  )
  SELECT
    AVG(delta) FILTER (WHERE rn <= total / 2),
    AVG(delta) FILTER (WHERE rn > total / 2)
  INTO v_first_half_avg, v_second_half_avg
  FROM ordered;

  v_trend := CASE
    WHEN v_attempts < 4 OR v_first_half_avg IS NULL OR v_second_half_avg IS NULL THEN 'insufficient_data'
    WHEN v_second_half_avg > GREATEST(v_first_half_avg * 1.2, v_first_half_avg + 0.02) THEN 'accelerating'
    WHEN v_second_half_avg < v_first_half_avg * 0.8 THEN 'slowing'
    ELSE 'steady'
  END;

  v_label := CASE
    WHEN v_gain_per_attempt >= 0.20 THEN 'fast'
    WHEN v_gain_per_attempt >= 0.08 THEN 'average'
    ELSE 'slow'
  END;

  SELECT sm.p_mastery INTO v_current_mastery
  FROM public.student_mastery sm
  JOIN public.learning_objectives lo ON lo.id = sm.learning_objective_id
  WHERE sm.student_id = p_student_id AND lo.subtopic_id = p_subtopic_id
  ORDER BY sm.updated_at DESC LIMIT 1;
  v_current_mastery := COALESCE(v_current_mastery, v_last_after, 0.30);

  v_projected_days := CASE
    WHEN v_gain_per_day > 0 AND v_current_mastery < 0.85 THEN (0.85 - v_current_mastery) / v_gain_per_day
    ELSE NULL
  END;
  v_projected_attempts := CASE
    WHEN v_gain_per_attempt > 0 AND v_current_mastery < 0.85 THEN (0.85 - v_current_mastery) / v_gain_per_attempt
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'subtopic_id', p_subtopic_id,
    'attempts_count', v_attempts,
    'days_active', round(v_days_active::numeric, 2),
    'mastery_gain_total', round(v_gain_total::numeric, 3),
    'mastery_gain_per_attempt', round(v_gain_per_attempt::numeric, 4),
    'mastery_gain_per_day', CASE WHEN v_gain_per_day IS NULL THEN NULL ELSE round(v_gain_per_day::numeric, 4) END,
    'velocity_label', v_label,
    'trend', v_trend,
    'projected_days_to_mastery', CASE WHEN v_projected_days IS NULL THEN NULL ELSE round(v_projected_days::numeric, 1) END,
    'projected_attempts_to_mastery', CASE WHEN v_projected_attempts IS NULL THEN NULL ELSE ceil(v_projected_attempts) END,
    'current_mastery', round(v_current_mastery::numeric, 3),
    'first_evidence_at', v_first_at,
    'last_evidence_at', v_last_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. refresh_student_velocity() - computes + upserts the snapshot row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_student_velocity(
  p_student_id uuid,
  p_subtopic_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_result jsonb;
BEGIN
  v_result := public.compute_concept_velocity(p_student_id, p_subtopic_id);

  INSERT INTO public.student_velocity_snapshots AS svs (
    student_id, subtopic_id, attempts_count, days_active, mastery_gain_total,
    mastery_gain_per_attempt, mastery_gain_per_day, velocity_label, trend,
    projected_days_to_mastery, projected_attempts_to_mastery, current_mastery,
    first_evidence_at, last_evidence_at, computed_at
  )
  SELECT
    p_student_id, p_subtopic_id,
    (v_result->>'attempts_count')::int,
    (v_result->>'days_active')::numeric,
    (v_result->>'mastery_gain_total')::numeric,
    (v_result->>'mastery_gain_per_attempt')::numeric,
    (v_result->>'mastery_gain_per_day')::numeric,
    v_result->>'velocity_label',
    v_result->>'trend',
    (v_result->>'projected_days_to_mastery')::numeric,
    (v_result->>'projected_attempts_to_mastery')::int,
    (v_result->>'current_mastery')::numeric,
    (v_result->>'first_evidence_at')::timestamptz,
    (v_result->>'last_evidence_at')::timestamptz,
    now()
  ON CONFLICT (student_id, subtopic_id) DO UPDATE SET
    attempts_count = EXCLUDED.attempts_count,
    days_active = EXCLUDED.days_active,
    mastery_gain_total = EXCLUDED.mastery_gain_total,
    mastery_gain_per_attempt = EXCLUDED.mastery_gain_per_attempt,
    mastery_gain_per_day = EXCLUDED.mastery_gain_per_day,
    velocity_label = EXCLUDED.velocity_label,
    trend = EXCLUDED.trend,
    projected_days_to_mastery = EXCLUDED.projected_days_to_mastery,
    projected_attempts_to_mastery = EXCLUDED.projected_attempts_to_mastery,
    current_mastery = EXCLUDED.current_mastery,
    first_evidence_at = EXCLUDED.first_evidence_at,
    last_evidence_at = EXCLUDED.last_evidence_at,
    computed_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. TRIGGER: every new mastery_evidence_log row keeps velocity live,
--    exactly the way record_mastery_evidence() (module 1/3) already keeps
--    student_mastery live on the same event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_refresh_velocity_after_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtopic_id bigint;
BEGIN
  SELECT subtopic_id INTO v_subtopic_id
  FROM public.learning_objectives WHERE id = NEW.learning_objective_id;

  IF v_subtopic_id IS NOT NULL THEN
    PERFORM public.refresh_student_velocity(NEW.student_id, v_subtopic_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_velocity_after_evidence ON public.mastery_evidence_log;
CREATE TRIGGER trg_velocity_after_evidence
AFTER INSERT ON public.mastery_evidence_log
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_velocity_after_evidence();

-- ---------------------------------------------------------------------------
-- 5. BACKFILL: compute snapshots for every (student, concept) pair that
--    already has evidence from before this migration ran, so modules 1-11's
--    existing usage history is reflected immediately rather than waiting
--    for the next attempt.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT mel.student_id, lo.subtopic_id
    FROM public.mastery_evidence_log mel
    JOIN public.learning_objectives lo ON lo.id = mel.learning_objective_id
  LOOP
    PERFORM public.refresh_student_velocity(r.student_id, r.subtopic_id);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. ROLLUP: get_student_velocity_tree() - subject -> chapter -> topic ->
--    concept, same shape family as get_student_mastery_tree() (module 1)
--    so the frontend can render it with the same mental model.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_velocity_tree(
  p_student_id uuid,
  p_book_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH concept AS (
    SELECT
      st.id AS subtopic_id, st.subtopic_name, st.topic_id,
      COALESCE(svs.attempts_count, 0) AS attempts_count,
      svs.mastery_gain_per_attempt,
      svs.mastery_gain_per_day,
      COALESCE(svs.velocity_label, 'insufficient_data') AS velocity_label,
      COALESCE(svs.trend, 'insufficient_data') AS trend,
      svs.projected_days_to_mastery,
      svs.projected_attempts_to_mastery,
      svs.current_mastery,
      svs.last_evidence_at
    FROM public.subtopics st
    LEFT JOIN public.student_velocity_snapshots svs
      ON svs.subtopic_id = st.id AND svs.student_id = p_student_id
  ),
  topic AS (
    SELECT
      t.id AS topic_id, t.topic_name, t.chapter_id,
      AVG(concept.mastery_gain_per_attempt) AS avg_gain_per_attempt,
      COUNT(*) FILTER (WHERE concept.velocity_label = 'fast') AS fast_count,
      COUNT(*) FILTER (WHERE concept.velocity_label = 'average') AS average_count,
      COUNT(*) FILTER (WHERE concept.velocity_label = 'slow') AS slow_count,
      COUNT(*) FILTER (WHERE concept.velocity_label = 'insufficient_data') AS insufficient_count,
      MAX(concept.last_evidence_at) AS last_evidence_at,
      jsonb_agg(jsonb_build_object(
        'id', concept.subtopic_id,
        'name', concept.subtopic_name,
        'attempts_count', concept.attempts_count,
        'mastery_gain_per_attempt', round(concept.mastery_gain_per_attempt::numeric, 4),
        'mastery_gain_per_day', round(concept.mastery_gain_per_day::numeric, 4),
        'velocity_label', concept.velocity_label,
        'trend', concept.trend,
        'projected_days_to_mastery', concept.projected_days_to_mastery,
        'projected_attempts_to_mastery', concept.projected_attempts_to_mastery,
        'current_mastery', round(concept.current_mastery::numeric, 3)
      ) ORDER BY concept.subtopic_id) AS concepts
    FROM public.topics t
    JOIN concept ON concept.topic_id = t.id
    GROUP BY t.id, t.topic_name, t.chapter_id
  ),
  chapter AS (
    SELECT
      c.id AS chapter_id, c.chapter_name, c.unit_id,
      AVG(topic.avg_gain_per_attempt) AS avg_gain_per_attempt,
      SUM(topic.fast_count) AS fast_count,
      SUM(topic.average_count) AS average_count,
      SUM(topic.slow_count) AS slow_count,
      SUM(topic.insufficient_count) AS insufficient_count,
      MAX(topic.last_evidence_at) AS last_evidence_at,
      jsonb_agg(jsonb_build_object(
        'id', topic.topic_id,
        'name', topic.topic_name,
        'avg_gain_per_attempt', round(topic.avg_gain_per_attempt::numeric, 4),
        'fast_count', topic.fast_count,
        'average_count', topic.average_count,
        'slow_count', topic.slow_count,
        'insufficient_count', topic.insufficient_count,
        'concepts', topic.concepts
      ) ORDER BY topic.topic_id) AS topics
    FROM public.curriculum_chapters c
    JOIN topic ON topic.chapter_id = c.id
    GROUP BY c.id, c.chapter_name, c.unit_id
  ),
  subject AS (
    SELECT
      b.id AS book_id, b.subject, b.class_name, b.curriculum,
      AVG(chapter.avg_gain_per_attempt) AS avg_gain_per_attempt,
      SUM(chapter.fast_count) AS fast_count,
      SUM(chapter.average_count) AS average_count,
      SUM(chapter.slow_count) AS slow_count,
      SUM(chapter.insufficient_count) AS insufficient_count,
      MAX(chapter.last_evidence_at) AS last_evidence_at,
      jsonb_agg(jsonb_build_object(
        'id', chapter.chapter_id,
        'name', chapter.chapter_name,
        'avg_gain_per_attempt', round(chapter.avg_gain_per_attempt::numeric, 4),
        'fast_count', chapter.fast_count,
        'average_count', chapter.average_count,
        'slow_count', chapter.slow_count,
        'insufficient_count', chapter.insufficient_count,
        'topics', chapter.topics
      ) ORDER BY chapter.chapter_id) AS chapters
    FROM public.books b
    JOIN public.units u ON u.book_id = b.id
    JOIN chapter ON chapter.unit_id = u.id
    WHERE (p_book_id IS NULL OR b.id = p_book_id)
    GROUP BY b.id, b.subject, b.class_name, b.curriculum
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'book_id', subject.book_id,
    'subject', subject.subject,
    'class_name', subject.class_name,
    'curriculum', subject.curriculum,
    'avg_gain_per_attempt', round(subject.avg_gain_per_attempt::numeric, 4),
    'pace_label', CASE
      WHEN subject.avg_gain_per_attempt IS NULL THEN 'insufficient_data'
      WHEN subject.avg_gain_per_attempt >= 0.20 THEN 'fast'
      WHEN subject.avg_gain_per_attempt >= 0.08 THEN 'average'
      ELSE 'slow'
    END,
    'fast_count', subject.fast_count,
    'average_count', subject.average_count,
    'slow_count', subject.slow_count,
    'insufficient_count', subject.insufficient_count,
    'last_evidence_at', subject.last_evidence_at,
    'chapters', subject.chapters
  ) ORDER BY subject.subject), '[]'::jsonb)
  FROM subject;
$$;

-- ---------------------------------------------------------------------------
-- 7. ROLLUP: get_class_velocity() - teacher view, mirrors get_class_mastery()
--    (module 1). Flags "pace concern" topics (class avg gain/attempt < 0.08)
--    - a DIFFERENT signal from get_class_mastery's weak spots: a topic can
--    have fine average mastery built up over many attempts yet still show a
--    slow per-attempt pace, and vice versa. Also ranks students by overall
--    pace so a teacher can see who needs more time vs who could move faster.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_class_velocity(
  p_student_ids uuid[],
  p_book_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_student AS (
    SELECT sid AS student_id, public.get_student_velocity_tree(sid, p_book_id) AS tree
    FROM unnest(p_student_ids) AS sid
  ),
  topic_rows AS (
    SELECT
      per_student.student_id,
      chap->>'id' AS chapter_id,
      chap->>'name' AS chapter_name,
      topic->>'id' AS topic_id,
      topic->>'name' AS topic_name,
      NULLIF(topic->>'avg_gain_per_attempt', '')::numeric AS avg_gain_per_attempt,
      COALESCE((topic->>'slow_count')::int, 0) AS slow_count,
      COALESCE((topic->>'fast_count')::int, 0) AS fast_count
    FROM per_student,
      jsonb_array_elements(tree) AS subj,
      jsonb_array_elements(subj->'chapters') AS chap,
      jsonb_array_elements(chap->'topics') AS topic
  ),
  -- One row per topic before the outer jsonb_agg (same nested-aggregate
  -- pitfall documented in get_class_mastery).
  topic_stats AS (
    SELECT
      chapter_id, chapter_name, topic_id, topic_name,
      round(AVG(avg_gain_per_attempt), 4) AS class_avg_gain_per_attempt,
      COUNT(*) FILTER (WHERE avg_gain_per_attempt IS NOT NULL) AS students_with_data,
      COUNT(*) AS students_total,
      SUM(slow_count) AS students_slow_pace,
      SUM(fast_count) AS students_fast_pace,
      (AVG(avg_gain_per_attempt) < 0.08) AS is_pace_concern
    FROM topic_rows
    GROUP BY chapter_id, chapter_name, topic_id, topic_name
  ),
  student_rows AS (
    SELECT
      per_student.student_id,
      NULLIF(topic->>'avg_gain_per_attempt', '')::numeric AS avg_gain_per_attempt
    FROM per_student,
      jsonb_array_elements(tree) AS subj,
      jsonb_array_elements(subj->'chapters') AS chap,
      jsonb_array_elements(chap->'topics') AS topic
  ),
  student_stats AS (
    SELECT
      student_id,
      round(AVG(avg_gain_per_attempt), 4) AS overall_avg_gain_per_attempt
    FROM student_rows
    GROUP BY student_id
  )
  SELECT jsonb_build_object(
    'topics', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chapter_id', chapter_id,
        'chapter_name', chapter_name,
        'topic_id', topic_id,
        'topic_name', topic_name,
        'class_avg_gain_per_attempt', class_avg_gain_per_attempt,
        'students_with_data', students_with_data,
        'students_total', students_total,
        'students_slow_pace', students_slow_pace,
        'students_fast_pace', students_fast_pace,
        'is_pace_concern', COALESCE(is_pace_concern, false)
      ))
      FROM topic_stats
    ), '[]'::jsonb),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', student_id,
        'overall_avg_gain_per_attempt', overall_avg_gain_per_attempt,
        'pace_label', CASE
          WHEN overall_avg_gain_per_attempt IS NULL THEN 'insufficient_data'
          WHEN overall_avg_gain_per_attempt >= 0.20 THEN 'fast'
          WHEN overall_avg_gain_per_attempt >= 0.08 THEN 'average'
          ELSE 'slow'
        END
      ) ORDER BY overall_avg_gain_per_attempt NULLS LAST)
      FROM student_stats
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 8. RLS - same shape as student_mastery / mastery_evidence_log (module 1):
--    reads for owner + teacher/admin; all writes go through the
--    SECURITY DEFINER trigger path, never direct inserts from client roles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_velocity_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to velocity snapshots" ON public.student_velocity_snapshots FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Teachers can read velocity snapshots" ON public.student_velocity_snapshots FOR SELECT
  USING (public.get_user_role(auth.uid()) = 'teacher');

CREATE POLICY "Students can read own velocity snapshots" ON public.student_velocity_snapshots FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

GRANT EXECUTE ON FUNCTION public.get_student_velocity_tree(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_velocity(uuid[], bigint) TO authenticated;
