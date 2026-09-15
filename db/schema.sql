create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  status text not null default 'processing', -- processing | ready | failed
  created_at timestamptz not null default now()
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  embedding vector(1024), -- matches liquid/lfm-2.5-embedding-350m:free output dim
  content_tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);

-- Re-running this file against a database where these tables already
-- exist (CREATE TABLE IF NOT EXISTS is a no-op there) needs these to
-- actually add the columns -- same reasoning as match_chunks below being
-- CREATE OR REPLACE.
--
-- Phase 7 (auth): user_id is NOT NULL with no default, so this only
-- succeeds on a table with zero existing rows. This project's
-- pre-Phase-7 documents/chunks/messages rows predated per-user
-- ownership and had no owner to assign -- they were wiped by hand
-- (once, manually, NOT by a statement in this file: a destructive
-- statement here would re-wipe real data every time this file is
-- re-applied in the future, which defeats the whole point of this file
-- being safely re-runnable). If you're hitting a not-null violation
-- here, truncate first: `truncate table messages, chunks, documents
-- cascade;` -- but only if you actually mean to discard that data.
alter table chunks add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;
alter table documents add column if not exists user_id uuid references auth.users(id) on delete cascade not null;
alter table chunks add column if not exists user_id uuid references auth.users(id) on delete cascade not null;

create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_content_tsv_idx
  on chunks using gin (content_tsv);

create index if not exists documents_user_id_idx on documents (user_id);
create index if not exists chunks_user_id_idx on chunks (user_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id text not null,
  role text not null, -- user | assistant
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);

alter table messages add column if not exists user_id uuid references auth.users(id) on delete cascade not null;

create index if not exists messages_session_idx on messages (session_id, created_at);
create index if not exists messages_user_id_idx on messages (user_id);

-- Phase 7: row level security, per-user ownership.
--
-- This is a BACKSTOP, not the only check -- application code (see
-- app/api/*, lib/tools.ts) explicitly filters every query by the
-- authenticated user's id too, even when using the service-role client
-- below (which bypasses RLS entirely, by Supabase's design, so it needs
-- the application-level filter regardless of what RLS says).
alter table documents enable row level security;
alter table chunks enable row level security;
alter table messages enable row level security;

drop policy if exists "documents_owner_all" on documents;
create policy "documents_owner_all" on documents
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "chunks_owner_all" on chunks;
create policy "chunks_owner_all" on chunks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "messages_owner_all" on messages;
create policy "messages_owner_all" on messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Phase 7: match_chunks/hybrid_search below are called via the
-- service-role ("supabaseAdmin") client, which bypasses RLS entirely --
-- so unlike a normal table query, RLS provides ZERO protection for these
-- functions on its own. Both now take a required p_user_id and filter by
-- it explicitly inside the function body.
--
-- IMPORTANT: CREATE OR REPLACE FUNCTION only replaces a function with the
-- EXACT SAME parameter list; since p_user_id is a new, added parameter,
-- re-running this against a database that already has the old
-- (unscoped) versions would leave BOTH signatures callable side by side
-- -- including the old one that returns every user's chunks. The DROP
-- statements below remove the old signatures outright before the new
-- ones are (re)created, so no unscoped overload is ever left reachable.
drop function if exists match_chunks(vector(1024), int);
drop function if exists hybrid_search(vector(1024), text, int);

-- Phase 1: cosine-similarity search over chunks. Raw `<=>` ordering isn't
-- expressible through the supabase-js query builder, so retrieval goes
-- through this function via supabase.rpc("match_chunks", ...). Currently
-- unused by application code (Phase 5 switched to hybrid_search below);
-- kept and still user-scoped for reference/safety rather than left as a
-- dangerous unscoped function sitting in the database.
create function match_chunks(
  query_embedding vector(1024),
  p_user_id uuid,
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
    and c.user_id = p_user_id
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
create function hybrid_search(
  query_embedding vector(1024),
  query_text text,
  p_user_id uuid,
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
      and c.user_id = p_user_id
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
      and c.user_id = p_user_id
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
