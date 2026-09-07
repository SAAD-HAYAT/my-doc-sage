// Phase 1: simple fixed-size chunking with overlap.
// Phase 5 (optional): revisit for semantic chunking.

/**
 * Split `text` into ~`chunkSize`-token pieces with `overlap` tokens shared
 * between consecutive chunks. Uses a word count as a rough stand-in for a
 * token count — good enough to stay under the embedding model's 512-token
 * cap without pulling in a real tokenizer.
 */
export function chunkText(text: string, chunkSize = 350, overlap = 50): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= chunkSize) return [words.join(" ")];

  const step = Math.max(1, chunkSize - overlap);
  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + chunkSize).join(" "));
    if (start + chunkSize >= words.length) break;
  }
  return chunks;
}
