import { describe, it } from "vitest";

// Phase 2: seed a small set of known chunks and known questions, assert
// the expected chunk shows up in the top-k. Mock lib/openrouter.ts's
// embed() so this doesn't hit the real API.

describe("retrieve", () => {
  it.todo("returns the expected chunk in the top-k for a known question");
});
