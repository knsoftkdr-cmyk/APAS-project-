-- Interactive Video Player.
--
-- Extends the existing Marketplace video listings (marketplace_listings.content_type = 'video'); it does NOT add a
-- video module. Adds only what listings do not have:
--   video_settings           per video: may students seek ahead? may they skip questions? (+ known duration)
--   video_questions          questions a teacher attaches to a timestamp (manual or AI-generated)
--   video_question_attempts  every answer / skip by a student
--   video_progress           per student per video: resume position, REAL watched seconds, completion
--   video_doubts             doubts a student asks from inside the player (+ AI draft answer / teacher reply)
--
-- Access: all five tables have RLS enabled and NO policies, i.e. service role only. Everything goes through the
-- `get-mastery-history` edge function (`vid_*` actions, _shared/handlers/interactiveVideo.ts), which authorises by
-- role / school / class and, importantly, never sends a question's correct answer to a student before they answer.
--
-- Telemetry: the edge function also writes `video_progress`, `video_question_answered` and `video_doubt` rows to the
-- existing learning_events table, which is what the Engagement Score and the live feed already read.

-- ── settings ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_settings (
  listing_id          uuid PRIMARY KEY,
  school_id           uuid,
  allow_video_skip    boolean NOT NULL DEFAULT true,   -- true = students may seek ahead (today's behaviour)
  allow_question_skip boolean NOT NULL DEFAULT true,   -- true = students may skip a question
  duration_seconds    integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400),
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── questions ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL,
  school_id         uuid,
  timestamp_seconds integer NOT NULL CHECK (timestamp_seconds BETWEEN 0 AND 86400),
  question_text     text NOT NULL CHECK (length(btrim(question_text)) > 0 AND length(question_text) <= 500),
  question_type     text NOT NULL DEFAULT 'mcq' CHECK (question_type IN ('mcq', 'true_false')),
  options           jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 6),
  correct_index     integer NOT NULL CHECK (correct_index >= 0 AND correct_index < 6),
  explanation       text CHECK (explanation IS NULL OR length(explanation) <= 1000),
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_questions_listing ON public.video_questions (listing_id, timestamp_seconds);

-- ── attempts ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_question_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       uuid NOT NULL REFERENCES public.video_questions(id) ON DELETE CASCADE,
  listing_id        uuid NOT NULL,
  school_id         uuid,
  student_id        uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  selected_index    integer CHECK (selected_index IS NULL OR selected_index BETWEEN 0 AND 5),
  is_correct        boolean,                                  -- NULL when skipped
  skipped           boolean NOT NULL DEFAULT false,
  attempt_no        integer NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  time_to_answer_ms integer CHECK (time_to_answer_ms IS NULL OR time_to_answer_ms >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_attempts_listing_student ON public.video_question_attempts (listing_id, student_id);
CREATE INDEX IF NOT EXISTS idx_video_attempts_question ON public.video_question_attempts (question_id);
CREATE INDEX IF NOT EXISTS idx_video_attempts_student ON public.video_question_attempts (student_id, created_at DESC);

-- ── progress / resume ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_progress (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id           uuid NOT NULL,
  school_id            uuid,
  student_id           uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  last_position_seconds numeric(10, 2) NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  furthest_seconds     numeric(10, 2) NOT NULL DEFAULT 0 CHECK (furthest_seconds >= 0),
  watched_seconds      integer NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),   -- UNIQUE seconds actually played
  duration_seconds     integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  completion_pct       numeric(5, 2) NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  completed            boolean NOT NULL DEFAULT false,
  watched_ranges       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(watched_ranges) = 'array'),
  first_watched_at     timestamptz NOT NULL DEFAULT now(),
  last_watched_at      timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (listing_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_video_progress_student ON public.video_progress (student_id, last_watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_progress_school ON public.video_progress (school_id, listing_id);

-- ── doubts ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_doubts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL,
  school_id         uuid,
  student_id        uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  timestamp_seconds integer NOT NULL DEFAULT 0 CHECK (timestamp_seconds BETWEEN 0 AND 86400),
  question_text     text NOT NULL CHECK (length(btrim(question_text)) > 0 AND length(question_text) <= 1000),
  ai_answer         text CHECK (ai_answer IS NULL OR length(ai_answer) <= 4000),
  answer_text       text CHECK (answer_text IS NULL OR length(answer_text) <= 4000),
  answered_by       uuid,
  answered_at       timestamptz,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_doubts_listing ON public.video_doubts (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_doubts_student ON public.video_doubts (student_id, created_at DESC);

-- ── RLS: service role only (see header) ────────────────────────────────────────────────────────────
ALTER TABLE public.video_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_progress          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_doubts            ENABLE ROW LEVEL SECURITY;

-- ── tie rows to their video: deleting a listing removes its questions, progress and doubts ────────────
-- Added only when marketplace_listings.id is a uuid (the app treats ids as opaque strings), so the migration cannot
-- fail on a database where it is not.
DO $$
DECLARE
  t text;
  id_type text;
BEGIN
  SELECT data_type INTO id_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'marketplace_listings' AND column_name = 'id';
  IF id_type = 'uuid' THEN
    FOREACH t IN ARRAY ARRAY['video_settings', 'video_questions', 'video_question_attempts', 'video_progress', 'video_doubts'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_listing_fk') THEN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE CASCADE',
          t, t || '_listing_fk');
      END IF;
    END LOOP;
  END IF;
END $$;

-- ── Engagement Score: new scoring activity marks the student for (lazy) recalculation ─────────────────
-- Same trigger as before, with the two new event types the score now reads (see engagementModel.interactionActivity).
DO $$
BEGIN
  IF to_regclass('public.learning_events') IS NOT NULL AND to_regprocedure('public.engagement_mark_dirty()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_engagement_learning_events ON public.learning_events;
    CREATE TRIGGER trg_engagement_learning_events
      AFTER INSERT ON public.learning_events
      FOR EACH ROW
      WHEN (NEW.event_type IN ('video_progress', 'tutor_message', 'video_question_answered', 'video_doubt'))
      EXECUTE FUNCTION public.engagement_mark_dirty('learning_event', 'student', 'student_id');

    DROP INDEX IF EXISTS public.idx_learning_events_engagement;
    CREATE INDEX IF NOT EXISTS idx_learning_events_engagement
      ON public.learning_events (student_id, occurred_at DESC)
      WHERE event_type IN ('video_progress', 'tutor_message', 'video_question_answered', 'video_doubt');
  END IF;
END $$;
