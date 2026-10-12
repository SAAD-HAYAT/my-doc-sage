import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));

import { generateFilePayload } from "@/lib/file-generation-server";
import { chat } from "@/lib/openrouter";
import { retrieve } from "@/lib/retrieval";

const mockChat = vi.mocked(chat);
const mockRetrieve = vi.mocked(retrieve);

beforeEach(() => {
  vi.clearAllMocks();
  mockRetrieve.mockResolvedValue([
    { documentName: "notes.md", chunkText: "Revenue was 100.", score: 0.9 },
  ]);
});

describe("generated file payloads", () => {
  it("validates a model-generated workbook specification", async () => {
    mockChat.mockResolvedValue(
      '```json\n{"sheets":[{"name":"Summary","rows":[["Metric","Value"],["Revenue",100]]}]}\n```',
    );

    await expect(
      generateFilePayload("Create an Excel report", "One summary worksheet", "xlsx", "user-1"),
    ).resolves.toEqual({
      format: "xlsx",
      name: "generated-workbook.xlsx",
      sheets: [
        {
          name: "Summary",
          rows: [
            ["Metric", "Value"],
            ["Revenue", 100],
          ],
        },
      ],
    });
    expect(mockRetrieve).toHaveBeenCalledWith("Create an Excel report", "user-1", 10);
  });

  it("returns model-authored Markdown content for PDF rendering", async () => {
    mockChat.mockResolvedValue("# Report\n\nRevenue was 100.");

    await expect(
      generateFilePayload("Generate a PDF", "Detailed report", "pdf", "user-1"),
    ).resolves.toEqual({
      format: "pdf",
      name: "generated-document.pdf",
      content: "# Report\n\nRevenue was 100.",
    });
  });

  it("rejects malformed Excel output rather than creating a corrupt workbook", async () => {
    mockChat.mockResolvedValue('{"sheets":[]}');
    await expect(
      generateFilePayload("Generate Excel", "Summary", "xlsx", "user-1"),
    ).rejects.toThrow("invalid worksheet list");
  });
});
