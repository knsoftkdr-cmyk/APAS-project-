-- ============================================================================
-- NEXT BEST LEARNING ACTION ENGINE (module 9)
--
--   Module 8 (Learning Path Generator) answers "what should I do next in
--   Biology" — you pick the subject, it sequences within it.
--   Module 9 answers "I've got 15 minutes right now — out of EVERYTHING,
--   across every subject, what's the single most important thing to do?"
--
-- It is a thin arbiter, not a new sequencer: it scores every subject the
-- student has any footprint in (or, for a brand-new student, every active
-- subject) using the same signals modules 6/7/2 already expose, picks the
-- most urgent one, and delegates the actual step-by-step sequencing to
-- generate_learning_path() from module 8 - then trims that sequence to fit
-- a time budget and promotes its first item to a single, justified
-- "next_action". No grading logic is duplicated: the returned steps are the
-- exact same shape module 8 produces, so they're graded through the
-- existing learning-path edge function's `answer` action.
--
--   review_schedule (6) ─┐
--   forgetting forecast(7)├─> per-subject urgency score ─> winning subject(s)
--   at-risk concepts (2) ─┘         │
--                                   v
--                     generate_learning_path() (8)  -> time-boxed queue
--                                   │
--                                   v
--                       next_action + session_plan + alternates
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. AUDIT LOG (mirrors learning_path_log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.next_best_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  book_id bigint REFERENCES public.books(id) ON DELETE SET NULL,
  recommendation jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_next_best_action_log_student ON public.next_best_action_log(student_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- 2. get_next_best_action(student, minutes_available?, max_steps?)
--    SECURITY DEFINER (calls generate_learning_path, which itself joins
--    question_bank); locked to service_role below, same as module 8.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_next_best_action(
  p_student_id uuid,
  p_minutes_available int DEFAULT 15,
  p_max_steps int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_any_engagement boolean;
  v_top_book bigint;
  v_scored jsonb;
  v_top_scored jsonb;
  v_alternates jsonb;
  v_path jsonb;
  v_session_plan jsonb := '[]'::jsonb;
  v_minutes_used numeric := 0;
  v_step_minutes numeric;
  v_step jsonb;
  v_result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.student_mastery sm WHERE sm.student_id = p_student_id AND sm.opportunities_count > 0
  ) INTO v_has_any_engagement;

  -- ── Score every candidate subject ───────────────────────────────────────
  WITH student_books AS (
    SELECT b.id AS book_id, b.subject, b.class_name
    FROM public.books b
    WHERE b.is_active = true
      AND (
        NOT v_has_any_engagement -- cold start: nothing to compare yet, consider everything
        OR EXISTS (
          SELECT 1 FROM public.units u JOIN public.curriculum_chapters c ON c.unit_id = u.id
          JOIN public.topics t ON t.chapter_id = c.id JOIN public.subtopics st ON st.topic_id = t.id
          JOIN public.learning_objectives lo ON lo.subtopic_id = st.id
          JOIN public.student_mastery sm ON sm.learning_objective_id = lo.id
            AND sm.student_id = p_student_id AND sm.opportunities_count > 0
          WHERE u.book_id = b.id
        )
      )
  ),
  book_lo AS (
    SELECT b.id AS book_id, lo.id AS learning_objective_id
    FROM student_books b
    JOIN public.units u ON u.book_id = b.id
    JOIN public.curriculum_chapters c ON c.unit_id = u.id
    JOIN public.topics t ON t.chapter_id = c.id
    JOIN public.subtopics st ON st.topic_id = t.id
    JOIN public.learning_objectives lo ON lo.subtopic_id = st.id AND lo.status = 'active'
  ),
  overdue AS (
    SELECT bl.book_id, COUNT(*) AS overdue_count
    FROM book_lo bl
    JOIN public.review_schedule rs ON rs.learning_objective_id = bl.learning_objective_id
      AND rs.student_id = p_student_id AND rs.suspended = false AND rs.due_at <= now()
    GROUP BY bl.book_id
  ),
  at_risk AS (
    SELECT sb.book_id,
      COUNT(*) FILTER (WHERE (f->>'is_at_risk')::boolean) AS at_risk_count,
      MIN((f->>'days_until_forgotten')::numeric) FILTER (WHERE (f->>'is_at_risk')::boolean) AS soonest_forget_days
    FROM student_books sb
    CROSS JOIN LATERAL jsonb_array_elements(public.get_forgetting_forecast(p_student_id, 0.5, 14, sb.book_id)) AS f
    GROUP BY sb.book_id
  ),
  blocked AS (
    SELECT sb.book_id, jsonb_array_length(public.get_at_risk_concepts(p_student_id, sb.book_id)) AS blocked_count
    FROM student_books sb
  ),
  scored AS (
    SELECT
      sb.book_id, sb.subject, sb.class_name,
      COALESCE(o.overdue_count, 0) AS overdue_count,
      COALESCE(ar.at_risk_count, 0) AS at_risk_count,
      COALESCE(ar.soonest_forget_days, 999) AS soonest_forget_days,
      COALESCE(bk.blocked_count, 0) AS blocked_count,
      -- Overdue reviews and imminent forgetting dominate (cheap to fix, costly
      -- to ignore); blocked/weak concepts add steady secondary pressure.
      ROUND((
        COALESCE(o.overdue_count, 0) * 3
        + COALESCE(ar.at_risk_count, 0) * 2
        + COALESCE(bk.blocked_count, 0) * 1.5
        + GREATEST(0, 14 - LEAST(COALESCE(ar.soonest_forget_days, 14), 14)) * 0.5
      )::numeric, 2) AS urgency_score
    FROM student_books sb
    LEFT JOIN overdue o ON o.book_id = sb.book_id
    LEFT JOIN at_risk ar ON ar.book_id = sb.book_id
    LEFT JOIN blocked bk ON bk.book_id = sb.book_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'book_id', book_id, 'subject', subject, 'class_name', class_name,
      'urgency_score', urgency_score,
      'overdue_count', overdue_count, 'at_risk_count', at_risk_count,
      'blocked_count', blocked_count,
      'soonest_forget_days', CASE WHEN soonest_forget_days < 999 THEN round(soonest_forget_days, 1) ELSE NULL END
    ) ORDER BY urgency_score DESC, book_id), '[]'::jsonb)
  INTO v_scored
  FROM scored;

  IF jsonb_array_length(v_scored) = 0 THEN
    RETURN jsonb_build_object(
      'has_recommendation', false,
      'message', 'No active subjects found for this student yet.',
      'generated_at', now()
    );
  END IF;

  v_top_book := (v_scored->0->>'book_id')::bigint;
  v_top_scored := v_scored->0;

  -- All caught up everywhere: nothing urgent, so nudge towards new content
  -- instead of insisting on the (arbitrary) first book in the sorted list.
  IF (v_scored->0->>'urgency_score')::numeric = 0 THEN
    SELECT elem INTO v_top_scored
    FROM jsonb_array_elements(v_scored) elem
    ORDER BY random() -- no urgency signal to break ties with; keep it fresh rather than always the same subject
    LIMIT 1;
    v_top_book := (v_top_scored->>'book_id')::bigint;
  END IF;

  -- ── Delegate sequencing to the Learning Path Generator (module 8) ───────
  v_path := public.generate_learning_path(p_student_id, v_top_book, GREATEST(p_max_steps, 5));

  -- ── Time-box: keep steps until the estimated minutes run out ────────────
  FOR v_step IN SELECT * FROM jsonb_array_elements(v_path)
  LOOP
    EXIT WHEN jsonb_array_length(v_session_plan) >= p_max_steps;
    v_step_minutes := CASE v_step->>'step_type'
      WHEN 'review' THEN 1.5
      WHEN 'practice' THEN 2
      ELSE 3 -- remediate / learn: reading a new stem + explanation takes longer
    END;
    EXIT WHEN v_minutes_used > 0 AND v_minutes_used + v_step_minutes > p_minutes_available;
    v_session_plan := v_session_plan || jsonb_build_array(v_step);
    v_minutes_used := v_minutes_used + v_step_minutes;
  END LOOP;

  -- Always return at least one step (even if it slightly overshoots the
  -- budget) rather than an empty plan when something was actually due.
  IF jsonb_array_length(v_session_plan) = 0 AND jsonb_array_length(v_path) > 0 THEN
    v_session_plan := jsonb_build_array(v_path->0);
    v_minutes_used := CASE v_path->0->>'step_type' WHEN 'review' THEN 1.5 WHEN 'practice' THEN 2 ELSE 3 END;
  END IF;

  -- Runner-up subjects, for context ("X is getting urgent too") — the two
  -- highest-scoring subjects other than the one actually chosen above.
  SELECT COALESCE(jsonb_agg(ranked.e), '[]'::jsonb) INTO v_alternates
  FROM (
    SELECT e FROM jsonb_array_elements(v_scored) e
    WHERE (e->>'book_id')::bigint <> v_top_book
    ORDER BY (e->>'urgency_score')::numeric DESC
    LIMIT 2
  ) ranked;

  v_result := jsonb_build_object(
    'has_recommendation', jsonb_array_length(v_session_plan) > 0,
    'primary_subject', v_top_scored,
    'next_action', CASE WHEN jsonb_array_length(v_session_plan) > 0 THEN v_session_plan->0 ELSE NULL END,
    'why_this_subject', CASE
      WHEN (v_top_scored->>'overdue_count')::int > 0
        THEN format('%s review(s) overdue in %s', v_top_scored->>'overdue_count', v_top_scored->>'subject')
      WHEN (v_top_scored->>'at_risk_count')::int > 0
        THEN format('%s concept(s) in %s predicted to be forgotten soon', v_top_scored->>'at_risk_count', v_top_scored->>'subject')
      WHEN (v_top_scored->>'blocked_count')::int > 0
        THEN format('%s concept(s) in %s are blocked on a weak prerequisite', v_top_scored->>'blocked_count', v_top_scored->>'subject')
      ELSE format('You''re caught up everywhere — %s has new material ready', v_top_scored->>'subject')
    END,
    'session_plan', v_session_plan,
    'estimated_minutes', v_minutes_used,
    'minutes_available', p_minutes_available,
    'alternates', v_alternates,
    'generated_at', now()
  );

  INSERT INTO public.next_best_action_log (student_id, book_id, recommendation)
  VALUES (p_student_id, v_top_book, v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS for the log
-- ---------------------------------------------------------------------------
ALTER TABLE public.next_best_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to next best action log" ON public.next_best_action_log;
CREATE POLICY "Admins full access to next best action log" ON public.next_best_action_log FOR ALL
  USING (public.get_user_role(auth.uid()) = 'admin')
  WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Staff read next best action log" ON public.next_best_action_log;
CREATE POLICY "Staff read next best action log" ON public.next_best_action_log FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('teacher','hod','principal','school_admin'));

DROP POLICY IF EXISTS "Students read own next best action log" ON public.next_best_action_log;
CREATE POLICY "Students read own next best action log" ON public.next_best_action_log FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. GRANTS — service_role only, same reasoning as generate_learning_path.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_next_best_action(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_best_action(uuid, int, int) TO service_role;
