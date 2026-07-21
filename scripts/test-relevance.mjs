import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { selectRelevantResults } from "../dist/relevance.js";
import { PathmarkStore } from "../dist/store.js";
import { tokenizeSearchText } from "../dist/tokenize.js";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-relevance-acceptance-"));
process.env.PATHMARK_STORE_DIR = storeDir;
const store = new PathmarkStore(loadConfig());
const at = "2026-07-21T00:00:00.000Z";

assert.doesNotThrow(() => tokenizeSearchText("constructor prototype toString"));

const records = [
  ["sovamax", "Alexandr confirmed that new SovaMax leads need company IDs before transfer into the ERP."],
  ["sovamax-noise", "The lead validation voice pilot uses a realtime model and a Czech reference implementation."],
  ["pathmark", "Pathmark visible recall showed the current prompt because the old flow reran retrieval after prompt capture."],
  ["pathmark-noise", "The current automation report is visible in the operations dashboard."],
  [
    "pathmark-transport-envelope",
    "# Files mentioned by the user:\nPathmark visible recall showed the current prompt and exact recall IDs.",
    ["role-user"],
  ],
  [
    "pathmark-progress-update",
    "I’m checking why Pathmark visible recall showed the current prompt and whether exact IDs were used.",
    ["role-assistant"],
  ],
  ["database", "We selected MySQL as the durable database for structured results before the later ERP migration."],
  ["database-noise", "We did not make any calls for this database, so replace the list if needed."],
  [
    "meetily",
    `Meetily transcription design uses a local-first desktop capture architecture with a separate speech-to-text worker. ${"Detailed implementation note. ".repeat(80)}`,
  ],
  ["meetily-transcription-noise", "Waiting for transcription after a ten-second phone call."],
  ["meetily-design-noise", "Apply the recommended design to the report template."],
  ["campaign", "The September target is 10,000 processed call results through Twilio, including no-answer and busy outcomes."],
  ["campaign-noise", "Twilio recording has a separate per-minute storage price."],
  ["activity-audit", "Nested activity inputs require recursive canonical hashing so different tool arguments remain auditable."],
  [
    "activity-skill-noise",
    "<skill>Nested activity inputs require recursive canonical hashing for the audit trail.</skill>",
    ["role-user"],
  ],
  [
    "activity-suggestion-noise",
    "# Overview\n\nGenerate 0 to 3 hyperpersonalized suggestions for nested activity inputs and canonical hashing.",
    ["role-user"],
  ],
  ["vague-naming-noise", "We need a totally new name and should collect good naming ideas."],
];

await store.addRecords(
  records.map(([id, text, tags = []]) => ({
    id,
    kind: "memory",
    text,
    tags: ["acceptance", ...tags],
    source: "relevance-acceptance",
    createdAt: at,
  })),
);

const cases = [
  { query: "What did Alexandr say about SovaMax leads and ERP?", expected: "sovamax", rejected: ["sovamax-noise"] },
  {
    query: "Why did Pathmark visible recall show the current prompt?",
    expected: "pathmark",
    rejected: ["pathmark-noise", "pathmark-transport-envelope", "pathmark-progress-update"],
  },
  { query: "Which database did we choose?", expected: "database", rejected: ["database-noise"] },
  {
    query: "Meetily transcription design",
    expected: "meetily",
    rejected: ["meetily-transcription-noise", "meetily-design-noise"],
  },
  { query: "10,000 calls September Twilio", expected: "campaign", rejected: ["campaign-noise"] },
  {
    query: "nested activity inputs canonical hashing",
    expected: "activity-audit",
    rejected: ["activity-skill-noise", "activity-suggestion-noise"],
  },
];

for (const testCase of cases) {
  const raw = await store.search({ query: testCase.query, tags: ["acceptance"], limit: 50 });
  const selected = selectRelevantResults(raw, testCase.query, 5);
  assert.equal(selected[0]?.record.id, testCase.expected, `wrong top result for: ${testCase.query}`);
  for (const rejected of testCase.rejected) {
    assert.equal(
      selected.some((result) => result.record.id === rejected),
      false,
      `admitted one-concept noise ${rejected} for: ${testCase.query}`,
    );
  }
}

const vagueRaw = await store.search({ query: "So, are we totally good?", tags: ["acceptance"], limit: 50 });
assert.equal(vagueRaw.some((result) => result.record.id === "vague-naming-noise"), true);
assert.deepEqual(selectRelevantResults(vagueRaw, "So, are we totally good?", 5), []);

console.log("Retrieval acceptance tests passed");
