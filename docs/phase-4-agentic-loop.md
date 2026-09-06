# Phase 4 — Agentic Loop

## Goal

Turn the single tool call into a small ReAct-style loop: the model can
call `search_notes` multiple times, reason about whether it has enough
information, and decide when to stop.

## Tasks

- [ ] Refactor `app/api/chat/route.ts`'s handler into a loop (cap it at,
      say, 4 iterations to avoid runaway costs): call the model → if it
      requests a tool, execute and feed the result back → if it returns
      a final answer, stop.
- [ ] Add a lightweight self-check: after the model produces an answer,
      do one more call asking it to verify the answer is actually
      supported by the retrieved chunks (or fold this into the same call
      via prompting — your choice, but write down which approach and
      why).
- [ ] Log each loop iteration (tool called, arguments, result summary)
      somewhere you can inspect — genuinely useful for debugging agents
      later.
- [ ] Add tests: a scenario where one search isn't enough (e.g. a
      question needing two different documents) and verify the loop
      calls the tool more than once.

## Acceptance criteria

- You can ask a question that requires pulling from two different
  documents and watch the model search twice.
- The loop has a hard iteration cap and fails gracefully (returns a
  "couldn't find a confident answer" message) instead of looping
  forever.

## Out of scope

No hybrid search or reranking yet — retrieval quality itself doesn't
change here, just how many times and how deliberately it's invoked.
