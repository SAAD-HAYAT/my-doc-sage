# DocuChat Interface

Build a clean, minimal chat interface for a personal RAG (Retrieval-Augmented

Generation) app called "NotesRAG" — a chatbot that answers questions using my

own uploaded documents.

Stack: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui. Do NOT

generate any backend logic, database, or Supabase integration — this is

frontend-only, wired to a REST API I'm building separately.

Layout:

- Left sidebar (collapsible on mobile):

  - "Upload" button/drop zone accepting PDF and Markdown files

  - List of uploaded documents showing name + status badge (Processing / Ready / Failed)

  - Delete icon per document

- Main panel: chat interface

  - Scrollable message history, user messages right-aligned, assistant messages left-aligned

  - Each assistant message has a small collapsible "Sources" section listing which

    documents/chunks were used

  - Message input at the bottom with a send button, disabled while a response is loading

  - Empty state when no documents are uploaded yet, prompting to upload first

- Top bar: app name + a "New chat" button that clears the current session

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

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/15544033-8fd5-495c-9651-f396ef2fe88b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
