import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  extractSpreadsheet,
  extractSpreadsheetText,
  readSpreadsheetRows,
  spreadsheetCellValueToText,
  trimSpreadsheetToSize,
} from "@/lib/spreadsheet";

async function workbookBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sales = workbook.addWorksheet("Sales");
  sales.addRow(["Month", "Revenue", "Published"]);
  sales.addRow(["March", 1250, new Date("2026-03-01T00:00:00.000Z")]);
  sales.getCell("B3").value = { formula: "B2*2", result: 2500 };
  sales.getCell("C3").value = { formula: "TODAY()" };
  sales.getCell("A4").value = { richText: [{ text: "Rich" }, { text: " text" }] };
  sales.getCell("B4").value = { text: "OpenAI", hyperlink: "https://openai.com" };
  sales.getCell("C4").value = { error: "#N/A" };
  sales.addRow([]);

  const hidden = workbook.addWorksheet("Lookup", { state: "hidden" });
  hidden.addRow(["Code", "Meaning"]);
  hidden.addRow([true, "Enabled"]);

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("Excel workbook extraction", () => {
  it("formats supported cell value shapes deterministically", () => {
    expect(spreadsheetCellValueToText(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "2026-01-02T03:04:05.000Z",
    );
    expect(spreadsheetCellValueToText({ formula: "A1*2", result: 10 })).toBe("10 (formula: =A1*2)");
    expect(spreadsheetCellValueToText({ formula: "NOW()" })).toBe("Formula: =NOW()");
    expect(spreadsheetCellValueToText({ richText: [{ text: "Hello" }, { text: " world" }] })).toBe(
      "Hello world",
    );
    expect(spreadsheetCellValueToText({ text: "Docs", hyperlink: "https://example.com" })).toBe(
      "Docs (https://example.com)",
    );
  });

  it("includes multiple and hidden sheets with row, coordinate, header, and formula context", async () => {
    const text = await extractSpreadsheetText(await workbookBytes());

    expect(text).toContain('Worksheet "Sales", row 2');
    expect(text).toContain('A2 / "Month"="March"');
    expect(text).toContain('B3 / "Revenue"="2500 (formula: =B2*2)"');
    expect(text).toContain('C3 / "Published"="Formula: =TODAY()"');
    expect(text).toContain('A4 / "Month"="Rich text"');
    expect(text).toContain('B4 / "Revenue"="OpenAI (https://openai.com)"');
    expect(text).toContain('Worksheet "Lookup" (hidden), row 2');
    expect(text).toContain('A2 / "Code"="true"');
  });

  it("preserves typed rows and cached formula results for structured queries", async () => {
    const extracted = await extractSpreadsheet(await workbookBytes());

    expect(extracted.sheets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheetName: "Sales",
          headerRowNumber: 1,
          populatedRowCount: 3,
          columns: expect.arrayContaining([
            expect.objectContaining({ header: "Revenue", headerKey: "revenue", letter: "B" }),
          ]),
        }),
        expect.objectContaining({ sheetName: "Lookup", sheetState: "hidden" }),
      ]),
    );
    const formula = extracted.rows.find((row) => row.rowNumber === 3)?.cells[0];
    expect(formula).toMatchObject({
      header: "Revenue",
      headerKey: "revenue",
      valueType: "number",
      numericValue: "2500",
      formula: "B2*2",
    });
    const published = extracted.rows.find((row) => row.rowNumber === 2)?.cells[2];
    expect(published).toMatchObject({
      valueType: "date",
      dateValue: "2026-03-01T00:00:00.000Z",
    });
  });

  it("rejects workbooks with no populated cells", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Empty");
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    await expect(extractSpreadsheetText(bytes)).rejects.toThrow(
      "No extractable cell values found in the workbook",
    );
  });

  it("rebuilds the largest complete populated-row prefix below a size limit", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    sheet.addRow(["Key", "Value"]);
    for (let index = 1; index <= 160; index += 1) {
      sheet.addRow([
        `item-${index}`,
        Array.from(
          { length: 20 },
          (_, part) => `${index}-${part}-${(index * 7919 + part) % 104729}`,
        ).join(" "),
      ]);
    }
    const source = new Uint8Array(await workbook.xlsx.writeBuffer());
    const normalized = await trimSpreadsheetToSize(source, Number.MAX_SAFE_INTEGER);
    const maxBytes = Math.floor(normalized.bytes.byteLength * 0.7);

    const trimmed = await trimSpreadsheetToSize(source, maxBytes);
    const retainedRows = await readSpreadsheetRows(trimmed.bytes);

    expect(trimmed.bytes.byteLength).toBeLessThan(maxBytes);
    expect(trimmed.includedRows).toBe(retainedRows.length);
    expect(trimmed.includedRows).toBeGreaterThan(0);
    expect(trimmed.includedRows).toBeLessThan(trimmed.totalRows);
    expect(retainedRows.at(-1)?.rowNumber).toBe(trimmed.includedRows);
  });

  it("trims a compressed workbook by semantic row limits even when bytes fit", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dense");
    sheet.addRow(["Code", "Description"]);
    for (let index = 1; index <= 12; index += 1) {
      sheet.addRow([`code-${index}`, `description-${index}`]);
    }
    const source = new Uint8Array(await workbook.xlsx.writeBuffer());

    const trimmed = await trimSpreadsheetToSize(source, Number.MAX_SAFE_INTEGER, {
      maxRows: 5,
      maxTextCharacters: Number.MAX_SAFE_INTEGER,
    });
    const retainedRows = await readSpreadsheetRows(trimmed.bytes);

    expect(trimmed.includedRows).toBe(5);
    expect(trimmed.totalRows).toBe(13);
    expect(retainedRows).toHaveLength(5);
    expect(retainedRows.at(-1)?.rowNumber).toBe(5);
  });

  it("rejects untrimmed workbooks over the semantic ingestion limit", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dense");
    sheet.addRows([["Header"], ["one"], ["two"]]);
    const source = new Uint8Array(await workbook.xlsx.writeBuffer());

    await expect(
      extractSpreadsheetText(source, {
        maxRows: 2,
        maxTextCharacters: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toThrow("Workbook exceeds the safe ingestion limit");
  });
});
