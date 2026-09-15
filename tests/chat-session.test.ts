import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/chat/[sessionId]/route.ts pulls in @/lib/supabase and
// @/lib/supabase-server -- mock both so this file costs zero API/DB
// calls. Phase 7 focus: the 401 gate, that the query is scoped to BOTH
// session_id AND user_id (not session_id alone -- guards against a user
// pasting in another user's sessionId directly), and the defense-in-depth
// check on top of that filter.
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));

import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { GET } from "@/app/api/chat/[sessionId]/route";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);

const TEST_USER_ID = "test-user-id";
const OTHER_USER_ID = "someone-elses-user-id";

// See tests/chat.test.ts for why this needs to be thenable at every step.
function chainable(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return obj;
}

function get(sessionId: string) {
  const req = new NextRequest(`http://localhost/api/chat/${sessionId}`);
  return GET(req, { params: Promise.resolve({ sessionId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ id: TEST_USER_ID } as never);
});

describe("GET /api/chat/:sessionId", () => {
  it("returns 401 and touches no tables when there's no authenticated session", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const res = await get("s1");

    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("scopes the query to BOTH session_id AND the authenticated user's id", async () => {
    const query = chainable({ data: [], error: null });
    mockFrom.mockReturnValue(query as never);

    await get("s1");

    expect(query.eq).toHaveBeenCalledWith("session_id", "s1");
    expect(query.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });

  it("a different authenticated user querying the SAME sessionId gets scoped to their own id, not the original owner's", async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: OTHER_USER_ID } as never);
    const query = chainable({ data: [], error: null });
    mockFrom.mockReturnValue(query as never);

    await get("s1");

    expect(query.eq).toHaveBeenCalledWith("user_id", OTHER_USER_ID);
    expect(query.eq).not.toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });

  it("shapes rows correctly (role, content, sources?, createdAt) and never leaks the internal user_id field into the response", async () => {
    const query = chainable({
      data: [
        {
          role: "user",
          content: "hi",
          sources: null,
          created_at: "2026-01-01T00:00:00Z",
          user_id: TEST_USER_ID,
        },
        {
          role: "assistant",
          content: "hello",
          sources: [{ documentName: "d.md", chunkText: "c", score: 0.5 }],
          created_at: "2026-01-01T00:00:01Z",
          user_id: TEST_USER_ID,
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query as never);

    const res = await get("s1");
    const body = await res.json();

    expect(body).toEqual([
      { role: "user", content: "hi", createdAt: "2026-01-01T00:00:00Z" },
      {
        role: "assistant",
        content: "hello",
        sources: [{ documentName: "d.md", chunkText: "c", score: 0.5 }],
        createdAt: "2026-01-01T00:00:01Z",
      },
    ]);
    for (const row of body) {
      expect(row.user_id).toBeUndefined();
    }
  });

  it("DEFENSE IN DEPTH: refuses to serve a row whose user_id doesn't match the caller, even though the query filter should already prevent this", async () => {
    // Simulates a hypothetical future bug where the .eq("user_id", ...)
    // filter gets dropped/loosened -- this should still refuse to leak
    // the row rather than silently trusting the query alone.
    const query = chainable({
      data: [
        {
          role: "user",
          content: "someone else's message",
          sources: null,
          created_at: "2026-01-01T00:00:00Z",
          user_id: OTHER_USER_ID,
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query as never);

    const res = await get("s1");

    expect(res.status).toBe(401);
  });

  it("returns 500 with a descriptive error if the query fails", async () => {
    const query = chainable({ data: null, error: { message: "db down" } });
    mockFrom.mockReturnValue(query as never);

    const res = await get("s1");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/db down/);
  });
});
