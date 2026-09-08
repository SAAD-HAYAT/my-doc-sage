// Phase 1: fixed-size chunking by real token count, with overlap.
// Phase 5 (optional): revisit for semantic chunking.

import { decode, encode } from "gpt-tokenizer";

// The embedding model (liquid/lfm-2.5-embedding-350m) caps at 512 input
// tokens. gpt-tokenizer is NOT that model's tokenizer — measured against
// the live API it runs ~1.05x the gpt-tokenizer count on clean prose and
// noticeably higher on PDF-extracted text (denser: broken words,
// ligatures, headers/footers). We assume a conservative 1.5x and keep
// every chunk well under the hard limit.
const DEFAULT_CHUNK_TOKENS = 300;
const DEFAULT_OVERLAP_TOKENS = 40;

// Absolute ceiling for a chunk actually sent to the embeddings API, in
// gpt-tokenizer tokens. 320 * 1.5 ≈ 480 real tokens — comfortably under
// the model's 512 hard limit even if PDF text tokenizes densely.
export const MAX_EMBED_TOKENS = 320;

export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Split `text` into ~`chunkSize`-token pieces with `overlap` tokens shared
 * between consecutive chunks, measured with a real BPE tokenizer.
 */
export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_TOKENS,
  overlap = DEFAULT_OVERLAP_TOKENS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const tokens = encode(trimmed);
  if (tokens.length <= chunkSize) return [trimmed];

  const step = Math.max(1, chunkSize - overlap);
  const chunks: string[] = [];
  for (let start = 0; start < tokens.length; start += step) {
    const piece = decode(tokens.slice(start, start + chunkSize)).trim();
    if (piece) chunks.push(piece);
    if (start + chunkSize >= tokens.length) break;
  }
  return chunks;
}

/**
 * Safety net: guarantee a chunk is at or under `maxTokens` by recursively
 * halving it. Should rarely fire after chunkText() — if it fires often,
 * lower DEFAULT_CHUNK_TOKENS or raise LIQUID_TOKEN_FACTOR. Pieces are
 * returned in original order.
 */
export function splitToTokenLimit(text: string, maxTokens = MAX_EMBED_TOKENS): string[] {
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return [text];

  const mid = Math.floor(tokens.length / 2);
  const left = decode(tokens.slice(0, mid)).trim();
  const right = decode(tokens.slice(mid)).trim();
  return [
    ...splitToTokenLimit(left, maxTokens),
    ...splitToTokenLimit(right, maxTokens),
  ];
}
