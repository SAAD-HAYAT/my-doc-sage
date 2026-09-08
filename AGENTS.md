# Agent Instructions

You are helping build NotesRAG, a personal RAG chatbot, **in phases**.
Read this file fully before writing any code.

## Ground rules

1. **Work one phase at a time.** Phase docs live in
   `docs/phase-1-basic-rag.md` through `docs/phase-6-eval-harness.md`. Do
   not implement logic from a later phase while working on an earlier
   one, even if it seems convenient — the point of this project is to
   build up complexity incrementally as a learning exercise, not to ship
   the most complete system in one pass.
2. **Do not move to the next phase until the current phase's acceptance
   criteria are met and its tests pass.** Phase 1 has no tests yet
   (that's Phase 2's job) — build the feature, then Phase 2 covers it
   with tests before anything else continues.
3. **Respect the frontend/backend split.** The frontend and backend now
   live in one repo. The frontend (`app/layout.tsx`, `app/page.tsx`,
   `app/globals.css`, `app/error.tsx`, `app/not-found.tsx`,
   `components/`, `hooks/`, `lib/utils.ts`, `lib/notes-rag-api.ts`,
   `public/`, `components.json`, `postcss.config.mjs`, Tailwind theme)
   was migrated in from Lovable and is **behaviorally frozen** — don't
   restyle, rename, or restructure it. Backend phase work touches only
   `app/api/`, the backend modules in `lib/` (`supabase.ts`,
   `openrouter.ts`, `chunking.ts`, `retrieval.ts`, `tools.ts`), `db/`,
   `tests/`, and `scripts/`. The API contract in `docs/api-contract.md`
   is fixed — don't change route shapes or response fields without
   flagging it to the user first, since the frontend was built against
   that exact contract.
4. **Keep Phase 1 simple.** No agent loops, no tool calling, no
   reranking — just a straight retrieve-then-generate pipeline. Resist
   adding robustness or abstractions that belong to a later phase.
5. **Ask before adding new dependencies** not already in `package.json`
   — this project is meant to stay lean and easy to reason about.

## Tech decisions already made (don't relitigate these)

- Backend: Next.js API routes (App Router), TypeScript
- DB + vectors: Supabase Postgres with the `pgvector` extension
- LLM + embeddings: OpenRouter — `liquid/lfm-2.5-embedding-350m:free` for
  embeddings (1024-dim, 512-token input cap — keep chunks under that),
  `openai/gpt-oss-120b:free` (or the `openrouter/free` router) for
  generation
- Testing: Vitest

## Environment variables

See `.env.example`. You'll need `OPENROUTER_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

## Where to start

Open `docs/phase-1-basic-rag.md` and work through its task list top to
bottom.
