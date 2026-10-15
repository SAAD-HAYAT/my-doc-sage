# Phase 12 — Structured spreadsheet queries

> This phase follows Phase 11 chat-generated files. It keeps semantic RAG for
> narrative questions while adding deterministic operations for exhaustive
> Excel filtering and calculation.

## Goal

Answer workbook totals, counts, averages, minimums, maximums, grouped results,
filters, and row lookups from every retained spreadsheet row rather than from a
small set of semantically retrieved chunks.

## Decisions

- Excel ingestion continues to produce retrieval-friendly text chunks for
  descriptive questions and summaries.
- The same ingestion pass also stores typed worksheet metadata and populated
  data rows in user-scoped `spreadsheet_sheets` and `spreadsheet_rows` tables.
- Structured cells retain their original coordinate, header, text, native
  numeric/date/boolean value, formula text, and cached formula result when one
  exists. Formulas are not recalculated.
- `inspect_spreadsheet` exposes workbook schemas to the agent.
- `query_spreadsheet` supports only whitelisted operations and filters. It does
  not execute model-authored SQL, JavaScript, or Excel formulas.
- Every database read and write is explicitly scoped by authenticated user ID,
  in addition to RLS policies on both new tables.
- Financial sums use decimal-string arithmetic rather than floating-point
  addition. The tool reports matched, numeric, and skipped-non-numeric counts.
- Query calculations scan all retained rows using bounded pagination. Returned
  evidence is capped for prompt size, but that cap never limits calculation.
- The existing chat API response shape remains unchanged. A deterministic
  calculation is represented as one score-1 source containing its operation,
  result, match count, and worksheet references.
- Workbooks uploaded before this phase must be re-uploaded because their typed
  rows were not stored and cannot be reconstructed reliably from text chunks.
- Queries against trimmed workbooks include the retained-row scope so answers
  can disclose that the source was partial.

## Supported operations

- `sum`, `count`, `count_distinct`, `average`, `minimum`, `maximum`, and `rows`
- Optional grouping by one column
- Up to eight AND/OR filters using `contains`, `equals`, `starts_with`,
  `ends_with`, numeric comparisons, `between`, and blank checks
- Up to twenty returned columns and one hundred displayed rows; calculations
  remain exhaustive regardless of display limits

## Acceptance criteria

- A newly uploaded `.xlsx` stores typed sheet metadata and data rows as well as
  the existing chunks and embeddings.
- Upload failures remove partial chunks, sheet metadata, and typed rows before
  the document receives its `failed` status.
- The agent uses structured queries—not semantic chunk retrieval—for exhaustive
  spreadsheet calculations.
- Column resolution is case-insensitive, supports a unique normalized alias,
  and rejects unknown or duplicate columns instead of guessing.
- A regression workbook with more than twenty matching rows returns the exact
  result, match count, skipped-value count, and source references.
- Legacy Excel uploads return a clear re-upload instruction.
- PDF and Markdown ingestion, ordinary RAG questions, authentication, chat
  history, and the public API response shapes continue to work unchanged.
