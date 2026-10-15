import { supabaseAdmin } from "@/lib/supabase";
import {
  normalizeSpreadsheetHeader,
  type StructuredSpreadsheetCell,
  type StructuredSpreadsheetColumn,
} from "@/lib/spreadsheet";

export const SPREADSHEET_QUERY_OPERATIONS = [
  "sum",
  "count",
  "count_distinct",
  "average",
  "minimum",
  "maximum",
  "rows",
] as const;

export const SPREADSHEET_FILTER_OPERATORS = [
  "contains",
  "equals",
  "starts_with",
  "ends_with",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "is_blank",
  "is_not_blank",
] as const;

export type SpreadsheetQueryOperation = (typeof SPREADSHEET_QUERY_OPERATIONS)[number];
export type SpreadsheetFilterOperator = (typeof SPREADSHEET_FILTER_OPERATORS)[number];

export interface SpreadsheetFilter {
  column: string;
  operator: SpreadsheetFilterOperator;
  value?: string | number | boolean;
  secondValue?: string | number | boolean;
  caseSensitive?: boolean;
}

export interface SpreadsheetQueryRequest {
  documentName?: string;
  sheetName?: string;
  operation: SpreadsheetQueryOperation;
  column?: string;
  filters: SpreadsheetFilter[];
  filterLogic: "all" | "any";
  groupBy?: string;
  columns?: string[];
  limit: number;
}

type DocumentRecord = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  trimmed_unit: string | null;
  included_count: number | null;
  source_count: number | null;
};

export type StoredSpreadsheetSheet = {
  document_id: string;
  sheet_name: string;
  sheet_state: string;
  header_row_number: number;
  columns: StructuredSpreadsheetColumn[];
  populated_row_count: number;
};

export type StoredSpreadsheetRow = {
  sheet_name: string;
  row_number: number;
  cells: StructuredSpreadsheetCell[];
};

type Decimal = { coefficient: bigint; scale: number };

export class SpreadsheetQueryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetQueryInputError";
  }
}

function shortString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

export function parseSpreadsheetQueryRequest(value: unknown): SpreadsheetQueryRequest {
  if (!value || typeof value !== "object") {
    throw new SpreadsheetQueryInputError("Spreadsheet query arguments must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!SPREADSHEET_QUERY_OPERATIONS.includes(record.operation as SpreadsheetQueryOperation)) {
    throw new SpreadsheetQueryInputError("Unsupported spreadsheet query operation");
  }
  const operation = record.operation as SpreadsheetQueryOperation;
  const documentName = shortString(record.documentName, 255);
  const sheetName = shortString(record.sheetName, 255);
  const column = shortString(record.column, 255);
  const groupBy = shortString(record.groupBy, 255);
  const filterLogic = record.filterLogic === "any" ? "any" : "all";
  const limit =
    typeof record.limit === "number" && Number.isSafeInteger(record.limit)
      ? Math.min(100, Math.max(1, record.limit))
      : 25;

  if (["sum", "count_distinct", "average", "minimum", "maximum"].includes(operation) && !column) {
    throw new SpreadsheetQueryInputError(`The ${operation} operation requires a column`);
  }

  const rawFilters = record.filters ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > 8) {
    throw new SpreadsheetQueryInputError("Spreadsheet queries support at most eight filters");
  }
  const filters = rawFilters.map((filter): SpreadsheetFilter => {
    if (!filter || typeof filter !== "object") {
      throw new SpreadsheetQueryInputError("Each spreadsheet filter must be an object");
    }
    const item = filter as Record<string, unknown>;
    const filterColumn = shortString(item.column, 255);
    const operator = item.operator as SpreadsheetFilterOperator;
    if (!filterColumn || !SPREADSHEET_FILTER_OPERATORS.includes(operator)) {
      throw new SpreadsheetQueryInputError("A filter has an invalid column or operator");
    }
    const needsValue = operator !== "is_blank" && operator !== "is_not_blank";
    const isPrimitive = (input: unknown): input is string | number | boolean =>
      typeof input === "string" || typeof input === "number" || typeof input === "boolean";
    if (needsValue && !isPrimitive(item.value)) {
      throw new SpreadsheetQueryInputError(`The ${operator} filter requires a value`);
    }
    if (operator === "between" && !isPrimitive(item.secondValue)) {
      throw new SpreadsheetQueryInputError("The between filter requires a secondValue");
    }
    return {
      column: filterColumn,
      operator,
      ...(isPrimitive(item.value) ? { value: item.value } : {}),
      ...(isPrimitive(item.secondValue) ? { secondValue: item.secondValue } : {}),
      caseSensitive: item.caseSensitive === true,
    };
  });

  let columns: string[] | undefined;
  if (record.columns !== undefined) {
    if (!Array.isArray(record.columns) || record.columns.length > 20) {
      throw new SpreadsheetQueryInputError("Row queries support at most twenty selected columns");
    }
    columns = record.columns.map((item) => {
      const selected = shortString(item, 255);
      if (!selected) throw new SpreadsheetQueryInputError("Selected columns must be non-empty");
      return selected;
    });
  }

  return {
    ...(documentName ? { documentName } : {}),
    ...(sheetName ? { sheetName } : {}),
    operation,
    ...(column ? { column } : {}),
    filters,
    filterLogic,
    ...(groupBy ? { groupBy } : {}),
    ...(columns ? { columns } : {}),
    limit,
  };
}

function parseDecimal(value: string): Decimal | null {
  let normalized = value.trim();
  let negative = false;
  if (/^\(.*\)$/.test(normalized)) {
    negative = true;
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized
    .replace(/^(?:pkr|rs\.?|usd|eur|gbp|\$|€|£)\s*/i, "")
    .replace(/\s*(?:\/=)?$/, "")
    .replace(/,/g, "")
    .trim();
  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const sign = match[1] === "-" || negative ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  let coefficient = BigInt(`${match[2]}${fraction}`) * sign;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function decimalForCell(cell: StructuredSpreadsheetCell | undefined): Decimal | null {
  if (!cell) return null;
  if (cell.numericValue) return parseDecimal(cell.numericValue);
  if (cell.valueType !== "text") return null;
  const cachedFormulaResult = cell.text.match(/^(.+?) \(formula: =.+\)$/)?.[1];
  return parseDecimal(cachedFormulaResult ?? cell.text);
}

function alignDecimals(left: Decimal, right: Decimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

function addDecimals(left: Decimal, right: Decimal): Decimal {
  const [a, b, scale] = alignDecimals(left, right);
  return { coefficient: a + b, scale };
}

function compareDecimals(left: Decimal, right: Decimal): number {
  const [a, b] = alignDecimals(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function decimalString(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  const split = padded.length - value.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function divideDecimal(value: Decimal, divisor: number, precision = 12): Decimal {
  const scaled = value.coefficient * 10n ** BigInt(precision);
  const divisorBigInt = BigInt(divisor);
  const quotient = scaled / divisorBigInt;
  const remainder = scaled % divisorBigInt;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const rounded =
    absoluteRemainder * 2n >= divisorBigInt ? quotient + (scaled < 0n ? -1n : 1n) : quotient;
  return { coefficient: rounded, scale: value.scale + precision };
}

function formattedNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number)
    : value;
}

function resolveColumn(
  columns: StructuredSpreadsheetColumn[],
  requested: string,
): StructuredSpreadsheetColumn | null {
  const requestedLetter = requested.match(/\(([A-Z]+)\)\s*$/i)?.[1]?.toUpperCase();
  const key = normalizeSpreadsheetHeader(requested.replace(/\s*\([A-Z]+\)\s*$/i, ""));
  const exact = columns.filter((column) => column.headerKey === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const selected = exact.find((column) => column.letter.toUpperCase() === requestedLetter);
    if (selected) return selected;
    throw new SpreadsheetQueryInputError(
      `Column “${requested}” is duplicated; specify one of ${exact.map((column) => `${column.header} (${column.letter})`).join(", ")}`,
    );
  }
  const aliases = columns.filter(
    (column) => column.headerKey.includes(key) || key.includes(column.headerKey),
  );
  return aliases.length === 1 ? aliases[0] : null;
}

function cellByColumn(row: StoredSpreadsheetRow, column: number) {
  return row.cells.find((cell) => cell.column === column);
}

function compareText(left: string, right: string, caseSensitive: boolean): [string, string] {
  return caseSensitive
    ? [left, right]
    : [left.toLocaleLowerCase("en-US"), right.toLocaleLowerCase("en-US")];
}

function matchesFilter(cell: StructuredSpreadsheetCell | undefined, filter: SpreadsheetFilter) {
  const text = cell?.text.trim() ?? "";
  if (filter.operator === "is_blank") return text === "";
  if (filter.operator === "is_not_blank") return text !== "";
  const rawValue = String(filter.value ?? "");
  const [left, right] = compareText(text, rawValue, filter.caseSensitive === true);
  if (filter.operator === "contains") return left.includes(right);
  if (filter.operator === "starts_with") return left.startsWith(right);
  if (filter.operator === "ends_with") return left.endsWith(right);
  if (filter.operator === "equals") {
    const leftNumber = decimalForCell(cell);
    const rightNumber = parseDecimal(rawValue);
    return leftNumber && rightNumber
      ? compareDecimals(leftNumber, rightNumber) === 0
      : left === right;
  }
  const leftNumber = decimalForCell(cell);
  const rightNumber = parseDecimal(rawValue);
  if (!leftNumber || !rightNumber) return false;
  const comparison = compareDecimals(leftNumber, rightNumber);
  if (filter.operator === "greater_than") return comparison > 0;
  if (filter.operator === "greater_than_or_equal") return comparison >= 0;
  if (filter.operator === "less_than") return comparison < 0;
  if (filter.operator === "less_than_or_equal") return comparison <= 0;
  const second = parseDecimal(String(filter.secondValue ?? ""));
  return Boolean(second && comparison >= 0 && compareDecimals(leftNumber, second) <= 0);
}

type ResolvedSheet = {
  schema: StoredSpreadsheetSheet;
  rows: StoredSpreadsheetRow[];
  valueColumn: StructuredSpreadsheetColumn | null;
  groupColumn: StructuredSpreadsheetColumn | null;
  selectedColumns: StructuredSpreadsheetColumn[];
  filters: {
    filter: SpreadsheetFilter;
    column: StructuredSpreadsheetColumn | null;
    anyColumn: boolean;
  }[];
};

function aggregateRows(
  operation: Exclude<SpreadsheetQueryOperation, "rows">,
  rows: { row: StoredSpreadsheetRow; valueCell: StructuredSpreadsheetCell | undefined }[],
  countRowsWithoutColumn = false,
) {
  if (operation === "count") {
    const count = countRowsWithoutColumn
      ? rows.length
      : rows.filter(({ valueCell }) => valueCell?.text !== undefined && valueCell.text !== "")
          .length;
    return {
      value: String(count),
      formattedValue: count.toLocaleString("en-US"),
      numericValueCount: count,
      skippedNonNumeric: 0,
    };
  }
  if (operation === "count_distinct") {
    const distinct = new Set(
      rows
        .map(({ valueCell }) => valueCell?.text.trim().toLocaleLowerCase("en-US"))
        .filter((value): value is string => Boolean(value)),
    );
    return {
      value: String(distinct.size),
      formattedValue: distinct.size.toLocaleString("en-US"),
      numericValueCount: distinct.size,
      skippedNonNumeric: 0,
    };
  }

  const numbers = rows
    .map(({ valueCell }) => decimalForCell(valueCell))
    .filter((value): value is Decimal => value !== null);
  const skippedNonNumeric = rows.length - numbers.length;
  if (numbers.length === 0) {
    throw new SpreadsheetQueryInputError(
      "No numeric values matched the requested aggregate column",
    );
  }
  let result = numbers[0];
  if (operation === "sum" || operation === "average") {
    result = numbers.reduce(addDecimals, { coefficient: 0n, scale: 0 });
    if (operation === "average") result = divideDecimal(result, numbers.length);
  } else if (operation === "minimum") {
    for (const number of numbers.slice(1)) if (compareDecimals(number, result) < 0) result = number;
  } else if (operation === "maximum") {
    for (const number of numbers.slice(1)) if (compareDecimals(number, result) > 0) result = number;
  }
  const value = decimalString(result);
  return {
    value,
    formattedValue: formattedNumber(value),
    numericValueCount: numbers.length,
    skippedNonNumeric,
  };
}

export function executeStructuredSpreadsheetQuery(
  sheets: StoredSpreadsheetSheet[],
  rows: StoredSpreadsheetRow[],
  request: SpreadsheetQueryRequest,
) {
  const requestedSheets = request.sheetName
    ? sheets.filter(
        (sheet) =>
          sheet.sheet_name.toLocaleLowerCase("en-US") ===
          request.sheetName?.toLocaleLowerCase("en-US"),
      )
    : sheets;
  if (requestedSheets.length === 0) {
    throw new SpreadsheetQueryInputError(
      `Worksheet “${request.sheetName}” was not found. Available worksheets: ${sheets.map((sheet) => sheet.sheet_name).join(", ")}`,
    );
  }

  const resolved: ResolvedSheet[] = [];
  for (const schema of requestedSheets) {
    const valueColumn = request.column ? resolveColumn(schema.columns, request.column) : null;
    const groupColumn = request.groupBy ? resolveColumn(schema.columns, request.groupBy) : null;
    const selectedNames = request.columns ?? [];
    const selectedColumns = selectedNames
      .map((name) => resolveColumn(schema.columns, name))
      .filter((column): column is StructuredSpreadsheetColumn => Boolean(column));
    const filters = request.filters.map((filter) => {
      const anyColumn = filter.column === "*";
      return {
        filter,
        column: anyColumn ? null : resolveColumn(schema.columns, filter.column),
        anyColumn,
      };
    });
    const compatible =
      (!request.column || valueColumn) &&
      (!request.groupBy || groupColumn) &&
      selectedColumns.length === selectedNames.length &&
      filters.every(({ column, anyColumn }) => anyColumn || column);
    if (!compatible) {
      if (request.sheetName) {
        throw new SpreadsheetQueryInputError(
          `One or more requested columns were not found in “${schema.sheet_name}”. Available columns: ${schema.columns.map((column) => `${column.header} (${column.letter})`).join(", ")}`,
        );
      }
      continue;
    }
    resolved.push({
      schema,
      rows: rows.filter((row) => row.sheet_name === schema.sheet_name),
      valueColumn,
      groupColumn,
      selectedColumns,
      filters: filters as ResolvedSheet["filters"],
    });
  }
  if (resolved.length === 0) {
    throw new SpreadsheetQueryInputError(
      `No worksheet contains all requested columns. Available schemas: ${sheets
        .map(
          (sheet) =>
            `${sheet.sheet_name}: ${sheet.columns.map((column) => column.header).join(", ")}`,
        )
        .join("; ")}`,
    );
  }

  const matches: {
    sheet: ResolvedSheet;
    row: StoredSpreadsheetRow;
    valueCell: StructuredSpreadsheetCell | undefined;
    group: string;
  }[] = [];
  for (const sheet of resolved) {
    for (const row of sheet.rows) {
      const decisions = sheet.filters.map(({ filter, column, anyColumn }) =>
        anyColumn
          ? row.cells.some((cell) => matchesFilter(cell, filter))
          : matchesFilter(cellByColumn(row, column!.column), filter),
      );
      const matched =
        decisions.length === 0 ||
        (request.filterLogic === "all" ? decisions.every(Boolean) : decisions.some(Boolean));
      if (!matched) continue;
      matches.push({
        sheet,
        row,
        valueCell: sheet.valueColumn ? cellByColumn(row, sheet.valueColumn.column) : undefined,
        group: sheet.groupColumn
          ? cellByColumn(row, sheet.groupColumn.column)?.text.trim() || "(blank)"
          : "",
      });
    }
  }

  const evidence = matches.slice(0, 200).map(({ row, valueCell }) => ({
    sheetName: row.sheet_name,
    rowNumber: row.row_number,
    ...(valueCell ? { address: valueCell.address, value: valueCell.text } : {}),
  }));
  const base = {
    ok: true as const,
    operation: request.operation,
    column: request.column ?? null,
    filters: request.filters,
    worksheets: resolved.map(({ schema }) => schema.sheet_name),
    matchedRowCount: matches.length,
    evidence,
    evidenceTruncated: matches.length > evidence.length,
  };

  if (request.operation === "rows") {
    return {
      ...base,
      selectedColumns: resolved.map(({ schema, selectedColumns }) => ({
        sheetName: schema.sheet_name,
        columns: (selectedColumns.length ? selectedColumns : schema.columns).map((column) => ({
          header: column.header,
          letter: column.letter,
          valueTypes: column.valueTypes,
        })),
      })),
      rows: matches.slice(0, request.limit).map(({ sheet, row }) => {
        const selected = sheet.selectedColumns.length
          ? sheet.selectedColumns
          : sheet.schema.columns;
        return {
          sheetName: row.sheet_name,
          rowNumber: row.row_number,
          values: selected.map((column) => {
            const cell = cellByColumn(row, column.column);
            return {
              column: column.header,
              address: cell?.address ?? null,
              value: cell?.text ?? null,
              valueType: cell?.valueType ?? null,
              numericValue: cell?.numericValue ?? null,
              dateValue: cell?.dateValue ?? null,
              booleanValue: cell?.booleanValue ?? null,
            };
          }),
        };
      }),
      rowsTruncated: matches.length > request.limit,
    };
  }

  if (request.groupBy) {
    const grouped = new Map<string, typeof matches>();
    for (const match of matches) {
      const group = grouped.get(match.group);
      if (group) group.push(match);
      else grouped.set(match.group, [match]);
    }
    return {
      ...base,
      groupBy: request.groupBy,
      groups: [...grouped.entries()].slice(0, 100).map(([group, groupRows]) => ({
        group,
        matchedRowCount: groupRows.length,
        ...aggregateRows(
          request.operation as Exclude<SpreadsheetQueryOperation, "rows">,
          groupRows,
          !request.column,
        ),
      })),
      groupsTruncated: grouped.size > 100,
    };
  }

  return {
    ...base,
    ...aggregateRows(
      request.operation as Exclude<SpreadsheetQueryOperation, "rows">,
      matches,
      !request.column,
    ),
  };
}

async function readyExcelDocuments(userId: string): Promise<DocumentRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, name, status, created_at, trimmed_unit, included_count, source_count")
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load spreadsheet documents: ${error.message}`);
  return ((data ?? []) as DocumentRecord[]).filter((document) =>
    document.name.toLocaleLowerCase("en-US").endsWith(".xlsx"),
  );
}

async function sheetsForDocuments(userId: string, documentIds: string[]) {
  if (documentIds.length === 0) return [] as StoredSpreadsheetSheet[];
  const { data, error } = await supabaseAdmin
    .from("spreadsheet_sheets")
    .select("document_id, sheet_name, sheet_state, header_row_number, columns, populated_row_count")
    .eq("user_id", userId)
    .in("document_id", documentIds)
    .order("sheet_name", { ascending: true });
  if (error) throw new Error(`Could not load spreadsheet schemas: ${error.message}`);
  return (data ?? []) as StoredSpreadsheetSheet[];
}

export async function inspectSpreadsheets(userId: string, documentName?: string) {
  const documents = await readyExcelDocuments(userId);
  const requested = documentName
    ? documents.filter(
        (document) =>
          document.name.toLocaleLowerCase("en-US") === documentName.toLocaleLowerCase("en-US"),
      )
    : documents;
  const sheets = await sheetsForDocuments(
    userId,
    requested.map((document) => document.id),
  );
  return {
    documents: requested.map((document) => {
      const documentSheets = sheets.filter((sheet) => sheet.document_id === document.id);
      return {
        name: document.name,
        uploadedAt: document.created_at,
        structured: documentSheets.length > 0,
        requiresReupload: documentSheets.length === 0,
        trimmed:
          document.trimmed_unit &&
          document.included_count !== null &&
          document.source_count !== null
            ? {
                unit: document.trimmed_unit,
                included: document.included_count,
                total: document.source_count,
              }
            : null,
        worksheets: documentSheets.map((sheet) => ({
          name: sheet.sheet_name,
          state: sheet.sheet_state,
          headerRowNumber: sheet.header_row_number,
          populatedRowCount: sheet.populated_row_count,
          columns: sheet.columns.map((column) => ({
            header: column.header,
            letter: column.letter,
            valueTypes: column.valueTypes,
          })),
        })),
      };
    }),
  };
}

async function rowsForSheets(
  userId: string,
  documentId: string,
  sheetNames: string[],
): Promise<StoredSpreadsheetRow[]> {
  const result: StoredSpreadsheetRow[] = [];
  for (const sheetName of sheetNames) {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabaseAdmin
        .from("spreadsheet_rows")
        .select("sheet_name, row_number, cells")
        .eq("user_id", userId)
        .eq("document_id", documentId)
        .eq("sheet_name", sheetName)
        .order("row_number", { ascending: true })
        .range(start, start + 999);
      if (error) throw new Error(`Could not load spreadsheet rows: ${error.message}`);
      const page = (data ?? []) as StoredSpreadsheetRow[];
      result.push(...page);
      if (page.length < 1000) break;
    }
  }
  return result;
}

async function executeStoredSpreadsheetQuery(userId: string, request: SpreadsheetQueryRequest) {
  const documents = await readyExcelDocuments(userId);
  const matching = request.documentName
    ? documents.filter(
        (document) =>
          document.name.toLocaleLowerCase("en-US") ===
          request.documentName?.toLocaleLowerCase("en-US"),
      )
    : documents;
  if (matching.length === 0) {
    throw new SpreadsheetQueryInputError(
      request.documentName
        ? `No ready Excel workbook named “${request.documentName}” was found`
        : "No ready Excel workbook was found",
    );
  }

  const allSheets = await sheetsForDocuments(
    userId,
    matching.map((document) => document.id),
  );
  const document = matching.find((candidate) =>
    allSheets.some((sheet) => sheet.document_id === candidate.id),
  );
  if (!document) {
    throw new SpreadsheetQueryInputError(
      `${matching[0].name} predates structured spreadsheet querying. Re-upload it to enable totals and filtering.`,
    );
  }
  if (
    !request.documentName &&
    matching.filter((candidate) => allSheets.some((sheet) => sheet.document_id === candidate.id))
      .length > 1
  ) {
    throw new SpreadsheetQueryInputError(
      `More than one workbook is available. Specify documentName: ${matching.map((item) => item.name).join(", ")}`,
    );
  }
  const sheets = allSheets.filter((sheet) => sheet.document_id === document.id);
  const selectedSheetNames = request.sheetName
    ? sheets
        .filter(
          (sheet) =>
            sheet.sheet_name.toLocaleLowerCase("en-US") ===
            request.sheetName?.toLocaleLowerCase("en-US"),
        )
        .map((sheet) => sheet.sheet_name)
    : sheets.map((sheet) => sheet.sheet_name);
  const rows = await rowsForSheets(userId, document.id, selectedSheetNames);
  const result = executeStructuredSpreadsheetQuery(sheets, rows, request);
  return {
    ...result,
    documentName: document.name,
    uploadedAt: document.created_at,
    scope:
      document.trimmed_unit && document.included_count !== null && document.source_count !== null
        ? {
            trimmed: true,
            unit: document.trimmed_unit,
            included: document.included_count,
            total: document.source_count,
          }
        : { trimmed: false },
  };
}

export async function querySpreadsheet(userId: string, rawRequest: unknown) {
  return executeStoredSpreadsheetQuery(userId, parseSpreadsheetQueryRequest(rawRequest));
}

export async function exportSpreadsheetRows(userId: string, rawRequest: unknown) {
  const request = parseSpreadsheetQueryRequest(rawRequest);
  if (request.operation !== "rows") {
    throw new SpreadsheetQueryInputError("Spreadsheet row exports require the rows operation");
  }
  return executeStoredSpreadsheetQuery(userId, { ...request, limit: 10_000 });
}

export type SpreadsheetQueryResult = Awaited<ReturnType<typeof querySpreadsheet>>;
