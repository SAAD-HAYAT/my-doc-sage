# Phase 1 — Basic RAG Loop

## Goal

Get ingestion → embedding → storage → retrieval → generation working end
to end, with no agent logic. Straight pipeline: user asks something, you
retrieve the top-k chunks, stuff them into a prompt, call the LLM, return
the answer.

## Tasks

- [ ] `db/schema.sql`: create `documents`, `chunks` (with a `vector`
      column), and `messages` tables in Supabase; enable the `pgvector`
      extension.
- [ ] `lib/supabase.ts`: Supabase client (server-side, service role key).
- [ ] `lib/openrouter.ts`: implement `embed(text)` and `chat(messages)`,
      calling OpenRouter's OpenAI-compatible `/embeddings` and
      `/chat/completions` endpoints.
- [ ] `lib/chunking.ts`: split raw text into ~300–400 token chunks with
      some overlap. Keep it simple — fixed-size chunking, no semantic
      splitting yet.
- [ ] `app/api/documents/route.ts`: `POST` parses the uploaded
      PDF/Markdown, chunks it, embeds each chunk, stores it. `GET` lists
      documents.
- [ ] `app/api/documents/[id]/route.ts`: `DELETE` removes a document and
      its chunks.
- [ ] `lib/retrieval.ts`: embed a query and run a cosine-similarity
      search (`<=>` operator) against `chunks`, returning top-k.
- [ ] `app/api/chat/route.ts`: `POST` — retrieve top-k chunks for the
      message, build a prompt with the context, call the LLM, save the
      exchange to `messages`, return the answer + sources.
- [ ] `app/api/chat/[sessionId]/route.ts`: `GET` — return message history
      for a session.

## Acceptance criteria

- You can upload a PDF or markdown file and see it show up as "ready".
- You can ask a question in the chat and get an answer clearly grounded
  in the uploaded document (test with a fact that only exists in your
  notes).
- Sources are returned alongside the answer.

## Out of scope for this phase

No tool calling, no agent loop, no reranking, no hybrid search, no tests
yet (that's Phase 2).
