"use client";

// Phase 7 (auth): the only entry point for signing in -- Google is the
// sole provider (no email/password, no signup page: a user's first
// Google sign-in creates their Supabase user automatically). Styled with
// the existing Tailwind/shadcn setup to match the rest of the app rather
// than introducing a different look for this one page.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.86c2.26-2.08 3.59-5.14 3.59-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.86-3.01c-1.07.72-2.45 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.98H1.24v3.11C3.2 21.3 7.26 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.25 14.25a7.14 7.14 0 0 1 0-4.5V6.64H1.24a11.98 11.98 0 0 0 0 10.72l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.26 0 3.2 2.7 1.24 6.64l4.01 3.11C6.2 6.89 8.86 4.77 12 4.77Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "auth_failed"
      ? "Sign-in failed. Please try again."
      : null,
  );

  const handleSignIn = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (signInError) {
        setError(signInError.message);
        setIsSigningIn(false);
      }
      // On success the browser navigates away to Google's consent
      // screen, so there's nothing further to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
      setIsSigningIn(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold tracking-tight">NotesRAG</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to chat with your own uploaded documents.
        </p>

        <Button
          variant="outline"
          size="default"
          className="mt-6 w-full"
          onClick={handleSignIn}
          disabled={isSigningIn}
        >
          <GoogleIcon />
          {isSigningIn ? "Redirecting…" : "Continue with Google"}
        </Button>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
