# Phase 6 — Eval Harness

## Goal

Build a small, repeatable way to measure whether your RAG pipeline is
actually getting better, instead of relying on vibes.

## Tasks

- [ ] Write 15–20 question/answer pairs grounded in your own uploaded
      notes, stored as a fixture (`tests/fixtures/eval-set.json`) with
      `{ question, expectedChunkId, expectedAnswerContains }`.
- [ ] Build `scripts/eval.ts`: runs the full pipeline against each
      question and reports retrieval hit rate (was the expected chunk in
      top-k?) and a simple faithfulness check (does the answer
      contain/align with expected content?).
- [ ] Run this eval before and after each Phase 5 technique, and record
      results in `docs/phase-5-advanced-retrieval.md`.

## Acceptance criteria

- Running `npm run eval` prints a score summary (hit rate %, rough
  faithfulness %).
- You have a before/after comparison for at least one retrieval
  technique, with numbers, not just impressions.
