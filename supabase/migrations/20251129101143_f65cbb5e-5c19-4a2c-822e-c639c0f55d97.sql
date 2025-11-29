-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create forms table with embedding support
CREATE TABLE public.forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL,
  summary TEXT, -- Summarized version for context retrieval
  embedding vector(768), -- For similarity search
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create submissions table
CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  responses JSONB NOT NULL,
  image_urls TEXT[] DEFAULT '{}',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for vector similarity search
CREATE INDEX forms_embedding_idx ON public.forms 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Create index for faster form lookups
CREATE INDEX forms_user_id_idx ON public.forms(user_id);
CREATE INDEX submissions_form_id_idx ON public.submissions(form_id);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Forms policies
CREATE POLICY "Users can view own forms" ON public.forms
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view published forms" ON public.forms
  FOR SELECT USING (is_published = true);

CREATE POLICY "Users can create forms" ON public.forms
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own forms" ON public.forms
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own forms" ON public.forms
  FOR DELETE USING (auth.uid() = user_id);

-- Submissions policies (anyone can submit to published forms)
CREATE POLICY "Anyone can submit to forms" ON public.submissions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.forms WHERE id = form_id AND is_published = true)
  );

CREATE POLICY "Form owners can view submissions" ON public.submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.forms WHERE id = form_id AND user_id = auth.uid())
  );

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  );
  RETURN NEW;
END;
$$;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_forms_updated_at
  BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Function to find similar forms using cosine similarity
CREATE OR REPLACE FUNCTION public.find_similar_forms(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  summary TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.title,
    f.summary,
    1 - (f.embedding <=> query_embedding) as similarity
  FROM public.forms f
  WHERE 
    f.embedding IS NOT NULL
    AND (p_user_id IS NULL OR f.user_id = p_user_id)
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;