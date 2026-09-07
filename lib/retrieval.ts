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
    score: row.similarity,
  }));
}
