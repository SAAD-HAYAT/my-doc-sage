import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/openrouter", () => ({ chat: vi.fn() }));

import { POST } from "@/app/api/spreadsheets/classify-departments/route";
import { chat } from "@/lib/openrouter";
import { getAuthenticatedUser } from "@/lib/supabase-server";

const mockChat = vi.mocked(chat);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);

const body = {
  departments: ["Assembly", "Finance", "Warehouse", "Mechanical"],
  categories: [
    { id: "category-1", name: "Production", description: "Assembly" },
    { id: "category-2", name: "Maintenance", description: "Mechanical" },
    { id: "category-3", name: "Administration", description: "Finance" },
    { id: "category-4", name: "Logistics", description: "Warehouse" },
  ],
};

function request(value: unknown) {
  return new NextRequest("http://localhost/api/spreadsheets/classify-departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" } as never);
  mockChat.mockResolvedValue(
    JSON.stringify({
      assignments: [
        { department: "Assembly", categoryId: "category-1" },
        { department: "Finance", categoryId: "category-3" },
        { department: "Warehouse", categoryId: "category-4" },
        { department: "Mechanical", categoryId: "category-2" },
      ],
    }),
  );
});

describe("POST /api/spreadsheets/classify-departments", () => {
  it("requires authentication", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const response = await POST(request(body));
    expect(response.status).toBe(401);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns one validated assignment per department", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assignments: [
        { department: "Assembly", categoryId: "category-1" },
        { department: "Finance", categoryId: "category-3" },
        { department: "Warehouse", categoryId: "category-4" },
        { department: "Mechanical", categoryId: "category-2" },
      ],
    });
  });

  it("rejects an invalid category configuration before calling the model", async () => {
    const response = await POST(request({ ...body, categories: body.categories.slice(0, 3) }));
    expect(response.status).toBe(400);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns 502 when the model omits a department", async () => {
    mockChat.mockResolvedValue(
      '{"assignments":[{"department":"Assembly","categoryId":"category-1"}]}',
    );
    const response = await POST(request(body));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("did not classify every department"),
    });
  });
});
