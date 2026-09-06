// Phase 6: run the full pipeline against tests/fixtures/eval-set.json
// and print a hit-rate / faithfulness summary.
//
// TODO:
//   1. Load eval-set.json
//   2. For each item, call retrieve(question) and check whether
//      expectedChunkId is in the top-k results -> hit rate
//   3. Call the full chat pipeline and check whether the answer contains
//      expectedAnswerContains -> rough faithfulness rate
//   4. Print a summary table

console.log("Not implemented yet — see docs/phase-6-eval-harness.md");
