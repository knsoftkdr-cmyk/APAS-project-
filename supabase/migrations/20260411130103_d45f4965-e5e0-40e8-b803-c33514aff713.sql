
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create ai_embeddings table
CREATE TABLE public.ai_embeddings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content text NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create knowledge_chunks table
CREATE TABLE public.knowledge_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name text NOT NULL,
  chunk_text text NOT NULL,
  subject text,
  class_level text,
  curriculum text,
  embedding_id uuid REFERENCES public.ai_embeddings(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_embeddings
CREATE POLICY "Authenticated users can read embeddings"
  ON public.ai_embeddings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage embeddings"
  ON public.ai_embeddings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can manage embeddings"
  ON public.ai_embeddings FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- RLS policies for knowledge_chunks
CREATE POLICY "Authenticated users can read chunks"
  ON public.knowledge_chunks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage chunks"
  ON public.knowledge_chunks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can manage chunks"
  ON public.knowledge_chunks FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin')
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- Create similarity search function
CREATE OR REPLACE FUNCTION public.match_embeddings(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    ae.id,
    ae.content,
    ae.metadata,
    1 - (ae.embedding <=> query_embedding) AS similarity
  FROM ai_embeddings ae
  WHERE 1 - (ae.embedding <=> query_embedding) > match_threshold
  ORDER BY ae.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Create index for faster similarity search
CREATE INDEX ON public.ai_embeddings
  USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);
