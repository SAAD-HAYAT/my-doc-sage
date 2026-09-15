import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

// Phase 7 (auth): request-scoped client bound to the incoming request's
// cookies, used in Route Handlers to read the caller's session. Unlike
// lib/supabase.ts's admin client, this one only ever acts as whichever
// user the request's cookies belong to (and is subject to RLS -- though
// nothing here queries app tables directly; it's used for
// supabase.auth.getUser() only).
//
// Created fresh per call, not a module-level singleton like the admin
// client: cookies() is tied to the current request, and Next.js (App
// Router, v15+) requires awaiting it.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env and fill them in.",
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Route Handlers CAN set cookies (unlike Server Components), so
          // this shouldn't normally throw here -- caught defensively per
          // @supabase/ssr's own documented pattern, since middleware.ts
          // is already refreshing the session on every request regardless
          // of whether an individual route handler's write lands.
        }
      },
    },
  });
}

// Every API route calls this first: returns the authenticated user, or
// null if there isn't one (missing/invalid/expired session) -- callers
// must return 401 in that case rather than proceeding. Deliberately
// getUser() rather than getSession(): getUser() re-validates the JWT
// against the Supabase Auth server instead of trusting a cookie's claims
// as-is, which matters here since this result gates access to every
// per-user query in the app.
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
