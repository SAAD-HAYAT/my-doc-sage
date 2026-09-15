import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/documents/route.ts and [id]/route.ts pull in @/lib/supabase,
// @/lib/supabase-server, and @/lib/openrouter (for embed()) -- mock all
// three so this file costs zero API/DB calls. Phase 7 focus: these tests
// cover the auth gate (401 with no session) and that every query/insert
// is scoped to the authenticated user's id -- NOT a full re-test of the
// ingestion pipeline's chunking/embedding mechanics, which predates this
// phase and is unchanged here besides the added user_id.
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/openrouter", () => ({ embed: vi.fn() }));

import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { embed } from "@/lib/openrouter";
import { GET, POST } from "@/app/api/documents/route";
import { DELETE } from "@/app/api/documents/[id]/route";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);
const mockEmbed = vi.mocked(embed);

const TEST_USER_ID = "test-user-id";
const OTHER_USER_ID = "someone-elses-user-id";

// See tests/chat.test.ts for why this needs to be thenable at every step
// (real supabase-js query builders resolve to {data, error} regardless
// of how many .eq()/.select()/etc. calls preceded the await).
function chainable(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "insert", "update", "delete", "single"]) {
    obj[method] = vi.fn(() => obj);
  }
  obj.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return obj;
}

function uploadRequest(fileContent: string, filename = "notes.md") {
  const form = new FormData();
  form.append("file", new File([fileContent], filename, { type: "text/markdown" }));
  return new NextRequest("http://localhost/api/documents", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ id: TEST_USER_ID } as never);
  mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
});

describe("POST /api/documents", () => {
  it("returns 401 and touches no tables when there's no authenticated session", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const res = await POST(uploadRequest("some notes"));

    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates the document row and every chunk row tagged with the authenticated user's id", async () => {
    const insertedDoc = chainable({
      data: { id: "doc-1", name: "notes.md", status: "processing", created_at: "2026-01-01" },
      error: null,
    });
    const chunksInsert = chainable({ data: null, error: null });
    const updatedDoc = chainable({
      data: { id: "doc-1", name: "notes.md", status: "ready", created_at: "2026-01-01" },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => insertedDoc as never) // documents: create
      .mockImplementationOnce(() => chunksInsert as never) // chunks: insert
      .mockImplementationOnce(() => updatedDoc as never); // documents: mark ready

    const res = await POST(uploadRequest("some notes content long enough to chunk"));

    expect(res.status).toBe(200);
    expect(insertedDoc.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: TEST_USER_ID }),
    );
    expect(chunksInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: TEST_USER_ID }),
    ]);
    // The "mark ready" update is scoped to this user, not just the doc id.
    expect(updatedDoc.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });

  it("scopes the cleanup (chunk delete + status=failed update) to the authenticated user's id on ingestion failure", async () => {
    const insertedDoc = chainable({
      data: { id: "doc-1", name: "notes.md", status: "processing", created_at: "2026-01-01" },
      error: null,
    });
    const chunksDelete = chainable({ data: null, error: null });
    const failedUpdate = chainable({ data: null, error: null });

    mockFrom
      .mockImplementationOnce(() => insertedDoc as never)
      .mockImplementationOnce(() => chunksDelete as never)
      .mockImplementationOnce(() => failedUpdate as never);

    mockEmbed.mockRejectedValue(new Error("embedding service down"));

    const res = await POST(uploadRequest("some notes content long enough to chunk"));

    // Route always returns 200 with status:"failed" in the body on an
    // ingestion error (see app/api/documents/route.ts) -- not itself a
    // Phase 7 concern, just confirming the scoped cleanup still ran.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(chunksDelete.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
    expect(failedUpdate.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });
});

describe("GET /api/documents", () => {
  it("returns 401 with no authenticated session", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("scopes the list query to the authenticated user's id", async () => {
    const query = chainable({ data: [{ id: "d1", name: "a.pdf", status: "ready", created_at: "x" }], error: null });
    mockFrom.mockReturnValue(query as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });

  it("a different authenticated user's list query is scoped to THEIR id, not another user's", async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ id: OTHER_USER_ID } as never);
    const query = chainable({ data: [], error: null });
    mockFrom.mockReturnValue(query as never);

    await GET();

    expect(query.eq).toHaveBeenCalledWith("user_id", OTHER_USER_ID);
    expect(query.eq).not.toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });
});

describe("DELETE /api/documents/:id", () => {
  function deleteRequest(id: string) {
    const req = new NextRequest(`http://localhost/api/documents/${id}`, { method: "DELETE" });
    return DELETE(req, { params: Promise.resolve({ id }) });
  }

  it("returns 401 and touches no tables when there's no authenticated session", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const res = await deleteRequest("doc-1");

    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("scopes the delete to BOTH the document id AND the authenticated user's id -- can't delete another user's document by guessing its id", async () => {
    const query = chainable({ data: null, error: null });
    mockFrom.mockReturnValue(query as never);

    const res = await deleteRequest("doc-1");

    expect(res.status).toBe(204);
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("id", "doc-1");
    expect(query.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });
});
