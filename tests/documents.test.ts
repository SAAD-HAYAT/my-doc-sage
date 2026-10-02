import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// app/api/documents/route.ts and [id]/route.ts pull in @/lib/supabase,
// @/lib/supabase-server, and @/lib/openrouter (for embedMany()) -- mock all
// three so this file costs zero API/DB calls. Phase 7 focus: these tests
// cover the auth gate (401 with no session) and that every query/insert
// is scoped to the authenticated user's id -- NOT a full re-test of the
// ingestion pipeline's chunking/embedding mechanics, which predates this
// phase and is unchanged here besides the added user_id.
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/supabase-server", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/openrouter", () => ({ embedMany: vi.fn() }));

import { supabaseAdmin } from "@/lib/supabase";
import { getAuthenticatedUser } from "@/lib/supabase-server";
import { embedMany } from "@/lib/openrouter";
import { GET, POST } from "@/app/api/documents/route";
import { DELETE } from "@/app/api/documents/[id]/route";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/document-upload";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);
const mockEmbedMany = vi.mocked(embedMany);

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

function uploadRequest(
  fileContent: string,
  filename = "notes.md",
  trimmed?: { unit: "pages" | "lines" | "rows"; included: number; total: number },
) {
  const form = new FormData();
  form.append("file", new File([fileContent], filename, { type: "text/markdown" }));
  if (trimmed) {
    form.append("trimmedUnit", trimmed.unit);
    form.append("includedCount", String(trimmed.included));
    form.append("sourceCount", String(trimmed.total));
  }
  return new NextRequest("http://localhost/api/documents", { method: "POST", body: form });
}

async function excelUploadRequest(
  rows: unknown[][],
  trimmed?: { unit: "pages" | "lines" | "rows"; included: number; total: number },
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Data");
  for (const row of rows) worksheet.addRow(row);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const form = new FormData();
  form.append(
    "file",
    new File([bytes], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  if (trimmed) {
    form.append("trimmedUnit", trimmed.unit);
    form.append("includedCount", String(trimmed.included));
    form.append("sourceCount", String(trimmed.total));
  }
  return new NextRequest("http://localhost/api/documents", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({ id: TEST_USER_ID } as never);
  mockEmbedMany.mockImplementation(async (texts) => texts.map(() => [0.1, 0.2, 0.3]));
});

describe("POST /api/documents", () => {
  it("returns 401 and touches no tables when there's no authenticated session", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);

    const res = await POST(uploadRequest("some notes"));

    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects files at the 4 MB limit before creating a document row", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(MAX_UPLOAD_SIZE_BYTES)], "large.pdf", {
        type: "application/pdf",
      }),
    );
    const request = new NextRequest("http://localhost/api/documents", {
      method: "POST",
      body: form,
    });

    const res = await POST(request);

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: "File size too large" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects unsupported file extensions before creating a document row", async () => {
    for (const [name, type] of [
      ["legacy.xls", "application/vnd.ms-excel"],
      ["macros.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
      ["table.csv", "text/csv"],
      ["notes.txt", "text/plain"],
    ]) {
      const form = new FormData();
      form.append("file", new File(["unsupported"], name, { type }));
      const res = await POST(
        new NextRequest("http://localhost/api/documents", { method: "POST", body: form }),
      );

      expect(res.status).toBe(415);
      await expect(res.json()).resolves.toEqual({
        error: "Unsupported file type. Upload a PDF, Markdown, or Excel (.xlsx) file.",
      });
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("accepts Excel row trim metadata and ingests workbook cell text", async () => {
    const trim = { unit: "rows" as const, included: 2, total: 8 };
    const insertedDoc = chainable({
      data: {
        id: "excel-1",
        name: "data.xlsx",
        status: "processing",
        created_at: "2026-10-02",
        trimmed_unit: trim.unit,
        included_count: trim.included,
        source_count: trim.total,
      },
      error: null,
    });
    const chunksInsert = chainable({ data: null, error: null });
    const updatedDoc = chainable({
      data: {
        id: "excel-1",
        name: "data.xlsx",
        status: "ready",
        created_at: "2026-10-02",
        trimmed_unit: trim.unit,
        included_count: trim.included,
        source_count: trim.total,
      },
      error: null,
    });
    mockFrom
      .mockImplementationOnce(() => insertedDoc as never)
      .mockImplementationOnce(() => chunksInsert as never)
      .mockImplementationOnce(() => updatedDoc as never);

    const res = await POST(
      await excelUploadRequest(
        [
          ["Name", "Score"],
          ["Ada", 98],
        ],
        trim,
      ),
    );

    expect(res.status).toBe(200);
    expect(insertedDoc.insert).toHaveBeenCalledWith(
      expect.objectContaining({ trimmed_unit: "rows", included_count: 2, source_count: 8 }),
    );
    expect(mockEmbedMany).toHaveBeenCalledWith([expect.stringContaining('A2 / "Name"="Ada"')]);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ trimmed: { unit: "rows", included: 2, total: 8 } }),
    );
  });

  it("rejects malformed or empty Excel workbooks without creating a document row", async () => {
    const malformed = new FormData();
    malformed.append(
      "file",
      new File(["not an xlsx archive"], "broken.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const malformedRes = await POST(
      new NextRequest("http://localhost/api/documents", { method: "POST", body: malformed }),
    );
    expect(malformedRes.status).toBe(400);
    expect((await malformedRes.json()).error).toMatch(/^Could not read Excel workbook:/);
    expect(mockFrom).not.toHaveBeenCalled();

    const emptyRes = await POST(await excelUploadRequest([]));
    expect(emptyRes.status).toBe(400);
    await expect(emptyRes.json()).resolves.toEqual({
      error: "Could not read Excel workbook: No extractable cell values found in the workbook",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates the document row and every chunk row tagged with the authenticated user's id", async () => {
    const trim = { unit: "lines" as const, included: 2, total: 5 };
    const insertedDoc = chainable({
      data: {
        id: "doc-1",
        name: "notes.md",
        status: "processing",
        created_at: "2026-01-01",
        trimmed_unit: trim.unit,
        included_count: trim.included,
        source_count: trim.total,
      },
      error: null,
    });
    const chunksInsert = chainable({ data: null, error: null });
    const updatedDoc = chainable({
      data: {
        id: "doc-1",
        name: "notes.md",
        status: "ready",
        created_at: "2026-01-01",
        trimmed_unit: trim.unit,
        included_count: trim.included,
        source_count: trim.total,
      },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => insertedDoc as never) // documents: create
      .mockImplementationOnce(() => chunksInsert as never) // chunks: insert
      .mockImplementationOnce(() => updatedDoc as never); // documents: mark ready

    const res = await POST(
      uploadRequest("some notes content long enough to chunk", "notes.md", trim),
    );

    expect(res.status).toBe(200);
    expect(insertedDoc.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        trimmed_unit: "lines",
        included_count: 2,
        source_count: 5,
      }),
    );
    expect(chunksInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: TEST_USER_ID }),
    ]);
    // The "mark ready" update is scoped to this user, not just the doc id.
    expect(updatedDoc.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ trimmed: { unit: "lines", included: 2, total: 5 } }),
    );
  });

  it("rejects incomplete or inconsistent trim metadata", async () => {
    const form = new FormData();
    form.append("file", new File(["notes"], "notes.md", { type: "text/markdown" }));
    form.append("trimmedUnit", "pages");
    form.append("includedCount", "5");
    form.append("sourceCount", "5");

    const res = await POST(
      new NextRequest("http://localhost/api/documents", { method: "POST", body: form }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid trim metadata" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("stores a large document's vectors in bounded database batches", async () => {
    const insertedDoc = chainable({
      data: { id: "doc-large", name: "large.md", status: "processing", created_at: "2026-01-01" },
      error: null,
    });
    const firstChunkBatch = chainable({ data: null, error: null });
    const secondChunkBatch = chainable({ data: null, error: null });
    const updatedDoc = chainable({
      data: { id: "doc-large", name: "large.md", status: "ready", created_at: "2026-01-01" },
      error: null,
    });

    mockFrom
      .mockImplementationOnce(() => insertedDoc as never)
      .mockImplementationOnce(() => firstChunkBatch as never)
      .mockImplementationOnce(() => secondChunkBatch as never)
      .mockImplementationOnce(() => updatedDoc as never);

    const res = await POST(uploadRequest("word ".repeat(16_000), "large.md"));

    expect(res.status).toBe(200);
    const firstInsert = firstChunkBatch.insert as ReturnType<typeof vi.fn>;
    const secondInsert = secondChunkBatch.insert as ReturnType<typeof vi.fn>;
    const firstRows = firstInsert.mock.calls[0][0] as unknown[];
    const secondRows = secondInsert.mock.calls[0][0] as unknown[];
    expect(firstRows).toHaveLength(50);
    expect(secondRows.length).toBeGreaterThan(0);
    expect(secondRows.length).toBeLessThanOrEqual(50);
    expect(firstRows.length + secondRows.length).toBeGreaterThan(50);
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

    mockEmbedMany.mockRejectedValue(new Error("embedding service down"));

    const res = await POST(uploadRequest("some notes content long enough to chunk"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(
      /^Document ingestion failed while embedding chunks: embedding service down$/,
    );
    expect(body.document.status).toBe("failed");
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
    const query = chainable({
      data: [
        {
          id: "d1",
          name: "a.pdf",
          status: "ready",
          created_at: "x",
          trimmed_unit: "pages",
          included_count: 3,
          source_count: 8,
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
    expect(query.select).toHaveBeenCalledWith(
      "id, name, status, created_at, trimmed_unit, included_count, source_count",
    );
    await expect(res.json()).resolves.toEqual([
      expect.objectContaining({ trimmed: { unit: "pages", included: 3, total: 8 } }),
    ]);
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
