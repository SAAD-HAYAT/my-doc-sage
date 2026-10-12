import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/file-generation-server", () => ({ generateFilePayload: vi.fn() }));

import { POST } from "@/app/api/files/generate/route";
import { generateFilePayload } from "@/lib/file-generation-server";
import { getAuthenticatedUser } from "@/lib/supabase-server";

const mockGenerate = vi.mocked(generateFilePayload);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);

function request(body: unknown) {
  return new NextRequest("http://localhost/api/files/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" } as never);
  mockGenerate.mockResolvedValue({
    format: "md",
    name: "generated-document.md",
    content: "# Generated",
  });
});

describe("POST /api/files/generate", () => {
  it("requires authentication", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    expect((await POST(request({ prompt: "p", specification: "s", format: "md" }))).status).toBe(
      401,
    );
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("validates and generates the requested format", async () => {
    const response = await POST(
      request({ prompt: "Create a Markdown file", specification: "Concise", format: "md" }),
    );
    expect(response.status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith("Create a Markdown file", "Concise", "md", "user-1");
  });

  it("rejects unsupported formats", async () => {
    const response = await POST(
      request({ prompt: "Create a file", specification: "Concise", format: "docx" }),
    );
    expect(response.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
