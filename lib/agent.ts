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
export async function runAgentLoop(
  initialMessages: ChatMessage[],
  toolDefs: ToolDefinition[],
): Promise<AgentResult> {
  // Each iteration builds a NEW messages array rather than mutating a
  // shared one in place -- chat() is called with a fresh array every time
  // so nothing (a caller, a test spy, a log) that captured an earlier
  // reference ever sees it change out from under it later.
  let messages: ChatMessage[] = [...initialMessages];
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

      const result = await executeTool(call.function.name, args);

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
