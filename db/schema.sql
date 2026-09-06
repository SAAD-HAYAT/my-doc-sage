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
