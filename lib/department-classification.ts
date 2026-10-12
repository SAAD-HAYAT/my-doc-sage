import {
  CATEGORY_COUNT,
  type DepartmentAssignment,
  type WorkbookCategory,
} from "@/lib/workbook-categorization";

export interface DepartmentClassificationRequest {
  departments: string[];
  categories: WorkbookCategory[];
}

export function validateClassificationRequest(
  value: unknown,
): DepartmentClassificationRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.departments) || !Array.isArray(record.categories)) return null;

  const departments = record.departments.filter(
    (department): department is string =>
      typeof department === "string" && department.trim().length > 0 && department.length <= 200,
  );
  const categories = record.categories.filter(
    (category): category is WorkbookCategory =>
      Boolean(category) &&
      typeof category === "object" &&
      typeof (category as WorkbookCategory).id === "string" &&
      typeof (category as WorkbookCategory).name === "string" &&
      typeof (category as WorkbookCategory).description === "string",
  );

  if (
    departments.length !== record.departments.length ||
    departments.length === 0 ||
    departments.length > 500 ||
    new Set(departments).size !== departments.length ||
    categories.length !== CATEGORY_COUNT ||
    categories.some(
      (category) =>
        !/^category-[1-4]$/.test(category.id) ||
        category.name.trim().length === 0 ||
        category.name.length > 50 ||
        category.description.length > 500,
    ) ||
    new Set(categories.map((category) => category.id)).size !== CATEGORY_COUNT ||
    new Set(categories.map((category) => category.name.trim().toLocaleLowerCase("en-US"))).size !==
      CATEGORY_COUNT
  ) {
    return null;
  }

  return { departments, categories };
}

export function parseDepartmentAssignments(
  content: string,
  request: DepartmentClassificationRequest,
): DepartmentAssignment[] {
  const unwrapped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON object");

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapped.slice(start, end + 1));
  } catch {
    throw new Error("The model returned invalid JSON");
  }

  const assignments =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { assignments?: unknown }).assignments)
      ? (parsed as { assignments: unknown[] }).assignments
      : null;
  if (!assignments) throw new Error("The model response did not contain assignments");

  const categoryIds = new Set(request.categories.map((category) => category.id));
  const expectedDepartments = new Map(
    request.departments.map((department) => [department.toLocaleLowerCase("en-US"), department]),
  );
  const result = new Map<string, DepartmentAssignment>();

  for (const item of assignments) {
    if (!item || typeof item !== "object") continue;
    const department = (item as { department?: unknown }).department;
    const categoryId = (item as { categoryId?: unknown }).categoryId;
    if (typeof department !== "string" || typeof categoryId !== "string") continue;
    const original = expectedDepartments.get(department.toLocaleLowerCase("en-US"));
    if (!original || !categoryIds.has(categoryId)) continue;
    const key = original.toLocaleLowerCase("en-US");
    if (result.has(key)) throw new Error(`The model classified “${original}” more than once`);
    result.set(key, { department: original, categoryId });
  }

  if (result.size !== request.departments.length) {
    const missing = request.departments.filter(
      (department) => !result.has(department.toLocaleLowerCase("en-US")),
    );
    throw new Error(
      `The model did not classify every department: ${missing.slice(0, 5).join(", ")}`,
    );
  }

  return request.departments.map(
    (department) => result.get(department.toLocaleLowerCase("en-US")) as DepartmentAssignment,
  );
}
