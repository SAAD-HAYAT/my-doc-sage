import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Phase 7 (auth): the OAuth callback -- required for the PKCE code
// exchange to complete at all. Without this route, the `code` query
// param Google/Supabase redirects back with is never exchanged for a
// session, and login silently fails (the user lands back on the app
// looking "logged out" with no error surfaced).
//
// Known gotcha (flagged in the phase brief, not yet hit but worth
// remembering if login ever "succeeds" but the app still looks signed
// out): some @supabase/supabase-js versions let the redirect response
// beat the Set-Cookie write from exchangeCodeForSession. Currently on
// @supabase/ssr 0.12.7 / @supabase/supabase-js 2.115.0, both well past
// where that was fixed, and the exchange below runs (and its cookies via
// lib/supabase-server.ts's setAll) BEFORE the redirect is constructed --
// but if this ever resurfaces, check the installed versions first rather
// than assuming this flow's ordering is wrong.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
