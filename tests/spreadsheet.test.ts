import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
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
});
