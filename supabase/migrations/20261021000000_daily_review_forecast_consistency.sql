-- 20261021000000_daily_review_forecast_consistency.sql
--
-- Daily Review showed "3 overdue / 3 due today" above a "Nothing due right now" message.
-- Two causes, both in get_review_forecast():
--
--  1. It counted EVERY schedule row, but the queue (get_due_reviews) only serves objectives that are
--     active, sit in a complete curriculum chain, AND have at least one active MCQ in question_bank.
--     An objective that was scheduled from other evidence (e.g. a written exam answer, homework,
--     the AI tutor) but has no MCQ to practise with was counted yet never served.
--  2. Its buckets overlapped: "overdue" (due_at <= now) was also counted in "due today" (same
--     calendar date) and "due today" again in "next 7 days".
--
-- Now the forecast uses exactly the same eligibility rules as the queue, and the buckets are
-- mutually exclusive:
--     due_now           ready to review right now
--     due_today         becomes due later today
--     due_next_7_days   becomes due after today, within the next 7 days
-- It also reports the two things the page needs to explain an empty queue honestly:
--     due_without_questions   due, but no MCQ exists yet to practise with
--     next_due_at             the next time something becomes reviewable
--
-- get_review_forecast was SECURITY INVOKER (relying on review_schedule RLS). Checking whether a
-- practice question exists needs question_bank, which students cannot read, so it becomes SECURITY
-- DEFINER with an explicit access check (own data, staff roles, or the service role).
-- get_due_reviews() is NOT touched - Learning Path and Adaptive Homework also use it.

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
