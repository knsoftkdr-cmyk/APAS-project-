-- Add source_type to knowledge_chunks
ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'curriculum';

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_type
  ON public.knowledge_chunks(source_type);

-- Add source_type to ai_embeddings (mirrors knowledge_chunks layer)
ALTER TABLE public.ai_embeddings
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'curriculum';

CREATE INDEX IF NOT EXISTS idx_ai_embeddings_source_type
  ON public.ai_embeddings(source_type);

-- Replace match_embeddings to support optional source_type filtering
CREATE OR REPLACE FUNCTION public.match_embeddings(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 5,
  source_filter text[] DEFAULT NULL
)
RETURNS TABLE(id uuid, content text, metadata jsonb, similarity double precision, source_type text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    ae.id,
    ae.content,
    ae.metadata,
    1 - (ae.embedding <=> query_embedding) AS similarity,
    ae.source_type
  FROM ai_embeddings ae
  WHERE 1 - (ae.embedding <=> query_embedding) > match_threshold
    AND (source_filter IS NULL OR ae.source_type = ANY(source_filter))
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$function$;