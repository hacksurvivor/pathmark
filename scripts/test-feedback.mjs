import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditMemory } from "../dist/audit.js";
import { loadConfig } from "../dist/config.js";
import { recordRecallFeedback } from "../dist/feedback.js";
import { answerMemory } from "../dist/memory-query.js";
import { sessionTrace } from "../dist/session-trace.js";
import { PathmarkStore } from "../dist/store.js";

const storeDir = await mkdtemp(path.join(os.tmpdir(), "pathmark-feedback-test-"));
process.env.PATHMARK_STORE_DIR = storeDir;

try {
  const config = loadConfig();
  const store = new PathmarkStore(config);
  await store.addRecords([
    {
      id: "relevant-memory",
      kind: "memory",
      text: "The deployment preference is signed artifacts.",
      tags: ["workspace:feedback", "session:feedback-session", "role-user"],
      source: "feedback-test",
    },
    {
      id: "irrelevant-memory",
      kind: "memory",
      text: "The deployment preference includes a weekly status email.",
      tags: ["workspace:feedback", "session:feedback-session", "role-user"],
      source: "feedback-test",
    },
  ]);

  const chat = await answerMemory(store, config, "deployment preference signed artifacts status email", {
    tags: ["workspace:feedback", "session:feedback-session"],
    kind: "memory",
    limit: 2,
  });
  assert.equal(typeof chat.recallId, "string");
  assert.equal(chat.usedMemories.length, 2);

  const feedback = await recordRecallFeedback(store, config, {
    recallId: chat.recallId,
    relevantIds: ["relevant-memory"],
    irrelevantIds: ["irrelevant-memory"],
    note: "API key sk-test-feedback-secret should be redacted",
  });
  assert.deepEqual(feedback.relevantIds, ["relevant-memory"]);
  assert.equal(String(feedback.note).includes("sk-test-feedback-secret"), false);

  const audit = await auditMemory(store, { days: 30, tags: ["workspace:feedback"] });
  assert.equal(audit.precision.status, "labeled");
  assert.equal(audit.precision.value, 0.5);
  assert.equal(audit.precision.labeledReferences, 2);
  assert.equal(audit.precision.labelCoverage, 1);

  await assert.rejects(
    recordRecallFeedback(store, config, { recallId: chat.recallId }),
    /requires at least one relevant or irrelevant memory id/,
  );

  await assert.rejects(
    recordRecallFeedback(store, config, {
      recallId: chat.recallId,
      relevantIds: ["relevant-memory"],
      irrelevantIds: ["relevant-memory"],
    }),
    /both relevant and irrelevant/,
  );
  await assert.rejects(
    recordRecallFeedback(store, config, {
      recallId: chat.recallId,
      irrelevantIds: ["not-recalled"],
    }),
    /was not part of recall/,
  );

  await new Promise((resolve) => setTimeout(resolve, 2));
  await recordRecallFeedback(store, config, {
    recallId: chat.recallId,
    irrelevantIds: ["relevant-memory"],
  });
  const reratedAudit = await auditMemory(store, { days: 30, tags: ["workspace:feedback"] });
  assert.equal(reratedAudit.precision.value, 0);
  assert.equal(reratedAudit.precision.labeledReferences, 2);
  assert.equal(reratedAudit.precision.relevantReferences, 0);
  assert.equal(reratedAudit.precision.irrelevantReferences, 2);

  const trace = await sessionTrace(store, "feedback-session");
  const activityEntries = trace.entries.filter((entry) => entry.type === "recall" || entry.type === "recall_feedback");
  assert.deepEqual(activityEntries.map((entry) => entry.type), ["recall", "recall_feedback", "recall_feedback"]);
  assert.equal(activityEntries[1].recallId, chat.recallId);
  assert.deepEqual(activityEntries[1].relevantIds, ["relevant-memory"]);
  assert.deepEqual(activityEntries[2].irrelevantIds, ["relevant-memory"]);

  const readOnlyChat = await answerMemory(
    {
      search: async ({ kind }) =>
        kind === "conclusion"
          ? [
              {
                record: {
                  id: "read-only-conclusion",
                  kind: "conclusion",
                  text: "Read-only stores can still answer from approved conclusions.",
                  tags: ["approval-approved"],
                  source: "feedback-test",
                  createdAt: "2026-08-25T00:00:00.000Z",
                  updatedAt: "2026-08-25T00:00:00.000Z",
                },
                score: 1,
                matchedTerms: ["read", "only", "conclusions"],
              },
            ]
          : [],
      add: async () => {
        throw new Error("read-only store");
      },
    },
    config,
    "Can read-only stores answer from conclusions?",
  );
  assert.equal(readOnlyChat.answer, "Read-only stores can still answer from approved conclusions.");
  assert.equal(readOnlyChat.recallId, null);

  console.log("Recall feedback tests passed");
} finally {
  await rm(storeDir, { recursive: true, force: true });
}
