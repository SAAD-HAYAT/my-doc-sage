import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 5: retrieve() calls supabase.rpc("hybrid_search", ...) instead of
// "match_chunks" -- it fetches a wide candidate pool from BOTH vector
// similarity and full-text search in one round trip, then fuses them here
// in TS via reciprocal rank fusion (RRF). Read lib/retrieval.ts before
// touching this file: the RPC row shape is
// { content, document_name, vector_rank, fulltext_rank } (either rank can
// be null if a chunk only placed in the other list), and the merge/sort/
// slice-to-k logic all happens client-side, which is exactly why it's
// worth covering with mocks here rather than only via a live DB.
//
// Reranking (a local cross-encoder) was tried on top of this and rejected
// after live testing showed it demoting exactly the chunks that had the
// right answer on this corpus's short, resume-style bullet fragments --
// see docs/phase-5-advanced-retrieval.md's Results Log. retrieve() is
// hybrid-search-only.
//
// These tests lock in the mapping/fusion/ordering logic with controlled
// inputs. They do NOT evaluate real semantic recall quality (does the
// right chunk actually get retrieved for a real question) — that's Phase
// 6's eval harness, not this one.

vi.mock("@/lib/openrouter", () => ({ embed: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: vi.fn() } }));

import { embed } from "@/lib/openrouter";
import { retrieve } from "@/lib/retrieval";
import { supabaseAdmin } from "@/lib/supabase";

const mockEmbed = vi.mocked(embed);
const mockRpc = vi.mocked(supabaseAdmin.rpc);
const TEST_USER_ID = "test-user-id";

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
});

function rpcResult(data: unknown, error: unknown = null) {
  // Matches supabase-js's { data, error } shape without pulling in a real
  // PostgrestBuilder — retrieve() only destructures these two fields.
  mockRpc.mockResolvedValue({ data, error } as never);
}

// RRF constants mirrored from lib/retrieval.ts (RRF_K=60, MAX_RRF_SCORE =
// 2/(RRF_K+1)) so expected scores below can be computed by hand rather
// than re-deriving retrieval.ts's internals in each assertion.
const RRF_K = 60;
const MAX_RRF = 2 / (RRF_K + 1);
function expectedScore(vectorRank: number | null, fulltextRank: number | null): number {
  const v = vectorRank === null ? 0 : 1 / (RRF_K + vectorRank);
  const f = fulltextRank === null ? 0 : 1 / (RRF_K + fulltextRank);
  return Math.min(1, (v + f) / MAX_RRF);
}

describe("retrieve", () => {
  it("embeds the raw query and calls hybrid_search with query_embedding, query_text, and a fixed candidate pool", async () => {
    rpcResult([]);
    await retrieve("what is the mascot?", TEST_USER_ID, 5);

    expect(mockEmbed).toHaveBeenCalledWith("what is the mascot?");
    expect(mockRpc).toHaveBeenCalledWith("hybrid_search", {
      query_embedding: [0.1, 0.2, 0.3],
      query_text: "what is the mascot?",
      p_user_id: TEST_USER_ID,
      match_count: 20,
    });
  });

  it("requests the same wide candidate pool from the RPC regardless of the caller's k, then slices to k afterward", async () => {
    rpcResult(
      Array.from({ length: 12 }, (_, i) => ({
        content: `chunk ${i}`,
        document_name: "doc.md",
        vector_rank: i + 1,
        fulltext_rank: null,
      })),
    );

    const result = await retrieve("q", TEST_USER_ID, 3);

    // Candidate pool requested from the RPC is independent of k...
    expect(mockRpc).toHaveBeenCalledWith("hybrid_search", expect.objectContaining({ match_count: 20 }));
    // ...but the final result respects k.
    expect(result).toHaveLength(3);
  });

  it("defaults k to 5 when not given", async () => {
    rpcResult(
      Array.from({ length: 8 }, (_, i) => ({
        content: `chunk ${i}`,
        document_name: "doc.md",
        vector_rank: i + 1,
        fulltext_rank: null,
      })),
    );

    const result = await retrieve("some question", TEST_USER_ID);
    expect(result).toHaveLength(5);
  });

  it("HYBRID BEHAVIOR: a strong keyword match outranks a better pure-vector match once fused", async () => {
    // Chunk A: the #1 vector match, but never surfaced by full-text search.
    // Chunk C: the #2 vector match, also never surfaced by full-text search.
    // Chunk B: only the #5 vector match, but the #1 (exact) full-text hit.
    // Pure vector search would rank A > C > B. RRF fusion should promote B
    // to #1 because it's corroborated by both signals' rankings combined
    // outweighing a single #1 vector-only placement -- proving the fusion
    // actually changes the outcome, not just plumbs data through unused.
    rpcResult([
      { content: "chunk A (top vector, no keyword hit)", document_name: "doc.md", vector_rank: 1, fulltext_rank: null },
      { content: "chunk B (weak vector, exact keyword hit)", document_name: "doc.md", vector_rank: 5, fulltext_rank: 1 },
      { content: "chunk C (2nd vector, no keyword hit)", document_name: "doc.md", vector_rank: 2, fulltext_rank: null },
    ]);

    const result = await retrieve("exact keyword", TEST_USER_ID);

    expect(result.map((r) => r.chunkText)).toEqual([
      "chunk B (weak vector, exact keyword hit)",
      "chunk A (top vector, no keyword hit)",
      "chunk C (2nd vector, no keyword hit)",
    ]);
    expect(result[0].score).toBeCloseTo(expectedScore(5, 1));
    expect(result[1].score).toBeCloseTo(expectedScore(1, null));
    expect(result[2].score).toBeCloseTo(expectedScore(2, null));
    // Confirms B truly overtakes A/C rather than merely tying.
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("a chunk ranked #1 in both vector and full-text gets the maximum normalized score of 1", async () => {
    rpcResult([{ content: "perfect hit", document_name: "doc.md", vector_rank: 1, fulltext_rank: 1 }]);

    const result = await retrieve("q", TEST_USER_ID);
    expect(result[0].score).toBe(1);
  });

  it("a chunk found by only one method still gets a sane, bounded score", async () => {
    rpcResult([{ content: "vector only, top rank", document_name: "doc.md", vector_rank: 1, fulltext_rank: null }]);

    const result = await retrieve("q", TEST_USER_ID);
    expect(result[0].score).toBeCloseTo(0.5);
    expect(result[0].score).toBeGreaterThanOrEqual(0);
    expect(result[0].score).toBeLessThanOrEqual(1);
  });

  it("scenario: empty results — returns an empty array, not an error", async () => {
    rpcResult([]);
    expect(await retrieve("nothing matches", TEST_USER_ID)).toEqual([]);
  });

  it("scenario: null data (no rows) — treated the same as an empty array", async () => {
    rpcResult(null);
    expect(await retrieve("q", TEST_USER_ID)).toEqual([]);
  });

  it("scenario: multiple results all bounded in 0-1 and sorted strictly descending by fused score", async () => {
    rpcResult([
      { content: "chunk near-tie 1", document_name: "doc.md", vector_rank: 1, fulltext_rank: 3 },
      { content: "chunk near-tie 2", document_name: "doc.md", vector_rank: 2, fulltext_rank: null },
      { content: "chunk near-tie 3", document_name: "doc.md", vector_rank: null, fulltext_rank: 4 },
    ]);

    const result = await retrieve("q", TEST_USER_ID);

    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[1].score).toBeGreaterThan(result[2].score);
  });

  it("scenario: single result — maps fields correctly", async () => {
    rpcResult([{ content: "only one", document_name: "doc.md", vector_rank: 1, fulltext_rank: null }]);
    const result = await retrieve("q", TEST_USER_ID);
    expect(result).toEqual([{ documentName: "doc.md", chunkText: "only one", score: expectedScore(1, null) }]);
  });

  it("scenario: RPC error surfaces as a descriptive thrown error, not a silent empty result", async () => {
    rpcResult(null, { message: 'relation "chunks" does not exist' });
    await expect(retrieve("q", TEST_USER_ID)).rejects.toThrow(/relation "chunks" does not exist/);
  });
});
