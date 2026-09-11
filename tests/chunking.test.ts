import { decode, encode } from "gpt-tokenizer";
import { describe, expect, it } from "vitest";
import {
  MAX_EMBED_TOKENS,
  chunkText,
  countTokens,
  splitToTokenLimit,
} from "@/lib/chunking";

// The real chunker measures in real BPE tokens (gpt-tokenizer), not words —
// a PDF-density chunk that "looks like" 350 words previously produced 589
// real tokens against the embedding model, which is what broke ingestion.
// These tests compute expected sizes via the same tokenizer library rather
// than assuming word count ≈ token count.

const SENTENCE =
  "The quick brown fox jumps over the lazy dog near the riverbank while " +
  "the autumn leaves drift slowly across the quiet meadow at dusk. ";

function longText(repeats: number): string {
  return SENTENCE.repeat(repeats);
}

describe("chunkText", () => {
  it("keeps every chunk at or under the target token count", () => {
    const text = longText(40);
    const chunks = chunkText(text); // defaults: 300 tokens, 40 overlap
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(encode(chunk).length).toBeLessThanOrEqual(300);
    }
  });

  it("overlaps consecutive chunks by the configured token count", () => {
    const chunkSize = 40;
    const overlap = 12;
    const chunks = chunkText(longText(10), chunkSize, overlap);
    expect(chunks.length).toBeGreaterThan(2);

    for (let i = 0; i < chunks.length - 1; i++) {
      const tailOfCurrent = decode(encode(chunks[i]).slice(-overlap)).trim();
      const headOfNext = decode(encode(chunks[i + 1]).slice(0, overlap)).trim();
      // Both spans start at (approximately) the same position in the
      // source text, so the shorter should be a prefix of the longer.
      // Not byte-exact equality: re-encoding a trimmed piece can shift a
      // single leading/trailing whitespace token by one BPE token, so the
      // two spans can differ by roughly one word at the far edge — this
      // still fails hard if the overlap logic actually breaks (e.g. no
      // shared text at all, or the step calculation is wrong).
      expect(tailOfCurrent.length).toBeGreaterThan(0);
      expect(headOfNext.length).toBeGreaterThan(0);
      const [shorter, longer] =
        tailOfCurrent.length <= headOfNext.length
          ? [tailOfCurrent, headOfNext]
          : [headOfNext, tailOfCurrent];
      expect(longer.startsWith(shorter)).toBe(true);
    }
  });

  it("produces the number of chunks the token-window math implies", () => {
    const chunkSize = 40;
    const overlap = 12;
    const step = chunkSize - overlap;
    const text = longText(10);
    const totalTokens = encode(text.trim()).length;

    const expectedCount = Math.ceil((totalTokens - overlap) / step);
    const chunks = chunkText(text, chunkSize, overlap);

    expect(chunks.length).toBe(expectedCount);
  });

  it("handles text shorter than one chunk without erroring", () => {
    const text = "Just one short note.";
    const chunks = chunkText(text);
    expect(chunks).toEqual([text]);
    expect(encode(chunks[0]).length).toBeLessThan(300);
  });

  it("handles empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t  ")).toEqual([]);
  });
});

describe("splitToTokenLimit (recursive ingestion safety net)", () => {
  it("passes text already under the limit straight through", () => {
    const text = "short text, well under any limit";
    expect(splitToTokenLimit(text)).toEqual([text]);
  });

  it("recursively halves an oversized chunk until every piece is under MAX_EMBED_TOKENS", () => {
    // Bypass chunkText's own windowing entirely and feed a single chunk far
    // larger than MAX_EMBED_TOKENS (320) directly — this is the "for any
    // reason" case the safety net exists for (e.g. denser-than-estimated
    // PDF text), not something chunkText's own 300-token default produces.
    const oversized = longText(60);
    expect(countTokens(oversized)).toBeGreaterThan(MAX_EMBED_TOKENS * 2);

    const pieces = splitToTokenLimit(oversized);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(countTokens(piece)).toBeLessThanOrEqual(MAX_EMBED_TOKENS);
    }
  });

  it("keeps every split piece under the embedding model's real 512-token hard limit", () => {
    const oversized = longText(60);
    const pieces = splitToTokenLimit(oversized);
    for (const piece of pieces) {
      expect(countTokens(piece)).toBeLessThan(512);
    }
  });

  it("mirrors the real ingestion flow: chunkText() -> per-chunk safety net", () => {
    // app/api/documents/route.ts calls chunkText() then runs every result
    // through splitToTokenLimit() before embedding. Simulate a
    // pathologically large chunkSize (as if DEFAULT_CHUNK_TOKENS were
    // misconfigured, or a single chunk otherwise ballooned) to force the
    // safety net to actually fire on chunkText's own output.
    const text = longText(60);
    const baseChunks = chunkText(text, 1000, 100);
    expect(baseChunks.some((c) => countTokens(c) > MAX_EMBED_TOKENS)).toBe(true);

    const finalChunks = baseChunks.flatMap((c) => splitToTokenLimit(c));
    for (const chunk of finalChunks) {
      expect(countTokens(chunk)).toBeLessThan(512);
    }
  });
});
