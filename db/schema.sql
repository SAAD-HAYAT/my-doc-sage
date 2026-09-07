create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'processing', -- processing | ready | failed
  created_at timestamptz not null default now()
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  embedding vector(1024), -- matches liquid/lfm-2.5-embedding-350m:free output dim
  created_at timestamptz not null default now()
);

create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  role text not null, -- user | assistant
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_idx on messages (session_id, created_at);

-- Phase 1: cosine-similarity search over chunks. Raw `<=>` ordering isn't
-- expressible through the supabase-js query builder, so retrieval goes
-- through this function via supabase.rpc("match_chunks", ...).
create or replace function match_chunks(
  query_embedding vector(1024),
  match_count int default 5
)
returns table (
  content text,
  document_name text,
  similarity float
)
language sql
stable
as $$
  select
    c.content,
    d.name as document_name,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
