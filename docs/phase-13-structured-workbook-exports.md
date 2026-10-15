# Phase 13 — Structured workbook exports

> This phase follows Phase 12 structured spreadsheet queries. It closes the
> gap between reliable workbook calculations and chat-generated Excel files.

## Goal

Generate downloadable, multi-sheet Excel workbooks from every retained row of
an uploaded workbook instead of asking the model to recreate data from a small
set of semantic-search passages.

## Decisions

- The existing chat-triggered file workflow remains the entry point. No
  separate Excel button or public `generate_spreadsheet` agent tool is added.
- The model creates a validated workbook plan. It may choose direct mode for a
  new template or structured mode for exports based on uploaded Excel data.
- A structured plan may contain up to twelve worksheets and mix:
  - row worksheets with selected columns and whitelisted filters;
  - summary worksheets containing deterministic scalar metrics.
- Structured row sheets use Phase 12's typed row store and scan every retained
  row. The model never receives or reproduces the complete source dataset.
- A `*` filter target performs a row-wide keyword match for workbooks whose
  headers are shifted, inaccurate, or inconsistent across appended sections.
- If a model-selected text column returns no rows, generation retries that
  keyword across all populated columns, includes all source columns, and writes
  an export note explaining the recovery. If nothing matches, generation fails
  clearly instead of downloading an empty workbook.
- Summary metrics use the same exact-decimal aggregation path as chat answers.
- Numeric and boolean values remain typed in the generated workbook. Dates are
  represented deterministically as ISO text and formulas use cached results.
- Output rows include their source worksheet and original row number.
- Trimmed source scope is written into the generated workbook.
- Direct, narrative workbook generation remains available and preserves the
  existing API response shape.

## Limits

- Twelve output worksheets.
- Fifty structured queries per workbook.
- Twenty explicitly selected columns per row query.
- Twenty-five metrics per summary worksheet.
- Row exports inherit the 10,000 populated-row ingestion bound.

## Acceptance criteria

- A workbook request can generate multiple row and summary worksheets.
- Row exports are not limited by semantic retrieval or the interactive
  100-row display cap.
- Structured queries are authenticated and user-scoped.
- Unknown workbooks, worksheets, columns, malformed filters, and legacy
  workbooks fail clearly instead of generating incomplete data.
- Inconsistent header layouts can still export keyword matches without silently
  producing an empty workbook.
- Direct Excel, PDF, Markdown, and workbook-categorization behavior remains
  unchanged.
- The browser receives the existing generated-workbook payload and downloads a
  valid `.xlsx` without a public API shape change.
