-- ============================================================================
-- SCHEDULE NIGHTLY OPEN-ENDED QUESTION CALIBRATION
--
-- Runs supabase/functions/calibrate-open-ended-items-cron every night, which
-- re-checks every non-retired question_bank_extended item's declared
-- difficulty against real graded student scores and corrects it where the
-- two disagree - the open-ended-item counterpart of
-- 20260923000000_schedule_irt_calibration.sql.
--
-- Reuses the SAME app.settings.cron_secret already configured for that
-- migration - no new secret to generate or set. If nightly MCQ calibration
-- is already running, this needs nothing extra from you beyond running this
-- migration and deploying calibrate-open-ended-items-cron.
-- ============================================================================

SELECT cron.schedule(
  'nightly-open-ended-calibration',
  '43 2 * * *',  -- 02:43 every night - a bit after the MCQ calibration job (02:17), off the hour
  $$
  SELECT net.http_post(
    url := 'https://hpyvadzxmutbbzwgmecv.functions.supabase.co/calibrate-open-ended-items-cron',
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
--   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'nightly-open-ended-calibration'), schedule := '...');
-- To stop it:
--   SELECT cron.unschedule('nightly-open-ended-calibration');
-- To check recent runs:
--   SELECT * FROM public.open_ended_calibration_runs WHERE run_by IS NULL ORDER BY created_at DESC LIMIT 20;
