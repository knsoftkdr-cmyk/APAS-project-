-- Enrichment Content Generator: cache of AI-generated "beyond the textbook" packs.
--
-- Additive only. Packs describe a curriculum scope (not a student), so one pack per
-- (scope, language) is shared by every eligible student - it avoids paying for a model
-- call per click and makes the content stable between visits.
--
-- Access is through the `generate-item-bank` edge function (action "enrichment"), which
-- applies the high-performer eligibility gate. RLS is enabled with NO policies on purpose:
-- only the service role can read/write, so the gate can't be bypassed with a direct
-- supabase-js table read.

CREATE TABLE IF NOT EXISTS public.enrichment_packs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  text   NOT NULL CHECK (scope_type IN ('chapter', 'topic', 'subtopic')),
  scope_id    bigint NOT NULL,
  language    text   NOT NULL DEFAULT 'en',
  title       text   NOT NULL,
  content     jsonb  NOT NULL,
  model       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, language)
);

ALTER TABLE public.enrichment_packs ENABLE ROW LEVEL SECURITY;
