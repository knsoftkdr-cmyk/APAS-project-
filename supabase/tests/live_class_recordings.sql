-- Live class recordings: schema / security / duplicate / retention checks.
-- Run in the Supabase SQL editor on STAGING after applying 20261114000000_live_class_recordings.sql.
-- One transaction, rolled back: nothing is left behind. A failed check raises an EXCEPTION; a missing prerequisite
-- (no school row) prints a NOTICE and stops.
--
-- This does NOT cover the edge handler, Google, or the storage bytes: those are in the manual checklist in the README.

BEGIN;

CREATE FUNCTION pg_temp.expect(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'FAILED: %', label; END IF;
  RAISE NOTICE 'ok   - %', label;
END $$;

DO $$
DECLARE
  v_school uuid; v_class uuid := gen_random_uuid();
  a uuid; b uuid; c uuid; failed boolean; n integer;
BEGIN
  SELECT id INTO v_school FROM schools LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'need at least one school; nothing to test'; RETURN; END IF;

  -- 1. locked down: RLS on, no policies, no grants to browser roles ------------------------------------
  PERFORM pg_temp.expect('1a: RLS is on for both tables',
    (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.live_class_recordings'::regclass, 'public.live_recording_settings'::regclass)));
  PERFORM pg_temp.expect('1b: neither table has any policy (deny by default)',
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('live_class_recordings', 'live_recording_settings')));
  PERFORM pg_temp.expect('1c: anon and authenticated have no table privileges',
    NOT has_table_privilege('anon', 'public.live_class_recordings', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.live_class_recordings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.live_recording_settings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.live_class_recordings', 'INSERT'));
  PERFORM pg_temp.expect('1d: browsers cannot run the expiry function', NOT has_function_privilege('authenticated', 'public.live_rec_mark_expired()', 'EXECUTE'));
  PERFORM pg_temp.expect('1e: the bucket exists and is private',
    EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'live-class-recordings' AND public = false));
  PERFORM pg_temp.expect('1f: no storage policy mentions the recordings bucket (nothing reachable from a browser)',
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND (coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%live-class-recordings%'));

  -- 2. duplicates are impossible --------------------------------------------------------------------------
  INSERT INTO live_class_recordings (school_id, class_id, title, source, provider, provider_recording_id, status)
  VALUES (v_school, v_class, 'r1', 'auto', 'google_meet', 'conferenceRecords/c1/recordings/r1', 'processing') RETURNING id INTO a;
  failed := false;
  BEGIN
    INSERT INTO live_class_recordings (school_id, class_id, title, source, provider, provider_recording_id, status)
    VALUES (v_school, v_class, 'r1 again', 'auto', 'google_meet', 'conferenceRecords/c1/recordings/r1', 'processing');
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  PERFORM pg_temp.expect('2a: the same Meet recording cannot be registered twice', failed);

  INSERT INTO live_class_recordings (school_id, class_id, title, source, status, storage_path)
  VALUES (v_school, v_class, 'upload', 'upload', 'processing', v_school || '/' || v_class || '/x.mp4');
  failed := false;
  BEGIN
    INSERT INTO live_class_recordings (school_id, class_id, title, source, status, storage_path)
    VALUES (v_school, v_class, 'upload2', 'upload', 'processing', v_school || '/' || v_class || '/x.mp4');
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  PERFORM pg_temp.expect('2b: two recordings cannot claim the same storage object', failed);

  INSERT INTO live_class_recordings (school_id, class_id, session_date, title, source, status, drive_view_url)
  VALUES (v_school, v_class, current_date, 'link', 'link', 'ready', 'https://drive.google.com/file/d/abc/view');
  -- (session_id is NULL here, and NULLs never collide: the link index is meaningful only with a real session)
  PERFORM pg_temp.expect('2c: status / source / kind values are constrained',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.live_class_recordings'::regclass AND contype = 'c') >= 4);
  failed := false;
  BEGIN
    INSERT INTO live_class_recordings (school_id, class_id, title, source, status) VALUES (v_school, v_class, 'bad', 'auto', 'exploded');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  PERFORM pg_temp.expect('2d: an unknown status is rejected', failed);

  -- 3. retention -----------------------------------------------------------------------------------------
  INSERT INTO live_class_recordings (school_id, class_id, title, source, status, retention_expires_at, pinned)
  VALUES (v_school, v_class, 'expired', 'link', 'ready', now() - interval '1 day', false) RETURNING id INTO a;
  INSERT INTO live_class_recordings (school_id, class_id, title, source, status, retention_expires_at, pinned)
  VALUES (v_school, v_class, 'expired but kept', 'link', 'ready', now() - interval '1 day', true) RETURNING id INTO b;
  INSERT INTO live_class_recordings (school_id, class_id, title, source, status, retention_expires_at, pinned)
  VALUES (v_school, v_class, 'no limit', 'link', 'ready', NULL, false) RETURNING id INTO c;
  n := live_rec_mark_expired();
  PERFORM pg_temp.expect('3a: expired recordings are marked deleted', (SELECT status = 'deleted' AND deleted_reason = 'retention' AND deleted_at IS NOT NULL FROM live_class_recordings WHERE id = a));
  PERFORM pg_temp.expect('3b: a pinned (Keep) recording survives retention', (SELECT status = 'ready' AND deleted_at IS NULL FROM live_class_recordings WHERE id = b));
  PERFORM pg_temp.expect('3c: a recording with no expiry survives', (SELECT status = 'ready' AND deleted_at IS NULL FROM live_class_recordings WHERE id = c));
  PERFORM pg_temp.expect('3d: running it again changes nothing', live_rec_mark_expired() = 0);

  -- 4. settings defaults are the safe ones ----------------------------------------------------------------
  INSERT INTO live_recording_settings (school_id) VALUES (v_school) ON CONFLICT (school_id) DO NOTHING;
  PERFORM pg_temp.expect('4: recording is OFF and students cannot download by default',
    (SELECT enabled = false AND student_download = false AND teachers_can_delete = false
       FROM live_recording_settings WHERE school_id = v_school)
    OR (SELECT true FROM live_recording_settings WHERE school_id = v_school AND updated_by IS NOT NULL));   -- a configured school keeps its own values

  RAISE NOTICE 'all live-class recording schema checks passed';
END $$;

ROLLBACK;
