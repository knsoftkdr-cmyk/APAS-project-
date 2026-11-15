-- Live Classes: automatic recordings (storage, linking, retention, permissions).
--
-- Live classes run on Google Meet links. Recording is done by Google on its own servers (Meet "auto recording",
-- switched on per meeting space through the Meet REST API) so it does not depend on the teacher's browser. See the
-- header of supabase/functions/_shared/liveRecordingsModel.ts for the full flow and its requirements.
--
-- This migration is additive: no existing table is dropped or rewritten.
--   virtual_classroom_sessions   + record_enabled / meet_space_name / recording_armed_at / recording_arm_error
--   live_recording_settings      one row per school (switches, permissions, retention, quota)
--   live_class_recordings        one row per recording (auto from Meet, uploaded file, or pasted link)
--   storage bucket live-class-recordings (PRIVATE)
--
-- SECURITY MODEL: both new tables have RLS enabled and NO client policies, and the bucket has NO storage
-- policies. Browsers and the anon/authenticated roles cannot read or write any of it directly. Everything goes
-- through the already-deployed edge function `ai-teacher-assistant` (action "live_recordings"), which checks who the
-- caller is, which class they belong to and what the school allows, then uses the service role and hands out
-- short-lived signed URLs. A leaked table grant or storage policy therefore cannot expose a recording.
--
-- DUPLICATES: a Meet recording can only be stored once (unique provider_recording_id); one storage object per
-- recording id (unique storage_path, path built from the id); a pasted link is unique per session/date.
--
-- Safe to re-run.

-- ── 0. Fail fast if the live tables are not what the code assumes ────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('virtual_classroom_sessions', 'id'), ('virtual_classroom_sessions', 'school_id'),
    ('virtual_classroom_sessions', 'class_id'), ('virtual_classroom_sessions', 'teacher_id'),
    ('virtual_classroom_sessions', 'subject'), ('virtual_classroom_sessions', 'title'),
    ('virtual_classroom_sessions', 'meet_link'), ('virtual_classroom_sessions', 'scheduled_start'),
    ('virtual_classroom_sessions', 'scheduled_end'), ('virtual_classroom_sessions', 'recurrence_end_date'),
    ('virtual_classroom_sessions', 'status'), ('profiles', 'id'), ('profiles', 'school_id'), ('profiles', 'role')
  ) AS t(tbl, col)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      RAISE EXCEPTION 'public.%.% is missing; review this migration before applying', r.tbl, r.col;
    END IF;
  END LOOP;
  IF to_regclass('public.schools') IS NULL THEN RAISE EXCEPTION 'public.schools does not exist'; END IF;
  IF to_regclass('storage.buckets') IS NULL THEN RAISE EXCEPTION 'Supabase Storage is not available in this database'; END IF;
END $$;

-- ── 1. Sessions: per-session switch + Meet arming state ──────────────────────────────────────────────
ALTER TABLE public.virtual_classroom_sessions
  ADD COLUMN IF NOT EXISTS record_enabled       boolean,        -- NULL = follow the school default
  ADD COLUMN IF NOT EXISTS meet_space_name      text,           -- spaces/xxxx once Meet has been configured
  ADD COLUMN IF NOT EXISTS recording_armed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS recording_arm_error  text,
  ADD COLUMN IF NOT EXISTS recording_arm_attempted_at timestamptz;

-- ── 2. School settings ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_recording_settings (
  school_id            uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  enabled              boolean NOT NULL DEFAULT false,            -- master switch: nothing records until an admin turns it on
  auto_record          boolean NOT NULL DEFAULT true,             -- default for sessions that have no explicit choice
  storage_mode         text    NOT NULL DEFAULT 'supabase_copy' CHECK (storage_mode IN ('supabase_copy', 'drive_link')),
  teachers_can_toggle  boolean NOT NULL DEFAULT true,             -- turn recording on/off for their own sessions
  teachers_can_manage  boolean NOT NULL DEFAULT true,             -- rename, hide, link to course/lesson, pin
  teachers_can_delete  boolean NOT NULL DEFAULT false,
  teachers_can_upload  boolean NOT NULL DEFAULT true,             -- attach a file or link by hand
  student_access       boolean NOT NULL DEFAULT true,
  student_download     boolean NOT NULL DEFAULT false,
  retention_days       integer NOT NULL DEFAULT 180  CHECK (retention_days BETWEEN 0 AND 3650),   -- 0 = keep until deleted
  storage_quota_gb     integer NOT NULL DEFAULT 50   CHECK (storage_quota_gb BETWEEN 1 AND 100000),
  max_upload_mb        integer NOT NULL DEFAULT 1024 CHECK (max_upload_mb BETWEEN 10 AND 5120),
  updated_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Recordings ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_class_recordings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- kept (not cascaded) when a session is deleted: the recording is course content, and its file must be purged
  -- through the Storage API, never orphaned by a cascade.
  session_id            uuid REFERENCES public.virtual_classroom_sessions(id) ON DELETE SET NULL,
  session_date          date,
  class_id              uuid NOT NULL,
  subject               text,
  teacher_id            uuid,                                     -- host / Meet organiser
  title                 text NOT NULL,
  notes                 text,
  source                text NOT NULL CHECK (source IN ('auto', 'upload', 'link')),
  provider              text,
  provider_recording_id text,                                     -- conferenceRecords/{c}/recordings/{r}
  owner_email           text,                                     -- whose Drive holds the original (impersonated to copy it)
  drive_file_id         text,
  drive_view_url        text,
  status                text NOT NULL CHECK (status IN ('recording', 'processing', 'copying', 'ready', 'failed', 'deleted')),
  storage_kind          text NOT NULL DEFAULT 'none' CHECK (storage_kind IN ('none', 'supabase', 'drive', 'link')),
  storage_path          text,
  mime_type             text,
  size_bytes            bigint NOT NULL DEFAULT 0,
  duration_seconds      integer,
  started_at            timestamptz,
  ended_at              timestamptz,
  visibility            text NOT NULL DEFAULT 'class' CHECK (visibility IN ('class', 'teachers')),
  pinned                boolean NOT NULL DEFAULT false,            -- exempt from retention
  course_id             uuid,                                      -- plain uuids: the course/lesson tables vary by deployment
  lesson_id             uuid,
  retention_expires_at  timestamptz,
  -- resumable copy state (Drive -> Storage)
  tus_url               text,
  copied_bytes          bigint NOT NULL DEFAULT 0,
  copy_attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  last_error            text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid,
  deleted_reason        text,
  purged_at             timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS lcr_provider_once ON public.live_class_recordings (provider, provider_recording_id)
  WHERE provider_recording_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lcr_path_once ON public.live_class_recordings (storage_path)
  WHERE storage_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lcr_link_once ON public.live_class_recordings (session_id, session_date, drive_view_url)
  WHERE source = 'link' AND deleted_at IS NULL AND drive_view_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS lcr_class_recent ON public.live_class_recordings (class_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lcr_school_status ON public.live_class_recordings (school_id, status);
CREATE INDEX IF NOT EXISTS lcr_copy_queue ON public.live_class_recordings (next_attempt_at) WHERE status = 'copying';
CREATE INDEX IF NOT EXISTS lcr_purge_queue ON public.live_class_recordings (deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS lcr_expiry ON public.live_class_recordings (retention_expires_at)
  WHERE deleted_at IS NULL AND retention_expires_at IS NOT NULL AND NOT pinned;

CREATE OR REPLACE FUNCTION public.lcr_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS lcr_touch ON public.live_class_recordings;
CREATE TRIGGER lcr_touch BEFORE UPDATE ON public.live_class_recordings FOR EACH ROW EXECUTE FUNCTION public.lcr_touch();

-- ── 4. Lock the tables: service role only ────────────────────────────────────────────────────────────
ALTER TABLE public.live_recording_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_class_recordings   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_recording_settings, public.live_class_recordings FROM PUBLIC, anon, authenticated;
-- (no policies on purpose: deny by default; the edge handler uses the service role)

-- ── 5. Private storage bucket (no storage.objects policies: nothing is reachable from a browser) ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('live-class-recordings', 'live-class-recordings', false, 2147483648, ARRAY['video/mp4', 'video/webm', 'video/quicktime'])
ON CONFLICT (id) DO UPDATE SET public = false;     -- never flip an existing bucket to public

-- ── 6. Retention: mark expired recordings deleted (SQL only, works even if the edge job is not scheduled) ─
-- The file itself is removed by the edge job (storage objects must be deleted through the Storage API; deleting
-- rows from storage.objects would leave the bytes behind and still be billed).
CREATE OR REPLACE FUNCTION public.live_rec_mark_expired() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.live_class_recordings
     SET deleted_at = now(), deleted_reason = 'retention', status = 'deleted'
   WHERE deleted_at IS NULL AND NOT pinned
     AND retention_expires_at IS NOT NULL AND retention_expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.live_rec_mark_expired() FROM PUBLIC, anon, authenticated;

-- ── 7. Schedules (only where pg_cron / pg_net exist; see README for the app.settings.cron_secret setup) ─
-- Hourly SQL-only expiry. The edge steps (arm / sync / copy / purge) are scheduled the same way the existing
-- calibration jobs are, through the already-deployed calibrate-irt-cron function with {"job":"live_recordings"}.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('live-recordings-expire', 'live-recordings-arm', 'live-recordings-sync', 'live-recordings-copy');
    PERFORM cron.schedule('live-recordings-expire', '7 * * * *', 'SELECT public.live_rec_mark_expired()');
    IF to_regnamespace('net') IS NOT NULL THEN
      PERFORM cron.schedule('live-recordings-arm', '*/5 * * * *', $job$
        SELECT net.http_post(
          url := 'https://qkclzrscyhzrbixajaiw.functions.supabase.co/calibrate-irt-cron',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', current_setting('app.settings.cron_secret', true)),
          body := '{"job":"live_recordings","step":"arm"}'::jsonb, timeout_milliseconds := 60000);
      $job$);
      PERFORM cron.schedule('live-recordings-sync', '*/5 * * * *', $job$
        SELECT net.http_post(
          url := 'https://qkclzrscyhzrbixajaiw.functions.supabase.co/calibrate-irt-cron',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', current_setting('app.settings.cron_secret', true)),
          body := '{"job":"live_recordings","step":"sync"}'::jsonb, timeout_milliseconds := 120000);
      $job$);
      PERFORM cron.schedule('live-recordings-copy', '* * * * *', $job$
        SELECT net.http_post(
          url := 'https://qkclzrscyhzrbixajaiw.functions.supabase.co/calibrate-irt-cron',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', current_setting('app.settings.cron_secret', true)),
          body := '{"job":"live_recordings","step":"copy_purge"}'::jsonb, timeout_milliseconds := 150000);
      $job$);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'live-recordings jobs were not scheduled: %', SQLERRM;
END $$;
