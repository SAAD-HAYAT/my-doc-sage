import { createClient } from "@supabase/supabase-js";

// Phase 1: server-side client using the service role key (never expose
// this key to the frontend). Service-role bypasses RLS, so this module
// must only ever be imported from server code (API routes, lib/).

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env and fill them in.",
  );
}

export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
