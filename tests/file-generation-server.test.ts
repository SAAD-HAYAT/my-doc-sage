import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/spreadsheet-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spreadsheet-query")>();
  return {
    ...actual,
    inspectSpreadsheets: vi.fn(),
    exportSpreadsheetRows: vi.fn(),
    querySpreadsheet: vi.fn(),
  };
});

import { generateFilePayload } from "@/lib/file-generation-server";
import { chat } from "@/lib/openrouter";
import { retrieve } from "@/lib/retrieval";
import {
  exportSpreadsheetRows,
  inspectSpreadsheets,
  querySpreadsheet,
} from "@/lib/spreadsheet-query";

const mockChat = vi.mocked(chat);
const mockRetrieve = vi.mocked(retrieve);
const mockInspectSpreadsheets = vi.mocked(inspectSpreadsheets);
const mockExportSpreadsheetRows = vi.mocked(exportSpreadsheetRows);
const mockQuerySpreadsheet = vi.mocked(querySpreadsheet);

beforeEach(() => {
  vi.clearAllMocks();
  mockRetrieve.mockResolvedValue([
    { documentName: "notes.md", chunkText: "Revenue was 100.", score: 0.9 },
  ]);
  mockInspectSpreadsheets.mockResolvedValue({ documents: [] });
});

describe("generated file payloads", () => {
  it("validates a model-generated workbook specification", async () => {
    mockChat.mockResolvedValue(
      '```json\n{"sheets":[{"name":"Summary","rows":[["Metric","Value"],["Revenue",100]]}]}\n```',
    );

    await expect(
      generateFilePayload("Create an Excel report", "One summary worksheet", "xlsx", "user-1"),
    ).resolves.toEqual({
      format: "xlsx",
      name: "generated-workbook.xlsx",
      sheets: [
        {
          name: "Summary",
          rows: [
            ["Metric", "Value"],
            ["Revenue", 100],
          ],
        },
      ],
    });
    expect(mockRetrieve).toHaveBeenCalledWith("Create an Excel report", "user-1", 10);
  });

  it("returns model-authored Markdown content for PDF rendering", async () => {
    mockChat.mockResolvedValue("# Report\n\nRevenue was 100.");

    await expect(
      generateFilePayload("Generate a PDF", "Detailed report", "pdf", "user-1"),
    ).resolves.toEqual({
      format: "pdf",
      name: "generated-document.pdf",
      content: "# Report\n\nRevenue was 100.",
    });
  });

  it("builds a multi-sheet workbook from exhaustive structured queries", async () => {
    mockInspectSpreadsheets.mockResolvedValue({
      documents: [
        {
          name: "INS.xlsx",
          uploadedAt: "2026-10-15",
          structured: true,
          requiresReupload: false,
          trimmed: { unit: "rows", included: 125, total: 200 },
          worksheets: [
            {
              name: "Policies",
              state: "visible",
              headerRowNumber: 1,
              populatedRowCount: 124,
              columns: [
                { header: "Policy #", letter: "A", valueTypes: ["text"] },
                { header: "expenses", letter: "B", valueTypes: ["number"] },
              ],
            },
          ],
        },
      ],
    });
    mockChat.mockResolvedValue(
      JSON.stringify({
        mode: "structured",
        sheets: [
          {
            kind: "summary",
            name: "Summary",
            metrics: [
              {
                label: "Fire expenses",
                query: {
                  documentName: "INS.xlsx",
                  sheetName: "Policies",
                  operation: "sum",
                  column: "expenses",
                  filters: [{ column: "Policy #", operator: "contains", value: "fire" }],
                },
              },
            ],
          },
          {
            kind: "rows",
            name: "Fire policies",
            query: {
              documentName: "INS.xlsx",
              sheetName: "Policies",
              operation: "rows",
              columns: ["Policy #", "expenses"],
              filters: [{ column: "Policy #", operator: "contains", value: "fire" }],
            },
          },
        ],
      }),
    );
    mockQuerySpreadsheet.mockResolvedValue({
      ok: true,
      operation: "sum",
      column: "expenses",
      filters: [],
      worksheets: ["Policies"],
      matchedRowCount: 49,
      evidence: [],
      evidenceTruncated: false,
      value: "10577164.656696110",
      formattedValue: "10,577,164.66",
      numericValueCount: 49,
      skippedNonNumeric: 0,
      documentName: "INS.xlsx",
      uploadedAt: "2026-10-15",
      scope: { trimmed: true, unit: "rows", included: 125, total: 200 },
    });
    mockExportSpreadsheetRows.mockResolvedValue({
      ok: true,
      operation: "rows",
      column: null,
      filters: [],
      worksheets: ["Policies"],
      matchedRowCount: 2,
      evidence: [],
      evidenceTruncated: false,
      selectedColumns: [
        {
          sheetName: "Policies",
          columns: [
            { header: "Policy #", letter: "A", valueTypes: ["text"] },
            { header: "expenses", letter: "B", valueTypes: ["number"] },
          ],
        },
      ],
      rows: [
        {
          sheetName: "Policies",
          rowNumber: 2,
          values: [
            {
              column: "Policy #",
              address: "A2",
              value: "Fire A",
              valueType: "text",
              numericValue: null,
              dateValue: null,
              booleanValue: null,
            },
            {
              column: "expenses",
              address: "B2",
              value: "100.25",
              valueType: "number",
              numericValue: "100.25",
              dateValue: null,
              booleanValue: null,
            },
          ],
        },
      ],
      rowsTruncated: false,
      documentName: "INS.xlsx",
      uploadedAt: "2026-10-15",
      scope: { trimmed: true, unit: "rows", included: 125, total: 200 },
    });

    const payload = await generateFilePayload(
      "Create an Excel file with fire policies and a summary",
      "Use two worksheets",
      "xlsx",
      "user-1",
    );

    expect(payload).toMatchObject({
      format: "xlsx",
      sheets: [
        {
          name: "Summary",
          rows: [
            expect.any(Array),
            [
              "Fire expenses",
              10577164.65669611,
              49,
              49,
              0,
              "INS.xlsx",
              "Trimmed: rows 1–125 of 200",
            ],
          ],
        },
        {
          name: "Fire policies",
          rows: [
            ["Source worksheet", "Source row", "Policy #", "expenses"],
            ["Policies", 2, "Fire A", 100.25],
            [],
            ["Source scope", "Trimmed: rows 1–125 of 200"],
          ],
        },
      ],
    });
    expect(mockQuerySpreadsheet).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ documentName: "INS.xlsx", operation: "sum" }),
    );
    expect(mockExportSpreadsheetRows).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ documentName: "INS.xlsx", operation: "rows" }),
    );
    expect(String(mockChat.mock.calls[0][0][1].content)).toContain("INS.xlsx");
  });

  it("recovers a zero-row keyword export across all columns instead of downloading an empty file", async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        mode: "structured",
        sheets: [
          {
            kind: "rows",
            name: "Terrorism policies",
            query: {
              documentName: "INS.xlsx",
              sheetName: "Sheet1",
              operation: "rows",
              columns: ["Policy #"],
              filters: [{ column: "Description", operator: "contains", value: "terrorism" }],
            },
          },
        ],
      }),
    );
    const common = {
      ok: true as const,
      operation: "rows" as const,
      column: null,
      filters: [],
      worksheets: ["Sheet1"],
      evidence: [],
      evidenceTruncated: false,
      rowsTruncated: false,
      documentName: "INS.xlsx",
      uploadedAt: "2026-10-15",
      scope: { trimmed: false as const },
    };
    mockExportSpreadsheetRows
      .mockResolvedValueOnce({
        ...common,
        matchedRowCount: 0,
        selectedColumns: [
          {
            sheetName: "Sheet1",
            columns: [{ header: "Policy #", letter: "D", valueTypes: ["text"] }],
          },
        ],
        rows: [],
      })
      .mockResolvedValueOnce({
        ...common,
        matchedRowCount: 1,
        selectedColumns: [
          {
            sheetName: "Sheet1",
            columns: [
              { header: "Description", letter: "C", valueTypes: ["text"] },
              { header: "Policy #", letter: "D", valueTypes: ["text"] },
            ],
          },
        ],
        rows: [
          {
            sheetName: "Sheet1",
            rowNumber: 5,
            values: [
              {
                column: "Description",
                address: "C5",
                value: "2590848797/07/2024",
                valueType: "text",
                numericValue: null,
                dateValue: null,
                booleanValue: null,
              },
              {
                column: "Policy #",
                address: "D5",
                value: "TERRORISM INSURANCE",
                valueType: "text",
                numericValue: null,
                dateValue: null,
                booleanValue: null,
              },
            ],
          },
        ],
      });

    const payload = await generateFilePayload(
      "I need make a separate excel file for all the policies number under terrorism",
      "Export the matching policy numbers",
      "xlsx",
      "user-1",
    );

    expect(mockExportSpreadsheetRows).toHaveBeenCalledTimes(2);
    expect(mockExportSpreadsheetRows).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({
        columns: undefined,
        filters: [expect.objectContaining({ column: "*", operator: "contains" })],
      }),
    );
    expect(payload).toMatchObject({
      sheets: [
        {
          rows: [
            ["Source worksheet", "Source row", "Description", "Policy #"],
            ["Sheet1", 5, "2590848797/07/2024", "TERRORISM INSURANCE"],
            [],
            ["Export note", expect.stringContaining("matched across all populated columns")],
          ],
        },
      ],
    });
  });

  it("rejects malformed Excel output rather than creating a corrupt workbook", async () => {
    mockChat.mockResolvedValue('{"sheets":[]}');
    await expect(
      generateFilePayload("Generate Excel", "Summary", "xlsx", "user-1"),
    ).rejects.toThrow("invalid worksheet list");
  });
});
