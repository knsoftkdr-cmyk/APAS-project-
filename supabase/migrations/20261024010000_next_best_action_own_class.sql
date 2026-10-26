-- ============================================================================
-- Also fixes `column b.id does not exist` (book_lo read student_books.id; the column is book_id).
-- What's Next: only recommend subjects from the student's OWN class (and school).
-- Before, every active book in the database was a candidate (all classes, all schools).
-- ============================================================================

-- "Class 4", "class 4", "Grade 4", "4", "4th", "IV" -> "4" (same rules as src/lib/Classsubjects.ts classKey()).
CREATE OR REPLACE FUNCTION public.class_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $f$
  SELECT CASE x.s
    WHEN 'i' THEN '1' WHEN 'ii' THEN '2' WHEN 'iii' THEN '3' WHEN 'iv' THEN '4' WHEN 'v' THEN '5'
    WHEN 'vi' THEN '6' WHEN 'vii' THEN '7' WHEN 'viii' THEN '8' WHEN 'ix' THEN '9' WHEN 'x' THEN '10'
    WHEN 'xi' THEN '11' WHEN 'xii' THEN '12'
    ELSE x.s
  END
  FROM (
    SELECT regexp_replace(
             regexp_replace(
               regexp_replace(lower(COALESCE(raw, '')), '\m(class|grade|std|standard)\M\.?', '', 'g'),
               '\s+', '', 'g'),
             '^(\d+)(st|nd|rd|th)$', '\1') AS s
  ) x
$f$;

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
  v_class_key text;
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

  -- The student's own class: enrolment first, then the students / profiles record.
  SELECT public.class_key(COALESCE(
           (SELECT c.name FROM public.class_students cs JOIN public.classes c ON c.id = cs.class_id
             WHERE cs.student_id = s.id ORDER BY cs.assigned_at DESC LIMIT 1),
           NULLIF(btrim(s.grade), ''), NULLIF(btrim(p.class_grade), '')))
    INTO v_class_key
  FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = p_student_id;

  IF v_class_key IS NULL OR v_class_key = '' THEN
    RETURN jsonb_build_object(
      'has_recommendation', false,
      'message', 'We couldn''t find your class yet. Please ask your school admin to assign you to a class.',
      'generated_at', now()
    );
  END IF;

  -- ── Score every candidate subject ───────────────────────────────────────
  WITH student_books AS (
    -- Only this student's class (and school); one book per subject (the one with the most curriculum).
    SELECT DISTINCT ON (lower(btrim(b.subject))) b.id AS book_id, b.subject, b.class_name
    FROM public.books b
    WHERE b.is_active = true
      AND b.subject IS NOT NULL
      AND public.class_key(b.class_name) = v_class_key
      AND (
        (SELECT p2.school_id FROM public.students s2 JOIN public.profiles p2 ON p2.id = s2.profile_id WHERE s2.id = p_student_id) IS NULL
        OR b.school_id = (SELECT p2.school_id FROM public.students s2 JOIN public.profiles p2 ON p2.id = s2.profile_id WHERE s2.id = p_student_id)
      )
    ORDER BY lower(btrim(b.subject)),
      (SELECT COUNT(*) FROM public.units u2 JOIN public.curriculum_chapters c2 ON c2.unit_id = u2.id
         JOIN public.topics t2 ON t2.chapter_id = c2.id WHERE u2.book_id = b.id) DESC,
      b.id
  ),
  book_lo AS (
    SELECT b.book_id AS book_id, lo.id AS learning_objective_id
    FROM student_books b
    JOIN public.units u ON u.book_id = b.book_id
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
      'message', 'No subjects have been set up for your class yet.',
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
