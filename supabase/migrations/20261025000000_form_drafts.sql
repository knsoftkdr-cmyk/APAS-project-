-- Auto-save & Recovery: server-side drafts for unfinished multi-field forms.
--
-- Drafts live ONLY in this table. They are never written to homework_submissions, lessons,
-- homework_assignments, worksheet_submissions, etc., so a draft can never appear as submitted work
-- (teachers and analytics read those tables directly). Real tables are written only by the form's
-- own existing Submit / Save button.
--
-- The app works without this migration: drafts are then kept on the device only (localStorage) and
-- the status indicator reports that they are saved offline.
--
-- Security model
--   * RLS: a user can only see / write / delete their own rows (user_id = auth.uid()).
--   * school_id is NEVER taken from the client: save_form_draft() reads it from profiles, and the
--     RLS WITH CHECK enforces it matches the caller's profile.
--   * save_form_draft() is SECURITY INVOKER, so the caller's existing RLS applies to every table it
--     touches. For forms tied to a record it first checks the caller can already SEE that record
--     (e.g. a student can only keep a homework draft for an assignment RLS lets them read).
--   * Conflict safety: an older save never overwrites a newer one (compared on client_updated_ms).

CREATE TABLE IF NOT EXISTS public.form_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id         uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  form_type         text NOT NULL CHECK (char_length(form_type) BETWEEN 1 AND 64),
  record_key        text NOT NULL DEFAULT '' CHECK (char_length(record_key) <= 300),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Fingerprint of the server data the draft was started from; lets the app warn if that data
  -- changed afterwards instead of silently restoring over it.
  base_hash         text,
  client_updated_ms bigint NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT form_drafts_payload_size CHECK (pg_column_size(payload) <= 1048576),
  CONSTRAINT form_drafts_unique UNIQUE (user_id, form_type, record_key)
);

CREATE INDEX IF NOT EXISTS idx_form_drafts_user ON public.form_drafts (user_id, form_type);
CREATE INDEX IF NOT EXISTS idx_form_drafts_expires ON public.form_drafts (expires_at);

ALTER TABLE public.form_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own drafts" ON public.form_drafts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users insert own drafts" ON public.form_drafts
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND school_id IS NOT DISTINCT FROM (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Users update own drafts" ON public.form_drafts
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND school_id IS NOT DISTINCT FROM (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Users delete own drafts" ON public.form_drafts
  FOR DELETE USING (user_id = auth.uid());

-- Does the caller (under their own RLS) have legitimate access to the record a draft refers to?
-- Unknown / record-less form types return true (nothing to check).
CREATE OR REPLACE FUNCTION public.form_draft_record_visible(p_form_type text, p_record_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  BEGIN
    v_id := split_part(p_record_key, '|', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN p_form_type IN ('survey_builder');   -- keys without a leading uuid are only valid here
  END;

  IF p_form_type = 'student_homework' THEN
    RETURN EXISTS (SELECT 1 FROM public.homework_assignments WHERE id = v_id);
  ELSIF p_form_type = 'worksheet_practice' THEN
    RETURN EXISTS (SELECT 1 FROM public.worksheet_assignments WHERE id = v_id);
  ELSIF p_form_type IN ('lesson_plan_edit', 'teacher_homework_questions',
                        'period_plan_edit', 'period_plan_manual', 'score_entry') THEN
    RETURN EXISTS (SELECT 1 FROM public.lessons WHERE id = v_id);
  END IF;
  RETURN true;
END;
$$;

-- Conflict-safe upsert. Returns jsonb:
--   { "status": "saved",    "version": n }                       our draft is now the latest
--   { "status": "conflict", "draft": {payload, base_hash, client_updated_ms, version} }
--                                   a NEWER draft already exists (e.g. saved from another device);
--                                   nothing was overwritten
--   { "status": "forbidden" }       caller has no access to the referenced record
CREATE OR REPLACE FUNCTION public.save_form_draft(
  p_form_type  text,
  p_record_key text,
  p_payload    jsonb,
  p_base_hash  text,
  p_client_ms  bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_school uuid;
  v_ms     bigint;
  v_row    public.form_drafts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.form_draft_record_visible(p_form_type, COALESCE(p_record_key, '')) THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT p.school_id INTO v_school FROM public.profiles p WHERE p.id = v_uid;

  -- Never trust a client clock far in the future (it would block every later save).
  v_ms := LEAST(p_client_ms, (extract(epoch FROM now()) * 1000)::bigint + 300000);

  INSERT INTO public.form_drafts AS d
    (user_id, school_id, form_type, record_key, payload, base_hash, client_updated_ms)
  VALUES
    (v_uid, v_school, p_form_type, COALESCE(p_record_key, ''), p_payload, p_base_hash, v_ms)
  ON CONFLICT (user_id, form_type, record_key) DO UPDATE
    SET payload = EXCLUDED.payload,
        base_hash = EXCLUDED.base_hash,
        school_id = EXCLUDED.school_id,
        client_updated_ms = EXCLUDED.client_updated_ms,
        version = d.version + 1,
        updated_at = now(),
        expires_at = now() + interval '30 days'
    WHERE d.client_updated_ms <= EXCLUDED.client_updated_ms
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('status', 'saved', 'version', v_row.version);
  END IF;

  SELECT * INTO v_row FROM public.form_drafts
   WHERE user_id = v_uid AND form_type = p_form_type AND record_key = COALESCE(p_record_key, '');
  RETURN jsonb_build_object(
    'status', 'conflict',
    'draft', jsonb_build_object(
      'payload', v_row.payload,
      'base_hash', v_row.base_hash,
      'client_updated_ms', v_row.client_updated_ms,
      'version', v_row.version));
END;
$$;

REVOKE ALL ON FUNCTION public.save_form_draft(text, text, jsonb, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_form_draft(text, text, jsonb, text, bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.form_draft_record_visible(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_draft_record_visible(text, text) TO authenticated;

-- Housekeeping: remove drafts nobody touched for 30 days (client also purges its own on login).
CREATE OR REPLACE FUNCTION public.purge_expired_form_drafts() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.form_drafts WHERE expires_at < now() RETURNING 1)
  SELECT count(*)::int FROM d;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_form_drafts() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('purge-expired-form-drafts', '17 3 * * *', 'SELECT public.purge_expired_form_drafts()');
  END IF;
END $$;
