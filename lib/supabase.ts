import { createClient } from "@supabase/supabase-js";

// Phase 1: server-side client using the service role key (never expose
// this key to the frontend).
export const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
);
