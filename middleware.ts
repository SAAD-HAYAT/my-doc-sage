import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Phase 7 (auth): refreshes the Supabase session on every request --
// middleware is the only place that can both read the incoming request's
// cookies and write refreshed ones back before any Server
// Component/Route Handler runs, per @supabase/ssr's documented pattern.
//
// /login and /auth/* skip the redirect check entirely (they handle their
// own redirects: /login shows the sign-in button, /auth/callback does the
// OAuth code exchange). /api/* ALSO skips the redirect -- deliberately,
// even though the phase brief said "redirect unauthenticated requests on
// any other route": a 3xx redirect in response to a fetch() call would
// have the frontend try to JSON.parse an HTML login page and break, not
// cleanly show "please sign in". API routes instead return a real 401
// JSON response via getAuthenticatedUser() (see lib/supabase-server.ts),
// which app/page.tsx's existing error handling already surfaces sanely.
// The page-level redirect below is what actually keeps a signed-out user
// from ever reaching the app in the first place; the API-level 401s are
// the defense-in-depth for a session expiring mid-visit.
const PUBLIC_PAGE_PATHS = ["/login", "/auth"];

function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env and fill them in.",
    );
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Calling getUser() (not getSession()) is what actually refreshes an
  // expiring session and re-validates the JWT -- skipping this call is
  // the documented #1 way to end up with unexpected/random logouts.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");

  if (!user && !isPublicPagePath(pathname) && !isApiRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
