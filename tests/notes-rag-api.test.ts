import { afterEach, describe, expect, it, vi } from "vitest";
import { documentsApi } from "@/lib/notes-rag-api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotesRAG API errors", () => {
  it("surfaces the server's JSON error message instead of raw JSON text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Document ingestion failed while storing chunks" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(documentsApi.list()).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        status: 500,
        message: "Document ingestion failed while storing chunks",
      }),
    );
  });
});
