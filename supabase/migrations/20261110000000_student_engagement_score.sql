-- Student Engagement Score.
--
-- Reuses existing activity data (learning_events, homework/worksheet submissions, paper attempts, live-class
-- attendance, classroom questions). This migration only adds:
--   engagement_settings       per-school configuration (weights, period, thresholds). No row = built-in defaults.
--   engagement_scores         the LATEST score per student (one row each) with the activity breakdown.
--   engagement_score_history  one snapshot per student per day, so trends can be shown.
--   engagement_recalc_queue   "this student has new activity" markers written by triggers; the edge function
--                             recalculates lazily (never per event), see handlers/engagementScore.ts.
--
-- Writes to scores / history / queue are service role only (the edge function). Reads are scoped by RLS:
--   student -> own row | teacher -> students on classes they teach | admin/principal/hod/school_admin -> own school.

-- ── helpers (SECURITY DEFINER avoids RLS recursion on profiles) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.engagement_caller_school()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.engagement_is_school_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role IN ('admin','principal','hod','school_admin') FROM public.profiles WHERE id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.engagement_teacher_can_see(p_student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_students cs
    JOIN public.class_teachers ct ON ct.class_id = cs.class_id
    WHERE cs.student_id = p_student AND ct.teacher_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.engagement_student_is_me(p_student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.students s WHERE s.id = p_student AND s.profile_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.engagement_caller_school() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.engagement_is_school_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.engagement_teacher_can_see(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.engagement_student_is_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.engagement_caller_school() TO authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_is_school_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_teacher_can_see(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_student_is_me(uuid) TO authenticated;

-- ── settings ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_settings (
  school_id  uuid PRIMARY KEY,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.engagement_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engagement_settings_read ON public.engagement_settings;
CREATE POLICY engagement_settings_read ON public.engagement_settings
  FOR SELECT TO authenticated
  USING (school_id = public.engagement_caller_school());

DROP POLICY IF EXISTS engagement_settings_write ON public.engagement_settings;
CREATE POLICY engagement_settings_write ON public.engagement_settings
  FOR ALL TO authenticated
  USING (public.engagement_is_school_staff() AND school_id = public.engagement_caller_school())
  WITH CHECK (public.engagement_is_school_staff() AND school_id = public.engagement_caller_school());

-- ── latest score ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_scores (
  student_id      uuid PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  school_id       uuid,
  window_days     integer NOT NULL,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  status          text NOT NULL CHECK (status IN ('ok','insufficient')),
  score           numeric(5,1) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  category        text CHECK (category IN ('highly_engaged','moderately_engaged','low','very_low')),
  opportunities   integer NOT NULL DEFAULT 0,
  breakdown       jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_score  numeric(5,1),
  config_hash     text,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_scores_school ON public.engagement_scores (school_id, score);
CREATE INDEX IF NOT EXISTS idx_engagement_scores_computed ON public.engagement_scores (computed_at);

-- ── history: one snapshot per student per day (re-computation the same day overwrites it) ───────────
CREATE TABLE IF NOT EXISTS public.engagement_score_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id     uuid,
  snapshot_date date NOT NULL,
  window_days   integer NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok','insufficient')),
  score         numeric(5,1) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  category      text,
  breakdown     jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_engagement_history_student ON public.engagement_score_history (student_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_history_school ON public.engagement_score_history (school_id, snapshot_date DESC);

-- ── recalculation queue ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_recalc_queue (
  student_id   uuid PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  school_id    uuid,
  reason       text,
  requested_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.engagement_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_recalc_queue ENABLE ROW LEVEL SECURITY; -- no policies: service role only

DROP POLICY IF EXISTS engagement_scores_student ON public.engagement_scores;
CREATE POLICY engagement_scores_student ON public.engagement_scores
  FOR SELECT TO authenticated USING (public.engagement_student_is_me(student_id));
DROP POLICY IF EXISTS engagement_scores_teacher ON public.engagement_scores;
CREATE POLICY engagement_scores_teacher ON public.engagement_scores
  FOR SELECT TO authenticated USING (public.engagement_teacher_can_see(student_id));
DROP POLICY IF EXISTS engagement_scores_school_staff ON public.engagement_scores;
CREATE POLICY engagement_scores_school_staff ON public.engagement_scores
  FOR SELECT TO authenticated
  USING (public.engagement_is_school_staff() AND school_id IS NOT NULL AND school_id = public.engagement_caller_school());

DROP POLICY IF EXISTS engagement_history_student ON public.engagement_score_history;
CREATE POLICY engagement_history_student ON public.engagement_score_history
  FOR SELECT TO authenticated USING (public.engagement_student_is_me(student_id));
DROP POLICY IF EXISTS engagement_history_teacher ON public.engagement_score_history;
CREATE POLICY engagement_history_teacher ON public.engagement_score_history
  FOR SELECT TO authenticated USING (public.engagement_teacher_can_see(student_id));
DROP POLICY IF EXISTS engagement_history_school_staff ON public.engagement_score_history;
CREATE POLICY engagement_history_school_staff ON public.engagement_score_history
  FOR SELECT TO authenticated
  USING (public.engagement_is_school_staff() AND school_id IS NOT NULL AND school_id = public.engagement_caller_school());

-- ── indexes on the existing event table for the events the score reads ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_learning_events_engagement
  ON public.learning_events (student_id, occurred_at DESC)
  WHERE event_type IN ('video_progress', 'tutor_message');

-- ── automatic updates: mark a student "dirty" when new scoring activity is recorded ─────────────────
-- The trigger only upserts one tiny row; the expensive calculation happens lazily in the edge function the
-- next time that score is read (and at most once per cool-down), so a burst of events costs one recalculation.
CREATE OR REPLACE FUNCTION public.engagement_enqueue(p_student uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid;
BEGIN
  IF p_student IS NULL THEN RETURN; END IF;
  SELECT p.school_id INTO v_school
    FROM public.students s JOIN public.profiles p ON p.id = s.profile_id WHERE s.id = p_student;
  INSERT INTO public.engagement_recalc_queue (student_id, school_id, reason, requested_at)
  VALUES (p_student, v_school, p_reason, now())
  ON CONFLICT (student_id) DO UPDATE SET requested_at = now(), reason = EXCLUDED.reason;
END;
$$;
REVOKE ALL ON FUNCTION public.engagement_enqueue(uuid, text) FROM PUBLIC, anon, authenticated;

-- Trigger body. TG_ARGV[0] = reason; TG_ARGV[1] = which column holds the student: 'student' (students.id) or
-- 'profile' (profiles.id, mapped through students.profile_id). It never raises: a scoring hiccup must not
-- be able to break a student's submission.
CREATE OR REPLACE FUNCTION public.engagement_mark_dirty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_id uuid;
  v_student uuid;
BEGIN
  BEGIN
    v_id := NULLIF(v_row ->> TG_ARGV[2], '')::uuid;
    IF TG_ARGV[1] = 'profile' THEN
      SELECT id INTO v_student FROM public.students WHERE profile_id = v_id LIMIT 1;
    ELSE
      v_student := v_id;
    END IF;
    PERFORM public.engagement_enqueue(v_student, TG_ARGV[0]);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'engagement_mark_dirty skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.engagement_mark_dirty() FROM PUBLIC, anon, authenticated;

-- Attach to each source table that exists in this database (skips quietly where one does not).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    -- table, trigger name, reason, student column kind, student column
    ('homework_submissions',                  'trg_engagement_homework',   'homework',   'profile', 'student_id'),
    ('worksheet_submissions',                 'trg_engagement_worksheet',  'worksheet',  'profile', 'student_id'),
    ('generated_assessment_paper_attempts',   'trg_engagement_quiz',       'quiz',       'student', 'student_id'),
    ('virtual_classroom_attendance',          'trg_engagement_live_class', 'live_class', 'student', 'student_id'),
    ('classroom_posts',                       'trg_engagement_doubt_post', 'doubt',      'profile', 'author_id')
  ) AS v(tbl, trg, reason, kind, col)
  LOOP
    IF to_regclass('public.' || t.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.trg, t.tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.engagement_mark_dirty(%L, %L, %L)',
        t.trg, t.tbl, t.reason, t.kind, t.col);
    END IF;
  END LOOP;

  -- learning_events: only the event types the score reads (heartbeats and page views are ignored on purpose).
  IF to_regclass('public.learning_events') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_engagement_learning_events ON public.learning_events;
    CREATE TRIGGER trg_engagement_learning_events
      AFTER INSERT ON public.learning_events
      FOR EACH ROW
      WHEN (NEW.event_type IN ('video_progress', 'tutor_message'))
      EXECUTE FUNCTION public.engagement_mark_dirty('learning_event', 'student', 'student_id');
  END IF;
END $$;

-- ── retention (not scheduled here; add a pg_cron job if wanted) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_engagement_history(p_keep_days integer DEFAULT 730)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v integer;
BEGIN
  DELETE FROM public.engagement_score_history WHERE snapshot_date < current_date - GREATEST(p_keep_days, 90);
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_engagement_history(integer) FROM PUBLIC, anon, authenticated;
