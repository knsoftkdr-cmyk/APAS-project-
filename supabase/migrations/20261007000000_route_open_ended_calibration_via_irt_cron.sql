-- ============================================================================
-- ROUTE NIGHTLY OPEN-ENDED CALIBRATION THROUGH calibrate-irt-cron
--   + POINT BOTH NIGHTLY JOBS AT THE CORRECT PROJECT
--
-- 1. The standalone calibrate-open-ended-items-cron edge function is no longer
--    deployed (Edge Function deployment limit). Its logic now lives in
--    _shared/handlers/openEndedCalibrationCron.ts and is served by the already
--    deployed calibrate-irt-cron function when the body is {"job":"open_ended"}.
--    It stays its OWN nightly invocation (02:43, separate from the 02:17 MCQ job)
--    so each run keeps its own wall-clock budget.
--
-- 2. 20260923000000 / 20261002000000 hard-coded the project ref
--    hpyvadzxmutbbzwgmecv, but this app's project is qkclzrscyhzrbixajaiw (see
--    .env). Both jobs are re-created here with the correct URL.
--
-- cron.schedule() with an existing job name updates that job in place, so this is
-- safe whether or not the earlier migrations ran. Nothing is dropped; the earlier
-- migrations are untouched. Same app.settings.cron_secret header as before.
-- ============================================================================

SELECT cron.schedule(
  'nightly-irt-calibration',
  '17 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkclzrscyhzrbixajaiw.functions.supabase.co/calibrate-irt-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

SELECT cron.schedule(
  'nightly-open-ended-calibration',
  '43 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkclzrscyhzrbixajaiw.functions.supabase.co/calibrate-irt-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret', true)
    ),
    body := '{"job":"open_ended"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
