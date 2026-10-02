# Phase 10 — Excel uploads and What's new

> This phase follows the completed Phase 9 oversized-upload work. It extends
> the same retrieval and 4 MiB safety model to modern Excel workbooks and adds
> a lightweight release-announcement surface.

## Goal

Let users upload `.xlsx` workbooks, ask questions about their cell data, and
request summaries. Make new capabilities discoverable without adding another
backend or database workflow.

## Decisions

- Only `.xlsx` is accepted. Legacy `.xls`, macro-enabled `.xlsm`, and CSV are
  outside this phase.
- Every populated row is converted to retrieval text containing its worksheet,
  row number, coordinates, values, and first populated row as header context.
- Hidden worksheets are included. Images, charts, comments, styles, and macros
  are not indexed.
- Formula text and its last saved cached result are indexed. Formulas are not
  recalculated during ingestion.
- Oversized workbooks are rebuilt without formatting/media and keep the largest
  complete populated-row prefix below 4 MiB.
- What's new announcements are code-defined and remembered in local storage by
  authenticated user id. No database migration is needed.

## Tasks

- [x] Add ExcelJS and shared workbook parsing/normalization.
- [x] Accept and ingest `.xlsx` through the documents API.
- [x] Add workbook-aware browser trimming and persistent row metadata.
- [x] Add an automatically opened, reopenable What's new dialog.
- [x] Update the API contract and product copy.
- [x] Add focused extraction, trimming, route, and announcement tests.

## Acceptance criteria

- A valid multi-sheet `.xlsx` becomes ready and its cell values are available
  to retrieval with worksheet and header context.
- An oversized workbook uploads either all optimized rows or the largest row
  prefix below 4 MiB and displays `Trimmed: rows 1–N of M` when truncated.
- Invalid, encrypted, empty, and unsupported workbooks do not create document
  rows and return a clear upload error.
- The latest announcement opens once per signed-in user in a browser, shows an
  unread indicator until dismissed, and remains available from the top bar.
