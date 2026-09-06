// Phase 1: simple fixed-size chunking with overlap.
// Phase 5 (optional): revisit for semantic chunking.

export function chunkText(text: string, chunkSize = 350, overlap = 50): string[] {
  // TODO (Phase 1): split `text` into ~chunkSize-token pieces with
  // `overlap` tokens shared between consecutive chunks. A rough
  // word-count approximation is fine to start — don't reach for a real
  // tokenizer yet.
  throw new Error("not implemented");
}
