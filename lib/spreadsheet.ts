import type { CellValue, Workbook, WorksheetState } from "exceljs";

export const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface SpreadsheetCell {
  column: number;
  address: string;
  text: string;
}

export interface SpreadsheetRow {
  sheetName: string;
  sheetState: WorksheetState;
  rowNumber: number;
  cells: SpreadsheetCell[];
  headers: SpreadsheetCell[];
}

async function createWorkbook(): Promise<Workbook> {
  const excelJs = await import("exceljs");
  return new excelJs.default.Workbook();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function primitiveToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return compactWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object") return compactWhitespace(String(value));

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.richText)) {
    return compactWhitespace(
      record.richText
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
        )
        .join(""),
    );
  }

  if (typeof record.hyperlink === "string") {
    const label = typeof record.text === "string" ? compactWhitespace(record.text) : "";
    return label && label !== record.hyperlink
      ? `${label} (${record.hyperlink})`
      : record.hyperlink;
  }

  if (typeof record.error === "string") return record.error;

  const formula =
    typeof record.formula === "string"
      ? record.formula
      : typeof record.sharedFormula === "string"
        ? record.sharedFormula
        : null;
  if (formula) {
    const result = primitiveToText(record.result);
    return result ? `${result} (formula: =${formula})` : `Formula: =${formula}`;
  }

  return "";
}

export function spreadsheetCellValueToText(value: CellValue): string {
  return primitiveToText(value);
}

export function isExcelFile(file: Pick<File, "name">): boolean {
  return file.name.toLowerCase().endsWith(".xlsx");
}

async function loadWorkbook(bytes: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const workbook = await createWorkbook();
  const input = bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes;
  await workbook.xlsx.load(input);
  return workbook;
}

function collectRowsFromWorkbook(workbook: Workbook): SpreadsheetRow[] {
  const rows: SpreadsheetRow[] = [];

  for (const worksheet of workbook.worksheets) {
    const sheetRows: Omit<SpreadsheetRow, "headers">[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: SpreadsheetCell[] = [];
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        // A merged cell's non-master entries repeat the master's value. Keeping
        // only the master avoids indexing the same text once per merged column.
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const text = spreadsheetCellValueToText(cell.value);
        if (!text) return;
        cells.push({ column, address: cell.address, text });
      });
      if (cells.length > 0) {
        sheetRows.push({
          sheetName: worksheet.name,
          sheetState: worksheet.state,
          rowNumber,
          cells,
        });
      }
    });

    const headers = sheetRows[0]?.cells ?? [];
    rows.push(...sheetRows.map((row) => ({ ...row, headers })));
  }

  return rows;
}

export async function readSpreadsheetRows(
  bytes: ArrayBuffer | Uint8Array,
): Promise<SpreadsheetRow[]> {
  return collectRowsFromWorkbook(await loadWorkbook(bytes));
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function formatSpreadsheetRow(row: SpreadsheetRow): string {
  const headerByColumn = new Map(row.headers.map((cell) => [cell.column, cell.text]));
  const headerRowNumber = Number(row.headers[0]?.address.match(/\d+$/)?.[0] ?? -1);
  const state = row.sheetState === "visible" ? "" : ` (${row.sheetState})`;
  const headerContext = row.headers
    .map((cell) => `${cell.address.replace(/\d+$/, "")}=${quoted(cell.text)}`)
    .join("; ");
  const values = row.cells
    .map((cell) => {
      const header = headerByColumn.get(cell.column);
      const label =
        header && row.rowNumber !== headerRowNumber
          ? `${cell.address} / ${quoted(header)}`
          : cell.address;
      return `${label}=${quoted(cell.text)}`;
    })
    .join("; ");

  return [
    `Worksheet ${quoted(row.sheetName)}${state}, row ${row.rowNumber}`,
    headerContext ? `Header context: ${headerContext}` : "",
    `Cells: ${values}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

export async function extractSpreadsheetText(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const rows = await readSpreadsheetRows(bytes);
  if (rows.length === 0) throw new Error("No extractable cell values found in the workbook");
  return rows.map(formatSpreadsheetRow).join("\n\n");
}

async function serializeRowPrefix(rows: SpreadsheetRow[], count: number): Promise<Uint8Array> {
  const workbook = await createWorkbook();
  const worksheets = new Map<string, ReturnType<Workbook["addWorksheet"]>>();

  for (const sourceRow of rows.slice(0, count)) {
    let worksheet = worksheets.get(sourceRow.sheetName);
    if (!worksheet) {
      worksheet = workbook.addWorksheet(sourceRow.sheetName, { state: sourceRow.sheetState });
      worksheets.set(sourceRow.sheetName, worksheet);
    }
    const targetRow = worksheet.getRow(sourceRow.rowNumber);
    for (const cell of sourceRow.cells) targetRow.getCell(cell.column).value = cell.text;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export interface TrimmedSpreadsheet {
  bytes: Uint8Array;
  includedRows: number;
  totalRows: number;
}

export async function trimSpreadsheetToSize(
  bytes: ArrayBuffer | Uint8Array,
  maxBytes: number,
): Promise<TrimmedSpreadsheet> {
  const rows = await readSpreadsheetRows(bytes);
  const totalRows = rows.length;
  if (totalRows === 0) throw new Error("No extractable cell values found in the workbook");

  const allRows = await serializeRowPrefix(rows, totalRows);
  if (allRows.byteLength < maxBytes) {
    return { bytes: allRows, includedRows: totalRows, totalRows };
  }

  let low = 1;
  let high = totalRows - 1;
  let includedRows = 0;
  let best: Uint8Array | null = null;

  while (low <= high) {
    const candidateCount = Math.floor((low + high) / 2);
    const candidate = await serializeRowPrefix(rows, candidateCount);
    if (candidate.byteLength < maxBytes) {
      includedRows = candidateCount;
      best = candidate;
      low = candidateCount + 1;
    } else {
      high = candidateCount - 1;
    }
  }

  if (!best || includedRows === 0) {
    throw new Error("The first populated Excel row is too large to fit within 4 MB");
  }

  return { bytes: best, includedRows, totalRows };
}
