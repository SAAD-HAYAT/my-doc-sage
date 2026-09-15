import { createClient } from "@supabase/supabase-js";

// Phase 1: server-side client using the service role key (never expose
// this key to the frontend). Service-role BYPASSES RLS, so this module
// must only ever be imported from server code (API routes, lib/).
//
// Phase 7 (auth): renamed from `supabase` to `supabaseAdmin` so every call
// site reads as an obviously-privileged operation. Because this client
// bypasses RLS entirely, every query made with it must filter by the
// authenticated user's id EXPLICITLY in application code (see app/api/*,
// lib/tools.ts) -- RLS (db/schema.sql) is a backstop for other access
// paths, not a substitute for that here. Use lib/supabase-server.ts's
// request-scoped client instead when you actually want RLS enforcement
// tied to the calling user.

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env and fill them in.",
  );
}

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
