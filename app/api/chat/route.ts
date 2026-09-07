import { NextRequest, NextResponse } from "next/server";
import { retrieve } from "@/lib/retrieval";
import { chat, type ChatMessage } from "@/lib/openrouter";
import { supabase } from "@/lib/supabase";

// Phase 1: POST -> retrieve top-k chunks, build prompt, call chat(),
//          save exchange to `messages`, return { answer, sources }
// Phase 3: handle tool_calls in the model response
// Phase 4: turn this into a bounded agentic loop

const SYSTEM_PROMPT =
  "You are NotesRAG, an assistant that answers questions strictly from the user's uploaded notes. " +
  "Answer using only the context provided below. If the context does not contain enough " +
  "information to answer the question, say so plainly rather than guessing or using outside knowledge.";

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
    const sources = await retrieve(message);

    const context =
      sources.length > 0
        ? sources
            .map((s, i) => `[${i + 1}] ${s.documentName}\n${s.chunkText}`)
            .join("\n\n")
        : "(no relevant context found in the uploaded notes)";

    const messages: ChatMessage[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\nContext:\n${context}` },
      { role: "user", content: message },
    ];

    const answer = await chat(messages);

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
