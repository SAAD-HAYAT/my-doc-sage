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
});
