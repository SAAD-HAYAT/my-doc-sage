# NotesRAG — Personal RAG Portfolio Project

A personal knowledge-base chatbot: upload your notes (PDF/Markdown), ask
questions, get answers grounded in your own documents.

## Stack

- **Frontend**: Next.js + TypeScript + Tailwind + shadcn/ui — generated
  separately via Lovable (see `docs/api-contract.md` for the exact prompt
  and the contract it expects)
- **Backend**: Next.js API routes (this repo)
- **Database + vector store**: Supabase (Postgres + pgvector)
- **LLM + embeddings**: OpenRouter (free-tier models)

## How this repo is organized

This project is built in six phases, each documented in
`docs/phase-N-*.md`. Every phase doc has a goal, a task list, files to
touch, and acceptance criteria. Build them **in order** — resist doing
Phase 4 things while you're still on Phase 1.

| Phase | Focus |
|---|---|
| 1 | Basic RAG loop (ingest → embed → store → retrieve → generate) |
| 2 | Testing foundation (Vitest + CI) |
| 3 | Tool calling |
| 4 | Agentic loop (ReAct-style retrieval) |
| 5 | Advanced retrieval (hybrid search, reranking, citations) |
| 6 | Eval harness |

If you're using an AI coding agent (Claude Code, Cursor, etc.) to help
build this, point it at `AGENTS.md` first — it has the ground rules.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase + OpenRouter keys
3. Run `db/schema.sql` against your Supabase project (SQL editor, or `supabase db push`)
4. `npm run dev`

## Frontend

The UI was generated separately via [Lovable](https://lovable.dev) — see
`docs/api-contract.md` for the exact prompt used. Drop the generated
frontend into `app/` alongside these API routes (or point it at wherever
this backend is deployed) — this repo only contains backend logic and
phase docs, not UI code.
