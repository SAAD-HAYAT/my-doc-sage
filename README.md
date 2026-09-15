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

The backend is built in phases, each documented in `docs/phase-N-*.md`.
Every phase doc has a goal, a task list, files to touch, and acceptance
criteria. Build them **in order**. Phases 1-6 were the original roadmap;
Phase 7 (auth) was added afterward as new scope.

| Phase | Focus |
|---|---|
| 1 | Basic RAG loop (ingest → embed → store → retrieve → generate) |
| 2 | Testing foundation (Vitest + CI) |
| 3 | Tool calling |
| 4 | Agentic loop (ReAct-style retrieval) |
| 5 | Advanced retrieval (hybrid search, query rewriting, citations) |
| 6 | Eval harness |
| 7 | Auth (Google-only SSO, per-user data isolation) |

If you're using an AI coding agent (Claude Code, Cursor, etc.) to help build
this, point it at `AGENTS.md` first — it has the ground rules.

## Project layout

```
app/
  layout.tsx, page.tsx, globals.css   frontend (client-rendered)
  error.tsx, not-found.tsx
  login/                              Phase 7: sign-in page
  auth/callback/                      Phase 7: OAuth code exchange
  api/                                backend route handlers
components/   ui/ (shadcn), ai-elements/, notes-rag/
hooks/
lib/          utils.ts, notes-rag-api.ts (frontend) + backend logic
              supabase.ts (admin/service-role client)
              supabase-server.ts, supabase-browser.ts (Phase 7: @supabase/ssr clients)
middleware.ts Phase 7: session refresh + page-route auth redirect
db/           schema.sql
docs/         api-contract.md + phase docs
tests/        Vitest suites
scripts/      eval.ts
```

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase + OpenRouter keys
   (including the Phase 7 `NEXT_PUBLIC_SUPABASE_*` ones — see Supabase's
   dashboard under Project Settings > API)
3. Run `db/schema.sql` against your Supabase project (SQL editor, or `supabase db push`)
4. `npm run dev`, then sign in with Google at `/login`
