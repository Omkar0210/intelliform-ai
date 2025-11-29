-- Fix security warnings: set search_path on functions

-- Update update_updated_at function with proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Update find_similar_forms function with proper search_path
CREATE OR REPLACE FUNCTION public.find_similar_forms(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  summary text,
  similarity float
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.title,
    f.summary,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM forms f
  WHERE 
    f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
    AND (p_user_id IS NULL OR f.user_id = p_user_id)
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;