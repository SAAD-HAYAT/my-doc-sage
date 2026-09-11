import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two things retrieve() actually calls, exactly as the real code
// calls them (read from lib/retrieval.ts before writing this):
//   - embed(query) from "./openrouter"  (aliased here as "@/lib/openrouter")
//   - supabase.rpc("match_chunks", { query_embedding, match_count })
//
// These tests lock in the mapping/ordering logic and the score-clamp
// regression fix with controlled inputs. They do NOT evaluate real
// semantic recall quality (does the right chunk actually get retrieved
// for a real question) — that's Phase 6's eval harness, not this one.

vi.mock("@/lib/openrouter", () => ({ embed: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { embed } from "@/lib/openrouter";
import { retrieve } from "@/lib/retrieval";
import { supabase } from "@/lib/supabase";

const mockEmbed = vi.mocked(embed);
const mockRpc = vi.mocked(supabase.rpc);

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
});

function rpcResult(data: unknown, error: unknown = null) {
  // Matches supabase-js's { data, error } shape without pulling in a real
  // PostgrestBuilder — retrieve() only destructures these two fields.
  mockRpc.mockResolvedValue({ data, error } as never);
}

describe("retrieve", () => {
  it("embeds the raw query and calls match_chunks with query_embedding + match_count", async () => {
    rpcResult([]);
    await retrieve("what is the mascot?", 5);

    expect(mockEmbed).toHaveBeenCalledWith("what is the mascot?");
    expect(mockRpc).toHaveBeenCalledWith("match_chunks", {
      query_embedding: [0.1, 0.2, 0.3],
      match_count: 5,
    });
  });

  it("defaults match_count to 5 when k isn't given", async () => {
    rpcResult([]);
    await retrieve("some question");
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks",
      expect.objectContaining({ match_count: 5 }),
    );
  });

  it("scenario 1: multiple results — maps fields and preserves the order the RPC returned them in", async () => {
    // match_chunks does the ORDER BY in SQL; retrieve() must not reorder
    // (or reverse) whatever comes back.
    rpcResult([
      { content: "chunk A", document_name: "doc1.md", similarity: 0.81 },
      { content: "chunk B", document_name: "doc1.md", similarity: 0.5 },
      { content: "chunk C", document_name: "doc2.pdf", similarity: 0.2 },
    ]);

    const result = await retrieve("q");

    expect(result).toEqual([
      { documentName: "doc1.md", chunkText: "chunk A", score: 0.81 },
      { documentName: "doc1.md", chunkText: "chunk B", score: 0.5 },
      { documentName: "doc2.pdf", chunkText: "chunk C", score: 0.2 },
    ]);
  });

  it("scenario 2: empty results — returns an empty array, not an error", async () => {
    rpcResult([]);
    expect(await retrieve("nothing matches")).toEqual([]);
  });

  it("scenario 3: null data (no rows) — treated the same as an empty array", async () => {
    rpcResult(null);
    expect(await retrieve("q")).toEqual([]);
  });

  it("scenario 4: negative raw cosine similarity is clamped to 0, not passed through", async () => {
    // Regression test for the score bug: match_chunks returns raw cosine
    // similarity, which is mathematically [-1, 1]. Near-orthogonal chunks
    // come back slightly negative; the API contract and frontend ("N%
    // match") require 0-1.
    rpcResult([
      { content: "weak match", document_name: "doc.md", similarity: -0.04 },
      { content: "also weak", document_name: "doc.md", similarity: -0.0001 },
    ]);

    const result = await retrieve("unrelated query");

    expect(result[0].score).toBe(0);
    expect(result[1].score).toBe(0);
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("scenario 5: close scores stay distinct and in RPC order, and every score is a plausible 0-1 similarity", async () => {
    rpcResult([
      { content: "chunk near-tie 1", document_name: "doc.md", similarity: 0.501 },
      { content: "chunk near-tie 2", document_name: "doc.md", similarity: 0.499 },
      { content: "chunk near-tie 3", document_name: "doc.md", similarity: 0.498 },
    ]);

    const result = await retrieve("q");

    expect(result.map((r) => r.score)).toEqual([0.501, 0.499, 0.498]);
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    // still strictly descending, i.e. not raw distance (which would ascend)
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[1].score).toBeGreaterThan(result[2].score);
  });

  it("scenario 6: single result", async () => {
    rpcResult([{ content: "only one", document_name: "doc.md", similarity: 0.72 }]);
    const result = await retrieve("q");
    expect(result).toEqual([{ documentName: "doc.md", chunkText: "only one", score: 0.72 }]);
  });

  it("scenario 7: RPC error surfaces as a descriptive thrown error, not a silent empty result", async () => {
    rpcResult(null, { message: "relation \"chunks\" does not exist" });
    await expect(retrieve("q")).rejects.toThrow(/relation "chunks" does not exist/);
  });
});
