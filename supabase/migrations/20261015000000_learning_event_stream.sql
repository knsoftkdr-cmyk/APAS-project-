-- Real-Time Learning Event Stream: one central, append-only table of student learning telemetry.
--
-- Written by:
--   * a trigger on mastery_evidence_log  -> every graded answer from EVERY flow (practice, homework,
--     daily review, adaptive test, exam paper, AI tutor, diagnostic) with no per-function wiring
--   * existing edge functions (service role) via _shared/learningEvents.ts: tutor, adaptive test,
--     exam paper, pronunciation
--   * the browser, only through get-mastery-history action `lel_ingest` (whitelisted types, sanitised)
-- Read through get-mastery-history actions `lel_stream` / `lel_summary`, which enforce who may see whom.
--
-- The app works without this migration: the endpoints answer `persistence: "unavailable"` and the UI says so.

CREATE TABLE IF NOT EXISTS public.learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id uuid,
  event_type text NOT NULL,
  source text,
  ref_id text,
  learning_objective_id bigint,
  is_correct boolean,
  score numeric,
  duration_seconds integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Makes retries / double submits harmless. NULLs are allowed (and not considered equal).
  dedupe_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_learning_events_student_created
  ON public.learning_events (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_student_occurred
  ON public.learning_events (student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_school_created
  ON public.learning_events (school_id, created_at DESC);

ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;

-- Students may read their OWN events directly. This exists so Supabase Realtime can push a student's own
-- events to their own browser (Realtime only delivers rows the subscriber may SELECT). Nobody can write
-- through the API: all writes are the service role or the SECURITY DEFINER trigger below.
-- Staff and parents get NO direct access; they read through the edge function, which scopes by class / child.
DROP POLICY IF EXISTS learning_events_student_read_own ON public.learning_events;
CREATE POLICY learning_events_student_read_own ON public.learning_events
  FOR SELECT TO authenticated
  USING (student_id IN (SELECT s.id FROM public.students s WHERE s.profile_id = auth.uid()));

-- Realtime publication (idempotent; skipped quietly where the publication does not exist).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'learning_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.learning_events;
  END IF;
END $$;

-- ── every graded answer becomes a `question_answered` event ───────────────────────────────────────────
-- record_mastery_evidence() is the single place all grading flows end up, and it logs to
-- mastery_evidence_log. Hooking that table captures all of them, including flows added later.
-- The body swallows its own errors: telemetry must never be able to break a student's answer.
CREATE OR REPLACE FUNCTION public.learning_events_from_mastery_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school uuid;
BEGIN
  BEGIN
    SELECT p.school_id INTO v_school
    FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
    WHERE s.id = NEW.student_id;

    INSERT INTO public.learning_events
      (student_id, school_id, event_type, source, ref_id, learning_objective_id, is_correct, payload, occurred_at, dedupe_key)
    VALUES
      (NEW.student_id, v_school, 'question_answered', NEW.source, NEW.source_id::text, NEW.learning_objective_id,
       NEW.is_correct,
       jsonb_build_object('mastery_before', round(NEW.p_mastery_before, 3), 'mastery_after', round(NEW.p_mastery_after, 3)),
       NEW.responded_at, 'mel:' || NEW.id::text)
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'learning_events trigger skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_learning_events_from_mastery_log ON public.mastery_evidence_log;
CREATE TRIGGER trg_learning_events_from_mastery_log
  AFTER INSERT ON public.mastery_evidence_log
  FOR EACH ROW EXECUTE FUNCTION public.learning_events_from_mastery_log();

-- ── retention ─────────────────────────────────────────────────────────────────────────────────────────
-- Heartbeats are only needed for recent "active minutes"; everything else is kept for a year by default.
-- Not scheduled here (add a pg_cron job if you want it automatic):
--   SELECT cron.schedule('prune-learning-events', '30 3 * * *', $$SELECT public.prune_learning_events()$$);
CREATE OR REPLACE FUNCTION public.prune_learning_events(p_keep_days integer DEFAULT 365, p_keep_heartbeat_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a integer;
  v_b integer;
BEGIN
  DELETE FROM public.learning_events
   WHERE event_type = 'session_heartbeat' AND created_at < now() - make_interval(days => GREATEST(p_keep_heartbeat_days, 1));
  GET DIAGNOSTICS v_a = ROW_COUNT;
  DELETE FROM public.learning_events
   WHERE created_at < now() - make_interval(days => GREATEST(p_keep_days, 30));
  GET DIAGNOSTICS v_b = ROW_COUNT;
  RETURN v_a + v_b;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_learning_events(integer, integer) FROM PUBLIC, anon, authenticated;
