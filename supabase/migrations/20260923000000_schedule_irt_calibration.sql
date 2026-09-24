-- ============================================================================
-- SCHEDULE NIGHTLY IRT CALIBRATION
--
-- Runs supabase/functions/calibrate-irt-cron every night, which re-estimates
-- item difficulty/discrimination for every subject from the day's CAT
-- responses and flags anything that looks mis-keyed - the same work a
-- teacher can trigger by hand from the Item Bank page's "Run" button, just
-- automatic and covering the whole school in one pass.
--
-- pg_cron and pg_net are already enabled by migration
-- 20260411130715_a34ceee6-18d4-4c3a-9407-8766682a4248.sql, so this migration
-- only adds the scheduled job itself.
--
-- ============================================================================
-- REQUIRED MANUAL STEP - this migration will not work until you do this:
--
--   1. Generate a long random secret, e.g.:  openssl rand -hex 32
--   2. Set it as an edge function secret:    supabase secrets set CRON_SECRET=<value>
--   3. Set the SAME value as a database setting, so the cron job below can
--      send it as a header without hard-coding it into a migration file that
--      ends up in version control:
--
--        ALTER DATABASE postgres SET app.settings.cron_secret = '<value>';
--
--      (run that directly against your database - psql, the SQL editor, etc;
--      it deliberately does not live in this file)
--
-- Steps 2 and 3 must use the EXACT SAME value, or calibrate-irt-cron will
-- reject every call with 401 and nothing will run.
-- ============================================================================

SELECT cron.schedule(
  'nightly-irt-calibration',
  '17 2 * * *',  -- 02:17 every night - off the hour, so it doesn't pile up alongside other jobs scheduled on the hour
  $$
  SELECT net.http_post(
    url := 'https://hpyvadzxmutbbzwgmecv.functions.supabase.co/calibrate-irt-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To change the schedule later:
--   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'nightly-irt-calibration'), schedule := '...');
-- To stop it:
--   SELECT cron.unschedule('nightly-irt-calibration');
-- To check recent runs (pg_net logs the HTTP response, not calibrate-irt-cron's
-- own logic - for that, see the per-subject rows this writes to
-- irt_calibration_runs, identifiable by run_by IS NULL):
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
--   SELECT * FROM irt_calibration_runs WHERE run_by IS NULL ORDER BY created_at DESC LIMIT 20;
