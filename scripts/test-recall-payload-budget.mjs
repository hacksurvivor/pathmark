import assert from "node:assert/strict";
import { summarizeSearch, usedMemories } from "../dist/format.js";

// Regression: recall payloads were unbounded in bytes.
// `limit` caps result COUNT, never SIZE, so a handful of large records
// produced 70k-125k character responses that blow past MCP output caps.
// `usedMemories` was already bounded (240-char previews); `summarizeSearch`
// interpolated `record.text` in full.

const at = "2026-08-05T00:00:00.000Z";
const huge = "x".repeat(20_000);

const results = Array.from({ length: 15 }, (_, index) => ({
  record: {
    id: `rec-${index}`,
    kind: "memory",
    text: `Record ${index} preamble. ${huge}`,
    tags: ["codex-raw", `session:${index}`],
    source: "test",
    createdAt: at,
    updatedAt: at,
    priority: 0,
  },
  score: 10 - index,
  matchedTerms: ["record"],
}));

// usedMemories is the canonical bounded view — assert it stays bounded.
const used = JSON.stringify(usedMemories(results));
assert.ok(used.length < 12_000, `usedMemories should stay bounded, got ${used.length}`);

// summarizeSearch must not emit full record text.
const context = summarizeSearch(results);
assert.ok(
  !context.includes(huge),
  "summarizeSearch must not interpolate full record text",
);
assert.ok(
  context.length < 20_000,
  `summarizeSearch should be bounded, got ${context.length}`,
);

// Every record must still be represented (bounding must not drop results).
for (let index = 0; index < results.length; index += 1) {
  assert.ok(context.includes(`rec-${index}`), `record rec-${index} missing from context`);
}

// Truncated entries must be marked so callers can tell text was elided.
assert.ok(context.includes("..."), "truncated text should carry an ellipsis marker");

console.log("recall payload budget: ok");
