import { beforeEach, describe, expect, it, vi } from "vitest";

// executeTool()'s two branches call retrieve() and supabase directly (read
// the real lib/tools.ts before writing this) -- mock both so this file
// costs zero API/DB calls and never lets lib/supabase.ts's fail-fast env
// check execute for real.
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { retrieve } from "@/lib/retrieval";
import { supabase } from "@/lib/supabase";
import { executeTool, listDocumentsTool, searchNotesTool, tools } from "@/lib/tools";

const mockRetrieve = vi.mocked(retrieve);
const mockFrom = vi.mocked(supabase.from);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool schemas", () => {
  it("search_notes: requires 'query', accepts optional 'k'", () => {
    expect(searchNotesTool.type).toBe("function");
    expect(searchNotesTool.function.name).toBe("search_notes");
    expect(searchNotesTool.function.parameters.required).toEqual(["query"]);
    const props = searchNotesTool.function.parameters.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["k", "query"]);
  });

  it("list_documents: takes no arguments", () => {
    expect(listDocumentsTool.function.name).toBe("list_documents");
    expect(listDocumentsTool.function.parameters.required).toEqual([]);
    expect(listDocumentsTool.function.parameters.properties).toEqual({});
  });

  it("tools exports both, in a stable order, ready for chat()'s tools param", () => {
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.function.name)).toEqual(["search_notes", "list_documents"]);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.description.length).toBeGreaterThan(0);
    }
  });
});

describe("executeTool", () => {
  it("search_notes: calls retrieve() with the query and k, returns its result", async () => {
    mockRetrieve.mockResolvedValue([{ documentName: "x.md", chunkText: "y", score: 0.8 }]);

    const result = await executeTool("search_notes", { query: "what is X", k: 3 });

    expect(mockRetrieve).toHaveBeenCalledWith("what is X", 3);
    expect(result).toEqual([{ documentName: "x.md", chunkText: "y", score: 0.8 }]);
  });

  it("search_notes: omitting k lets retrieve() apply its own default", async () => {
    mockRetrieve.mockResolvedValue([]);

    await executeTool("search_notes", { query: "q" });

    expect(mockRetrieve).toHaveBeenCalledWith("q", undefined);
  });

  it("search_notes: rejects a missing/empty query without calling retrieve()", async () => {
    await expect(executeTool("search_notes", {})).rejects.toThrow(/query/i);
    await expect(executeTool("search_notes", { query: "   " })).rejects.toThrow(/query/i);
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("list_documents: queries the documents table directly -- no embedding/chat cost", async () => {
    const select = vi.fn().mockResolvedValue({
      data: [{ name: "a.pdf", status: "ready" }],
      error: null,
    });
    mockFrom.mockReturnValue({ select } as never);

    const result = await executeTool("list_documents", {});

    expect(mockFrom).toHaveBeenCalledWith("documents");
    expect(select).toHaveBeenCalledWith("name, status");
    expect(result).toEqual([{ name: "a.pdf", status: "ready" }]);
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("list_documents: surfaces a DB error with a descriptive message", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: "relation missing" } });
    mockFrom.mockReturnValue({ select } as never);

    await expect(executeTool("list_documents", {})).rejects.toThrow(/relation missing/);
  });

  it("list_documents: an empty table returns an empty array, not null/undefined", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ select } as never);

    expect(await executeTool("list_documents", {})).toEqual([]);
  });

  it("throws a clear, specific error for an unknown tool name -- doesn't crash", async () => {
    await expect(executeTool("delete_everything", {})).rejects.toThrow(
      /Unknown tool: delete_everything/,
    );
  });
});
