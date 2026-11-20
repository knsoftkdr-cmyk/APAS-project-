-- ============================================================================
-- App feature knowledge base
--
-- A searchable copy of the documentation of every APAS feature, per role, that the AI assistants (Study Buddy
-- first) read to explain the app. The rows are GENERATED from the application code by
-- tools/generate-feature-docs.mjs and loaded by tools/sync-feature-kb.mjs. Nothing here is student data: it is
-- help text about pages, tabs and buttons.
--
-- Why a new table (and not ai_embeddings):
--   * ai_embeddings holds textbook content as 1536-dimension OpenAI vectors; these are 768-dimension Gemini
--     vectors. Two embedding models cannot share one vector space.
--   * these rows need a role, soft-delete (a removed feature must stop being explained) and a content hash so an
--     unchanged feature is not re-embedded.
--
-- Search is hybrid: pgvector similarity (meaning, e.g. "how do I revise before exams") plus pg_trgm / full-text
-- (exact names and misspellings, e.g. "adaptiv test"). Either half works on its own, so the assistant still finds
-- features when embeddings are missing or the embedding service is down.
--
-- Safe to re-run. Does not touch existing tables.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.app_feature_docs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role            text        NOT NULL,                          -- who this doc is for: 'student', later 'parent', 'teacher'
  feature_key     text        NOT NULL,                          -- stable id from the generator, e.g. 'nav:/my-doubts'
  name            text        NOT NULL,                          -- the name exactly as users see it
  aliases         text[]      NOT NULL DEFAULT '{}',             -- other names, including previous names after a rename
  keywords        text[]      NOT NULL DEFAULT '{}',             -- single words people use for it
  route           text,
  kind            text        NOT NULL DEFAULT 'page',           -- page | tab | manual
  content         text        NOT NULL,                          -- the explanation handed to the model
  search_text     text        NOT NULL,                          -- name + aliases + purpose + labels, for search and embedding
  confidence      text        NOT NULL DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  needs_review    boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  content_hash    text        NOT NULL,                          -- unchanged hash = no need to re-embed
  embedding       extensions.vector(768),                        -- NULL until embedded; search still works without it
  embedding_model text,
  removed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_feature_docs_role_key_unique UNIQUE (role, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_app_feature_docs_role_status ON public.app_feature_docs (role, status);

CREATE INDEX IF NOT EXISTS idx_app_feature_docs_fts
  ON public.app_feature_docs USING gin (to_tsvector('simple', search_text));

CREATE INDEX IF NOT EXISTS idx_app_feature_docs_embedding
  ON public.app_feature_docs USING hnsw (embedding extensions.vector_cosine_ops);

-- Trigram index on the name. The operator class lives in whichever schema pg_trgm was installed in
-- (same approach as 20261023000000_universal_search.sql); skipped if pg_trgm is unavailable.
DO $$
DECLARE v_ns text;
BEGIN
  SELECT n.nspname INTO v_ns
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  IF v_ns IS NULL THEN
    RAISE NOTICE 'pg_trgm not available - skipping the name trigram index (search still works)';
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_app_feature_docs_name_trgm ON public.app_feature_docs USING gin (lower(name) %I.gin_trgm_ops)',
    v_ns
  );
END $$;

-- ---------------------------------------------------------------------------
-- Access: a signed-in user can read ONLY the active docs written for their own role (a student never reads
-- teacher or admin docs). Only the service role (the sync script) writes. The role is read from profiles in the
-- database, so it cannot be spoofed by a request parameter.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_feature_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read active feature docs for their own role" ON public.app_feature_docs;
CREATE POLICY "Users read active feature docs for their own role"
  ON public.app_feature_docs FOR SELECT
  TO authenticated
  USING (status = 'active' AND role = public.get_user_role(auth.uid()));

DROP POLICY IF EXISTS "Admins read all feature docs" ON public.app_feature_docs;
CREATE POLICY "Admins read all feature docs"
  ON public.app_feature_docs FOR SELECT
  TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('admin', 'knsoft_admin'));

DROP POLICY IF EXISTS "Service role manages feature docs" ON public.app_feature_docs;
CREATE POLICY "Service role manages feature docs"
  ON public.app_feature_docs FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.app_feature_docs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_feature_docs FROM authenticated;

-- ---------------------------------------------------------------------------
-- match_feature_docs: hybrid search.
--   p_query      the student's question (already combined with the last turn by the caller for follow-ups)
--   p_embedding  the question's embedding, or NULL (then only text search runs)
-- Returns the best p_limit docs with the raw scores, so the caller can decide how confident the match is:
--   name_score    0..1  how closely the question contains the feature's name or an alias (tolerates typos). This is a
--                       CANDIDATE signal only: trigram overlap alone can match a partly similar name, so the caller
--                       must also check that every significant word of the name is present (see featureRetrieval.ts).
--   text_score    0..1  full-text relevance over the whole description
--   vector_score  0..1  cosine similarity of meaning (NULL without an embedding)
-- SECURITY INVOKER: the table's row-level security (own role only) applies to whoever calls this.
-- ---------------------------------------------------------------------------
-- (dropped first because CREATE OR REPLACE cannot change a function's result columns on a re-run)
DROP FUNCTION IF EXISTS public.match_feature_docs(text, text, extensions.vector, integer);
CREATE OR REPLACE FUNCTION public.match_feature_docs(
  p_role      text,
  p_query     text,
  p_embedding extensions.vector(768) DEFAULT NULL,
  p_limit     integer DEFAULT 4
)
RETURNS TABLE (
  feature_key  text,
  name         text,
  aliases      text[],
  route        text,
  kind         text,
  content      text,
  confidence   text,
  needs_review boolean,
  name_score   real,
  text_score   real,
  vector_score real,
  score        double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT
      lower(regexp_replace(coalesce(p_query, ''), '[^a-zA-Z0-9 ]+', ' ', 'g')) AS t,
      (
        SELECT to_tsquery('simple', string_agg(quote_literal(w), ' | '))
        FROM regexp_split_to_table(lower(regexp_replace(coalesce(p_query, ''), '[^a-zA-Z0-9 ]+', ' ', 'g')), '\s+') AS w
        WHERE length(w) > 2
          AND w NOT IN ('the','what','how','can','you','and','for','are','this','that','with','about','tell','show',
                        'does','work','works','use','using','page','feature','app','please','where','find','get','see','open',
                        'explain','topic','school','help','need','want','make','learn','understand','question','give','tell','know')
      ) AS ts
  ),
  base AS (
    SELECT d.*, q.t, q.ts
    FROM public.app_feature_docs d CROSS JOIN q
    WHERE d.status = 'active' AND d.role = p_role
  ),
  scored AS (
    SELECT
      b.feature_key, b.name, b.aliases, b.route, b.kind, b.content, b.confidence, b.needs_review,
      greatest(
        word_similarity(lower(b.name), b.t),
        coalesce((SELECT max(word_similarity(lower(a), b.t)) FROM unnest(b.aliases) AS a), 0)
      )::real AS name_score,
      least(1.0, CASE WHEN b.ts IS NULL THEN 0 ELSE ts_rank_cd(to_tsvector('simple', b.search_text), b.ts, 32) * 2 END)::real AS text_score,
      CASE WHEN p_embedding IS NOT NULL AND b.embedding IS NOT NULL THEN (1 - (b.embedding <=> p_embedding))::real END AS vector_score
    FROM base b
  ),
  lex AS (
    SELECT s.*, row_number() OVER (ORDER BY greatest(s.name_score, s.text_score * 0.8) DESC) AS lex_rank
    FROM scored s
    WHERE greatest(s.name_score, s.text_score * 0.8) >= 0.35
  ),
  vec AS (
    SELECT s.feature_key, row_number() OVER (ORDER BY s.vector_score DESC) AS vec_rank
    FROM scored s
    WHERE s.vector_score IS NOT NULL
    ORDER BY s.vector_score DESC
    LIMIT 8
  )
  SELECT
    s.feature_key, s.name, s.aliases, s.route, s.kind, s.content, s.confidence, s.needs_review,
    s.name_score, s.text_score, s.vector_score,
    (coalesce(1.0 / (60 + l.lex_rank), 0) + coalesce(1.0 / (60 + v.vec_rank), 0))::double precision AS score
  FROM scored s
  LEFT JOIN lex l ON l.feature_key = s.feature_key
  LEFT JOIN vec v ON v.feature_key = s.feature_key
  WHERE l.feature_key IS NOT NULL OR v.feature_key IS NOT NULL
  ORDER BY score DESC, s.name_score DESC
  LIMIT greatest(1, least(coalesce(p_limit, 4), 8));
$$;

REVOKE ALL ON FUNCTION public.match_feature_docs(text, text, extensions.vector, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_feature_docs(text, text, extensions.vector, integer) TO authenticated, service_role;

COMMENT ON TABLE public.app_feature_docs IS
  'Generated documentation of app features per role, read by AI assistants. Written only by tools/sync-feature-kb.mjs (service role). Contains no user data.';
