# NotesRAG — Personal RAG Portfolio Project

A personal knowledge-base chatbot: upload your notes (PDF/Markdown), ask
questions, get answers grounded in your own documents.

## Stack

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui —
  originally generated via Lovable, now migrated into this repo (see
  `docs/api-contract.md` for the exact prompt and the contract it expects)
- **Backend**: Next.js API routes (`app/api/`)
- **Database + vector store**: Supabase (Postgres + pgvector)
- **LLM + embeddings**: OpenRouter (free-tier models)

## How this repo is organized

The backend is built in six phases, each documented in `docs/phase-N-*.md`.
Every phase doc has a goal, a task list, files to touch, and acceptance
criteria. Build them **in order**.

| Phase | Focus |
|---|---|
| 1 | Basic RAG loop (ingest → embed → store → retrieve → generate) |
| 2 | Testing foundation (Vitest + CI) |
| 3 | Tool calling |
| 4 | Agentic loop (ReAct-style retrieval) |
| 5 | Advanced retrieval (hybrid search, reranking, citations) |
| 6 | Eval harness |

If you're using an AI coding agent (Claude Code, Cursor, etc.) to help build
this, point it at `AGENTS.md` first — it has the ground rules.

## Project layout

```
app/
  layout.tsx, page.tsx, globals.css   frontend (client-rendered)
  error.tsx, not-found.tsx
  api/                                backend route handlers
components/   ui/ (shadcn), ai-elements/, notes-rag/
hooks/
lib/          utils.ts, notes-rag-api.ts (frontend) + backend logic
db/           schema.sql
docs/         api-contract.md + phase docs
tests/        Vitest suites
scripts/      eval.ts
```

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase + OpenRouter keys
3. Run `db/schema.sql` against your Supabase project (SQL editor, or `supabase db push`)
4. `npm run dev`
