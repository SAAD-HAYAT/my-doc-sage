import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));

import { planFileRequest, validatePlanningInput } from "@/lib/file-request-planner";
import { chat } from "@/lib/openrouter";

const mockChat = vi.mocked(chat);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model-driven file request planning", () => {
  it("returns the model's clarification question, suggestions, and custom hint", async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        action: "clarify",
        mode: "generate",
        question: "Which reporting period should the workbook cover?",
        options: ["Use the latest 12 months", "Use the current calendar year"],
        customPlaceholder: "Enter a date range",
      }),
    );

    await expect(planFileRequest("Create an Excel report", "xlsx", [])).resolves.toEqual({
      action: "clarify",
      format: "xlsx",
      mode: "generate",
      question: "Which reporting period should the workbook cover?",
      options: ["Use the latest 12 months", "Use the current calendar year"],
      customPlaceholder: "Enter a date range",
    });
    expect(mockChat.mock.calls[0][0][0].content).toContain("Ask only when genuinely necessary");
  });

  it("lets the model proceed directly when no clarification is needed", async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        action: "generate",
        mode: "generate",
        specification: "A detailed PDF report with headings and source-grounded findings.",
      }),
    );

    await expect(planFileRequest("Generate a detailed PDF report", "pdf", [])).resolves.toEqual({
      action: "generate",
      format: "pdf",
      mode: "generate",
      specification: "A detailed PDF report with headings and source-grounded findings.",
    });
  });

  it("returns a validated four-category workbook plan after clarification", async () => {
    mockChat.mockResolvedValue(
      JSON.stringify({
        action: "generate",
        mode: "categorize-workbook",
        specification: "Split material consumption into four department groups.",
        categorization: {
          strategy: "model-classification",
          categories: [
            { name: "Operations", description: "Production teams" },
            { name: "Engineering", description: "Technical teams" },
            { name: "Corporate", description: "Office teams" },
            { name: "Supply", description: "Warehouse teams" },
          ],
        },
      }),
    );

    const result = await planFileRequest("Categorize this workbook", "xlsx", [
      "Use Operations, Engineering, Corporate, and Supply",
    ]);
    expect(result).toMatchObject({
      action: "generate",
      mode: "categorize-workbook",
      categorization: {
        strategy: "model-classification",
        categories: [
          { id: "category-1", name: "Operations" },
          { id: "category-2", name: "Engineering" },
          { id: "category-3", name: "Corporate" },
          { id: "category-4", name: "Supply" },
        ],
      },
    });
    expect(mockChat.mock.calls[0][0][1].content).toContain(
      "Use Operations, Engineering, Corporate, and Supply",
    );
  });

  it("rejects malformed clarifications and invalid request input", async () => {
    mockChat.mockResolvedValue(
      '{"action":"clarify","mode":"generate","question":"Choose","options":["Only one"]}',
    );
    await expect(planFileRequest("Generate Excel", "xlsx", [])).rejects.toThrow(
      "invalid clarification",
    );
    expect(validatePlanningInput("", "xlsx", [])).toBeNull();
    expect(validatePlanningInput("Create", "docx", [])).toBeNull();
    expect(validatePlanningInput("Create", "xlsx", [1])).toBeNull();
  });
});
