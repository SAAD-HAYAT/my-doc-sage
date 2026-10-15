import type { CellValue, Workbook, WorksheetState } from "exceljs";

export const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_SPREADSHEET_ROWS = 10_000;
export const MAX_SPREADSHEET_TEXT_CHARACTERS = 500_000;

export interface SpreadsheetLimits {
  maxRows: number;
  maxTextCharacters: number;
}

const DEFAULT_SPREADSHEET_LIMITS: SpreadsheetLimits = {
  maxRows: MAX_SPREADSHEET_ROWS,
  maxTextCharacters: MAX_SPREADSHEET_TEXT_CHARACTERS,
};

export interface SpreadsheetCell {
  column: number;
  address: string;
  text: string;
  valueType: "text" | "number" | "date" | "boolean" | "error" | "formula";
  numericValue?: string;
  dateValue?: string;
  booleanValue?: boolean;
  formula?: string;
}

export interface SpreadsheetRow {
  sheetName: string;
  sheetState: WorksheetState;
  rowNumber: number;
  cells: SpreadsheetCell[];
  headers: SpreadsheetCell[];
}

export interface StructuredSpreadsheetColumn {
  column: number;
  letter: string;
  header: string;
  headerKey: string;
  valueTypes: SpreadsheetCell["valueType"][];
}

export interface StructuredSpreadsheetSheet {
  sheetName: string;
  sheetState: WorksheetState;
  headerRowNumber: number;
  columns: StructuredSpreadsheetColumn[];
  populatedRowCount: number;
}

export interface StructuredSpreadsheetCell extends SpreadsheetCell {
  header: string | null;
  headerKey: string | null;
}

export interface StructuredSpreadsheetRow {
  sheetName: string;
  rowNumber: number;
  cells: StructuredSpreadsheetCell[];
}

export interface ExtractedSpreadsheet {
  text: string;
  sheets: StructuredSpreadsheetSheet[];
  rows: StructuredSpreadsheetRow[];
}

async function createWorkbook(): Promise<Workbook> {
  const excelJs = await import("exceljs");
  return new excelJs.default.Workbook();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

type CellDetails = Omit<SpreadsheetCell, "column" | "address">;

function cellValueDetails(value: unknown): CellDetails {
  if (value === null || value === undefined) return { text: "", valueType: "text" };
  if (value instanceof Date) {
    const dateValue = value.toISOString();
    return { text: dateValue, valueType: "date", dateValue };
  }
  if (typeof value === "string") {
    return { text: compactWhitespace(value), valueType: "text" };
  }
  if (typeof value === "number") {
    return { text: String(value), valueType: "number", numericValue: String(value) };
  }
  if (typeof value === "boolean") {
    return { text: String(value), valueType: "boolean", booleanValue: value };
  }
  if (typeof value !== "object") {
    return { text: compactWhitespace(String(value)), valueType: "text" };
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.richText)) {
    return {
      text: compactWhitespace(
        record.richText
          .map((part) =>
            part && typeof part === "object" && "text" in part
              ? String((part as { text: unknown }).text)
              : "",
          )
          .join(""),
      ),
      valueType: "text",
    };
  }

  if (typeof record.hyperlink === "string") {
    const label = typeof record.text === "string" ? compactWhitespace(record.text) : "";
    return {
      text:
        label && label !== record.hyperlink ? `${label} (${record.hyperlink})` : record.hyperlink,
      valueType: "text",
    };
  }

  if (typeof record.error === "string") {
    return { text: record.error, valueType: "error" };
  }

  const formula =
    typeof record.formula === "string"
      ? record.formula
      : typeof record.sharedFormula === "string"
        ? record.sharedFormula
        : null;
  if (formula) {
    const result = cellValueDetails(record.result);
    return result.text
      ? { ...result, text: `${result.text} (formula: =${formula})`, formula }
      : { text: `Formula: =${formula}`, valueType: "formula", formula };
  }

  return { text: "", valueType: "text" };
}

export function spreadsheetCellValueToText(value: CellValue): string {
  return cellValueDetails(value).text;
}

export function normalizeSpreadsheetHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
        const details = cellValueDetails(cell.value);
        if (!details.text) return;
        cells.push({ column, address: cell.address, ...details });
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
    // Do not spread a whole worksheet into push(). Dense workbooks can have
    // more rows than V8 permits as function arguments (roughly 100k), which
    // previously caused "Maximum call stack size exceeded" before trimming.
    for (const row of sheetRows) rows.push({ ...row, headers });
  }

  return rows;
}

export function structureSpreadsheetRows(rows: SpreadsheetRow[]): {
  sheets: StructuredSpreadsheetSheet[];
  rows: StructuredSpreadsheetRow[];
} {
  const sheets: StructuredSpreadsheetSheet[] = [];
  const structuredRows: StructuredSpreadsheetRow[] = [];
  const rowsBySheet = new Map<string, SpreadsheetRow[]>();

  for (const row of rows) {
    const existing = rowsBySheet.get(row.sheetName);
    if (existing) existing.push(row);
    else rowsBySheet.set(row.sheetName, [row]);
  }

  for (const [sheetName, sheetRows] of rowsBySheet) {
    const firstRow = sheetRows[0];
    const headerRowNumber = firstRow.rowNumber;
    const headerByColumn = new Map(firstRow.headers.map((cell) => [cell.column, cell.text]));
    const valueTypes = new Map<number, Set<SpreadsheetCell["valueType"]>>();

    for (const row of sheetRows) {
      if (row.rowNumber === headerRowNumber) continue;
      const cells = row.cells.map((cell): StructuredSpreadsheetCell => {
        const header = headerByColumn.get(cell.column) ?? null;
        let types = valueTypes.get(cell.column);
        if (!types) {
          types = new Set();
          valueTypes.set(cell.column, types);
        }
        types.add(cell.valueType);
        return {
          ...cell,
          header,
          headerKey: header ? normalizeSpreadsheetHeader(header) : null,
        };
      });
      structuredRows.push({ sheetName, rowNumber: row.rowNumber, cells });
    }

    sheets.push({
      sheetName,
      sheetState: firstRow.sheetState,
      headerRowNumber,
      columns: firstRow.headers.map((header) => ({
        column: header.column,
        letter: header.address.replace(/\d+$/, ""),
        header: header.text,
        headerKey: normalizeSpreadsheetHeader(header.text),
        valueTypes: [...(valueTypes.get(header.column) ?? new Set())].sort(),
      })),
      populatedRowCount: Math.max(0, sheetRows.length - 1),
    });
  }

  return { sheets, rows: structuredRows };
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

function semanticPrefixLength(
  rows: SpreadsheetRow[],
  limits: SpreadsheetLimits = DEFAULT_SPREADSHEET_LIMITS,
): number {
  let characters = 0;
  let included = 0;

  for (const row of rows) {
    if (included >= limits.maxRows) break;
    const rowCharacters = formatSpreadsheetRow(row).length + (included === 0 ? 0 : 2);
    if (characters + rowCharacters > limits.maxTextCharacters) break;
    characters += rowCharacters;
    included += 1;
  }

  if (included === 0) {
    throw new Error("The first populated Excel row exceeds the safe processing limit");
  }
  return included;
}

export async function extractSpreadsheetText(
  bytes: ArrayBuffer | Uint8Array,
  limits: SpreadsheetLimits = DEFAULT_SPREADSHEET_LIMITS,
): Promise<string> {
  return (await extractSpreadsheet(bytes, limits)).text;
}

export async function extractSpreadsheet(
  bytes: ArrayBuffer | Uint8Array,
  limits: SpreadsheetLimits = DEFAULT_SPREADSHEET_LIMITS,
): Promise<ExtractedSpreadsheet> {
  const rows = await readSpreadsheetRows(bytes);
  if (rows.length === 0) throw new Error("No extractable cell values found in the workbook");
  const includedRows = semanticPrefixLength(rows, limits);
  if (includedRows < rows.length) {
    throw new Error(
      `Workbook exceeds the safe ingestion limit (${limits.maxRows.toLocaleString("en-US")} rows or ${limits.maxTextCharacters.toLocaleString("en-US")} extracted characters). Upload it through the app so it can be trimmed safely.`,
    );
  }
  return {
    text: rows.map(formatSpreadsheetRow).join("\n\n"),
    ...structureSpreadsheetRows(rows),
  };
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
  limits: SpreadsheetLimits = DEFAULT_SPREADSHEET_LIMITS,
): Promise<TrimmedSpreadsheet> {
  const rows = await readSpreadsheetRows(bytes);
  const totalRows = rows.length;
  if (totalRows === 0) throw new Error("No extractable cell values found in the workbook");

  const semanticRows = semanticPrefixLength(rows, limits);
  const allRows = await serializeRowPrefix(rows, semanticRows);
  if (allRows.byteLength < maxBytes) {
    return { bytes: allRows, includedRows: semanticRows, totalRows };
  }

  let low = 1;
  let high = semanticRows - 1;
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
