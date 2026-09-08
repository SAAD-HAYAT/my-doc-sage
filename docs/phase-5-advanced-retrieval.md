# Phase 5 — Advanced Retrieval

## Goal

Improve retrieval quality itself, one technique at a time, measuring
each change against your Phase 2 tests (and, once it exists, your Phase
6 eval harness).

## Tasks (pick these up incrementally — don't do all at once)

- [ ] **Hybrid search**: combine pgvector cosine similarity with
      Postgres full-text search (`tsvector`/`tsquery`) and merge results
      (e.g. reciprocal rank fusion).
- [ ] **Reranking**: retrieve top-20 by vector similarity, then rerank
      to top-5 using a cross-encoder or an LLM-as-reranker call.
- [ ] **Query rewriting**: before embedding the user's question, ask the
      model to rewrite it into a more search-friendly form (handles
      vague follow-ups like "what about the second one?").
- [ ] **Citations**: return exact chunk spans/document names with the
      answer, and have the model reference them inline (e.g. "[1]").

## Acceptance criteria

- For each technique, add a before/after comparison using your Phase 2
  retrieval tests — did hit rate improve, stay flat, or regress?
- Record which techniques you kept and why, in this file.

## Out of scope

Don't add all four at once — ship and evaluate one at a time.

## Results log

<!-- Fill this in as you go: technique, before/after hit rate, decision -->
