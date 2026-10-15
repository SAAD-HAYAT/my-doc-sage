import { beforeEach, describe, expect, it, vi } from "vitest";

// executeTool()'s two branches call retrieve() and supabaseAdmin directly
// (read the real lib/tools.ts before writing this) -- mock both so this
// file costs zero API/DB calls and never lets lib/supabase.ts's fail-fast
// env check execute for real.
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/spreadsheet-query", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/spreadsheet-query")>();
  return {
    ...original,
    inspectSpreadsheets: vi.fn(),
    querySpreadsheet: vi.fn(),
  };
});

import { retrieve } from "@/lib/retrieval";
import { supabaseAdmin } from "@/lib/supabase";
import {
  inspectSpreadsheets,
  querySpreadsheet,
  SpreadsheetQueryInputError,
} from "@/lib/spreadsheet-query";
import {
  executeTool,
  inspectSpreadsheetTool,
  listDocumentsTool,
  querySpreadsheetTool,
  searchNotesTool,
  tools,
} from "@/lib/tools";

const mockRetrieve = vi.mocked(retrieve);
const mockFrom = vi.mocked(supabaseAdmin.from);
const mockInspectSpreadsheets = vi.mocked(inspectSpreadsheets);
const mockQuerySpreadsheet = vi.mocked(querySpreadsheet);

const TEST_USER_ID = "test-user-id";

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

  it("exports semantic and structured spreadsheet tools in a stable order", () => {
    expect(inspectSpreadsheetTool.function.name).toBe("inspect_spreadsheet");
    expect(querySpreadsheetTool.function.name).toBe("query_spreadsheet");
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.function.name)).toEqual([
      "search_notes",
      "list_documents",
      "inspect_spreadsheet",
      "query_spreadsheet",
    ]);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.description.length).toBeGreaterThan(0);
    }
  });
});

// Phase 7: mocks the .select(...).eq("user_id", ...) chain list_documents
// now goes through -- a plain .select(...) mock (as before Phase 7) would
// no longer match the real call shape.
function mockDocumentsQuery(result: { data: unknown; error: unknown }) {
  const eq = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select } as never);
  return { select, eq };
}

describe("executeTool", () => {
  it("search_notes: calls retrieve() with the query, userId, and k, returns its result", async () => {
    mockRetrieve.mockResolvedValue([{ documentName: "x.md", chunkText: "y", score: 0.8 }]);

    const result = await executeTool("search_notes", { query: "what is X", k: 3 }, TEST_USER_ID);

    expect(mockRetrieve).toHaveBeenCalledWith("what is X", TEST_USER_ID, 3);
    expect(result).toEqual([{ documentName: "x.md", chunkText: "y", score: 0.8 }]);
  });

  it("search_notes: omitting k lets retrieve() apply its own default", async () => {
    mockRetrieve.mockResolvedValue([]);

    await executeTool("search_notes", { query: "q" }, TEST_USER_ID);

    expect(mockRetrieve).toHaveBeenCalledWith("q", TEST_USER_ID, undefined);
  });

  it("search_notes: rejects a missing/empty query without calling retrieve()", async () => {
    await expect(executeTool("search_notes", {}, TEST_USER_ID)).rejects.toThrow(/query/i);
    await expect(executeTool("search_notes", { query: "   " }, TEST_USER_ID)).rejects.toThrow(
      /query/i,
    );
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("list_documents: queries the documents table scoped to the caller's user_id -- no embedding/chat cost", async () => {
    const { select, eq } = mockDocumentsQuery({
      data: [{ name: "a.pdf", status: "ready" }],
      error: null,
    });

    const result = await executeTool("list_documents", {}, TEST_USER_ID);

    expect(mockFrom).toHaveBeenCalledWith("documents");
    expect(select).toHaveBeenCalledWith("name, status");
    expect(eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
    expect(result).toEqual([{ name: "a.pdf", status: "ready" }]);
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("list_documents: surfaces a DB error with a descriptive message", async () => {
    mockDocumentsQuery({ data: null, error: { message: "relation missing" } });

    await expect(executeTool("list_documents", {}, TEST_USER_ID)).rejects.toThrow(
      /relation missing/,
    );
  });

  it("list_documents: an empty table returns an empty array, not null/undefined", async () => {
    mockDocumentsQuery({ data: null, error: null });

    expect(await executeTool("list_documents", {}, TEST_USER_ID)).toEqual([]);
  });

  it("inspect_spreadsheet and query_spreadsheet remain explicitly user-scoped", async () => {
    mockInspectSpreadsheets.mockResolvedValue({ documents: [] });
    mockQuerySpreadsheet.mockResolvedValue({
      ok: true,
      operation: "sum",
      column: "expenses",
      filters: [],
      worksheets: ["Sheet1"],
      matchedRowCount: 2,
      evidence: [],
      evidenceTruncated: false,
      value: "30",
      formattedValue: "30",
      numericValueCount: 2,
      skippedNonNumeric: 0,
      documentName: "data.xlsx",
      uploadedAt: "2026-10-15",
      scope: { trimmed: false },
    });

    await executeTool("inspect_spreadsheet", { documentName: "data.xlsx" }, TEST_USER_ID);
    await executeTool(
      "query_spreadsheet",
      { documentName: "data.xlsx", operation: "sum", column: "expenses" },
      TEST_USER_ID,
    );

    expect(mockInspectSpreadsheets).toHaveBeenCalledWith(TEST_USER_ID, "data.xlsx");
    expect(mockQuerySpreadsheet).toHaveBeenCalledWith(TEST_USER_ID, {
      documentName: "data.xlsx",
      operation: "sum",
      column: "expenses",
    });
  });

  it("returns recoverable spreadsheet query errors to the model", async () => {
    mockQuerySpreadsheet.mockRejectedValue(
      new SpreadsheetQueryInputError("legacy.xlsx must be re-uploaded"),
    );

    await expect(
      executeTool(
        "query_spreadsheet",
        { documentName: "legacy.xlsx", operation: "count" },
        TEST_USER_ID,
      ),
    ).resolves.toEqual({ ok: false, error: "legacy.xlsx must be re-uploaded" });
  });

  it("throws a clear, specific error for an unknown tool name -- doesn't crash", async () => {
    await expect(executeTool("delete_everything", {}, TEST_USER_ID)).rejects.toThrow(
      /Unknown tool: delete_everything/,
    );
  });
});
