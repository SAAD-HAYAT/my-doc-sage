import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/file-request-planner", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/file-request-planner")>();
  return { ...original, planFileRequest: vi.fn() };
});

import { POST } from "@/app/api/files/plan/route";
import { planFileRequest } from "@/lib/file-request-planner";
import { getAuthenticatedUser } from "@/lib/supabase-server";

const mockPlan = vi.mocked(planFileRequest);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);

function request(body: unknown) {
  return new NextRequest("http://localhost/api/files/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ id: "user-1" } as never);
  mockPlan.mockResolvedValue({
    action: "generate",
    format: "pdf",
    mode: "generate",
    specification: "Detailed report",
  });
});

describe("POST /api/files/plan", () => {
  it("requires authentication", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    expect(
      (await POST(request({ prompt: "Generate PDF", format: "pdf", answers: [] }))).status,
    ).toBe(401);
    expect(mockPlan).not.toHaveBeenCalled();
  });

  it("passes the request and prior answers to the model planner", async () => {
    const response = await POST(
      request({ prompt: "Generate PDF", format: "pdf", answers: ["Detailed"] }),
    );
    expect(response.status).toBe(200);
    expect(mockPlan).toHaveBeenCalledWith("Generate PDF", "pdf", ["Detailed"]);
  });

  it("rejects malformed planning input", async () => {
    const response = await POST(request({ prompt: "Generate file", format: "docx", answers: [] }));
    expect(response.status).toBe(400);
    expect(mockPlan).not.toHaveBeenCalled();
  });
});
