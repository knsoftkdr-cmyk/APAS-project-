-- Gamification: class-strict questions that never repeat for a student.
--
-- Read and written by the already-deployed update-mastery edge function (service role) via
-- action = 'gq_context' / 'gq_serve'. No new edge function. See supabase/functions/CONSOLIDATION.md.
--
-- Purely additive and safe to re-run: new tables / indexes / function only, IF NOT EXISTS / CREATE OR REPLACE
-- throughout. No existing table is altered, so scores, XP, badges, streaks, missions and leaderboards are untouched.
--
-- 1) gamification_question_pool       class-tagged game content (AI-generated, reusable by every student of the same
--                                     school + class). Teacher-reviewed MCQs are read straight from question_bank.
-- 2) student_question_history         one row per (student, class, subject, content fingerprint) ever served.
--                                     Never reset: finishing a round, refreshing, logging out/in do not touch it.
-- 3) gq_claim_items()                 atomic "mark as served": the unique constraint arbitrates concurrent requests.

-- ── 1. pool ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gamification_question_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- School scope. Rows never cross schools. school_scope is school_id, or the all-zero uuid when the student has no school,
  -- so the uniqueness below works with a plain (non-expression) index and PostgREST upserts.
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  school_scope uuid NOT NULL,
  class_key text NOT NULL,                 -- normalised: '1'..'12', 'nursery', 'lkg', 'ukg' (see class_key())
  subject_key text NOT NULL,               -- lower-cased, single-spaced subject name
  subject_label text NOT NULL,
  game_type text NOT NULL CHECK (game_type IN ('quick-quiz','word-scramble','match-pairs','category-sort','speed-tap','visual-memory')),
  difficulty text CHECK (difficulty IN ('easy','medium','hard')),
  fingerprint text NOT NULL,               -- content identity: same content in any formatting => same fingerprint
  payload jsonb NOT NULL,                  -- the game item, already validated against the class
  source text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','manual')),
  generation_model text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gamification_question_pool_unique
  ON public.gamification_question_pool (school_scope, class_key, subject_key, fingerprint);
CREATE INDEX IF NOT EXISTS gamification_question_pool_lookup
  ON public.gamification_question_pool (school_scope, class_key, subject_key, game_type) WHERE status = 'active';

-- ── 2. per-student history ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_question_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,   -- the authenticated student (same key as gamification_events)
  school_id uuid,
  class_key text NOT NULL,
  subject_key text NOT NULL,
  game_type text NOT NULL,                 -- the game the item was FIRST served in
  fingerprint text NOT NULL,
  pool_item_id uuid,                       -- gamification_question_pool.id, when the item came from the pool
  source text NOT NULL DEFAULT 'pool' CHECK (source IN ('bank','pool','ai')),
  session_id text,                         -- the round it was served in (client round id)
  served_at timestamptz NOT NULL DEFAULT now()
);

-- One record per student per distinct question, whichever game type it appeared in: this is what blocks both
-- repeats over time and the same content turning up in a different game.
CREATE UNIQUE INDEX IF NOT EXISTS student_question_history_unique
  ON public.student_question_history (user_id, class_key, subject_key, fingerprint);
CREATE INDEX IF NOT EXISTS student_question_history_user_time
  ON public.student_question_history (user_id, served_at DESC);

-- ── RLS: service role writes; a student may read only their own history; the pool is not client-readable ──
ALTER TABLE public.gamification_question_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_question_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own question history" ON public.student_question_history;
CREATE POLICY "Students read own question history" ON public.student_question_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ── 3. atomic claim ─────────────────────────────────────────────────────────────────────────────────
-- p_items: [{"fingerprint": "...", "pool_item_id": "<uuid>|null", "source": "bank|pool|ai"}, ...]
-- Returns the fingerprints this call actually inserted. If two requests race for the same question, the unique index
-- lets exactly one insert win; the other gets it back as "not claimed" and tops up with a different question.
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
      (user_id, school_id, class_key, subject_key, game_type, fingerprint, pool_item_id, source, session_id)
    SELECT p_user, p_school, p_class_key, p_subject_key, p_game_type,
           x->>'fingerprint',
           NULLIF(x->>'pool_item_id', '')::uuid,
           CASE WHEN x->>'source' IN ('bank','pool','ai') THEN x->>'source' ELSE 'pool' END,
           left(p_session, 64)
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x
    WHERE COALESCE(x->>'fingerprint', '') <> ''
    ON CONFLICT (user_id, class_key, subject_key, fingerprint) DO NOTHING
    RETURNING fingerprint
  )
  SELECT COALESCE(array_agg(fingerprint), ARRAY[]::text[]) FROM ins
$$;

-- Service role only (like get_due_reviews / generate_learning_path): the user id comes from the verified JWT in the edge function.
REVOKE ALL ON FUNCTION public.gq_claim_items(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gq_claim_items(uuid, uuid, text, text, text, text, jsonb) TO service_role;
