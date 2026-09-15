import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// scripts/eval.ts imports retrieve()/runAgentLoop()/tools/supabase --
// mock all four so this file costs zero API/DB calls. vi.mock() keys on
// the RESOLVED module path, so mocking via the "@/..." alias here still
// intercepts scripts/eval.ts's own relative "../lib/..." imports (both
// resolve to the same physical files).
vi.mock("@/lib/retrieval", () => ({ retrieve: vi.fn() }));
vi.mock("@/lib/agent", () => ({ runAgentLoop: vi.fn() }));
vi.mock("@/lib/tools", () => ({ tools: [{ type: "function", function: { name: "search_notes" } }] }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { runAgentLoop } from "@/lib/agent";
import { retrieve } from "@/lib/retrieval";
import { supabaseAdmin } from "@/lib/supabase";
import { evaluateCase, loadEvalSet, runEval, summarize, type EvalCase } from "@/scripts/eval";

const mockRetrieve = vi.mocked(retrieve);
const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockFrom = vi.mocked(supabaseAdmin.from);
const TEST_USER_ID = "test-user-id";

function mockChunkLookup(byId: Record<string, string | null>) {
  mockFrom.mockImplementation((_table: string) => {
    const eq = vi.fn((_col: string, id: string) => ({
      single: vi.fn().mockResolvedValue(
        byId[id] != null ? { data: { content: byId[id] }, error: null } : { data: null, error: { message: "not found" } },
      ),
    }));
    return { select: vi.fn().mockReturnValue({ eq }) } as never;
  });
}

const CASE: EvalCase = {
  question: "What certification does Saad have?",
  expectedChunkId: "chunk-1",
  expectedAnswerContains: "AWS Cloud Foundations",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evaluateCase", () => {
  it("retrieval HIT + faithfulness PASS when the expected chunk is retrieved and the answer contains the expected phrase", async () => {
    mockChunkLookup({ "chunk-1": "Certification: AWS Cloud Foundations (2024)" });
    mockRetrieve.mockResolvedValue([
      { documentName: "d.pdf", chunkText: "some other chunk", score: 0.4 },
      { documentName: "d.pdf", chunkText: "Certification: AWS Cloud Foundations (2024)", score: 0.9 },
    ]);
    mockRunAgentLoop.mockResolvedValue({
      answer: "Saad has the AWS Cloud Foundations certification.",
      sources: [],
    });

    const result = await evaluateCase(CASE, TEST_USER_ID);

    expect(result.retrievalHit).toBe(true);
    expect(result.faithful).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("retrieval MISS when the expected chunk's exact content isn't among the retrieved results", async () => {
    mockChunkLookup({ "chunk-1": "Certification: AWS Cloud Foundations (2024)" });
    mockRetrieve.mockResolvedValue([{ documentName: "d.pdf", chunkText: "an unrelated chunk", score: 0.4 }]);
    mockRunAgentLoop.mockResolvedValue({ answer: "AWS Cloud Foundations, apparently.", sources: [] });

    const result = await evaluateCase(CASE, TEST_USER_ID);

    expect(result.retrievalHit).toBe(false);
  });

  it("faithfulness FAIL when the answer doesn't contain the expected phrase (case-insensitive check still applies)", async () => {
    mockChunkLookup({ "chunk-1": "Certification: AWS Cloud Foundations (2024)" });
    mockRetrieve.mockResolvedValue([]);
    mockRunAgentLoop.mockResolvedValue({ answer: "I couldn't find that in your notes.", sources: [] });

    const result = await evaluateCase(CASE, TEST_USER_ID);
    expect(result.faithful).toBe(false);
  });

  it("faithfulness check is case-insensitive", async () => {
    mockChunkLookup({ "chunk-1": "Certification: AWS Cloud Foundations (2024)" });
    mockRetrieve.mockResolvedValue([]);
    mockRunAgentLoop.mockResolvedValue({ answer: "he has aws cloud foundations, from 2024.", sources: [] });

    const result = await evaluateCase(CASE, TEST_USER_ID);
    expect(result.faithful).toBe(true);
  });

  it("calls runAgentLoop with a single-turn [system, user] message array and the real tools", async () => {
    mockChunkLookup({ "chunk-1": "x" });
    mockRetrieve.mockResolvedValue([]);
    mockRunAgentLoop.mockResolvedValue({ answer: "answer", sources: [] });

    await evaluateCase(CASE, TEST_USER_ID);

    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    const [messages, toolsArg] = mockRunAgentLoop.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: CASE.question });
    expect(toolsArg).toBeDefined();
  });

  it("a bad expectedChunkId (stale after a re-upload) fails that case gracefully instead of throwing", async () => {
    mockChunkLookup({}); // "chunk-1" not found

    const result = await evaluateCase(CASE, TEST_USER_ID);

    expect(result.retrievalHit).toBe(false);
    expect(result.faithful).toBe(false);
    expect(result.error).toMatch(/chunk-1/);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it("a retrieve() failure fails that case gracefully instead of aborting the whole run", async () => {
    mockChunkLookup({ "chunk-1": "x" });
    mockRetrieve.mockRejectedValue(new Error("embedding service down"));

    const result = await evaluateCase(CASE, TEST_USER_ID);

    expect(result.error).toMatch(/embedding service down/);
    expect(result.retrievalHit).toBe(false);
    expect(result.faithful).toBe(false);
  });

  it("a runAgentLoop failure fails that case gracefully instead of aborting the whole run", async () => {
    mockChunkLookup({ "chunk-1": "x" });
    mockRetrieve.mockResolvedValue([]);
    mockRunAgentLoop.mockRejectedValue(new Error("all chat models exhausted"));

    const result = await evaluateCase(CASE, TEST_USER_ID);

    expect(result.error).toMatch(/all chat models exhausted/);
    expect(result.faithful).toBe(false);
  });
});

describe("summarize", () => {
  it("computes hit rate and faithfulness rate as percentages over evaluated cases", () => {
    const results = [
      { question: "q1", retrievalHit: true, faithful: true, answer: "a" },
      { question: "q2", retrievalHit: true, faithful: false, answer: "a" },
      { question: "q3", retrievalHit: false, faithful: false, answer: "a" },
      { question: "q4", retrievalHit: false, faithful: true, answer: "a" },
    ];

    expect(summarize(results)).toEqual({
      hitRate: 50,
      faithfulnessRate: 50,
      evaluatedCount: 4,
      erroredCount: 0,
    });
  });

  it("returns 0/0 for an empty result set rather than NaN", () => {
    expect(summarize([])).toEqual({ hitRate: 0, faithfulnessRate: 0, evaluatedCount: 0, erroredCount: 0 });
  });

  it("EXCLUDES errored cases from the rate calculation entirely, rather than counting them as misses/fails", () => {
    const results = [
      { question: "q1", retrievalHit: true, faithful: true, answer: "a" },
      { question: "q2 (errored, e.g. quota exhausted)", retrievalHit: false, faithful: false, answer: "", error: "429" },
    ];

    // Only q1 was actually evaluated -- rates should be 100%, not 50%
    // (which is what you'd get if the errored case were counted as a miss).
    expect(summarize(results)).toEqual({
      hitRate: 100,
      faithfulnessRate: 100,
      evaluatedCount: 1,
      erroredCount: 1,
    });
  });

  it("returns 0/0 rates (not NaN) when every case errored", () => {
    const results = [
      { question: "q1", retrievalHit: false, faithful: false, answer: "", error: "429" },
      { question: "q2", retrievalHit: false, faithful: false, answer: "", error: "429" },
    ];

    expect(summarize(results)).toEqual({ hitRate: 0, faithfulnessRate: 0, evaluatedCount: 0, erroredCount: 2 });
  });
});

describe("loadEvalSet", () => {
  it("the real tests/fixtures/eval-set.json parses into a well-formed, non-trivial EvalCase[]", () => {
    const cases = loadEvalSet("tests/fixtures/eval-set.json");

    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(15);
    for (const c of cases) {
      expect(typeof c.question).toBe("string");
      expect(c.question.length).toBeGreaterThan(0);
      expect(typeof c.expectedChunkId).toBe("string");
      expect(typeof c.expectedAnswerContains).toBe("string");
    }
  });
});

describe("runEval", () => {
  let tmpDir: string;

  function writeFixture(cases: EvalCase[]): string {
    tmpDir = mkdtempSync(path.join(tmpdir(), "eval-test-"));
    const fixturePath = path.join(tmpDir, "eval-set.json");
    writeFileSync(fixturePath, JSON.stringify(cases));
    return fixturePath;
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("evaluates every case in the fixture and returns one result per case", async () => {
    mockChunkLookup({ "chunk-1": "x", "chunk-2": "y" });
    mockRetrieve.mockResolvedValue([]);
    mockRunAgentLoop.mockResolvedValue({ answer: "some answer", sources: [] });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const fixturePath = writeFixture([
      { question: "q1", expectedChunkId: "chunk-1", expectedAnswerContains: "x" },
      { question: "q2", expectedChunkId: "chunk-2", expectedAnswerContains: "y" },
    ]);

    const results = await runEval(fixturePath, TEST_USER_ID);

    expect(results).toHaveLength(2);
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(2);
  });

  it("respects the limit parameter, running only the first N cases", async () => {
    mockChunkLookup({ "chunk-1": "x", "chunk-2": "y", "chunk-3": "z" });
    mockRetrieve.mockResolvedValue([]);
    mockRunAgentLoop.mockResolvedValue({ answer: "some answer", sources: [] });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const fixturePath = writeFixture([
      { question: "q1", expectedChunkId: "chunk-1", expectedAnswerContains: "x" },
      { question: "q2", expectedChunkId: "chunk-2", expectedAnswerContains: "y" },
      { question: "q3", expectedChunkId: "chunk-3", expectedAnswerContains: "z" },
    ]);

    const results = await runEval(fixturePath, TEST_USER_ID, 1);

    expect(results).toHaveLength(1);
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
  });
});
