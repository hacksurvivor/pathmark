import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditMemory } from "../dist/audit.js";
import { loadConfig } from "../dist/config.js";
import { PathmarkStore } from "../dist/store.js";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-audit-"));
process.env.PATHMARK_STORE_DIR = storeDir;

try {
  assert.equal(loadConfig().codexRawRecallDays, 30);
  assert.equal(loadConfig().codexRawRecallLimit, 2);
  process.env.PATHMARK_CODEX_RAW_RECALL_DAYS = "0";
  process.env.PATHMARK_CODEX_RAW_RECALL_LIMIT = "9";
  assert.equal(loadConfig().codexRawRecallDays, 0);
  assert.equal(loadConfig().codexRawRecallLimit, 2);
  delete process.env.PATHMARK_CODEX_RAW_RECALL_DAYS;
  delete process.env.PATHMARK_CODEX_RAW_RECALL_LIMIT;

  const store = new PathmarkStore(loadConfig());
  const scopedTags = ["workspace:audit", "codex-raw"];
  await store.addRecords([
    {
      id: "fresh-evidence",
      kind: "memory",
      text: "Fresh workspace evidence",
      tags: scopedTags,
      source: "audit-test",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "fresh-evidence-duplicate",
      kind: "memory",
      text: "Fresh workspace evidence",
      tags: scopedTags,
      source: "audit-test",
      createdAt: "2026-08-21T00:00:00.000Z",
    },
    {
      id: "stale-evidence",
      kind: "memory",
      text: "Stale workspace evidence",
      tags: scopedTags,
      source: "audit-test",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "approved-intent",
      kind: "conclusion",
      text: "Approved durable intent",
      tags: ["workspace:audit", "decision"],
      source: "audit-test",
      createdAt: "2026-08-10T00:00:00.000Z",
      evidenceIds: ["fresh-evidence"],
    },
    {
      id: "recall-event",
      kind: "memory",
      text: "Pathmark injected audit fixtures.",
      tags: ["workspace:audit", "pathmark-activity", "activity-recall", "role-tool"],
      source: "audit-test",
      createdAt: "2026-08-25T00:00:00.000Z",
      activity: {
        type: "recall",
        queryHash: "audit-query",
        memoryIds: ["fresh-evidence", "stale-evidence", "approved-intent", "missing-evidence"],
        memoryCount: 4,
      },
    },
  ]);

  const audit = await auditMemory(store, {
    days: 30,
    tags: ["workspace:audit"],
    rawRecallDays: 30,
    now: new Date("2026-08-25T12:00:00.000Z"),
  });
  assert.deepEqual(audit.scope, { tags: ["workspace:audit"] });
  assert.equal(audit.inventory.activeRecords, 5);
  assert.equal(audit.inventory.rawEvidenceRecords, 3);
  assert.equal(audit.inventory.activityRecords, 1);
  assert.equal(audit.inventory.approvedConclusions, 1);
  assert.equal(audit.inventory.exactDuplicateRecords, 1);
  assert.equal(audit.recall.events, 1);
  assert.equal(audit.recall.totalReferences, 4);
  assert.equal(audit.recall.scopedReferences, 3);
  assert.equal(audit.recall.missingReferences, 1);
  assert.equal(audit.recall.uniqueRecalledRecords, 3);
  assert.equal(audit.recall.notRecalledInWindow, 1);
  assert.equal(audit.recall.recordsCreatedInWindow, 3);
  assert.equal(audit.recall.createdAndRecalledInWindow, 2);
  assert.equal(audit.recall.staleRawReferences, 1);
  assert.equal(audit.recall.staleRawHitRate, 0.5);
  assert.equal(audit.inventory.evidenceBackedConclusions, 1);
  assert.equal(audit.synthesis.uniqueEvidenceReferenced, 1);
  assert.equal(audit.synthesis.unprocessedRawEvidenceRecords, 2);
  assert.equal(audit.synthesis.rawEvidenceConclusionCoverage, 0.3333);
  assert.equal(audit.precision.status, "unlabeled");
  assert.equal(audit.precision.value, null);

  console.log("Memory audit tests passed");
} finally {
  await rm(storeDir, { recursive: true, force: true });
}
