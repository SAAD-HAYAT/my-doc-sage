// Phase 6: runs the full pipeline against tests/fixtures/eval-set.json
// and prints a retrieval hit-rate / faithfulness summary.
//
// Each case's `expectedChunkId` is a real chunk UUID from the live
// `chunks` table (grab one via Supabase once you've uploaded notes) --
// resolved to that row's actual content here rather than baked into the
// fixture, so the check stays correct even if chunking output ever
// changes slightly. NOTE: chunk IDs are tied to the CURRENT database
// state -- if a document is deleted and re-uploaded, chunking assigns
// fresh UUIDs, and this fixture will need regenerating against the new
// ones (see the DB-only chunk-listing step in this phase's writeup).
//
// COST WARNING: this hits the real OpenRouter API once per case for
// retrieval (an embedding call) and up to ~4 more times for the full
// tool-calling/generation loop (lib/agent.ts) -- with 18 cases that's
// potentially 40-90+ real requests in one run, easily enough to exhaust
// this project's free-tier daily quota. Use EVAL_LIMIT=3 (see below) for
// a cheap smoke test before running the whole set.
//
// Uses relative imports (not the "@/..." alias) deliberately: this file
// runs directly via `tsx`, not through Next's/Vitest's alias resolution.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./load-env"; // must run before any import that reads process.env
import type { ChatMessage } from "../lib/openrouter";
import { runAgentLoop } from "../lib/agent";
import { retrieve } from "../lib/retrieval";
import { supabase } from "../lib/supabase";
import { tools } from "../lib/tools";

export type EvalCase = {
  question: string;
  expectedChunkId: string;
  expectedAnswerContains: string;
};

export type EvalCaseResult = {
  question: string;
  retrievalHit: boolean;
  faithful: boolean;
  answer: string;
  error?: string;
};

// How many top retrieve() results count as a "hit". Deliberately small
// (not the production default of 5): with only a handful of chunks
// currently uploaded, a generous k would make every case trivially a
// "hit" regardless of ranking quality and defeat the point of measuring
// this at all.
const RETRIEVAL_K = 3;

// Mirrors app/api/chat/route.ts's SYSTEM_PROMPT so the eval measures the
// same pipeline real users go through -- kept as a local copy rather than
// importing from route.ts, since Next route modules aren't meant to be
// imported as plain functions outside the framework.
const SYSTEM_PROMPT =
  "You are NotesRAG, an assistant that answers questions strictly from the user's uploaded notes. " +
  "Use the search_notes tool to find relevant passages before answering a question about the notes, " +
  "and list_documents for questions about what's been uploaded. Don't guess or use outside knowledge " +
  "— if the notes don't contain enough information after searching, say so plainly.";

async function resolveExpectedChunkText(chunkId: string): Promise<string> {
  const { data, error } = await supabase.from("chunks").select("content").eq("id", chunkId).single();
  if (error || !data) {
    throw new Error(`Could not resolve expectedChunkId "${chunkId}": ${error?.message ?? "no such chunk"}`);
  }
  return (data as { content: string }).content;
}

export async function evaluateCase(testCase: EvalCase): Promise<EvalCaseResult> {
  try {
    const expectedChunkText = await resolveExpectedChunkText(testCase.expectedChunkId);

    const retrieved = await retrieve(testCase.question, RETRIEVAL_K);
    const retrievalHit = retrieved.some((r) => r.chunkText === expectedChunkText);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: testCase.question },
    ];
    const { answer } = await runAgentLoop(messages, tools);

    const faithful = answer.toLowerCase().includes(testCase.expectedAnswerContains.toLowerCase());

    return { question: testCase.question, retrievalHit, faithful, answer };
  } catch (err) {
    // A single bad/misconfigured case (e.g. a stale expectedChunkId after
    // a re-upload) shouldn't abort the whole run -- report it as a failed
    // case with the reason, and keep going.
    return {
      question: testCase.question,
      retrievalHit: false,
      faithful: false,
      answer: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Rates are computed over cases that actually EVALUATED (no `error`) --
// a case that errored (e.g. the API quota ran out mid-run) never got a
// real chance to hit or be faithful, so counting it as a miss/fail would
// silently conflate "the pipeline got it wrong" with "we couldn't even
// ask," making the score look worse than the pipeline actually is.
export function summarize(results: EvalCaseResult[]): {
  hitRate: number;
  faithfulnessRate: number;
  evaluatedCount: number;
  erroredCount: number;
} {
  const evaluated = results.filter((r) => !r.error);
  const erroredCount = results.length - evaluated.length;
  const n = evaluated.length;
  const hits = evaluated.filter((r) => r.retrievalHit).length;
  const faithful = evaluated.filter((r) => r.faithful).length;
  return {
    hitRate: n === 0 ? 0 : (hits / n) * 100,
    faithfulnessRate: n === 0 ? 0 : (faithful / n) * 100,
    evaluatedCount: n,
    erroredCount,
  };
}

export function loadEvalSet(fixturePath: string): EvalCase[] {
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as EvalCase[];
}

function printReport(results: EvalCaseResult[]): void {
  console.log("\n# NotesRAG eval report\n");
  results.forEach((r, i) => {
    if (r.error) {
      console.log(`${i + 1}. [ERRORED -- not evaluated] ${r.question}`);
      console.log(`   error: ${r.error}`);
      return;
    }
    const hitMark = r.retrievalHit ? "HIT " : "MISS";
    const faithMark = r.faithful ? "PASS" : "FAIL";
    console.log(`${i + 1}. [retrieval ${hitMark}] [faithfulness ${faithMark}] ${r.question}`);
  });

  const { hitRate, faithfulnessRate, evaluatedCount, erroredCount } = summarize(results);
  const hits = results.filter((r) => !r.error && r.retrievalHit).length;
  const faithful = results.filter((r) => !r.error && r.faithful).length;
  console.log("\n---");
  if (erroredCount > 0) {
    console.log(`Errored (not evaluated): ${erroredCount}/${results.length} -- excluded from the rates below.`);
  }
  console.log(`Retrieval hit rate:  ${hitRate.toFixed(1)}% (${hits}/${evaluatedCount} evaluated)`);
  console.log(`Faithfulness rate:   ${faithfulnessRate.toFixed(1)}% (${faithful}/${evaluatedCount} evaluated)`);
}

export async function runEval(fixturePath: string, limit?: number): Promise<EvalCaseResult[]> {
  const allCases = loadEvalSet(fixturePath);
  const cases = typeof limit === "number" ? allCases.slice(0, limit) : allCases;

  const results: EvalCaseResult[] = [];
  for (const testCase of cases) {
    console.log(`Running: ${testCase.question}`);
    results.push(await evaluateCase(testCase));
  }

  printReport(results);
  return results;
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const fixturePath = path.resolve(process.cwd(), "tests/fixtures/eval-set.json");
  const limit = process.env.EVAL_LIMIT ? Number.parseInt(process.env.EVAL_LIMIT, 10) : undefined;
  runEval(fixturePath, limit).catch((err) => {
    console.error("Eval run failed:", err);
    process.exit(1);
  });
}
