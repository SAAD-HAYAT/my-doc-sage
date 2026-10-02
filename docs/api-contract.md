# Frontend ↔ Backend API Contract

The frontend was generated with [Lovable](https://lovable.dev) using the
prompt below. Any backend route added in later phases must keep this
contract stable — extend it, don't break it, or the frontend will need
regenerating.

## Phase 7: authentication

The original prompt below says "No auth needed yet" — that was true
through Phase 6. As of Phase 7, **every endpoint below requires an
authenticated session** (Supabase Auth, Google-only SSO, cookie-based —
see `docs/phase-7-auth.md`). This isn't a change to the request/response
shapes documented below, just an added precondition:

- A request with no session, or an invalid/expired one, gets
  `401 { error: string }` instead of the shapes below.
- Data returned (documents, chat history) is always scoped to the
  requesting user — never another user's, even for the same
  `sessionId`.
- The frontend doesn't need to add an `Authorization` header or
  anything else itself: the session is a cookie set by
  `/auth/callback` after Google sign-in, and `middleware.ts` +
  `fetch()`'s default same-origin credential behavior handle the rest.

## Lovable prompt used

```
Build a clean, minimal chat interface for a personal RAG (Retrieval-Augmented
Generation) app called "NotesRAG" — a chatbot that answers questions using my
own uploaded documents.

Stack: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui. Do NOT
generate any backend logic, database, or Supabase integration — this is
frontend-only, wired to a REST API I'm building separately.

Layout:
- Left sidebar (collapsible on mobile):
  - "Upload" button/drop zone accepting PDF, Markdown, and Excel `.xlsx` files
  - List of uploaded documents showing name + status badge (Processing / Ready / Failed)
  - Delete icon per document
- Main panel: chat interface
  - Scrollable message history, user messages right-aligned, assistant messages left-aligned
  - Each assistant message has a small collapsible "Sources" section listing which
    documents/chunks were used
  - Message input at the bottom with a send button, disabled while a response is loading
  - Empty state when no documents are uploaded yet, prompting to upload first
- Top bar: app name + What's new, New chat, and Log out controls

Wire the UI to these exact REST endpoints (I'll implement the backend — just
call them and handle loading/error states):

- POST /api/documents (multipart file upload) -> { id, name, status, createdAt }
- GET /api/documents -> array of the above
- DELETE /api/documents/:id
- POST /api/chat  body: { message, sessionId } -> { answer, sources: [{ documentName, chunkText, score }] }
- GET /api/chat/:sessionId -> array of { role, content, sources, createdAt }

Use local React state/hooks — no global store needed. Styling: minimal and
modern, neutral colors, rounded corners, similar feel to a simple ChatGPT-style
UI. No auth needed yet.
```

## Endpoints

### `POST /api/documents`

Multipart file upload (PDF, Markdown, or Excel `.xlsx`). Files must be smaller than 4 MiB;
oversized requests return `413 { "error": "File size too large" }`. PDFs use
their embedded text layer when available and OCR for scanned/image-only pages.
The browser trims an oversized PDF to the largest complete page prefix below
that limit, an oversized Markdown file to complete leading lines, or an
oversized Excel workbook to complete populated rows in worksheet order before
uploading it. Excel formatting and media are removed during optimization; cell
values, sheet names, row numbers, formulas, and cached formula results are
indexed. A trimmed upload also sends `trimmedUnit`, `includedCount`, and
`sourceCount` multipart fields; inconsistent metadata returns
`400 { "error": "Invalid trim metadata" }`.

Unsupported extensions (including `.xls`, `.xlsm`, and CSV) return HTTP 415.
Malformed, encrypted, or empty Excel workbooks return HTTP 400 before a
document row is created.

Response:
`{ id: string, name: string, status: "processing" | "ready" | "failed", createdAt: string, trimmed: { unit: "pages" | "lines" | "rows", included: number, total: number } | null }`
Requires auth (see above): `401 { error: string }` with no valid session.
If extraction, embedding, or chunk storage fails after the document row is
created, the row is marked `failed` and the endpoint returns
`500 { error: string, document: { ...status: "failed" } }`. The error identifies
the failed ingestion stage rather than returning a misleading HTTP 200.

### `GET /api/documents`

Response: array of the above, including persistent trim metadata (only the
requesting user's documents).
Requires auth: `401 { error: string }` with no valid session.

### `DELETE /api/documents/:id`

Response: `204 No Content`
Requires auth: `401 { error: string }` with no valid session. Deleting
another user's document id is a no-op (scoped by user_id), not a 403/404.

### `POST /api/chat`

Body: `{ message: string, sessionId: string }`
Response: `{ answer: string, sources: { documentName: string, chunkText: string, score: number }[] }`
Requires auth: `401 { error: string }` with no valid session.

### `GET /api/chat/:sessionId`

Response: array of `{ role: "user" | "assistant", content: string, sources?: [...], createdAt: string }`
(only the requesting user's own messages for that session).
Requires auth: `401 { error: string }` with no valid session.
