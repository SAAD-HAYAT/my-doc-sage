# Phase 9 — Trimmed oversized uploads

> This phase follows the completed Phase 8 upload-limit and OCR work. It keeps
> the server-side 4 MiB safety boundary while preserving a useful prefix of an
> oversized document in the browser.

## Goal

When a PDF or Markdown file is too large, upload as much complete content from
the beginning as will safely fit and clearly tell the user what context the
chatbot received.

## Decisions

- The API still rejects files at or above 4 MiB. Trimming happens in the
  browser, before multipart upload, so requests stay below Vercel's limit.
- Oversized PDFs are rebuilt as the largest complete prefix of pages that is
  smaller than 4 MiB. If rebuilding the PDF makes every page fit, it is treated
  as optimized rather than trimmed.
- Oversized Markdown keeps the largest prefix of complete lines below the
  limit.
- The existing `File size too large` toast remains. Its description states the
  retained range and the last page or line available to the chatbot.
- Trim metadata is stored on the document row and returned by the documents
  API so the label remains after refresh or sign-in.

## Tasks

- [x] Add browser-side PDF and Markdown prefix trimming.
- [x] Keep the size warning toast and explain the chatbot context boundary.
- [x] Persist trim metadata with each document.
- [x] Show `Trimmed: pages 1–N of M` beside trimmed PDFs.
- [x] Validate trim metadata at the API boundary.
- [x] Add focused unit and route tests.

## Acceptance criteria

- Uploading an oversized multi-page PDF sends the largest complete page prefix
  that is smaller than 4 MiB.
- The warning toast says how many pages were retained and through which page
  the chatbot has context.
- The uploaded document displays `Trimmed: pages 1–N of M`, including after a
  page refresh.
- Direct oversized requests still receive HTTP 413 without a database write.
- Invalid trim metadata receives HTTP 400 without a database write.

## Deployment note

Reapply `db/schema.sql` in Supabase before deploying the application code. It
adds the nullable `trimmed_unit`, `included_count`, and `source_count` columns
without deleting existing documents.
