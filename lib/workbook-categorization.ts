import type { CellValue, Workbook, Worksheet } from "exceljs";
import { spreadsheetCellValueToText } from "@/lib/spreadsheet";

export const CATEGORY_COUNT = 4;
export const MAX_CLASSIFIABLE_DEPARTMENTS = 500;

export interface WorkbookCategory {
  id: string;
  name: string;
  description: string;
}

export interface LoadedCategorizationWorkbook {
  workbook: Workbook;
  headers: string[];
  inferredDepartmentHeader: string | null;
  worksheetCount: number;
}

export interface DepartmentAssignment {
  department: string;
  categoryId: string;
}

interface SheetLayout {
  worksheet: Worksheet;
  headerRowNumber: number;
  columns: { column: number; header: string; normalizedHeader: string }[];
}

const DEPARTMENT_HEADER_ALIASES = [
  "department",
  "department name",
  "dept",
  "dept name",
  "section",
  "cost center",
  "cost centre",
];

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

async function createWorkbook(): Promise<Workbook> {
  const excelJs = await import("exceljs");
  return new excelJs.default.Workbook();
}

function sheetLayout(worksheet: Worksheet): SheetLayout | null {
  let bestRow: { rowNumber: number; cells: { column: number; header: string }[] } | null = null;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 50) return;
    const cells: { column: number; header: string }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const header = spreadsheetCellValueToText(cell.value);
      if (header) cells.push({ column, header });
    });
    if (cells.length > 0 && (!bestRow || cells.length > bestRow.cells.length)) {
      bestRow = { rowNumber, cells };
    }
  });

  if (!bestRow) return null;
  const selected = bestRow as { rowNumber: number; cells: { column: number; header: string }[] };
  const duplicateCounts = new Map<string, number>();
  for (const cell of selected.cells) {
    const key = normalized(cell.header);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const columns = selected.cells.map((cell) => {
    const key = normalized(cell.header);
    const address = worksheet.getRow(selected.rowNumber).getCell(cell.column).address;
    const displayHeader =
      (duplicateCounts.get(key) ?? 0) > 1
        ? `${cell.header} (${address.replace(/\d+$/, "")})`
        : cell.header;
    return {
      column: cell.column,
      header: displayHeader,
      normalizedHeader: normalized(displayHeader),
    };
  });

  return { worksheet, headerRowNumber: selected.rowNumber, columns };
}

function layoutsFor(workbook: Workbook): SheetLayout[] {
  return workbook.worksheets
    .map(sheetLayout)
    .filter((layout): layout is SheetLayout => layout !== null);
}

export async function loadCategorizationWorkbook(
  bytes: ArrayBuffer | Uint8Array,
): Promise<LoadedCategorizationWorkbook> {
  const workbook = await createWorkbook();
  const input = bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes;
  await workbook.xlsx.load(input);

  const layouts = layoutsFor(workbook);
  if (layouts.length === 0) throw new Error("The workbook has no populated worksheets");

  const headersByNormalized = new Map<string, string>();
  for (const layout of layouts) {
    for (const column of layout.columns) {
      if (!headersByNormalized.has(column.normalizedHeader)) {
        headersByNormalized.set(column.normalizedHeader, column.header);
      }
    }
  }

  const inferredDepartmentHeader = DEPARTMENT_HEADER_ALIASES.map((alias) =>
    headersByNormalized.get(alias),
  ).find((header): header is string => Boolean(header));

  return {
    workbook,
    headers: [...headersByNormalized.values()],
    inferredDepartmentHeader: inferredDepartmentHeader ?? null,
    worksheetCount: layouts.length,
  };
}

function matchingLayouts(workbook: Workbook, departmentHeader: string) {
  const target = normalized(departmentHeader);
  return layoutsFor(workbook)
    .map((layout) => ({
      ...layout,
      departmentColumn: layout.columns.find((column) => column.normalizedHeader === target)?.column,
    }))
    .filter(
      (layout): layout is SheetLayout & { departmentColumn: number } =>
        layout.departmentColumn !== undefined,
    );
}

export function listWorkbookDepartments(
  loaded: LoadedCategorizationWorkbook,
  departmentHeader: string,
): string[] {
  const layouts = matchingLayouts(loaded.workbook, departmentHeader);
  if (layouts.length === 0) {
    throw new Error(`No worksheet contains the selected column “${departmentHeader}”`);
  }

  const departments = new Map<string, string>();
  for (const layout of layouts) {
    layout.worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= layout.headerRowNumber) return;
      const department = spreadsheetCellValueToText(row.getCell(layout.departmentColumn).value);
      if (department && !departments.has(normalized(department))) {
        departments.set(normalized(department), department);
      }
    });
  }

  if (departments.size === 0) {
    throw new Error(`The selected column “${departmentHeader}” contains no department values`);
  }
  if (departments.size > MAX_CLASSIFIABLE_DEPARTMENTS) {
    throw new Error(
      `The workbook contains ${departments.size.toLocaleString("en-US")} unique departments; the current limit is ${MAX_CLASSIFIABLE_DEPARTMENTS.toLocaleString("en-US")}.`,
    );
  }

  return [...departments.values()];
}

function exportCellValue(value: CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  const record = value as unknown as Record<string, unknown>;
  if ("result" in record && record.result !== undefined && record.result !== null) {
    return exportCellValue(record.result as CellValue);
  }
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  if (typeof record.text === "string") return record.text;
  if (typeof record.hyperlink === "string") return record.hyperlink;
  if (typeof record.error === "string") return record.error;
  if (typeof record.formula === "string") return `=${record.formula}`;
  if (typeof record.sharedFormula === "string") return `=${record.sharedFormula}`;
  return spreadsheetCellValueToText(value);
}

function safeWorksheetNames(categories: WorkbookCategory[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();

  for (const category of categories) {
    const base =
      category.name
        .replace(/[\\/*?:[\]]/g, "-")
        .trim()
        .slice(0, 31) || "Category";
    let name = base;
    let suffix = 2;
    while (used.has(normalized(name))) {
      const marker = ` (${suffix})`;
      name = `${base.slice(0, 31 - marker.length)}${marker}`;
      suffix += 1;
    }
    used.add(normalized(name));
    result.set(category.id, name);
  }

  return result;
}

export async function buildCategorizedWorkbook(
  loaded: LoadedCategorizationWorkbook,
  departmentHeader: string,
  categories: WorkbookCategory[],
  assignments: DepartmentAssignment[],
): Promise<{ bytes: Uint8Array; categorizedRows: number; sourceWorksheets: number }> {
  if (categories.length !== CATEGORY_COUNT) {
    throw new Error(`Exactly ${CATEGORY_COUNT} categories are required`);
  }

  const layouts = matchingLayouts(loaded.workbook, departmentHeader);
  if (layouts.length === 0) {
    throw new Error(`No worksheet contains the selected column “${departmentHeader}”`);
  }

  const categoryIds = new Set(categories.map((category) => category.id));
  const assignmentByDepartment = new Map<string, string>();
  for (const assignment of assignments) {
    if (!categoryIds.has(assignment.categoryId)) {
      throw new Error(`Unknown category assignment: ${assignment.categoryId}`);
    }
    assignmentByDepartment.set(normalized(assignment.department), assignment.categoryId);
  }

  const outputHeaders = new Map<string, string>();
  for (const layout of layouts) {
    for (const column of layout.columns) {
      if (!outputHeaders.has(column.normalizedHeader)) {
        outputHeaders.set(column.normalizedHeader, column.header);
      }
    }
  }

  const output = await createWorkbook();
  output.creator = "NotesRAG";
  output.created = new Date();
  const names = safeWorksheetNames(categories);
  const outputSheets = new Map<string, Worksheet>();
  const headerValues = ["Source worksheet", "Source row", ...outputHeaders.values()];

  for (const category of categories) {
    const worksheet = output.addWorksheet(names.get(category.id) ?? category.name);
    worksheet.addRow(headerValues);
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
      from: "A1",
      to: worksheet.getRow(1).getCell(headerValues.length).address,
    };
    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    header.alignment = { vertical: "middle" };
    header.height = 22;
    outputSheets.set(category.id, worksheet);
  }

  let categorizedRows = 0;
  for (const layout of layouts) {
    const sourceColumnByHeader = new Map(
      layout.columns.map((column) => [column.normalizedHeader, column.column]),
    );
    layout.worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= layout.headerRowNumber) return;
      const department = spreadsheetCellValueToText(row.getCell(layout.departmentColumn).value);
      if (!department) return;
      const categoryId = assignmentByDepartment.get(normalized(department));
      const target = categoryId ? outputSheets.get(categoryId) : undefined;
      if (!target) throw new Error(`No category was assigned to department “${department}”`);

      target.addRow([
        layout.worksheet.name,
        rowNumber,
        ...[...outputHeaders.keys()].map((header) => {
          const sourceColumn = sourceColumnByHeader.get(header);
          return sourceColumn ? exportCellValue(row.getCell(sourceColumn).value) : null;
        }),
      ]);
      categorizedRows += 1;
    });
  }

  for (const worksheet of output.worksheets) {
    worksheet.getColumn(1).width = 20;
    worksheet.getColumn(2).width = 12;
    for (let column = 3; column <= headerValues.length; column += 1) {
      worksheet.getColumn(column).width = 18;
    }
  }

  const buffer = await output.xlsx.writeBuffer();
  return {
    bytes: new Uint8Array(buffer),
    categorizedRows,
    sourceWorksheets: layouts.length,
  };
}
