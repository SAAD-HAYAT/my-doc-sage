import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/chat/route.ts pulls in @/lib/supabase, @/lib/retrieval and
// @/lib/openrouter. lib/supabase.ts fails fast at import time if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set, so these vi.mock()
// calls must intercept the module before the real one is ever evaluated.
// vi.mock() is hoisted above these imports by Vitest, so this works even
// though the mock factories are declared before the values they return are
// used below — verified by actually running this suite with no env vars
// set (see the workflow / local run notes).
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));

import { retrieve } from "@/lib/retrieval";
import { chat } from "@/lib/openrouter";
import { supabase } from "@/lib/supabase";
import { POST } from "@/app/api/chat/route";

const mockRetrieve = vi.mocked(retrieve);
const mockChat = vi.mocked(chat);
const mockFrom = vi.mocked(supabase.from);

type HistoryRow = { role: "user" | "assistant"; content: string; sources?: unknown };

/** Wires supabase.from("messages") to return `rows` for the history
 * select-chain, and a no-op resolver for the two persistence inserts. */
function mockHistory(rows: HistoryRow[]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  mockFrom.mockReturnValue({ select, insert } as never);
  return { select, eq, order, limit, insert };
}

function post(body: unknown) {
  const req = new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRetrieve.mockResolvedValue([
    { documentName: "notes.md", chunkText: "some retrieved context", score: 0.6 },
  ]);
  mockChat.mockResolvedValue("the model's answer");
});

describe("POST /api/chat — conversation memory", () => {
  it("sends [system, ...prior turns, current user message] when history exists", async () => {
    // Real DB rows come back newest-first (order by created_at desc); the
    // route reverses them. So A1 (the answer) is "newer" than Q1 (the
    // question that produced it) and must be listed first here.
    mockHistory([
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q1" },
    ]);

    const res = await post({ message: "Q2", sessionId: "s1" });
    expect(res.status).toBe(200);

    expect(mockChat).toHaveBeenCalledTimes(1);
    const messages = mockChat.mock.calls[0][0];

    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("some retrieved context");
    expect(messages[1]).toEqual({ role: "user", content: "Q1" });
    expect(messages[2]).toEqual({ role: "assistant", content: "A1" });
    expect(messages[3]).toEqual({ role: "user", content: "Q2" });
  });

  it("sends just [system, current user message] on a brand new session", async () => {
    mockHistory([]);

    await post({ message: "first question", sessionId: "new-session" });

    const messages = mockChat.mock.calls[0][0];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "first question" });
  });

  it("requests at most the last 10 messages, oldest-to-newest, from newest-first DB rows", async () => {
    // The real query orders `created_at` descending then .limit(10) — the
    // route then reverses it back to chronological order. Feed rows in
    // newest-first order (as Postgres would return them) and assert the
    // route flips them before building the prompt.
    const { limit } = mockHistory([
      { role: "assistant", content: "turn4-assistant" },
      { role: "user", content: "turn4-user" },
      { role: "assistant", content: "turn3-assistant" },
      { role: "user", content: "turn3-user" },
    ]);

    await post({ message: "current turn", sessionId: "s1" });

    expect(limit).toHaveBeenCalledWith(10);

    const messages = mockChat.mock.calls[0][0];
    // system, 4 prior (now chronological), current = 6
    expect(messages).toHaveLength(6);
    expect(messages.slice(1, -1)).toEqual([
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
    mockHistory([
      {
        role: "assistant",
        content: "an earlier grounded answer",
        // A real assistant row does carry `sources` in the messages table;
        // the route must not leak it into the model-facing history.
        sources: [{ documentName: "x.md", chunkText: "y", score: 0.9 }],
      },
    ]);

    await post({ message: "follow-up", sessionId: "s1" });

    const messages = mockChat.mock.calls[0][0];
    const priorEntry = messages[1];
    expect(Object.keys(priorEntry).sort()).toEqual(["content", "role"]);
    expect(priorEntry).toEqual({
      role: "assistant",
      content: "an earlier grounded answer",
    });
  });

  it("persists the user message then the assistant reply after generating the answer", async () => {
    const { insert } = mockHistory([]);

    await post({ message: "hello", sessionId: "s1" });

    expect(insert).toHaveBeenNthCalledWith(1, {
      session_id: "s1",
      role: "user",
      content: "hello",
    });
    expect(insert).toHaveBeenNthCalledWith(2, {
      session_id: "s1",
      role: "assistant",
      content: "the model's answer",
      sources: [{ documentName: "notes.md", chunkText: "some retrieved context", score: 0.6 }],
    });
  });

  it("returns 500 with a descriptive error if the history fetch fails", async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "db down" } });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select, insert: vi.fn() } as never);

    const res = await post({ message: "hi", sessionId: "s1" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/db down/);
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
