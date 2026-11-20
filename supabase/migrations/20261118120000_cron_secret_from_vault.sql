-- ============================================================================
-- Cron jobs: read the shared cron secret from Supabase Vault
--
-- Why: the pg_cron jobs that call edge functions (dispatch-scheduled-messages, live recordings, IRT / open-ended
-- calibration) sent current_setting('app.settings.cron_secret'), which was never set (hosted Supabase does not allow
-- ALTER DATABASE ... SET app.settings.* any more), so every call got 401 "Not authorized" and push / email for
-- scheduled messages and fee reminders never went out.
--
-- BEFORE running this file:
--   1. Edge Functions > Secrets: add CRON_SECRET = <a long random value>
--   2. SQL Editor, run once (same value):   SELECT vault.create_secret('<the same value>', 'cron_secret');
--      (to change it later: SELECT vault.update_secret(id, '<new value>') FROM vault.secrets WHERE name = 'cron_secret';)
--
-- Safe to run more than once.
-- ============================================================================

-- 1. Scheduled messages that were delivered in-app long ago but never pushed / emailed (because of the 401) are
--    marked as handled, so turning push/email on does not suddenly send parents a pile of old messages.
UPDATE public.scheduled_message_recipients r
   SET dispatched_at = now(),
       dispatch_error = 'skipped: delivered before push/email hand-off was working'
  FROM public.scheduled_messages m
 WHERE m.id = r.scheduled_message_id
   AND m.status = 'sent'
   AND r.dispatched_at IS NULL
   AND m.sent_at < now() - interval '1 day';

-- 2. Every cron job that sends the secret now reads it from Vault (falling back to the old setting if one exists).
DO $$
DECLARE
  j record;
  v_old text := $q$current_setting('app.settings.cron_secret', true)$q$;
  v_new text := $q$COALESCE(NULLIF(current_setting('app.settings.cron_secret', true), ''), (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))$q$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not enabled - nothing to update.';
    RETURN;
  END IF;
  FOR j IN SELECT jobid, jobname, command FROM cron.job
            WHERE command LIKE '%app.settings.cron_secret%' AND command NOT LIKE '%vault.decrypted_secrets%' LOOP
    PERFORM cron.alter_job(j.jobid, command := replace(j.command, v_old, v_new));
    RAISE NOTICE 'cron job % now reads the secret from Vault', j.jobname;
  END LOOP;
END $$;

-- Check:  SELECT jobname, command LIKE '%vault%' AS uses_vault FROM cron.job;
-- Then, a minute later:  SELECT status_code, content, created FROM net._http_response ORDER BY created DESC LIMIT 5;
--   200 = working.  401 = the Vault value and the CRON_SECRET edge secret are not exactly the same.
