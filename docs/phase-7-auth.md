# Phase 7 — Auth (Google SSO)

> This phase is new scope beyond the original 6-phase roadmap. It was
> added after Phase 6 to turn NotesRAG from a single-tenant personal
> tool into a per-user one: every document, chunk, and chat session now
> belongs to exactly one signed-in Google account.

## Goal

Add Google-only SSO so each user only ever sees their own uploaded
documents and their own chat history — never another user's.

## Tech decisions made for this phase

- **Supabase Auth**, Google as the ONLY provider. No email/password, no
  signup page — a user's first Google sign-in creates their Supabase
  `auth.users` row automatically.
- **`@supabase/ssr`** for Next.js App Router integration (the current
  supported package; `@supabase/auth-helpers-nextjs` is deprecated).
- Google OAuth client + the Google provider toggle in Supabase's
  dashboard are configured outside this repo (already done before this
  phase started) — nothing here configures that.

## Tasks

- [x] `@supabase/ssr` added to `package.json`;
      `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
      added to `.env.example` alongside the existing service-role key.
- [x] `db/schema.sql`: `user_id uuid references auth.users(id) on
      delete cascade not null` added to `documents`, `messages`, AND
      `chunks` (denormalized onto `chunks` at insert time from the
      parent document — keeps RLS policies and reads simple, no join
      needed). RLS enabled on all three tables, with `for all` policies
      restricting every operation to `auth.uid() = user_id`.
- [x] `match_chunks`/`hybrid_search` (the two RPC functions retrieval
      goes through) both take a new required `p_user_id` and filter by
      it explicitly. This matters even with RLS on: both are called via
      the service-role client, which bypasses RLS entirely, so without
      this every user's search would return every other user's chunks
      too. The old (unscoped) function signatures are explicitly
      `DROP`ped first, since `CREATE OR REPLACE` doesn't remove an old
      signature it no longer matches — it would otherwise leave the
      unscoped version sitting in the database, still callable.
- [x] `lib/supabase.ts`: the existing service-role client renamed
      `supabaseAdmin` so every call site reads as obviously privileged.
      New `lib/supabase-server.ts` (request-scoped `@supabase/ssr`
      client reading the incoming request's cookies, plus a
      `getAuthenticatedUser()` helper every route calls first) and
      `lib/supabase-browser.ts` (browser client for the login page and
      the sign-out button).
- [x] `app/login/page.tsx`: a single "Continue with Google" button,
      styled with the existing Tailwind/shadcn setup rather than a new
      look. Calls `supabase.auth.signInWithOAuth({ provider: "google",
      options: { redirectTo: \`${origin}/auth/callback\` } })`.
- [x] `app/auth/callback/route.ts`: exchanges the OAuth `code` for a
      session via `exchangeCodeForSession`, redirects to `/` on
      success or `/login?error=auth_failed` on failure. Required for
      the PKCE flow to complete at all.
- [x] `middleware.ts`: refreshes the Supabase session on every request.
      Redirects an unauthenticated visitor to `/login` for page routes.
      **Deliberate deviation from the original brief**: `/api/*` routes
      are excluded from that redirect (not just `/login` and `/auth/*`)
      — a 3xx redirect in response to a `fetch()` call would have the
      frontend try to `JSON.parse` an HTML login page and break, not
      cleanly show "please sign in." API routes instead return a real
      401 JSON response via `getAuthenticatedUser()`, which the
      frontend's existing error handling already surfaces sanely. The
      page-level redirect is what actually keeps a signed-out user from
      reaching the app; the API-level 401s are defense-in-depth for a
      session expiring mid-visit.
- [x] Every existing API route made auth-aware — `getAuthenticatedUser()`
      first, 401 if none, every query/insert explicitly filtered by
      that user's id (on top of RLS, not instead of it, since
      `supabaseAdmin` bypasses RLS):
  - `app/api/documents/route.ts` (POST, GET)
  - `app/api/documents/[id]/route.ts` (DELETE — scoped to id AND
    user_id, so a user can't delete another user's document by
    guessing its id)
  - `app/api/chat/route.ts` (POST) — `runAgentLoop`/`executeTool`/
    `retrieve()` all take the authenticated user's id now and thread
    it through to the `hybrid_search`/`list_documents` queries
  - `app/api/chat/[sessionId]/route.ts` (GET) — scoped to session_id
    AND user_id, plus an explicit check that every returned row's
    `user_id` actually matches the caller, as a backstop on top of the
    query filter itself
- [x] Logout control added to the existing top bar (`app/page.tsx`),
      next to "New chat" — calls `supabase.auth.signOut()` then does a
      full navigation to `/login`. Nothing else in the existing
      chat/document UI changed.
- [x] `docs/api-contract.md` updated: every endpoint now requires an
      authenticated session (cookie-based); 401 on missing/invalid
      session.
- [x] Tests: mocked 401-with-no-user and scoped-to-the-authenticated-
      user cases added across `tests/chat.test.ts`,
      `tests/documents.test.ts` (new), `tests/chat-session.test.ts`
      (new), plus signature updates to `tests/retrieval.test.ts` /
      `tests/tools.test.ts` / `tests/agent.test.ts` for the new
      `userId` parameters threaded through `retrieve()` /
      `executeTool()` / `runAgentLoop()`.
- [ ] Live verification: sign in with one real Google account, upload
      a document, ask a question; sign in with a second, different
      Google account and confirm it sees zero documents and gets no
      history from the first account's `sessionId` even pasted in
      directly. **Not yet run** — held for the user to do (or ask for)
      once the publishable/anon key is in `.env` and Google sign-in has
      actually been exercised once.

## One-time manual step before the schema changes apply

This project's pre-Phase-7 `documents`/`chunks`/`messages` rows
predated per-user ownership and had no owner to backfill onto — they
were wiped once, by hand, in Supabase's SQL editor:

```sql
truncate table messages, chunks, documents cascade;
```

This is **not** baked into `db/schema.sql` itself: a destructive
statement there would re-wipe real data every time the file is
re-applied in the future, which defeats the point of the file staying
safely re-runnable. If you're setting this project up fresh (no
pre-Phase-7 data), there's nothing to wipe.

## Known limitation (flagged, not solved here)

`OPENROUTER_API_KEY` (and its fallback `OPENROUTER_API_KEY_2`) is still
a single shared backend credential — the free-tier daily quota is
shared pool-wide across ALL users, not per-user. One user's heavy usage
can exhaust the quota for everyone else. Not addressed in this phase.

## Acceptance criteria

- A signed-out visitor is redirected to `/login`; signing in with
  Google lands them back on `/` with a working session.
- Two different Google accounts each see only their own documents and
  chat history — including when one pastes in the other's `sessionId`
  directly.
- Every API route returns 401 with no session, and every DB
  query/insert an authenticated route makes is scoped to that user's
  id, not just relying on RLS.
- Full test suite passes with zero real API/DB calls.

## Out of scope

- Any provider other than Google (no email/password, no other OAuth
  providers).
- Per-user OpenRouter quota/billing (see the known limitation above).
- Any change to the frontend beyond the login page and the logout
  control — the existing chat/document UI is otherwise untouched.
