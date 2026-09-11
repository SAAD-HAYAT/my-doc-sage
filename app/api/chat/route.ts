import { NextRequest, NextResponse } from "next/server";
import type { ChatMessage } from "@/lib/openrouter";
import { supabase } from "@/lib/supabase";
import { tools } from "@/lib/tools";
import { runAgentLoop } from "@/lib/agent";

// Phase 1: POST -> retrieve top-k chunks, build prompt, call chat(),
//          save exchange to `messages`, return { answer, sources }
// Phase 3: the model now decides whether to search the notes at all, via
//          the search_notes / list_documents tools -- no more unconditional
//          up-front retrieval.
// Phase 4: tool calling is now a bounded loop (lib/agent.ts) instead of a
//          single round, plus a groundedness self-check on the final answer.

const SYSTEM_PROMPT =
  "You are NotesRAG, an assistant that answers questions strictly from the user's uploaded notes. " +
  "Use the search_notes tool to find relevant passages before answering a question about the notes, " +
  "and list_documents for questions about what's been uploaded. Don't guess or use outside knowledge " +
  "— if the notes don't contain enough information after searching, say so plainly.";

export async function POST(req: NextRequest) {
  let body: { message?: unknown; sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";

  if (!message || !sessionId) {
    return NextResponse.json(
      { error: "Both 'message' and 'sessionId' are required" },
      { status: 400 },
    );
  }

  try {
    // Conversation memory: pull the last few turns of this session so the
    // model can resolve follow-ups ("who leads that?"). Capped at 10
    // messages (~5 exchanges) to keep token usage bounded. Fetch
    // newest-first + limit, then flip to chronological order. The current
    // message isn't persisted yet, so it won't appear here.
    const { data: priorRows, error: historyError } = await supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (historyError) {
      throw new Error(`Could not load session history: ${historyError.message}`);
    }

    const priorMessages: ChatMessage[] = (priorRows ?? [])
      .reverse()
      .map((row) => ({
        role: row.role as "user" | "assistant",
        content: row.content,
      }));

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...priorMessages,
      { role: "user", content: message },
    ];

    // The intermediate tool-calling exchange (assistant tool_calls +
    // tool-result messages) isn't persisted -- the `messages` table /
    // GET /api/chat/:sessionId contract only knows about "user" |
    // "assistant" roles.
    const { answer, sources, groundednessWarning } = await runAgentLoop(messages, tools);

    if (groundednessWarning) {
      // Logged for now, not surfaced in the API response -- the contract
      // (docs/api-contract.md) only defines { answer, sources }. Deciding
      // whether/how to expose this to the UI is a Phase 5+ call.
      console.warn(`[chat] answer for session ${sessionId} failed its groundedness self-check.`);
    }

    // Persist the exchange. User message first, then the assistant reply,
    // so history reads back in order.
    await supabase
      .from("messages")
      .insert({ session_id: sessionId, role: "user", content: message });
    await supabase.from("messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: answer,
      sources,
    });

    return NextResponse.json({ answer, sources });
  } catch (err) {
    console.error("Chat request failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat request failed" },
      { status: 500 },
    );
  }
}
