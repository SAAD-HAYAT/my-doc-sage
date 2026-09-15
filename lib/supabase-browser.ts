import { createBrowserClient } from "@supabase/ssr";

// Phase 7 (auth): browser-side client for the login page's OAuth kickoff
// (supabase.auth.signInWithOAuth) and the top bar's sign-out button. Safe
// to use the publishable/anon key here -- it's meant to be exposed to the
// browser, unlike lib/supabase.ts's service-role key.
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env and fill them in.",
    );
  }
  return createBrowserClient(url, key);
}
