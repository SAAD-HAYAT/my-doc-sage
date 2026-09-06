# Phase 3 — Tool Calling

## Goal

Stop always retrieving. Give the model a `search_notes` tool and let it
decide when to use it, via OpenRouter's `tools` parameter.

## Tasks

- [ ] `lib/tools.ts`: define a `search_notes` tool schema (JSON schema
      for its arguments — e.g. `{ query: string, k?: number }`) and an
      executor function that calls `lib/retrieval.ts`.
- [ ] Add a second, trivial tool — `get_current_date` or
      `list_documents` — so you practice handling multiple tools in one
      loop.
- [ ] Update `lib/openrouter.ts`'s `chat` function to accept a `tools`
      array and handle the case where the model returns a `tool_calls`
      response instead of a final answer.
- [ ] Update `app/api/chat/route.ts`: on a tool call, execute the tool,
      append the result as a `tool` role message, and call the model
      again for the final answer (single round, no loop yet — that's
      Phase 4).
- [ ] Add a test: mock a model response that requests `search_notes`,
      verify your route executes it and constructs the follow-up message
      correctly.

## Acceptance criteria

- The model, not your code, decides whether to search your notes for a
  given question.
- You can see (e.g. via logs) the tool call request and its arguments.
- Tests from Phase 2 still pass; new tests cover the tool-calling path.

## Out of scope

No multi-step loops yet — the model gets exactly one chance to call a
tool before answering.
