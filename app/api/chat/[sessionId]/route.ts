import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { RetrievedChunk } from "@/lib/retrieval";

// Phase 1: GET -> return message history for a session

type MessageRow = {
  role: "user" | "assistant";
  content: string;
  sources: RetrievedChunk[] | null;
  created_at: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const { data, error } = await supabase
    .from("messages")
    .select("role, content, sources, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const history = (data as MessageRow[]).map((row) => ({
    role: row.role,
    content: row.content,
    ...(row.sources ? { sources: row.sources } : {}),
    createdAt: row.created_at,
  }));

  return NextResponse.json(history);
}
