// Phase 1: retrieve(query, k) — embed the query, cosine-similarity
// search in `chunks` via pgvector.
// Phase 5: hybrid search + reranking will extend this.

export type RetrievedChunk = {
  documentName: string;
  chunkText: string;
  score: number;
};

export async function retrieve(query: string, k = 5): Promise<RetrievedChunk[]> {
  // TODO (Phase 1):
  //   1. const vector = await embed(query)
  //   2. Query Supabase: order chunks by `embedding <=> vector` ascending,
  //      limit k, join documents for the name.
  //   3. Map to RetrievedChunk[].
  throw new Error("not implemented");
}
