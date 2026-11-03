-- Gamification: remember the IDEA a question taught, not just its exact text, so the same concept does not come back
-- in a different game or in different words. Additive and safe to re-run; existing rows keep NULL (still blocked by fingerprint).
-- Scores, XP, badges, streaks, missions and leaderboards are untouched.
ALTER TABLE public.student_question_history ADD COLUMN IF NOT EXISTS concept_keys text[];

-- Same signature as before; p_items entries may now carry "concept_keys": ["k:paris", ...].
CREATE OR REPLACE FUNCTION public.gq_claim_items(
  p_user uuid, p_school uuid, p_class_key text, p_subject_key text,
  p_game_type text, p_session text, p_items jsonb
) RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ins AS (
    INSERT INTO public.student_question_history
      (user_id, school_id, class_key, subject_key, game_type, fingerprint, pool_item_id, source, session_id, concept_keys)
    SELECT p_user, p_school, p_class_key, p_subject_key, p_game_type,
           x->>'fingerprint',
           NULLIF(x->>'pool_item_id', '')::uuid,
           CASE WHEN x->>'source' IN ('bank','pool','ai') THEN x->>'source' ELSE 'pool' END,
           left(p_session, 64),
           CASE WHEN jsonb_typeof(x->'concept_keys') = 'array'
                THEN ARRAY(SELECT jsonb_array_elements_text(x->'concept_keys')) ELSE NULL END
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
    WHERE COALESCE(x->>'fingerprint', '') <> ''
    ON CONFLICT (user_id, class_key, subject_key, fingerprint) DO NOTHING
    RETURNING fingerprint
  )
  SELECT COALESCE(array_agg(fingerprint), ARRAY[]::text[]) FROM ins
$$;

REVOKE ALL ON FUNCTION public.gq_claim_items(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gq_claim_items(uuid, uuid, text, text, text, text, jsonb) TO service_role;
