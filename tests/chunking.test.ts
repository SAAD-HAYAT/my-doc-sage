import { describe, it } from "vitest";

// Phase 2: flesh these out once lib/chunking.ts is implemented in Phase 1.

describe("chunkText", () => {
  it.todo("splits long text into roughly equal chunks");
  it.todo("overlaps consecutive chunks by the configured amount");
  it.todo("handles text shorter than one chunk without erroring");
  it.todo("handles empty input");
});
