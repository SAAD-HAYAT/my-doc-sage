import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
import {
  executeStructuredSpreadsheetQuery,
  exportSpreadsheetRows,
  inspectSpreadsheets,
  parseSpreadsheetQueryRequest,
  querySpreadsheet,
  type StoredSpreadsheetRow,
  type StoredSpreadsheetSheet,
} from "@/lib/spreadsheet-query";
import { extractSpreadsheet } from "@/lib/spreadsheet";
import { supabaseAdmin } from "@/lib/supabase";

const mockFrom = vi.mocked(supabaseAdmin.from);

function chainable(result: { data: unknown; error: unknown }) {
  const object: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in", "range"]) {
    object[method] = vi.fn(() => object);
  }
  object.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (error: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return object;
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function structuredFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Policies");
  sheet.addRow(["Policy #", "expenses", "Department"]);
  for (let index = 1; index <= 49; index += 1) {
    sheet.addRow([`Fire material damage ${index}`, index + 0.25, index % 2 ? "North" : "South"]);
  }
  for (let index = 1; index <= 10; index += 1) {
    sheet.addRow([`Motor policy ${index}`, 10_000, "Motor"]);
  }
  sheet.addRow(["FIRE policy with invalid expense", "not available", "North"]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const extracted = await extractSpreadsheet(bytes);
  const sheets: StoredSpreadsheetSheet[] = extracted.sheets.map((item) => ({
    document_id: "doc-1",
    sheet_name: item.sheetName,
    sheet_state: item.sheetState,
    header_row_number: item.headerRowNumber,
    columns: item.columns,
    populated_row_count: item.populatedRowCount,
  }));
  const rows: StoredSpreadsheetRow[] = extracted.rows.map((item) => ({
    sheet_name: item.sheetName,
    row_number: item.rowNumber,
    cells: item.cells,
  }));
  return { sheets, rows };
}

describe("structured spreadsheet queries", () => {
  it("sums every matching row beyond the semantic retrieval candidate limit", async () => {
    const data = await structuredFixture();
    const request = parseSpreadsheetQueryRequest({
      operation: "sum",
      column: "expenses",
      filters: [{ column: "Policy", operator: "contains", value: "fire" }],
    });

    const result = executeStructuredSpreadsheetQuery(data.sheets, data.rows, request);

    expect(result).toMatchObject({
      operation: "sum",
      matchedRowCount: 50,
      value: "1237.25",
      formattedValue: "1,237.25",
      numericValueCount: 49,
      skippedNonNumeric: 1,
      evidenceTruncated: false,
    });
    expect(result.evidence).toHaveLength(50);
  });

  it("supports grouped counts, row selection, and case-sensitive filters", async () => {
    const data = await structuredFixture();
    const grouped = executeStructuredSpreadsheetQuery(
      data.sheets,
      data.rows,
      parseSpreadsheetQueryRequest({
        operation: "count",
        filters: [{ column: "Policy #", operator: "contains", value: "fire" }],
        groupBy: "Department",
      }),
    );
    expect("groups" in grouped ? grouped.groups : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: "North", matchedRowCount: 26, value: "26" }),
        expect.objectContaining({ group: "South", matchedRowCount: 24, value: "24" }),
      ]),
    );

    const rows = executeStructuredSpreadsheetQuery(
      data.sheets,
      data.rows,
      parseSpreadsheetQueryRequest({
        operation: "rows",
        columns: ["Policy #", "expenses"],
        filters: [
          {
            column: "Policy #",
            operator: "starts_with",
            value: "Fire",
            caseSensitive: true,
          },
        ],
        limit: 2,
      }),
    );
    expect("rows" in rows ? rows.rows : []).toHaveLength(2);
    expect("rowsTruncated" in rows && rows.rowsTruncated).toBe(true);
  });

  it("rejects unknown and ambiguous columns instead of guessing", () => {
    const sheet: StoredSpreadsheetSheet = {
      document_id: "doc-1",
      sheet_name: "Data",
      sheet_state: "visible",
      header_row_number: 1,
      populated_row_count: 1,
      columns: [
        { column: 1, letter: "A", header: "Amount", headerKey: "amount", valueTypes: ["number"] },
        { column: 2, letter: "B", header: "Amount", headerKey: "amount", valueTypes: ["number"] },
      ],
    };
    const row: StoredSpreadsheetRow = {
      sheet_name: "Data",
      row_number: 2,
      cells: [
        {
          column: 1,
          address: "A2",
          text: "10",
          valueType: "number",
          numericValue: "10",
          header: "Amount",
          headerKey: "amount",
        },
        {
          column: 2,
          address: "B2",
          text: "20",
          valueType: "number",
          numericValue: "20",
          header: "Amount",
          headerKey: "amount",
        },
      ],
    };

    expect(() =>
      executeStructuredSpreadsheetQuery(
        [sheet],
        [row],
        parseSpreadsheetQueryRequest({ operation: "sum", column: "Amount" }),
      ),
    ).toThrow(/duplicated/i);
    expect(
      executeStructuredSpreadsheetQuery(
        [sheet],
        [row],
        parseSpreadsheetQueryRequest({ operation: "sum", column: "Amount (B)" }),
      ),
    ).toMatchObject({ value: "20" });
    expect(() =>
      executeStructuredSpreadsheetQuery(
        [sheet],
        [row],
        parseSpreadsheetQueryRequest({ operation: "sum", column: "Missing" }),
      ),
    ).toThrow(/requested columns|contains all/i);
  });

  it("validates bounded operations and filters", () => {
    expect(() => parseSpreadsheetQueryRequest({ operation: "sql", query: "drop table" })).toThrow(
      /unsupported/i,
    );
    expect(() => parseSpreadsheetQueryRequest({ operation: "sum" })).toThrow(/requires a column/i);
    expect(() =>
      parseSpreadsheetQueryRequest({
        operation: "count",
        filters: [{ column: "A", operator: "between", value: 1 }],
      }),
    ).toThrow(/secondValue/i);
  });

  it("loads schemas and all query rows with explicit user scoping", async () => {
    const data = await structuredFixture();
    const documentQuery = chainable({
      data: [
        {
          id: "doc-1",
          name: "INS.xlsx",
          status: "ready",
          created_at: "2026-10-15",
          trimmed_unit: null,
          included_count: null,
          source_count: null,
        },
      ],
      error: null,
    });
    const sheetQuery = chainable({ data: data.sheets, error: null });
    const rowQuery = chainable({ data: data.rows, error: null });
    mockFrom
      .mockImplementationOnce(() => documentQuery as never)
      .mockImplementationOnce(() => sheetQuery as never)
      .mockImplementationOnce(() => rowQuery as never);

    const result = await querySpreadsheet("user-1", {
      documentName: "INS.xlsx",
      operation: "sum",
      column: "expenses",
      filters: [{ column: "Policy #", operator: "contains", value: "fire" }],
    });

    expect(result).toMatchObject({
      documentName: "INS.xlsx",
      matchedRowCount: 50,
      value: "1237.25",
    });
    for (const query of [documentQuery, sheetQuery, rowQuery]) {
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    }
    expect(rowQuery.range).toHaveBeenCalledWith(0, 999);
  });

  it("exports every matching row beyond the interactive display limit", async () => {
    const data = await structuredFixture();
    const rows = Array.from({ length: 150 }, (_, index) => {
      const source = data.rows[index % data.rows.length];
      const rowNumber = index + 2;
      return {
        ...source,
        row_number: rowNumber,
        cells: source.cells.map((cell) => ({
          ...cell,
          address: cell.address.replace(/\d+$/, String(rowNumber)),
        })),
      };
    });
    const documentQuery = chainable({
      data: [
        {
          id: "doc-1",
          name: "INS.xlsx",
          status: "ready",
          created_at: "2026-10-15",
          trimmed_unit: null,
          included_count: null,
          source_count: null,
        },
      ],
      error: null,
    });
    const sheetQuery = chainable({ data: data.sheets, error: null });
    const rowQuery = chainable({ data: rows, error: null });
    mockFrom
      .mockImplementationOnce(() => documentQuery as never)
      .mockImplementationOnce(() => sheetQuery as never)
      .mockImplementationOnce(() => rowQuery as never);

    const result = await exportSpreadsheetRows("user-1", {
      documentName: "INS.xlsx",
      sheetName: "Policies",
      operation: "rows",
      columns: ["Policy #", "expenses"],
      filters: [],
      limit: 1,
    });

    expect("rows" in result ? result.rows : []).toHaveLength(150);
    expect("rowsTruncated" in result && result.rowsTruncated).toBe(false);
    expect(rowQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("marks pre-Phase-12 workbooks as requiring re-upload", async () => {
    const documentQuery = chainable({
      data: [
        {
          id: "legacy-1",
          name: "legacy.xlsx",
          status: "ready",
          created_at: "2026-10-01",
          trimmed_unit: null,
          included_count: null,
          source_count: null,
        },
      ],
      error: null,
    });
    const sheetQuery = chainable({ data: [], error: null });
    mockFrom
      .mockImplementationOnce(() => documentQuery as never)
      .mockImplementationOnce(() => sheetQuery as never);

    await expect(
      querySpreadsheet("user-1", {
        documentName: "legacy.xlsx",
        operation: "count",
      }),
    ).rejects.toThrow(/re-upload/i);
  });

  it("inspection reports structured and legacy workbook status", async () => {
    const data = await structuredFixture();
    const documentQuery = chainable({
      data: [
        {
          id: "doc-1",
          name: "INS.xlsx",
          status: "ready",
          created_at: "2026-10-15",
          trimmed_unit: "rows",
          included_count: 60,
          source_count: 100,
        },
        {
          id: "legacy-1",
          name: "legacy.xlsx",
          status: "ready",
          created_at: "2026-10-01",
          trimmed_unit: null,
          included_count: null,
          source_count: null,
        },
      ],
      error: null,
    });
    const sheetQuery = chainable({ data: data.sheets, error: null });
    mockFrom
      .mockImplementationOnce(() => documentQuery as never)
      .mockImplementationOnce(() => sheetQuery as never);

    const result = await inspectSpreadsheets("user-1");
    expect(result.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "INS.xlsx",
          structured: true,
          trimmed: { unit: "rows", included: 60, total: 100 },
        }),
        expect.objectContaining({ name: "legacy.xlsx", requiresReupload: true }),
      ]),
    );
  });
});
