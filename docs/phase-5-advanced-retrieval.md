# Phase 5 — Advanced Retrieval

## Goal

Improve retrieval quality itself, one technique at a time, measuring
each change against your Phase 2 tests (and, once it exists, your Phase
6 eval harness).

## Tasks (pick these up incrementally — don't do all at once)

- [x] **Hybrid search**: combine pgvector cosine similarity with
      Postgres full-text search (`tsvector`/`tsquery`) and merge results
      (e.g. reciprocal rank fusion).
- [x] **Citations**: return exact chunk spans/document names with the
      answer, and have the model reference them inline (e.g. "[1]").
- [x] **Query rewriting**: before embedding the user's question, ask the
      model to rewrite it into a more search-friendly form (handles
      vague follow-ups like "what about the second one?").
- [x] **Reranking**: retrieve top-20 by vector similarity, then rerank
      to top-5 using a cross-encoder or an LLM-as-reranker call. --
      **tried, rejected** (see Results log).

## Acceptance criteria

- For each technique, add a before/after comparison using your Phase 2
  retrieval tests — did hit rate improve, stay flat, or regress?
- Record which techniques you kept and why, in this file.

## Out of scope

Don't add all four at once — ship and evaluate one at a time.

## Results log

### 1. Hybrid search — kept

`db/schema.sql` adds a generated `content_tsv` column + GIN index on
`chunks`, and a `hybrid_search()` function returning the top-20
candidates from vector similarity AND the top-20 from full-text search
in one round trip (each tagged with its rank in each list, null if
absent). `lib/retrieval.ts` fuses them via reciprocal rank fusion
(RRF, k=60), normalized back to 0-1 for the frontend's "N% match".

Found and fixed a real bug during verification: the first version used
`websearch_to_tsquery`, which ANDs all significant terms together. A
full sentence question ("What certification does Saad have, and when
did he get it?") decomposes to `certification & saad & get`, and no
single chunk contains all three — full-text search silently returned
**zero rows** for realistic questions. Fixed by OR-ing the terms
instead (`plainto_tsquery(...)::text` with `&` rewritten to `|`,
re-parsed via `to_tsquery`).

Before/after (Phase 2 retrieval tests): 9 → 11 tests, including a
dedicated "keyword match outranks a better pure-vector match once
fused" proof. Live: the chunk containing "AWS Cloud Foundations
(2024)" scored 0.4919 (vector-only) → 0.9839 (hybrid, post-fix) on the
exact certification question — a real, visible improvement, not just
a reshuffle. Also correctly separated cross-document questions
(wireframe PDF vs. resume) without cross-contamination.

### 2. Citations — kept

`lib/agent.ts` injects a system-role instruction (not editing
`route.ts`'s own prompt, which is outside this phase's file scope)
telling the model to cite `search_notes` passages inline as `[1]`,
`[2]`, etc., in the exact order the tool result array returns them.
Because `sources` is a direct, unmodified assignment of that same
array, `sources[0]` is *structurally guaranteed* to be the model's
`[1]` — not just conventionally expected to.

Live testing surfaced a real, separate limitation worth recording: the
numbering mechanism itself is reliable, but a weaker free-tier
fallback model can still misattribute a citation to the wrong number
even with correct passages in front of it (observed once: a fact was
correctly stated but cited `[2]` when it should have been `[3]`). This
is a free-model-quality limitation, not a wiring bug — a second live
run with the primary model handling the request cited both facts
correctly. Not something to build around further in this phase.

### 3. Query rewriting — kept

Retrieval only ever sees whatever string the *tool-calling model*
puts in `search_notes`'s `query` argument (Phase 3 replaced Phase 1's
direct, code-driven `retrieve()` call with model-driven tool calls) —
so instead of the phase doc's original "rewrite before calling
retrieve()" design, `lib/agent.ts` makes one extra `chat()` call (no
tools, skipped entirely on turn 1 when there's no history to rewrite
against) that restates the latest message as a self-contained query,
then injects it as a system-role *hint* the tool-calling model can
use when composing its own search — keeping the model in control of
query composition rather than forcibly overriding it.

Live-verified end to end: two-turn session ("Which company does Saad
work at?" → "Gengini", then "what does it do as a company?"). Server
log confirmed the rewrite fired and was followed:
`query rewrite: "what does it do as a company?" -> "What does Gengini
do as a company?"`, and the model's own subsequent searches both used
"Gengini" explicitly instead of the raw ambiguous "it".

### 4. Reranking — tried, rejected

Built a local cross-encoder reranker (`@huggingface/transformers`,
`Xenova/ms-marco-MiniLM-L-6-v2`, chosen over an LLM-as-reranker call
specifically to avoid adding another slow/rate-limited OpenRouter
round trip on top of an already-strained free tier) to rerank the
top-20 hybrid candidates to a final top-5. Fully implemented and
covered by 67/67 mocked tests, but **live verification showed it
actively hurting relevance on this corpus** and it was reverted.

What happened: for "What certification does Saad have, and when did
he get it?", the chunk containing the actual answer
("Certification: AWS Cloud Foundations (2024)") scored ~0 after
reranking, while a chunk with no mention of certifications at all
(the header/contact-info block) scored highest — Phase 4's
groundedness self-check correctly flagged the resulting answer as
unsupported.

Root-caused (confirmed locally, zero API cost) rather than assumed a
fluke: the model itself works correctly on textbook pairs (0.9996 vs
0.000015 on an obvious relevant/irrelevant example), but even the
cleanest possible isolated passage — just `"Certification: AWS Cloud
Foundations (2024)"` — scored strongly *negative* against every
natural-language phrasing of the question tried. The moment the query
was rephrased to echo the passage's own terminology
("AWS Cloud Foundations certification") instead of asking a question,
the same passage scored strongly positive. `ms-marco-MiniLM-L-6-v2`
was trained on MS MARCO's full-sentence web passages and doesn't
generalize to this corpus's short, resume-style "Field: Value" bullet
fragments when queried as natural questions — a genuine model/corpus
mismatch, not a code bug (verified: sign convention, tokenizer
ordering, and passage-length variants were all ruled out first).

Decision: dropped for now rather than patched around (e.g. blending
reranker/hybrid scores would paper over the root cause). Kept Steps
1-3's results as Phase 5's outcome. Worth revisiting with a
differently-trained or larger reranker model in a future pass if
retrieval quality issues persist after the Phase 6 eval harness gives
a real hit-rate signal to test against — this finding is specific to
*this* model on *this* corpus, not evidence against cross-encoder
reranking as an approach in general.
