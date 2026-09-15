import { beforeEach, describe, expect, it, vi } from "vitest";

// runAgentLoop's only dependencies are chat() (lib/openrouter) and
// executeTool() (lib/tools) -- mock both directly so this file never
// touches retrieve()/supabase/network and costs zero API calls.
vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));
vi.mock("@/lib/tools", () => ({ executeTool: vi.fn() }));

import { chat } from "@/lib/openrouter";
import { executeTool } from "@/lib/tools";
import { runAgentLoop } from "@/lib/agent";
import type { ChatMessage, ToolDefinition } from "@/lib/openrouter";

const mockChat = vi.mocked(chat);
const mockExecuteTool = vi.mocked(executeTool);

const noTools: ToolDefinition[] = [];
const initialMessages: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "q" },
];

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
});

describe("runAgentLoop", () => {
  it("loops through two different search_notes calls before answering", async () => {
    mockChat
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "first thing" }))
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "second thing" }))
      .mockResolvedValueOnce("final answer combining both searches")
      .mockResolvedValueOnce("supported"); // groundedness self-check

    mockExecuteTool
      .mockResolvedValueOnce([{ documentName: "a.md", chunkText: "a", score: 0.9 }])
      .mockResolvedValueOnce([{ documentName: "b.md", chunkText: "b", score: 0.8 }]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runAgentLoop(initialMessages, noTools);

    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    expect(mockExecuteTool).toHaveBeenNthCalledWith(1, "search_notes", { query: "first thing" });
    expect(mockExecuteTool).toHaveBeenNthCalledWith(2, "search_notes", { query: "second thing" });

    // 2 tool-calling iterations + 1 final-answer iteration + 1 self-check call.
    expect(mockChat).toHaveBeenCalledTimes(4);

    expect(result.answer).toBe("final answer combining both searches");
    expect(result.sources).toEqual([{ documentName: "b.md", chunkText: "b", score: 0.8 }]);
    expect(result.groundednessWarning).toBe(false);

    // Each iteration is diagnosable from logs alone: iteration number, tool
    // name, and args should all show up somewhere in the log lines.
    const logs = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => /iteration 1/.test(l) && /search_notes/.test(l) && /first thing/.test(l))).toBe(true);
    expect(logs.some((l) => /iteration 2/.test(l) && /search_notes/.test(l) && /second thing/.test(l))).toBe(true);
    expect(logs.some((l) => /iteration 3/.test(l) && /final answer/i.test(l))).toBe(true);

    logSpy.mockRestore();
  });

  it("stops at exactly 4 iterations and returns the fallback message on a runaway loop", async () => {
    mockChat.mockResolvedValue(toolCallResponse("search_notes", { query: "keeps asking" }));
    mockExecuteTool.mockResolvedValue([]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runAgentLoop(initialMessages, noTools);

    expect(mockChat).toHaveBeenCalledTimes(4);
    expect(mockExecuteTool).toHaveBeenCalledTimes(4);
    expect(result.answer).toBe("I couldn't find a confident answer in your notes for this question.");
    expect(result.groundednessWarning).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("iteration cap"));

    warnSpy.mockRestore();
  });

  it("a single tool_calls round followed by a final answer works as before (Phase 3 behavior preserved)", async () => {
    mockChat
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "q" }))
      .mockResolvedValueOnce("answer")
      .mockResolvedValueOnce("supported");
    mockExecuteTool.mockResolvedValueOnce([{ documentName: "n.md", chunkText: "c", score: 0.5 }]);

    const result = await runAgentLoop(initialMessages, noTools);

    expect(mockChat).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      answer: "answer",
      sources: [{ documentName: "n.md", chunkText: "c", score: 0.5 }],
      groundednessWarning: false,
    });
  });

  it("a direct answer with no tool calls skips the self-check entirely (nothing to ground against)", async () => {
    mockChat.mockResolvedValueOnce("just answering directly, no notes needed");

    const result = await runAgentLoop(initialMessages, noTools);

    expect(mockChat).toHaveBeenCalledTimes(1); // no self-check call: sources is empty
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(result).toEqual({
      answer: "just answering directly, no notes needed",
      sources: [],
      groundednessWarning: false,
    });
  });

  it("flags groundednessWarning when the self-check reports the answer is unsupported, but still returns it", async () => {
    mockChat
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "q" }))
      .mockResolvedValueOnce("an answer that drifts from the notes")
      .mockResolvedValueOnce("unsupported");
    mockExecuteTool.mockResolvedValueOnce([{ documentName: "n.md", chunkText: "c", score: 0.5 }]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runAgentLoop(initialMessages, noTools);

    expect(result.answer).toBe("an answer that drifts from the notes");
    expect(result.groundednessWarning).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unsupported"));

    warnSpy.mockRestore();
  });

  it("citations: injects a citation instruction after the caller's system message(s), before the first user turn", async () => {
    mockChat.mockResolvedValueOnce("direct answer");

    await runAgentLoop(initialMessages, noTools);

    const sentMessages = mockChat.mock.calls[0][0];
    // initialMessages = [system, user] -> instruction lands at index 1.
    expect(sentMessages).toHaveLength(initialMessages.length + 1);
    expect(sentMessages[0]).toEqual(initialMessages[0]); // caller's own system prompt, untouched
    expect(sentMessages[1].role).toBe("system");
    expect(sentMessages[1].content).toMatch(/\[1\]/);
    expect(sentMessages[1].content).toMatch(/\[2\]/);
    expect(sentMessages[2]).toEqual(initialMessages[1]); // original user turn, unmoved
  });

  it("citations: the array position the model reads as its [N]th passage is exactly sources[N-1]", async () => {
    const chunkA = { documentName: "a.md", chunkText: "alpha content", score: 0.9 };
    const chunkB = { documentName: "b.md", chunkText: "beta content", score: 0.8 };

    mockChat
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "q" }))
      .mockResolvedValueOnce("Alpha is described in [1] and beta in [2].")
      .mockResolvedValueOnce("supported");
    mockExecuteTool.mockResolvedValueOnce([chunkA, chunkB]);

    const result = await runAgentLoop(initialMessages, noTools);

    // What the model actually reads as the numbered passage list...
    const followUpMessages = mockChat.mock.calls[1][0];
    const toolResultMsg = followUpMessages.find((m) => m.role === "tool");
    const modelVisibleArray = JSON.parse(toolResultMsg?.content as string);

    // ...is the exact same array, same order, returned as `sources` -- not
    // just conventionally expected to match, structurally guaranteed to.
    expect(result.sources).toEqual(modelVisibleArray);
    expect(result.sources[0]).toEqual(chunkA); // the model's "[1]"
    expect(result.sources[1]).toEqual(chunkB); // the model's "[2]"
  });

  it("query rewriting: skipped entirely on the first message of a session (no prior history)", async () => {
    // initialMessages = [system, user] -- exactly one conversational turn.
    mockChat.mockResolvedValueOnce("direct answer");

    await runAgentLoop(initialMessages, noTools);

    // Only the one loop-iteration call -- no extra rewrite call was made.
    expect(mockChat).toHaveBeenCalledTimes(1);
    const sentMessages = mockChat.mock.calls[0][0];
    expect(sentMessages.some((m) => m.content?.includes("Context hint"))).toBe(false);
  });

  it("query rewriting: fires on turn 2+ and injects a self-contained-query hint right before the current message", async () => {
    const messagesWithHistory: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "Who leads the platform team?" },
      { role: "assistant", content: "Maria Chen leads the platform team." },
      { role: "user", content: "who leads that?" },
    ];

    mockChat
      .mockResolvedValueOnce("who leads the platform team") // the rewrite call
      .mockResolvedValueOnce("direct answer"); // the loop's own call

    const result = await runAgentLoop(messagesWithHistory, noTools);

    expect(mockChat).toHaveBeenCalledTimes(2);
    // The rewrite call itself gets no `tools` param -- it's a plain rewrite, not a search.
    expect(mockChat.mock.calls[0][1]).toBeUndefined();

    const loopMessages = mockChat.mock.calls[1][0];
    const hint = loopMessages.find((m) => m.role === "system" && m.content?.includes("Context hint"));
    expect(hint).toBeDefined();
    expect(hint?.content).toContain("who leads the platform team");

    // Hint sits immediately before the unmodified current user message.
    expect(loopMessages[loopMessages.length - 1]).toEqual({ role: "user", content: "who leads that?" });
    expect(loopMessages[loopMessages.length - 2]).toBe(hint);

    expect(result.answer).toBe("direct answer");
  });

  it("query rewriting: skips inserting a hint when the rewrite is identical to the original message", async () => {
    const messagesWithHistory: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "first turn" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "a fully self-contained question already" },
    ];

    mockChat
      .mockResolvedValueOnce("a fully self-contained question already") // rewrite: no-op
      .mockResolvedValueOnce("direct answer");

    await runAgentLoop(messagesWithHistory, noTools);

    const loopMessages = mockChat.mock.calls[1][0];
    expect(loopMessages.some((m) => m.content?.includes("Context hint"))).toBe(false);
  });

  it("query rewriting: a failed rewrite call degrades gracefully -- no hint, no crash, loop still proceeds", async () => {
    const messagesWithHistory: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "first turn" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "who leads that?" },
    ];

    mockChat
      .mockRejectedValueOnce(new Error("network down")) // rewrite call fails
      .mockResolvedValueOnce("direct answer");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runAgentLoop(messagesWithHistory, noTools);

    expect(result.answer).toBe("direct answer");
    const loopMessages = mockChat.mock.calls[1][0];
    expect(loopMessages.some((m) => m.content?.includes("Context hint"))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("query-rewrite call failed"));

    warnSpy.mockRestore();
  });

  it("query rewriting: when the model follows the hint, search_notes (and so retrieve()) gets the rewritten query, not the raw pronoun-laden one", async () => {
    const messagesWithHistory: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "Who leads the platform team?" },
      { role: "assistant", content: "Maria Chen leads the platform team." },
      { role: "user", content: "who leads that?" },
    ];

    mockChat
      .mockResolvedValueOnce("who leads the platform team") // rewrite
      .mockResolvedValueOnce(toolCallResponse("search_notes", { query: "who leads the platform team" }))
      .mockResolvedValueOnce("Maria Chen.")
      .mockResolvedValueOnce("supported");
    mockExecuteTool.mockResolvedValueOnce([{ documentName: "d.md", chunkText: "c", score: 0.9 }]);

    await runAgentLoop(messagesWithHistory, noTools);

    expect(mockExecuteTool).toHaveBeenCalledWith("search_notes", { query: "who leads the platform team" });
  });
});
