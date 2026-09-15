import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/chat/route.ts pulls in @/lib/supabase, @/lib/supabase-server,
// @/lib/retrieval (via @/lib/tools's search_notes executor) and
// @/lib/openrouter. lib/supabase.ts fails fast at import time if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set, so these vi.mock()
// calls must intercept the module before the real one is ever evaluated.
// vi.mock() is hoisted above these imports by Vitest, so this works even
// though the mock factories are declared before the values they return
// are used below.
//
// @/lib/tools itself is NOT mocked: these tests exercise the real
// executeTool()/tool-schema logic (tools.test.ts covers that directly too),
// only its dependencies (retrieve, supabaseAdmin) are faked.
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: vi.fn() },
}));
vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));

import { retrieve } from "@/lib/retrieval";
import { chat } from "@/lib/openrouter";
import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { POST } from "@/app/api/chat/route";

const mockRetrieve = vi.mocked(retrieve);
const mockChat = vi.mocked(chat);
const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);

const TEST_USER_ID = "test-user-id";
const OTHER_USER_ID = "someone-elses-user-id";

type HistoryRow = { role: "user" | "assistant"; content: string; sources?: unknown };

// Real supabase-js query builders are "thenable" at every step (each
// chained method returns an object that resolves to {data, error} when
// awaited, regardless of exactly how many .eq()/.select()/etc. calls
// preceded it) -- mirroring that here means route.ts can add another
// .eq(...) to a chain (as Phase 7 did, scoping by user_id) without
// breaking every test that built that chain's mock by hand.
function chainable(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "insert"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return obj;
}

/**
 * Wires supabaseAdmin.from(...) for both tables the route touches:
 *  - "messages": the history select-chain and a no-op resolver for the
 *    two persistence inserts (tracked separately via `insert` so call
 *    assertions stay simple).
 *  - "documents": the select the list_documents tool runs directly.
 */
function mockSupabase(opts: {
  history?: HistoryRow[];
  historyError?: { message: string };
  documents?: { name: string; status: string }[];
}) {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const historyChain = chainable({
    data: opts.historyError ? null : opts.history ?? [],
    error: opts.historyError ?? null,
  });
  const documentsChain = chainable({ data: opts.documents ?? [], error: null });

  mockFrom.mockImplementation((table: string) => {
    if (table === "messages") return { select: historyChain.select, insert } as never;
    if (table === "documents") return { select: documentsChain.select } as never;
    throw new Error(`mockSupabase: unexpected table "${table}"`);
  });

  return { insert, historyChain, documentsChain };
}

function post(body: unknown) {
  const req = new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

/** A canned tool_calls response shaped like the real AssistantToolCallMessage. */
function toolCallResponse(name: string, argsObj: unknown, id = "call_1") {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(argsObj) } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChat.mockResolvedValue("the model's answer");
  mockGetAuthenticatedUser.mockResolvedValue({ id: TEST_USER_ID } as never);
});

describe("POST /api/chat — auth", () => {
  it("returns 401 and touches nothing else when there's no authenticated session", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const res = await post({ message: "hi", sessionId: "s1" });

    expect(res.status).toBe(401);
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("scopes the history query to the authenticated user's id, not session_id alone", async () => {
    const { historyChain } = mockSupabase({ history: [] });

    await post({ message: "hi", sessionId: "s1" });

    expect(historyChain.eq).toHaveBeenCalledWith("session_id", "s1");
    expect(historyChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });

  it("persists both the user and assistant rows tagged with the authenticated user's id", async () => {
    const { insert } = mockSupabase({ history: [] });

    await post({ message: "hello", sessionId: "s1" });

    expect(insert).toHaveBeenNthCalledWith(1, expect.objectContaining({ user_id: TEST_USER_ID }));
    expect(insert).toHaveBeenNthCalledWith(2, expect.objectContaining({ user_id: TEST_USER_ID }));
  });

  it("a different authenticated user gets their own isolated history, not another user's", async () => {
    // Same sessionId, but this "other" user's query would be scoped to
    // THEIR id -- since the mock's history chain doesn't know about
    // ownership, this test asserts the route asks for the RIGHT id
    // rather than assuming isolation is real (that's what the .eq
    // assertions above already lock in structurally).
    mockGetAuthenticatedUser.mockResolvedValue({ id: OTHER_USER_ID } as never);
    const { historyChain } = mockSupabase({ history: [] });

    await post({ message: "hi", sessionId: "s1" });

    expect(historyChain.eq).toHaveBeenCalledWith("user_id", OTHER_USER_ID);
    expect(historyChain.eq).not.toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });
});

describe("POST /api/chat — conversation memory", () => {
  it("sends [system, ...prior turns, current user message] when history exists", async () => {
    // Real DB rows come back newest-first (order by created_at desc); the
    // route reverses them. So A1 (the answer) is "newer" than Q1 (the
    // question that produced it) and must be listed first here.
    mockSupabase({
      history: [
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q1" },
      ],
    });

    // Phase 5 query rewriting fires whenever prior history exists (it does
    // here: Q1/A1) -- make it a no-op rewrite (returns the message
    // unchanged) so the loop's own message shape below is unaffected by it.
    mockChat.mockResolvedValueOnce("Q2");

    const res = await post({ message: "Q2", sessionId: "s1" });
    expect(res.status).toBe(200);

    // [0] = the query-rewrite call, [1] = the actual loop call.
    expect(mockChat).toHaveBeenCalledTimes(2);
    const messages = mockChat.mock.calls[1][0];

    // Phase 5: runAgentLoop injects its own citation-instruction system
    // message right after route.ts's system prompt, before the rest.
    expect(messages).toHaveLength(5);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("system"); // citation instruction (lib/agent.ts)
    expect(messages[2]).toEqual({ role: "user", content: "Q1" });
    expect(messages[3]).toEqual({ role: "assistant", content: "A1" });
    expect(messages[4]).toEqual({ role: "user", content: "Q2" });
  });

  it("sends just [system, current user message] on a brand new session", async () => {
    mockSupabase({ history: [] });

    await post({ message: "first question", sessionId: "new-session" });

    const messages = mockChat.mock.calls[0][0];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("system"); // citation instruction (lib/agent.ts)
    expect(messages[2]).toEqual({ role: "user", content: "first question" });
  });

  it("requests at most the last 10 messages, oldest-to-newest, from newest-first DB rows", async () => {
    // The real query orders `created_at` descending then .limit(10) — the
    // route then reverses it back to chronological order. Feed rows in
    // newest-first order (as Postgres would return them) and assert the
    // route flips them before building the prompt.
    const { historyChain } = mockSupabase({
      history: [
        { role: "assistant", content: "turn4-assistant" },
        { role: "user", content: "turn4-user" },
        { role: "assistant", content: "turn3-assistant" },
        { role: "user", content: "turn3-user" },
      ],
    });

    // No-op rewrite (see the history-exists test above for why).
    mockChat.mockResolvedValueOnce("current turn");

    await post({ message: "current turn", sessionId: "s1" });

    expect(historyChain.limit).toHaveBeenCalledWith(10);

    const messages = mockChat.mock.calls[1][0];
    // system, citation instruction (Phase 5), 4 prior (now chronological), current = 7
    expect(messages).toHaveLength(7);
    expect(messages[1].role).toBe("system"); // citation instruction (lib/agent.ts)
    expect(messages.slice(2, -1)).toEqual([
      { role: "user", content: "turn3-user" },
      { role: "assistant", content: "turn3-assistant" },
      { role: "user", content: "turn4-user" },
      { role: "assistant", content: "turn4-assistant" },
    ]);
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "current turn",
    });
  });

  it("drops sources/metadata from prior messages — chat() only gets role+content", async () => {
    mockSupabase({
      history: [
        {
          role: "assistant",
          content: "an earlier grounded answer",
          // A real assistant row does carry `sources` in the messages table;
          // the route must not leak it into the model-facing history.
          sources: [{ documentName: "x.md", chunkText: "y", score: 0.9 }],
        },
      ],
    });

    // No-op rewrite (see the history-exists test above for why).
    mockChat.mockResolvedValueOnce("follow-up");

    await post({ message: "follow-up", sessionId: "s1" });

    const messages = mockChat.mock.calls[1][0];
    const priorEntry = messages[2]; // index 1 is the Phase 5 citation instruction
    expect(Object.keys(priorEntry).sort()).toEqual(["content", "role"]);
    expect(priorEntry).toEqual({
      role: "assistant",
      content: "an earlier grounded answer",
    });
  });

  it("returns 500 with a descriptive error if the history fetch fails", async () => {
    mockSupabase({ historyError: { message: "db down" } });

    const res = await post({ message: "hi", sessionId: "s1" });
    expect(res.status).toBe(500);
    const resBody = await res.json();
    expect(resBody.error).toMatch(/db down/);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns 400 when message or sessionId is missing, without calling chat()", async () => {
    const res1 = await post({ sessionId: "s1" });
    expect(res1.status).toBe(400);
    const res2 = await post({ message: "hi" });
    expect(res2.status).toBe(400);
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat — tool calling", () => {
  it("no tool_calls: the direct-answer path still works unchanged", async () => {
    mockSupabase({ history: [] });
    mockChat.mockResolvedValueOnce("a direct answer, no tools needed");

    const res = await post({ message: "hi", sessionId: "s1" });
    expect(res.status).toBe(200);
    const resBody = await res.json();

    expect(resBody).toEqual({ answer: "a direct answer, no tools needed", sources: [] });
    expect(mockChat).toHaveBeenCalledTimes(1); // no follow-up call
    // first (only) call must offer the tools array
    expect(mockChat.mock.calls[0][1]).toBeDefined();
  });

  it("search_notes: executes retrieve() with the model's args (scoped to the user) and builds the follow-up messages correctly", async () => {
    mockSupabase({ history: [{ role: "user", content: "earlier turn" }] });
    mockRetrieve.mockResolvedValue([
      { documentName: "notes.md", chunkText: "the answer lives here", score: 0.77 },
    ]);
    mockChat
      // Phase 5: prior history exists ("earlier turn"), so the query-rewrite
      // call fires first -- a no-op rewrite here keeps the rest of this
      // test's message-shape assertions unaffected by it.
      .mockResolvedValueOnce("what is X?")
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "what is X?", k: 3 }))
      .mockResolvedValueOnce("X is explained in your notes.")
      .mockResolvedValueOnce("supported"); // Phase 4 groundedness self-check

    const res = await post({ message: "what is X?", sessionId: "s1" });
    expect(res.status).toBe(200);
    const resBody = await res.json();

    expect(mockRetrieve).toHaveBeenCalledWith("what is X?", TEST_USER_ID, 3);
    expect(resBody).toEqual({
      answer: "X is explained in your notes.",
      sources: [{ documentName: "notes.md", chunkText: "the answer lives here", score: 0.77 }],
    });

    // [0] rewrite + loop call 1 (search_notes) + loop call 2 (final answer)
    // + 1 groundedness self-check call now that search_notes populated sources.
    expect(mockChat).toHaveBeenCalledTimes(4);
    const [initialMessages, toolsArg] = mockChat.mock.calls[1];
    expect(toolsArg).toBeDefined();

    const followUpMessages = mockChat.mock.calls[2][0];
    // Follow-up = everything sent the first time, plus the assistant's
    // tool_calls message, plus one tool-result message per call.
    expect(followUpMessages).toHaveLength(initialMessages.length + 2);
    expect(followUpMessages.slice(0, initialMessages.length)).toEqual(initialMessages);

    const assistantToolCallMsg = followUpMessages[initialMessages.length];
    expect(assistantToolCallMsg.role).toBe("assistant");
    expect(assistantToolCallMsg.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "search_notes", arguments: JSON.stringify({ query: "what is X?", k: 3 }) },
      },
    ]);

    const toolResultMsg = followUpMessages[initialMessages.length + 1];
    expect(toolResultMsg.role).toBe("tool");
    expect(toolResultMsg.tool_call_id).toBe("call_1");
    expect(typeof toolResultMsg.content).toBe("string");
    expect(JSON.parse(toolResultMsg.content as string)).toEqual([
      { documentName: "notes.md", chunkText: "the answer lives here", score: 0.77 },
    ]);

    // Phase 4: every loop iteration still offers tools (that's what lets a
    // model request a second search instead of hallucinating one as text) —
    // only the rewrite call (0) and the groundedness self-check call (3) omit it.
    expect(mockChat.mock.calls[0][1]).toBeUndefined();
    expect(mockChat.mock.calls[2][1]).toBeDefined();
    expect(mockChat.mock.calls[3][1]).toBeUndefined();
  });

  it("search_notes: called with only a query defaults k inside the executor", async () => {
    mockSupabase({ history: [] });
    mockRetrieve.mockResolvedValue([]);
    mockChat
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "no k here" }))
      .mockResolvedValueOnce("answer");

    await post({ message: "q", sessionId: "s1" });

    expect(mockRetrieve).toHaveBeenCalledWith("no k here", TEST_USER_ID, undefined);
  });

  it("list_documents: queries the documents table (scoped to the user) and never touches embeddings/retrieve", async () => {
    const { documentsChain } = mockSupabase({
      history: [],
      documents: [
        { name: "a.pdf", status: "ready" },
        { name: "b.md", status: "processing" },
      ],
    });
    mockChat
      .mockResolvedValueOnce(toolCallResponse("list_documents", {}))
      .mockResolvedValueOnce("You have 2 documents: a.pdf (ready) and b.md (processing).");

    const res = await post({ message: "what documents do I have?", sessionId: "s1" });
    const resBody = await res.json();

    expect(resBody.answer).toBe("You have 2 documents: a.pdf (ready) and b.md (processing).");
    // list_documents isn't chunk-based, so it never populates `sources`.
    expect(resBody.sources).toEqual([]);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(documentsChain.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);

    const followUpMessages = mockChat.mock.calls[1][0];
    const toolResultMsg = followUpMessages[followUpMessages.length - 1];
    expect(toolResultMsg.role).toBe("tool");
    expect(JSON.parse(toolResultMsg.content as string)).toEqual([
      { name: "a.pdf", status: "ready" },
      { name: "b.md", status: "processing" },
    ]);
  });

  it("fails gracefully (500, no crash) when a tool call has malformed JSON arguments", async () => {
    mockSupabase({ history: [] });
    mockChat.mockResolvedValueOnce({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_bad",
          type: "function",
          function: { name: "search_notes", arguments: "{not valid json" },
        },
      ],
    });

    const res = await post({ message: "q", sessionId: "s1" });
    expect(res.status).toBe(500);
    const resBody = await res.json();
    expect(resBody.error).toMatch(/malformed arguments/i);
    expect(resBody.error).toMatch(/search_notes/);
    expect(mockChat).toHaveBeenCalledTimes(1); // never reached the follow-up call
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("fails gracefully (500, no crash) when the model requests an unknown tool", async () => {
    mockSupabase({ history: [] });
    mockChat.mockResolvedValueOnce(toolCallResponse("delete_everything", {}));

    const res = await post({ message: "q", sessionId: "s1" });
    expect(res.status).toBe(500);
    const resBody = await res.json();
    expect(resBody.error).toMatch(/Unknown tool/);
    expect(resBody.error).toMatch(/delete_everything/);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/chat — persistence", () => {
  it("persists the user message then the final assistant answer (direct-answer path -> empty sources)", async () => {
    const { insert } = mockSupabase({ history: [] });
    mockChat.mockResolvedValueOnce("the model's answer");

    await post({ message: "hello", sessionId: "s1" });

    expect(insert).toHaveBeenNthCalledWith(1, {
      session_id: "s1",
      user_id: TEST_USER_ID,
      role: "user",
      content: "hello",
    });
    expect(insert).toHaveBeenNthCalledWith(2, {
      session_id: "s1",
      user_id: TEST_USER_ID,
      role: "assistant",
      content: "the model's answer",
      sources: [],
    });
  });

  it("persists search_notes' retrieved chunks as sources on the assistant row", async () => {
    const { insert } = mockSupabase({ history: [] });
    mockRetrieve.mockResolvedValue([{ documentName: "n.md", chunkText: "c", score: 0.5 }]);
    mockChat
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "q" }))
      .mockResolvedValueOnce("grounded answer");

    await post({ message: "q", sessionId: "s1" });

    expect(insert).toHaveBeenNthCalledWith(2, {
      session_id: "s1",
      user_id: TEST_USER_ID,
      role: "assistant",
      content: "grounded answer",
      sources: [{ documentName: "n.md", chunkText: "c", score: 0.5 }],
    });
  });
});
