# Phase 8 — Upload limits and PDF OCR

> This phase was added after Phase 7 passed live verification. It is narrowly
> scoped to safer document uploads and scanned-PDF support.

## Goal

Reject files that are too large before upload and extract text from both
text-native and scanned/image-only PDFs.

## Decisions

- The file limit is strictly less than 4 MiB. Vercel Functions reject request
  bodies above 4.5 MB before application code runs, and multipart encoding adds
  overhead, so 4 MiB is the safe deployed limit.
- The client shows `File size too large` and does not send oversized files.
- The API independently enforces the same limit and returns HTTP 413.
- PDF extraction is hybrid: preserve embedded text when a page has it; render
  sparse/image-only pages and OCR them with Tesseract.js.
- OCR defaults to English printed text. Corrupt, password-protected, or
  unsupported-encryption PDFs can still fail cleanly; no OCR engine can
  guarantee successful extraction from literally every possible PDF.

## Tasks

- [x] Show the upload limit in the existing drop zone.
- [x] Reject oversized files in the browser with an error toast.
- [x] Enforce the same limit in `POST /api/documents` before any database write.
- [x] Add native-text-first, per-page OCR fallback for PDFs.
- [x] Verify unit tests, type-check/build, and a real image-only PDF OCR pass
      (`npm run verify:ocr`).

## Acceptance criteria

- A file whose size is 4 MiB or greater shows `File size too large` and is not
  uploaded.
- Bypassing the browser check still produces HTTP 413 without creating a
  document row.
- Text-native PDFs continue to use embedded text without invoking OCR.
- Image-only and mixed PDFs produce usable text from their scanned pages.
- Existing tests remain green and the production build succeeds.
