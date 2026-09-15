// Phase 1: retrieve(query, k) — embed the query, cosine-similarity
// search in `chunks` via pgvector.
// Phase 5: hybrid search — combine that vector search with Postgres
// full-text search via reciprocal rank fusion (RRF). Reranking (a local
// cross-encoder) was tried and rejected here -- see
// docs/phase-5-advanced-retrieval.md's Results Log for why.

import { embed } from "./openrouter";
import { supabase } from "./supabase";

export type RetrievedChunk = {
  documentName: string;
  chunkText: string;
  score: number;
};

type HybridSearchRow = {
  content: string;
  document_name: string;
  vector_rank: number | null;
  fulltext_rank: number | null;
};

// How many candidates each of the two underlying searches (vector,
// full-text) contributes to the fusion, before we cut down to the
// caller's requested `k`. Wider than `k` on purpose: a chunk that's
// merely the 8th-best vector match but the #1 keyword match should still
// get a chance to win on fusion instead of being cut before it's ever
// considered.
const CANDIDATE_POOL = 20;

// Standard RRF damping constant (Cormack, Clarke & Buettcher 2009) — high
// enough that a handful of low-ranked hits from one list can't outweigh a
// single top hit from the other.
const RRF_K = 60;

function rrfContribution(rank: number | null): number {
  return rank === null ? 0 : 1 / (RRF_K + rank);
}

// Best possible fused value: rank #1 in both the vector AND full-text
// lists. Used to normalize the fused score back into the same 0-1 range
// the frontend already renders as "N% match" -- 1.0 means both methods
// agree this is the top hit, 0.5 means only one method found it, but as
// its own #1 result.
const MAX_RRF_SCORE = 2 / (RRF_K + 1);

export async function retrieve(query: string, k = 5): Promise<RetrievedChunk[]> {
  const vector = await embed(query);

  const { data, error } = await supabase.rpc("hybrid_search", {
    query_embedding: vector,
    query_text: query,
    match_count: CANDIDATE_POOL,
  });

  if (error) {
    throw new Error(`Retrieval query failed: ${error.message}`);
  }

  const rows = (data ?? []) as HybridSearchRow[];

  return rows
    .map((row) => ({
      documentName: row.document_name,
      chunkText: row.content,
      score: Math.min(
        1,
        (rrfContribution(row.vector_rank) + rrfContribution(row.fulltext_rank)) / MAX_RRF_SCORE,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
