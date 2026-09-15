import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import type { RetrievedChunk } from "@/lib/retrieval";

// Phase 1: GET -> return message history for a session
// Phase 7: requires an authenticated session; the query is scoped to
// BOTH session_id AND user_id (not session_id alone) so a signed-in user
// can never read another user's session history, even by guessing or
// pasting in someone else's sessionId directly.

type MessageRow = {
  role: "user" | "assistant";
  content: string;
  sources: RetrievedChunk[] | null;
  created_at: string;
  user_id: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("role, content, sources, created_at, user_id")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data as MessageRow[];

  // Defense in depth on top of the .eq("user_id", ...) filter above: even
  // if that filter were ever accidentally dropped or loosened in a future
  // edit, this still refuses to serve a row that doesn't actually belong
  // to the caller, rather than silently trusting the query alone.
  const leaked = rows.find((row) => row.user_id !== user.id);
  if (leaked) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const history = rows.map((row) => ({
    role: row.role,
    content: row.content,
    ...(row.sources ? { sources: row.sources } : {}),
    createdAt: row.created_at,
  }));

  return NextResponse.json(history);
}
