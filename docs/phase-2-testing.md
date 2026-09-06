# Phase 2 — Testing Foundation

## Goal

Before adding more complexity, build a safety net so you can tell
whether later changes actually help or quietly break something.

## Tasks

- [ ] Install Vitest, add an `npm run test` script.
- [ ] `tests/chunking.test.ts`: unit tests for `lib/chunking.ts` — chunk
      sizes, overlap behavior, edge cases (empty doc, doc smaller than
      one chunk).
- [ ] `tests/retrieval.test.ts`: seed a small known set of chunks
      (mocked or a test Supabase schema) and assert that a handful of
      known questions retrieve the expected chunk in the top-k. This is
      your first retrieval regression test.
- [ ] Mock the OpenRouter client in tests — don't hit the real API in
      CI. Wrap `lib/openrouter.ts` calls behind an interface you can
      stub.
- [ ] Add a GitHub Actions workflow (`.github/workflows/test.yml`, a
      starting version is already in this repo) that runs `npm test` on
      every push/PR.

## Acceptance criteria

- `npm test` passes locally.
- Tests run automatically on push via GitHub Actions.
- At least 5 known question → expected-chunk pairs are covered by the
  retrieval test.

## Out of scope

No new product features this phase — purely testing infrastructure.
