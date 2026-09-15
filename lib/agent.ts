// Phase 4: bounded ReAct-style agent loop, extracted out of
// app/api/chat/route.ts so it's testable without mocking Next.js
// request/response objects.
//
// Phase 3 made exactly one tool-calling round: call chat() with tools,
// if it asks for a tool run it once and make one follow-up call with no
// tools. That follow-up-with-no-tools design is what caused the
// hallucinated-tool-call-as-text bug (see lib/openrouter.ts) — a model
// that still wants another tool has no structured way to ask for it.
// This loop fixes that at the root: every call in the loop still gets
// the `tools` param, so a model that needs a second search can just
// make a real tool_calls response instead of faking one as text.

import { chat, type ChatMessage, type ToolDefinition } from "./openrouter";
import { executeTool, type DocumentSummary } from "./tools";
import type { RetrievedChunk } from "./retrieval";

const MAX_ITERATIONS = 4;

export type AgentResult = {
  answer: string;
  sources: RetrievedChunk[];
  groundednessWarning?: boolean;
};

// Phase 5, citations: the model needs to know it should cite [1], [2], etc.
// This lives here rather than in app/api/chat/route.ts's SYSTEM_PROMPT
// (Phase 5's file scope is retrieval/agent/db/tests, not the route) --
// injected as an extra system message rather than editing the caller's
// prompt in place, so route.ts's own prompt is untouched either way.
//
// Why this numbering is trustworthy: search_notes' result array becomes
// BOTH the tool-result message the model reads (JSON.stringify(result),
// below) AND -- unmodified, same array, same order -- the `sources` this
// function returns. So "the model's [1] is whatever it reads first in
// that JSON array" and "sources[0]" are structurally the same element,
// not just conventionally expected to line up.
const CITATION_INSTRUCTION: ChatMessage = {
  role: "system",
  content:
    "When search_notes returns passages, they arrive as a JSON array -- cite them inline in your " +
    "answer as [1], [2], etc., using that array's order (its first element is [1], second is [2], " +
    "and so on; this is the same order the passages are shown to the user as sources). Cite every " +
    "passage your answer actually relies on, and don't cite ones you didn't use.",
};

// Inserted after any leading system message(s) (route.ts's own prompt),
// before the first user/assistant turn -- so it augments the existing
// system prompt instead of replacing or reordering it.
function withCitationInstruction(messages: ChatMessage[]): ChatMessage[] {
  const firstNonSystemIndex = messages.findIndex((m) => m.role !== "system");
  const insertAt = firstNonSystemIndex === -1 ? messages.length : firstNonSystemIndex;
  return [...messages.slice(0, insertAt), CITATION_INSTRUCTION, ...messages.slice(insertAt)];
}

// Phase 5, query rewriting: retrieval only ever sees whatever string the
// model puts in search_notes' `query` argument, and by default that's
// often just the user's raw message -- a pronoun-heavy follow-up like
// "who leads that?" embeds and retrieves poorly even though the MODEL
// itself has the full conversation history to resolve "that" from. This
// makes that resolution explicit: one extra chat() call (no tools),
// skipped entirely when there's no prior history to rewrite against (the
// first message of a session), asking the model to restate the latest
// message as a self-contained query using the history.
//
// The rewritten text is injected as a system-role HINT for the
// tool-calling model to use (or not) when composing search_notes' query
// -- not a forced override of whatever the model decides to search for.
// That keeps the model in control of query composition (it may reasonably
// combine several aspects of a question into one search, as seen live in
// earlier phases) while removing the "did it even resolve the pronoun"
// guesswork. Crucially, the rewrite is NEVER persisted or shown to the
// user -- route.ts's `messages` table insert and the frontend only ever
// see the ORIGINAL message; this hint lives only in the ephemeral
// `messages` array chat() sees inside this function.
const REWRITE_SYSTEM_PROMPT =
  "Rewrite the user's latest message into a single self-contained search query, resolving any " +
  'pronouns or vague references ("that", "the second one", "who leads it") using the conversation ' +
  "history. Reply with ONLY the rewritten query text -- no quotes, no explanation, no preamble.";

function conversationTurns(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === "user" || m.role === "assistant");
}

async function rewriteQuery(history: ChatMessage[], currentMessage: string): Promise<string | null> {
  const rewriteMessages: ChatMessage[] = [
    { role: "system", content: REWRITE_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: currentMessage },
  ];

  let rewritten: string;
  try {
    rewritten = await chat(rewriteMessages);
  } catch (err) {
    console.warn(
      `[agent] query-rewrite call failed, proceeding without a rewrite hint: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }

  const trimmed = rewritten.trim();
  return trimmed || null;
}

// Skips (no extra call) when `messages` holds only the current turn --
// i.e. the first message of a session, matching the phase's "skip
// entirely on turn 1" requirement. Otherwise rewrites and inserts the
// hint immediately before the current user message (the last element),
// regardless of what other system messages (route's prompt, the citation
// instruction) already precede it.
async function withRewrittenQueryHint(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const turns = conversationTurns(messages);
  if (turns.length <= 1) return messages;

  const currentMessage = turns[turns.length - 1];
  const history = turns.slice(0, -1);

  if (typeof currentMessage.content !== "string" || !currentMessage.content.trim()) {
    return messages;
  }

  const rewritten = await rewriteQuery(history, currentMessage.content);
  if (!rewritten || rewritten === currentMessage.content.trim()) return messages;

  console.log(`[agent] query rewrite: "${currentMessage.content}" -> "${rewritten}"`);

  const hint: ChatMessage = {
    role: "system",
    content:
      `Context hint: resolved against the conversation so far, the user's latest message can be ` +
      `restated as this self-contained query: "${rewritten}". If you call search_notes, prefer using ` +
      "this (or an equally self-contained rephrasing) as your query -- it resolves references from " +
      "earlier turns that the raw message alone would not.",
  };

  return [...messages.slice(0, -1), hint, messages[messages.length - 1]];
}

function summarizeToolResult(
  name: string,
  result: RetrievedChunk[] | DocumentSummary[],
): string {
  if (name === "search_notes") {
    const chunks = result as RetrievedChunk[];
    if (chunks.length === 0) return "0 chunks";
    const top = chunks[0];
    return `${chunks.length} chunk(s), top="${top.documentName}" score=${top.score.toFixed(2)}`;
  }
  if (name === "list_documents") {
    const docs = result as DocumentSummary[];
    return `${docs.length} document(s): ${docs.map((d) => `${d.name}(${d.status})`).join(", ")}`;
  }
  return JSON.stringify(result).slice(0, 100);
}

// Self-check design (Phase 4 leaves this to the implementer): a single
// extra chat() call, no tools, asking a yes/no groundedness question
// about the final answer against the retrieved passages. Deliberately
// simple for this phase — no automatic re-querying on a failed check,
// just log a warning and return the answer with `groundednessWarning:
// true` so the caller can decide whether to surface it. Automatic
// re-querying (e.g. looping back to search again on an unsupported
// answer) is a reasonable Phase 5 enhancement, not built here.
//
// Only runs when `sources` is non-empty. If the model never called
// search_notes (e.g. it answered directly, or only called
// list_documents), there's no retrieved context to check the answer
// against, so the check is skipped entirely rather than checking
// against nothing.
async function checkGroundedness(
  answer: string,
  sources: RetrievedChunk[],
): Promise<boolean> {
  if (sources.length === 0) return false;

  const context = sources
    .map((s, i) => `[${i + 1}] (${s.documentName}) ${s.chunkText}`)
    .join("\n\n");

  const verificationMessages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a strict fact-checker. You will be given retrieved note passages and an " +
        'answer someone gave based on them. Reply with exactly one word: "supported" if every ' +
        'claim in the answer is backed by the passages, or "unsupported" if the answer contains ' +
        "claims the passages don't support.",
    },
    {
      role: "user",
      content: `Passages:\n${context}\n\nAnswer:\n${answer}\n\nIs the answer supported?`,
    },
  ];

  let verdict: string;
  try {
    verdict = await chat(verificationMessages);
  } catch (err) {
    console.warn(
      `[agent] groundedness self-check call failed, skipping: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }

  const normalized = verdict.trim().toLowerCase();
  const unsupported = normalized.includes("unsupported");

  if (unsupported) {
    console.warn(`[agent] groundedness self-check flagged this answer as unsupported: "${answer.slice(0, 160)}"`);
  }

  return unsupported;
}

// Runs the bounded tool-calling loop: call chat() with tools, execute
// any requested tools and feed results back, repeat until the model
// returns a final answer (no tool_calls) or MAX_ITERATIONS is hit.
// Phase 7: `userId` is threaded straight into every executeTool() call so
// search_notes/list_documents stay scoped to the authenticated caller.
export async function runAgentLoop(
  initialMessages: ChatMessage[],
  toolDefs: ToolDefinition[],
  userId: string,
): Promise<AgentResult> {
  // Each iteration builds a NEW messages array rather than mutating a
  // shared one in place -- chat() is called with a fresh array every time
  // so nothing (a caller, a test spy, a log) that captured an earlier
  // reference ever sees it change out from under it later.
  let messages: ChatMessage[] = withCitationInstruction(initialMessages);
  messages = await withRewrittenQueryHint(messages);
  let sources: RetrievedChunk[] = [];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const response = await chat(messages, toolDefs);

    if (typeof response === "string") {
      console.log(`[agent] iteration ${iteration}: final answer.`);
      const groundednessWarning = await checkGroundedness(response, sources);
      return { answer: response, sources, groundednessWarning };
    }

    const toolCalls = response.tool_calls;

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: response.content ?? null,
      tool_calls: toolCalls,
    };

    const toolResultMessages: ChatMessage[] = [];

    for (const call of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        throw new Error(
          `Model requested tool "${call.function.name}" with malformed arguments: ${call.function.arguments}`,
        );
      }

      const result = await executeTool(call.function.name, args, userId);

      if (call.function.name === "search_notes") {
        sources = result as RetrievedChunk[];
      }

      console.log(
        `[agent] iteration ${iteration}: tool=${call.function.name} args=${JSON.stringify(args)} result=${summarizeToolResult(call.function.name, result)}`,
      );

      toolResultMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    messages = [...messages, assistantMessage, ...toolResultMessages];
  }

  console.warn(`[agent] hit the ${MAX_ITERATIONS}-iteration cap without a final answer; returning fallback.`);
  return {
    answer: "I couldn't find a confident answer in your notes for this question.",
    sources,
  };
}
