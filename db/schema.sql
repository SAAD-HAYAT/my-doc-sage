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
  content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);

-- Re-running this file against a database where `chunks` already exists
-- (CREATE TABLE IF NOT EXISTS is a no-op there) needs this to actually add
-- the column -- same reasoning as match_chunks below being CREATE OR REPLACE.
alter table chunks add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_content_tsv_idx
  on chunks using gin (content_tsv);

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

-- Phase 5: hybrid search. Hands back the top `match_count` candidates from
-- vector similarity AND the top `match_count` from full-text search in one
-- round trip, each tagged with its rank in that list (null if a chunk
-- didn't place in it). Deliberately does NOT compute a single fused score
-- here -- reciprocal rank fusion happens in lib/retrieval.ts, both because
-- it's simple enough not to need a second round trip through SQL and
-- because keeping the fusion math in TS makes it unit-testable without a
-- database.
--
-- The full-text side ORs its terms together rather than ANDing them.
-- websearch_to_tsquery/plainto_tsquery default to AND, which is fine for a
-- search box but too strict for retrieval ranking: a real user question is
-- a full sentence ("What certification does Saad have, and when did he get
-- it?"), and requiring every content word (certification & saad & get) to
-- appear in the SAME chunk routinely matches zero chunks even when the
-- answer is right there in a nearby chunk -- confirmed live against a real
-- question during Phase 5 verification, where an AND query returned 0
-- full-text rows despite the answer chunk being right next to the top
-- vector hit. plainto_tsquery(...)::text is already safely stemmed/escaped
-- (handles punctuation, quotes etc. the way websearch_to_tsquery does), so
-- rewriting its '&' to '|' and re-parsing with to_tsquery is a safe,
-- standard way to turn it into an OR query without re-exposing raw user
-- input to tsquery's operator syntax.
create or replace function hybrid_search(
  query_embedding vector(1024),
  query_text text,
  match_count int default 20
)
returns table (
  content text,
  document_name text,
  vector_rank int,
  fulltext_rank int
)
language sql
stable
as $$
  with query_tsq as (
    select to_tsquery('english', replace(plainto_tsquery('english', query_text)::text, ' & ', ' | ')) as q
  ),
  vector_matches as (
    select
      c.id,
      c.content,
      d.name as document_name,
      row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c
    join documents d on d.id = c.document_id
    where c.embedding is not null
    order by c.embedding <=> query_embedding
    limit match_count
  ),
  fulltext_matches as (
    select
      c.id,
      c.content,
      d.name as document_name,
      row_number() over (order by ts_rank(c.content_tsv, query_tsq.q) desc) as rnk
    from chunks c
    join documents d on d.id = c.document_id
    cross join query_tsq
    where query_tsq.q is not null
      and c.content_tsv @@ query_tsq.q
    order by ts_rank(c.content_tsv, query_tsq.q) desc
    limit match_count
  )
  select
    coalesce(v.content, f.content) as content,
    coalesce(v.document_name, f.document_name) as document_name,
    v.rnk as vector_rank,
    f.rnk as fulltext_rank
  from vector_matches v
  full outer join fulltext_matches f on v.id = f.id;
$$;
