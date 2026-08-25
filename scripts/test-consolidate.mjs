import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recall } from "../dist/codex/capture.js";
import { consolidationNudge, consolidateMemory, prepareConsolidationBatch } from "../dist/consolidate.js";
import { loadConfig } from "../dist/config.js";
import { answerMemory } from "../dist/memory-query.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-consolidate-test-"));
process.env.PATHMARK_STORE_DIR = temp;

try {
  const config = loadConfig();
  assert.equal(config.codexProactiveConsolidation, true);
  assert.equal(config.consolidationMinEvidence, 8);
  const store = new PathmarkStore(config);
  assert.equal((await consolidateMemory(store, config)).status, "scope_required");
  await store.addRecords([
    evidence("user-decision", "The deployment decision is to require signed artifacts.", "role-user", "2026-08-20T00:00:00.000Z"),
    evidence("assistant-confirmation", "Confirmed: releases require signed artifacts.", "role-assistant", "2026-08-20T00:01:00.000Z"),
    evidence("user-preference", "I prefer quiet native interfaces with minimal chrome.", "role-user", "2026-08-20T00:02:00.000Z"),
    evidence("assistant-preference", "The durable UI preference is quiet native surfaces.", "role-assistant", "2026-08-20T00:03:00.000Z"),
    evidence(
      "internal-suggestion-prompt",
      "# Overview\n\nGenerate 0 to 3 hyperpersonalized suggestions for this user.",
      "role-user",
      "2026-08-20T00:03:30.000Z",
    ),
    {
      ...evidence("activity", "ran tests", "role-tool", "2026-08-20T00:04:00.000Z"),
      tags: ["workspace:consolidate", "project:consolidate", "pathmark-activity", "role-tool"],
      activity: {
        type: "tool",
        toolName: "exec",
        status: "success",
        filesChanged: false,
      },
    },
  ]);

  const batch = await prepareConsolidationBatch(store, {
    tags: ["workspace:consolidate"],
    days: 30,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(batch.backlogCount, 4);
  assert.equal(batch.evidence.length, 4);
  assert.equal(batch.evidence.some((record) => record.id === "activity"), false);
  assert.equal(consolidationNudge(batch, 4).includes('"tags":["workspace:consolidate"]'), true);
  assert.equal(consolidationNudge(batch, 5), "");
  process.env.PATHMARK_CONSOLIDATION_MIN_EVIDENCE = "4";
  const sessionContext = await recall({ cwd: "/workspace/consolidate", session_id: "new-session" });
  delete process.env.PATHMARK_CONSOLIDATION_MIN_EVIDENCE;
  assert.equal(sessionContext.includes("mcp__pathmark__consolidate_memory"), true);

  const clientResult = await consolidateMemory(store, config, {
    tags: ["workspace:consolidate"],
    days: 30,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(clientResult.status, "client_synthesis_required");

  const executable = path.join(temp, "fake-consolidator.mjs");
  await writeFile(
    executable,
    [
      "#!/usr/bin/env node",
      'process.stdout.write(JSON.stringify({ conclusions: [{ text: "Releases require signed artifacts.", tags: ["decision"], evidenceIds: ["user-decision", "assistant-confirmation"], confidence: 0.96 }] }));',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(executable, 0o755);
  const synthesisConfig = { ...config, synthesisProvider: "command", chatCommand: executable };
  const preview = await consolidateMemory(store, synthesisConfig, {
    tags: ["workspace:consolidate"],
    days: 30,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(preview.status, "preview");
  assert.equal(preview.proposals.length, 1);
  assert.deepEqual(preview.proposals[0].evidenceIds, ["user-decision", "assistant-confirmation"]);

  const applied = await consolidateMemory(store, synthesisConfig, {
    tags: ["workspace:consolidate"],
    days: 30,
    apply: true,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(applied.status, "staged_pending_approval");
  assert.equal(applied.staged.length, 1);
  assert.equal(applied.staged[0].record.approval.status, "pending");
  assert.deepEqual(applied.staged[0].record.evidenceIds, ["user-decision", "assistant-confirmation"]);

  const after = await prepareConsolidationBatch(store, {
    tags: ["workspace:consolidate"],
    days: 30,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(after.backlogCount, 2);
  assert.equal(after.alreadyReferencedCount, 2);

  await store.add({
    id: "approved-chat-intent",
    kind: "conclusion",
    text: "Signed artifacts are required for releases.",
    tags: ["workspace:consolidate", "approval-approved"],
    source: "test",
  });
  const conclusionChat = await answerMemory(store, config, "What is required for signed artifact releases?", {
    tags: ["workspace:consolidate"],
  });
  assert.equal(conclusionChat.retrievalMode, "approved_conclusions");
  assert.deepEqual(conclusionChat.usedMemories.map((memory) => memory.id), ["approved-chat-intent"]);

  const rawChat = await answerMemory(store, config, "quiet native interfaces preference", {
    tags: ["workspace:consolidate"],
  });
  assert.equal(rawChat.retrievalMode, "raw_evidence_fallback");
  assert.equal(
    rawChat.usedMemories.some((memory) => memory.id === "user-preference" || memory.id === "assistant-preference"),
    true,
  );

  console.log("Consolidation and memory chat tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}

function evidence(id, text, role, createdAt) {
  return {
    id,
    kind: "memory",
    text,
    tags: ["workspace:consolidate", "project:consolidate", role, "session:consolidate-session"],
    source: "codex:session:consolidate-session",
    createdAt,
    updatedAt: createdAt,
  };
}
