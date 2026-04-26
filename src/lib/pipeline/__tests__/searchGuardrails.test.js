// /lib/pipeline/__tests__/searchGuardrails.test.js
//
// Integration tests for the search guardrail system.
// Run with: node --experimental-vm-modules node_modules/.bin/jest
// Or:       node lib/pipeline/__tests__/searchGuardrails.test.js (manual)
//
// These tests verify the guardrail rules without making any network requests.

import {
  SEARCH_BUDGET,
  allocateQuerySlots,
  deduplicateQueries,
  queryFingerprint,
  validateQueryPlan,
  classifyYield,
} from "../searchGuardrails.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  PASS: ${message}`);
}

function assertEqual(a, b, message) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`FAIL: ${message}\n  expected: ${sb}\n  got:      ${sa}`);
  console.log(`  PASS: ${message}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

function testBudgetConstants() {
  console.log("\n[Budget constants]");
  assert(SEARCH_BUDGET.maxQueriesPerRun > 0,     "maxQueriesPerRun is positive");
  assert(SEARCH_BUDGET.maxQueriesPerTheme > 0,   "maxQueriesPerTheme is positive");
  assert(SEARCH_BUDGET.minQueriesPerTheme > 0,   "minQueriesPerTheme is positive");
  assert(SEARCH_BUDGET.maxPostsPerQueryPerSub > 0,"maxPostsPerQueryPerSub is positive");
  assert(SEARCH_BUDGET.maxQueriesPerTheme <= SEARCH_BUDGET.maxQueriesPerRun,
    "maxQueriesPerTheme never exceeds maxQueriesPerRun");
  assert(Array.isArray(SEARCH_BUDGET.subreddits) && SEARCH_BUDGET.subreddits.length > 0,
    "subreddits is a non-empty array");
}

function testSlotAllocation() {
  console.log("\n[Slot allocation]");
  const budget = 10;

  // Basic: 3 equal-score themes
  {
    const themes = ["AI", "oil", "crypto"];
    const slots  = allocateQuerySlots(themes, [], budget);
    const total  = Object.values(slots).reduce((s, v) => s + v, 0);

    assert(total <= budget,                     "total slots never exceeds budget");
    assert(Object.keys(slots).length === 3,     "all themes get slots");
    for (const t of themes) {
      assert((slots[t] ?? 0) >= SEARCH_BUDGET.minQueriesPerTheme, `${t} gets minimum slots`);
      assert((slots[t] ?? 0) <= SEARCH_BUDGET.maxQueriesPerTheme, `${t} never exceeds max`);
    }
  }

  // Score weighting: high-score theme should get more slots
  {
    const themes = ["AI", "housing"];
    const scores = [90, 40];
    const slots  = allocateQuerySlots(themes, scores, budget);
    assert((slots["AI"] ?? 0) >= (slots["housing"] ?? 0),
      "higher-scored theme gets equal or more slots");
  }

  // Single theme: gets up to maxQueriesPerTheme, never more
  {
    const slots = allocateQuerySlots(["AI"], [], budget);
    assert((slots["AI"] ?? 0) <= SEARCH_BUDGET.maxQueriesPerTheme,
      "single theme never exceeds maxQueriesPerTheme");
  }

  // Many themes: total never exceeds budget
  {
    const themes = ["AI","oil","crypto","rates","biotech","banks","EV","gold","china","inflation","uranium","macro"];
    const slots  = allocateQuerySlots(themes, [], budget);
    const total  = Object.values(slots).reduce((s, v) => s + v, 0);
    assert(total <= budget, "many themes: total never exceeds budget");
  }

  // No themes
  {
    const slots = allocateQuerySlots([], [], budget);
    assertEqual(slots, {}, "empty themes → empty slots");
  }
}

function testQueryFingerprint() {
  console.log("\n[Query fingerprinting]");

  assertEqual(
    queryFingerprint("NVDA AI datacenter"),
    queryFingerprint("AI datacenter NVDA"),
    "word-order-independent fingerprint"
  );

  assertEqual(
    queryFingerprint("nvda ai"),
    queryFingerprint("NVDA AI"),
    "case-insensitive fingerprint"
  );

  assert(
    queryFingerprint("NVDA earnings") !== queryFingerprint("NVDA thesis"),
    "different queries have different fingerprints"
  );

  assertEqual(
    queryFingerprint("$NVDA earnings!"),
    queryFingerprint("NVDA earnings"),
    "punctuation stripped in fingerprint"
  );
}

function testQueryDeduplication() {
  console.log("\n[Query deduplication]");

  const queries = [
    { theme: "AI",  query: "NVDA AI datacenter",  source: "static" },
    { theme: "AI",  query: "AI datacenter NVDA",  source: "ai"     }, // duplicate
    { theme: "oil", query: "CVX oil thesis",       source: "static" },
    { theme: "oil", query: "oil CVX thesis",       source: "ai"     }, // duplicate
    { theme: "oil", query: "crude oil supply",     source: "static" }, // unique
  ];

  const result = deduplicateQueries(queries);
  assertEqual(result.length, 3, "deduplicates word-order variants");
  assert(result[0].query === "NVDA AI datacenter", "keeps first occurrence");
  assert(result[2].query === "crude oil supply",   "keeps unique queries");
}

function testValidation() {
  console.log("\n[Query plan validation]");

  // Valid plan
  {
    const plan = Array.from({ length: SEARCH_BUDGET.maxQueriesPerRun }, (_, i) => ({
      theme: `theme${i % 4}`,
      query: `query number ${i}`,
      source: "static",
    }));
    const errors = validateQueryPlan(plan);
    assertEqual(errors, [], "valid plan has no violations");
  }

  // Exceeds maxQueriesPerRun
  {
    const plan = Array.from({ length: SEARCH_BUDGET.maxQueriesPerRun + 1 }, (_, i) => ({
      theme: "AI", query: `query ${i}`, source: "static",
    }));
    const errors = validateQueryPlan(plan);
    assert(errors.length > 0, "too many queries is a violation");
  }

  // Single theme exceeds maxQueriesPerTheme
  {
    const plan = Array.from({ length: SEARCH_BUDGET.maxQueriesPerTheme + 1 }, (_, i) => ({
      theme: "AI", query: `AI query ${i}`, source: "static",
    }));
    const errors = validateQueryPlan(plan);
    assert(errors.some(e => e.includes("AI")), "per-theme overflow is a violation");
  }

  // Empty query string
  {
    const errors = validateQueryPlan([{ theme: "AI", query: "", source: "static" }]);
    assert(errors.some(e => e.includes("Empty")), "empty query is a violation");
  }
}

function testYieldClassification() {
  console.log("\n[Yield classification]");
  assertEqual(classifyYield(0),  "low",    "0 posts = low yield");
  assertEqual(classifyYield(2),  "low",    "2 posts = low yield");
  assertEqual(classifyYield(3),  "normal", "3 posts = normal yield");
  assertEqual(classifyYield(9),  "normal", "9 posts = normal yield");
  assertEqual(classifyYield(10), "high",   "10 posts = high yield");
  assertEqual(classifyYield(50), "high",   "50 posts = high yield");
}

// ─── Coverage balance test ────────────────────────────────────────────────────

function testCoverageBalance() {
  console.log("\n[Coverage balance]");

  const themes = ["AI", "oil", "uranium", "crypto", "rates"];
  const budget = SEARCH_BUDGET.maxQueriesPerRun;
  const slots  = allocateQuerySlots(themes, [], budget);

  // No theme should be starved (0 slots) unless budget is truly exhausted
  const zeroThemes = themes.filter(t => (slots[t] ?? 0) === 0);
  const minNeeded  = themes.length * SEARCH_BUDGET.minQueriesPerTheme;

  if (minNeeded <= budget) {
    assertEqual(zeroThemes.length, 0, "no theme is starved when budget allows minimums");
  } else {
    assert(true, "some themes may be starved when budget < themes × minimum (expected)");
  }

  // Max spread: difference between most and least allocated should be ≤ maxQueriesPerTheme
  const values = themes.map(t => slots[t] ?? 0);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values.filter(v => v > 0));
  assert(
    maxVal - minVal <= SEARCH_BUDGET.maxQueriesPerTheme,
    "slot spread stays within maxQueriesPerTheme"
  );
}

// ─── Run all tests ────────────────────────────────────────────────────────────

function runAll() {
  let passed = 0;
  let failed = 0;

  const suites = [
    testBudgetConstants,
    testSlotAllocation,
    testQueryFingerprint,
    testQueryDeduplication,
    testValidation,
    testYieldClassification,
    testCoverageBalance,
  ];

  for (const suite of suites) {
    try {
      suite();
      passed++;
    } catch (e) {
      console.error(`\n${e.message}`);
      failed++;
    }
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runAll();
