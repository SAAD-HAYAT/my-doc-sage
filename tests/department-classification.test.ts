import { describe, expect, it } from "vitest";
import {
  parseDepartmentAssignments,
  validateClassificationRequest,
} from "@/lib/department-classification";

const request = {
  departments: ["Assembly", "Mechanical", "Finance", "Warehouse"],
  categories: [
    { id: "category-1", name: "Production", description: "Assembly and manufacturing" },
    { id: "category-2", name: "Maintenance", description: "Mechanical and electrical" },
    { id: "category-3", name: "Administration", description: "Finance and HR" },
    { id: "category-4", name: "Logistics", description: "Warehouse and dispatch" },
  ],
};

describe("department classification", () => {
  it("validates four categories and unique departments", () => {
    expect(validateClassificationRequest(request)).toEqual(request);
    expect(
      validateClassificationRequest({ ...request, categories: request.categories.slice(0, 3) }),
    ).toBeNull();
    expect(
      validateClassificationRequest({ ...request, departments: ["Assembly", "Assembly"] }),
    ).toBeNull();
  });

  it("parses fenced JSON while preserving the exact input department names", () => {
    const content = `\`\`\`json
      {"assignments":[
        {"department":"assembly","categoryId":"category-1"},
        {"department":"Mechanical","categoryId":"category-2"},
        {"department":"Finance","categoryId":"category-3"},
        {"department":"Warehouse","categoryId":"category-4"}
      ]}
    \`\`\``;

    expect(parseDepartmentAssignments(content, request)).toEqual([
      { department: "Assembly", categoryId: "category-1" },
      { department: "Mechanical", categoryId: "category-2" },
      { department: "Finance", categoryId: "category-3" },
      { department: "Warehouse", categoryId: "category-4" },
    ]);
  });

  it("rejects incomplete or invented assignments", () => {
    expect(() =>
      parseDepartmentAssignments(
        '{"assignments":[{"department":"Assembly","categoryId":"category-1"}]}',
        request,
      ),
    ).toThrow("did not classify every department");
  });

  it("rejects duplicate assignments instead of accepting the last one", () => {
    const duplicate = JSON.stringify({
      assignments: [
        { department: "Assembly", categoryId: "category-1" },
        { department: "Assembly", categoryId: "category-2" },
        { department: "Mechanical", categoryId: "category-2" },
        { department: "Finance", categoryId: "category-3" },
        { department: "Warehouse", categoryId: "category-4" },
      ],
    });

    expect(() => parseDepartmentAssignments(duplicate, request)).toThrow("more than once");
  });
});
