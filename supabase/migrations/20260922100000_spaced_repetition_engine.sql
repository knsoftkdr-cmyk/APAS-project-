-- ============================================================================
-- SPACED REPETITION ENGINE
--
--   mastery_evidence_log (Mastery Engine 2.0, BKT)
--        └── trigger: schedule_next_review()
--                          └── review_schedule   one row per (student, LO)
--                                                 SM-2 ease/interval/due_at
--
-- Additive only. It does not modify mastery_evidence_log, student_mastery,
-- learning_objectives or question_bank, except one non-breaking ALTER to
-- widen mastery_evidence_log.source's allowed values (adds 'spaced_review').
--
-- HOW IT PLUGS IN
--   Every graded attempt already flows through record_mastery_evidence()
--   (called by update-mastery, apply_cat_response, the AI tutor, etc.) and
--   lands a row in mastery_evidence_log. A trigger on that table is the only
--   integration point this engine needs: it fires for every source (mcq,
--   homework, ai_tutor, diagnostic, worksheet, manual, spaced_review) and
--   reschedules that learning objective's next review — so nothing that
--   already calls record_mastery_evidence() needs to change.
--
--   "Quality of recall" (SM-2's 0-5 input) is derived, not self-rated: it
--   uses is_correct plus the mastery band the student was in *before*
--   answering (reusing the same 0.85 / 0.60 / 0.35 thresholds already used
--   for mastery_status labels), so an easy correct answer on something
--   already mastered counts as a confident recall, while a miss on
--   something thought-to-be-known counts as a lapse.
--
-- SECURITY MODEL (mirrors the IRT/CAT engine)
--   * get_due_reviews() must join question_bank (which holds the answer
--     key and has no student SELECT policy), so it runs SECURITY DEFINER
--     and is locked to service_role - only the spaced-repetition edge
--     function may call it, after verifying the caller owns p_student_id.
--   * review_schedule itself carries normal RLS (students read own, staff
--     read all); all writes happen through the trigger or through
--     reschedule_review(), never directly from the browser.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Widen the evidence source vocabulary to include review-driven answers.
-- ---------------------------------------------------------------------------
ALTER TABLE public.mastery_evidence_log DROP CONSTRAINT IF EXISTS mastery_evidence_log_source_check;
ALTER TABLE public.mastery_evidence_log ADD CONSTRAINT mastery_evidence_log_source_check
  CHECK (source IN ('mcq','homework','worksheet','ai_tutor','diagnostic','manual','spaced_review'));

-- ---------------------------------------------------------------------------
-- 1. REVIEW SCHEDULE (current SM-2 state per student per learning objective)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  learning_objective_id bigint NOT NULL REFERENCES public.learning_objectives(id) ON DELETE CASCADE,

  ease_factor numeric NOT NULL DEFAULT 2.5 CHECK (ease_factor >= 1.3),
  interval_days int NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  repetitions int NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  lapses int NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  last_quality int CHECK (last_quality BETWEEN 0 AND 5),

  last_reviewed_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),
  suspended boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, learning_objective_id)
);

CREATE INDEX IF NOT EXISTS idx_review_schedule_due
  ON public.review_schedule(student_id, due_at) WHERE suspended = false;
CREATE INDEX IF NOT EXISTS idx_review_schedule_objective ON public.review_schedule(learning_objective_id);

-- ---------------------------------------------------------------------------
-- 2. CORE ENGINE: schedule_next_review()
--    Fires after every mastery_evidence_log insert. Classic SM-2: a lapse
--    (quality < 3) resets the repetition ladder back to a 1-day interval;
--    a successful recall advances it (1 -> 6 -> interval * ease_factor) and
--    nudges the ease factor up or down depending on how comfortable the
--    recall was.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_next_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quality int;
  v_existing public.review_schedule%ROWTYPE;
  v_ef numeric;
  v_reps int;
  v_interval int;
BEGIN
  IF NEW.is_correct THEN
    v_quality := CASE
      WHEN NEW.p_mastery_before >= 0.85 THEN 5   -- confidently known, correct
      WHEN NEW.p_mastery_before >= 0.60 THEN 4   -- solid, correct
      ELSE 3                                      -- correct despite a shaky prior (possible guess)
    END;
  ELSE
    v_quality := CASE
      WHEN NEW.p_mastery_before >= 0.60 THEN 2   -- unexpected miss on something thought-known: a lapse
      WHEN NEW.p_mastery_before >= 0.35 THEN 1
      ELSE 0                                      -- not known at all yet
    END;
  END IF;

  SELECT * INTO v_existing
  FROM public.review_schedule
  WHERE student_id = NEW.student_id AND learning_objective_id = NEW.learning_objective_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_ef := 2.5;
    v_reps := 0;
  ELSE
    v_ef := v_existing.ease_factor;
    v_reps := v_existing.repetitions;
  END IF;

  IF v_quality < 3 THEN
    v_reps := 0;
    v_interval := 1;
  ELSE
    v_reps := v_reps + 1;
    v_interval := CASE v_reps
      WHEN 1 THEN 1
      WHEN 2 THEN 6
      ELSE GREATEST(1, ROUND(COALESCE(v_existing.interval_days, 1) * v_ef))
    END;
  END IF;

  -- SM-2 ease-factor update, clamped so a bad run can't push it below 1.3.
  v_ef := GREATEST(1.3, v_ef + (0.1 - (5 - v_quality) * (0.08 + (5 - v_quality) * 0.02)));

  INSERT INTO public.review_schedule AS rs
    (student_id, learning_objective_id, ease_factor, interval_days, repetitions, lapses,
     last_quality, last_reviewed_at, due_at, updated_at)
  VALUES
    (NEW.student_id, NEW.learning_objective_id, v_ef, v_interval, v_reps,
     CASE WHEN v_quality < 3 THEN 1 ELSE 0 END,
     v_quality, NEW.responded_at, NEW.responded_at + make_interval(days => v_interval), NEW.responded_at)
  ON CONFLICT (student_id, learning_objective_id) DO UPDATE SET
    ease_factor = v_ef,
    interval_days = v_interval,
    repetitions = v_reps,
    lapses = rs.lapses + CASE WHEN v_quality < 3 THEN 1 ELSE 0 END,
    last_quality = v_quality,
    last_reviewed_at = NEW.responded_at,
    due_at = NEW.responded_at + make_interval(days => v_interval),
    updated_at = NEW.responded_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_next_review ON public.mastery_evidence_log;
CREATE TRIGGER trg_schedule_next_review
AFTER INSERT ON public.mastery_evidence_log
FOR EACH ROW EXECUTE FUNCTION public.schedule_next_review();

-- ---------------------------------------------------------------------------
-- 3. get_due_reviews(student, limit, book?)
--    Due objectives (most overdue + weakest first), each paired with one
--    active question_bank item. SECURITY DEFINER because question_bank has
--    no student SELECT policy; locked to service_role below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_due_reviews(
  p_student_id uuid,
  p_limit int DEFAULT 20,
  p_book_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH due AS (
    SELECT
      rs.id AS schedule_id, rs.learning_objective_id, rs.due_at, rs.interval_days,
      rs.repetitions, rs.ease_factor, rs.lapses, rs.last_reviewed_at,
      lo.objective_text, lo.difficulty, lo.bloom_level,
      st.id AS subtopic_id, st.subtopic_name,
      t.id AS topic_id, t.topic_name,
      c.chapter_name, u.book_id,
      b.subject, b.class_name,
      COALESCE(sm.p_mastery, bp.p_init, 0.30) AS p_mastery,
      GREATEST(0, EXTRACT(EPOCH FROM (now() - rs.due_at)) / 86400) AS days_overdue
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
      AND rs.due_at <= now()
      AND (p_book_id IS NULL OR u.book_id = p_book_id)
  ),
  ranked AS (
    SELECT d.*, ROW_NUMBER() OVER (ORDER BY days_overdue DESC, p_mastery ASC) AS rn
    FROM due d
  ),
  with_item AS (
    SELECT r.*, (
      SELECT jsonb_build_object(
        'item_id', q.id, 'stem', q.stem, 'options', q.options, 'bloom_level', q.bloom_level
      )
      FROM public.question_bank q
      WHERE q.learning_objective_id = r.learning_objective_id AND q.status = 'active'
      ORDER BY random()
      LIMIT 1
    ) AS item
    FROM ranked r
    WHERE r.rn <= GREATEST(1, p_limit)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schedule_id', schedule_id,
    'learning_objective_id', learning_objective_id,
    'objective_text', objective_text,
    'difficulty', difficulty,
    'subtopic_id', subtopic_id, 'subtopic_name', subtopic_name,
    'topic_id', topic_id, 'topic_name', topic_name,
    'chapter_name', chapter_name,
    'subject', subject, 'class_name', class_name,
    'p_mastery', round(p_mastery::numeric, 3),
    'due_at', due_at,
    'days_overdue', round(days_overdue::numeric, 1),
    'repetitions', repetitions,
    'lapses', lapses,
    'ease_factor', round(ease_factor::numeric, 2),
    'item', item
  ) ORDER BY days_overdue DESC), '[]'::jsonb)
  FROM with_item
  WHERE item IS NOT NULL;  -- skip LOs with no active item to serve
$$;

-- ---------------------------------------------------------------------------
-- 4. get_review_forecast(student) — dashboard counts. Plain SECURITY INVOKER:
--    review_schedule's own RLS (below) already scopes reads to the caller's
--    own rows or staff, so no student-spoofing risk in leaving this open to
--    authenticated callers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_review_forecast(p_student_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH buckets AS (
    SELECT
      COUNT(*) FILTER (WHERE due_at <= now()) AS due_now,
      COUNT(*) FILTER (WHERE due_at::date = CURRENT_DATE) AS due_today,
      COUNT(*) FILTER (WHERE due_at > now() AND due_at < now() + interval '7 days') AS due_next_7_days,
      COUNT(*) AS total_scheduled,
      COUNT(*) FILTER (WHERE interval_days >= 21) AS long_retention_count,
      COUNT(*) FILTER (WHERE last_quality < 3 AND last_reviewed_at > now() - interval '7 days') AS recent_lapses,
      MAX(last_reviewed_at) AS last_reviewed_at
    FROM public.review_schedule
    WHERE student_id = p_student_id AND suspended = false
  )
  SELECT jsonb_build_object(
    'due_now', due_now,
    'due_today', due_today,
    'due_next_7_days', due_next_7_days,
    'total_scheduled', total_scheduled,
    'long_retention_count', long_retention_count,
    'recent_lapses', recent_lapses,
    'last_reviewed_at', last_reviewed_at
  )
  FROM buckets;
$$;

-- ---------------------------------------------------------------------------
-- 5. reschedule_review(student, LO, days) — manual snooze / "remind me
--    later". SECURITY DEFINER + service-role-only, same as the write path
--    above; the edge function checks the caller owns p_student_id (or is
--    staff) before calling it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_review(
  p_student_id uuid,
  p_learning_objective_id bigint,
  p_days int
)
RETURNS TABLE (due_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.review_schedule rs
  SET due_at = now() + make_interval(days => GREATEST(1, p_days)), updated_at = now()
  WHERE rs.student_id = p_student_id AND rs.learning_objective_id = p_learning_objective_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_schedule_not_found';
  END IF;

  RETURN QUERY
  SELECT rs.due_at FROM public.review_schedule rs
  WHERE rs.student_id = p_student_id AND rs.learning_objective_id = p_learning_objective_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.review_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to review schedule" ON public.review_schedule;
CREATE POLICY "Admins full access to review schedule" ON public.review_schedule FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read review schedule" ON public.review_schedule;
CREATE POLICY "Staff read review schedule" ON public.review_schedule FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own review schedule" ON public.review_schedule;
CREATE POLICY "Students read own review schedule" ON public.review_schedule FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. FUNCTION PRIVILEGES
--    Same reasoning as the CAT engine: get_due_reviews() and
--    reschedule_review() trust their p_student_id argument and/or read
--    question_bank, so only the service role (i.e. the spaced-repetition
--    edge function, after its own auth check) may call them.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_due_reviews(uuid, int, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_review(uuid, bigint, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_reviews(uuid, int, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_review(uuid, bigint, int) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_review_forecast(uuid) TO authenticated;
