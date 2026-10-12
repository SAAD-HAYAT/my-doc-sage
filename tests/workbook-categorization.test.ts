import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildCategorizedWorkbook,
  listWorkbookDepartments,
  loadCategorizationWorkbook,
  type WorkbookCategory,
} from "@/lib/workbook-categorization";

const categories: WorkbookCategory[] = [
  { id: "category-1", name: "Production", description: "" },
  { id: "category-2", name: "Maintenance", description: "" },
  { id: "category-3", name: "Administration", description: "" },
  { id: "category-4", name: "Logistics", description: "" },
];

async function sourceWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const january = workbook.addWorksheet("January");
  january.addRows([
    [new Date("2026-01-01T00:00:00.000Z")],
    ["Department", "Material", "Consumption"],
    ["Assembly", "Steel", 100],
    ["Mechanical", "Oil", 25],
  ]);
  const february = workbook.addWorksheet("February");
  february.addRows([
    ["Department", "Material", "Consumption"],
    ["Finance", "Paper", 5],
    ["Warehouse", "Pallet", 12],
  ]);
  february.getCell("C3").value = { formula: "6*2", result: 12 };
  const lookup = workbook.addWorksheet("Lookup");
  lookup.addRows([
    ["Code", "Meaning"],
    ["A", "Active"],
  ]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("workbook categorization", () => {
  it("infers the department column and finds unique values across matching worksheets", async () => {
    const loaded = await loadCategorizationWorkbook(await sourceWorkbook());

    expect(loaded.inferredDepartmentHeader).toBe("Department");
    expect(loaded.worksheetCount).toBe(3);
    expect(listWorkbookDepartments(loaded, "Department")).toEqual([
      "Assembly",
      "Mechanical",
      "Finance",
      "Warehouse",
    ]);
  });

  it("creates four value-only worksheets and preserves source provenance", async () => {
    const loaded = await loadCategorizationWorkbook(await sourceWorkbook());
    const result = await buildCategorizedWorkbook(loaded, "Department", categories, [
      { department: "Assembly", categoryId: "category-1" },
      { department: "Mechanical", categoryId: "category-2" },
      { department: "Finance", categoryId: "category-3" },
      { department: "Warehouse", categoryId: "category-4" },
    ]);
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(Uint8Array.from(result.bytes).buffer);

    expect(output.worksheets.map((sheet) => sheet.name)).toEqual([
      "Production",
      "Maintenance",
      "Administration",
      "Logistics",
    ]);
    expect(output.getWorksheet("Production")?.getRow(2).values).toEqual([
      undefined,
      "January",
      3,
      "Assembly",
      "Steel",
      100,
    ]);
    expect(output.getWorksheet("Logistics")?.getCell("E2").value).toBe(12);
    expect(result).toMatchObject({ categorizedRows: 4, sourceWorksheets: 2 });
  });

  it("fails instead of silently dropping an unassigned department", async () => {
    const loaded = await loadCategorizationWorkbook(await sourceWorkbook());

    await expect(
      buildCategorizedWorkbook(loaded, "Department", categories, [
        { department: "Assembly", categoryId: "category-1" },
      ]),
    ).rejects.toThrow("No category was assigned");
  });
});
