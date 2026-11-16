-- Exam proctoring (browser-based): while a student sits an online exam (/exam/:assignmentId), the exam page records
-- integrity events - leaving the exam tab, switching to another window, leaving full screen, copy/paste and
-- right-click. Each event is logged with how long the student was away, and the attempt keeps a running summary the
-- teacher sees in Assessments > Proctoring.
--
-- Nothing is recorded outside an open exam, and no camera or screen images are taken.
-- Students can only log events for their OWN attempt while it is in progress (log_exam_integrity_event, SECURITY
-- DEFINER). Students can't read or delete the log. Staff read it under the same rule as the attempts themselves.

BEGIN;

ALTER TABLE public.generated_assessment_paper_attempts
  ADD COLUMN IF NOT EXISTS integrity_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS integrity_event_count int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.exam_integrity_events (
  id bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES public.generated_assessment_paper_attempts(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('tab_hidden','window_blur','fullscreen_exit','copy_paste','right_click')),
  away_seconds int CHECK (away_seconds IS NULL OR away_seconds BETWEEN 0 AND 86400),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exam_integrity_events_attempt ON public.exam_integrity_events(attempt_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_paper_attempts_integrity ON public.generated_assessment_paper_attempts(integrity_event_count) WHERE integrity_event_count > 0;

ALTER TABLE public.exam_integrity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read exam integrity events" ON public.exam_integrity_events;
CREATE POLICY "Staff read exam integrity events" ON public.exam_integrity_events FOR SELECT
  USING (public.get_user_role(auth.uid()) IN ('admin','teacher','hod','principal','school_admin'));
-- No insert/update/delete policies: writes go through log_exam_integrity_event only.

CREATE OR REPLACE FUNCTION public.log_exam_integrity_event(p_attempt_id uuid, p_event text, p_away_seconds int DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student uuid;
  v_attempt public.generated_assessment_paper_attempts%ROWTYPE;
  v_away int := CASE WHEN p_away_seconds IS NULL THEN NULL ELSE LEAST(GREATEST(p_away_seconds, 0), 86400) END;
  v_summary jsonb;
BEGIN
  IF p_event NOT IN ('tab_hidden','window_blur','fullscreen_exit','copy_paste','right_click') THEN
    RAISE EXCEPTION 'Unknown integrity event.';
  END IF;

  SELECT id INTO v_student FROM public.students WHERE profile_id = auth.uid() LIMIT 1;
  IF v_student IS NULL THEN RAISE EXCEPTION 'Only students can log exam events.'; END IF;

  SELECT * INTO v_attempt FROM public.generated_assessment_paper_attempts
   WHERE id = p_attempt_id AND student_id = v_student
   FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This exam is not open.';
  END IF;

  -- A runaway client can't flood the log.
  IF v_attempt.integrity_event_count >= 500 THEN
    RETURN v_attempt.integrity_event_count;
  END IF;

  INSERT INTO public.exam_integrity_events(attempt_id, student_id, event_type, away_seconds)
  VALUES (p_attempt_id, v_student, p_event, v_away);

  v_summary := COALESCE(v_attempt.integrity_summary, '{}'::jsonb);
  v_summary := jsonb_set(v_summary, ARRAY[p_event], to_jsonb(COALESCE((v_summary->>p_event)::int, 0) + 1));
  IF v_away IS NOT NULL THEN
    v_summary := jsonb_set(v_summary, ARRAY['away_seconds'], to_jsonb(COALESCE((v_summary->>'away_seconds')::int, 0) + v_away));
  END IF;

  UPDATE public.generated_assessment_paper_attempts
     SET integrity_summary = v_summary,
         integrity_event_count = v_attempt.integrity_event_count + 1
   WHERE id = p_attempt_id;

  RETURN v_attempt.integrity_event_count + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.log_exam_integrity_event(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_exam_integrity_event(uuid, text, int) TO authenticated;

COMMIT;
