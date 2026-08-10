-- Phase 1: AI primitives foundation — vector knowledge base, model routing, web search, traces.

-- Enable pgvector for tenant-scoped semantic search.
create extension if not exists vector;

-- Documents: tenant-owned source files for the knowledge base.
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  content_type TEXT NOT NULL DEFAULT 'text/plain',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents tenant read" ON public.documents
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "documents tenant insert" ON public.documents
  FOR INSERT TO authenticated WITH CHECK (public.has_org_access(org_id) AND user_id = auth.uid());
CREATE POLICY "documents tenant update" ON public.documents
  FOR UPDATE TO authenticated USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));
CREATE POLICY "documents tenant delete" ON public.documents
  FOR DELETE TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "super admin read documents" ON public.documents
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- Document chunks: searchable slices with embeddings.
CREATE TABLE public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding vector(3072) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chunks tenant read" ON public.document_chunks
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "chunks tenant insert" ON public.document_chunks
  FOR INSERT TO authenticated WITH CHECK (public.has_org_access(org_id));
CREATE POLICY "chunks tenant update" ON public.document_chunks
  FOR UPDATE TO authenticated USING (public.has_org_access(org_id)) WITH CHECK (public.has_org_access(org_id));
CREATE POLICY "chunks tenant delete" ON public.document_chunks
  FOR DELETE TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "super admin read chunks" ON public.document_chunks
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- HNSW index for 3072-dim vectors via halfvec cast.
create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

-- Semantic search function: returns tenant-scoped chunks ordered by cosine similarity.
create or replace function public.match_document_chunks(
  _org_id uuid,
  _query_embedding vector(3072),
  _match_count int default 5,
  _document_ids uuid[] default null
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
security definer
set search_path = public
as $$
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    dc.metadata,
    1 - (dc.embedding::halfvec(3072) <=> _query_embedding::halfvec(3072))::float as similarity
  from public.document_chunks dc
  where dc.org_id = _org_id
    and (_document_ids is null or dc.document_id = any(_document_ids))
  order by dc.embedding::halfvec(3072) <=> _query_embedding::halfvec(3072)
  limit _match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(uuid, vector(3072), int, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(uuid, vector(3072), int, uuid[]) TO service_role;

-- Tool traces: per-call observability for latency, cost, model and outcome.
CREATE TABLE public.tool_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id UUID,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  provider TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

GRANT ALL ON public.tool_traces TO service_role;

ALTER TABLE public.tool_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "traces tenant read" ON public.tool_traces
  FOR SELECT TO authenticated USING (public.has_org_access(org_id));
CREATE POLICY "super admin read traces" ON public.tool_traces
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- Restrictive policy: only service_role can insert/update/delete traces.
CREATE POLICY "traces service insert" ON public.tool_traces
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "traces service update" ON public.tool_traces
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY "traces service delete" ON public.tool_traces
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- Model routing settings on workspaces.
ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS default_model TEXT NOT NULL DEFAULT 'google/gemini-3.5-flash',
  ADD COLUMN IF NOT EXISTS cost_quality_tier TEXT NOT NULL DEFAULT 'balanced';

ALTER TABLE public.org_settings
  DROP CONSTRAINT IF EXISTS org_settings_cost_quality_tier_check,
  ADD CONSTRAINT org_settings_cost_quality_tier_check
    CHECK (cost_quality_tier IN ('economy', 'balanced', 'quality'));

-- Grant continued access to the modified org_settings table.
GRANT SELECT, INSERT, UPDATE ON public.org_settings TO authenticated;
GRANT ALL ON public.org_settings TO service_role;

-- Seed model routing defaults for existing workspaces.
UPDATE public.org_settings
SET default_model = 'google/gemini-3.5-flash',
    cost_quality_tier = 'balanced'
WHERE default_model IS NULL;
