// Phase 1: retrieve(query, k) — embed the query, cosine-similarity
// search in `chunks` via pgvector.
// Phase 5: hybrid search + reranking will extend this.

import { embed } from "./openrouter";
import { supabase } from "./supabase";

export type RetrievedChunk = {
  documentName: string;
  chunkText: string;
  score: number;
};

type MatchChunkRow = {
  content: string;
  document_name: string;
  similarity: number;
};

export async function retrieve(query: string, k = 5): Promise<RetrievedChunk[]> {
  const vector = await embed(query);

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: vector,
    match_count: k,
  });

  if (error) {
    throw new Error(`Retrieval query failed: ${error.message}`);
  }

  return ((data ?? []) as MatchChunkRow[]).map((row) => ({
    documentName: row.document_name,
    chunkText: row.content,
    // match_chunks returns raw cosine similarity, which is mathematically
    // [-1, 1]; near-orthogonal chunks come back slightly negative. The API
    // contract (and the frontend's "N% match") expects 0-1, so clamp the
    // floor. Ordering is unaffected — negatives are already the weakest hits.
    score: Math.max(0, row.similarity),
  }));
}
