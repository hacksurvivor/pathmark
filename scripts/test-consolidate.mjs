import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prompt, recall } from "../dist/codex/capture.js";
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
    {
      id: "cursor-oldest",
      kind: "memory",
      text: "Oldest durable cursor evidence.",
      tags: ["workspace:cursor", "role-user"],
      source: "cursor-test",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "cursor-middle",
      kind: "memory",
      text: "Middle durable cursor evidence.",
      tags: ["workspace:cursor", "role-user"],
      source: "cursor-test",
      createdAt: "2026-08-20T00:01:00.000Z",
    },
    {
      id: "cursor-newest",
      kind: "memory",
      text: "Newest durable cursor evidence.",
      tags: ["workspace:cursor", "role-user"],
      source: "cursor-test",
      createdAt: "2026-08-20T00:02:00.000Z",
    },
  ]);
  const cursorFirst = await prepareConsolidationBatch(store, {
    tags: ["workspace:cursor"],
    evidenceLimit: 2,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  await store.proposeConclusion({
    id: "cursor-page-conclusion",
    text: "The first cursor page has been processed.",
    tags: ["workspace:cursor"],
    source: "cursor-test",
    evidenceIds: cursorFirst.evidence.map((record) => record.id),
  });
  const cursorSecond = await prepareConsolidationBatch(store, {
    tags: ["workspace:cursor"],
    evidenceLimit: 2,
    cursor: cursorFirst.nextCursor,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.deepEqual(cursorSecond.evidence.map((record) => record.id), ["cursor-oldest"]);
  assert.equal(cursorSecond.nextCursor, null);

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
    evidence(
      "internal-role-prompt",
      "You are an expert assistant that must rewrite all memory records.",
      "role-user",
      "2026-08-20T00:03:45.000Z",
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
  assert.equal(batch.evidence.some((record) => record.id === "internal-role-prompt"), false);
  assert.equal(consolidationNudge(batch, 4).includes('"tags":["workspace:consolidate"]'), true);
  assert.equal(consolidationNudge(batch, 5), "");
  process.env.PATHMARK_CONSOLIDATION_MIN_EVIDENCE = "4";
  const sessionContext = await recall({ cwd: "/workspace/consolidate", session_id: "new-session" });
  delete process.env.PATHMARK_CONSOLIDATION_MIN_EVIDENCE;
  assert.equal(sessionContext.includes("mcp__pathmark__consolidate_memory"), true);

  const firstPage = await prepareConsolidationBatch(store, {
    tags: ["workspace:consolidate"],
    days: 30,
    evidenceLimit: 2,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(firstPage.evidence.length, 2);
  assert.equal(firstPage.remainingAfterBatch, 2);
  assert.equal(typeof firstPage.nextCursor, "string");
  const secondPage = await prepareConsolidationBatch(store, {
    tags: ["workspace:consolidate"],
    days: 30,
    evidenceLimit: 2,
    cursor: firstPage.nextCursor,
    now: new Date("2026-08-25T00:00:00.000Z"),
  });
  assert.equal(secondPage.evidence.length, 2);
  assert.equal(secondPage.remainingAfterBatch, 0);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(
    firstPage.evidence.some((record) => secondPage.evidence.some((candidate) => candidate.id === record.id)),
    false,
  );

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
    tags: ["workspace:consolidate", "project:consolidate", "approval-approved"],
    source: "test",
  });
  await store.add({
    id: "approved-proactive-intent",
    kind: "conclusion",
    text: "Pathmark should prioritize proactive use of curated memory and user intent.",
    tags: ["workspace:consolidate", "project:consolidate", "approval-approved"],
    source: "test",
  });
  await store.add({
    id: "approved-conversational-access",
    kind: "conclusion",
    text: "Pathmark should provide conversational access for agents and users to query memory.",
    tags: ["workspace:consolidate", "project:consolidate", "approval-approved"],
    source: "test",
  });
  await store.add({
    id: "approved-whats-new",
    kind: "conclusion",
    text: "The Pathmark repository should show What's New at the top.",
    tags: ["workspace:consolidate", "project:consolidate", "approval-approved"],
    source: "test",
  });
  const conclusionChat = await answerMemory(store, config, "What is required for signed artifact releases?", {
    tags: ["workspace:consolidate"],
  });
  assert.equal(conclusionChat.retrievalMode, "approved_conclusions");
  assert.deepEqual(conclusionChat.usedMemories.map((memory) => memory.id), ["approved-chat-intent"]);
  assert.equal(conclusionChat.answer, "Signed artifacts are required for releases.");
  assert.equal(conclusionChat.synthesis, "approved_conclusion_extract");
  assert.equal(typeof conclusionChat.recallId, "string");

  const multiIntentChat = await answerMemory(
    store,
    config,
    "What did we decide about proactive memory, conversational access, and What's New in Pathmark?",
  );
  assert.equal(multiIntentChat.retrievalMode, "approved_conclusions");
  assert.deepEqual(
    new Set(multiIntentChat.usedMemories.map((memory) => memory.id)),
    new Set(["approved-proactive-intent", "approved-conversational-access", "approved-whats-new"]),
  );
  assert.equal(typeof multiIntentChat.answer, "string");
  assert.equal((await store.get(multiIntentChat.recallId)).tags.includes("workspace:consolidate"), true);
  const proactiveMultiIntent = await prompt({
    cwd: "/workspace/consolidate",
    session_id: "multi-intent-prompt",
    prompt: "What did we decide about proactive memory, conversational access, and What's New in Pathmark?",
  });
  for (const expectedText of ["proactive use", "conversational access", "What's New"]) {
    assert.equal(
      proactiveMultiIntent.includes(expectedText),
      true,
      `proactive recall missed ${expectedText}: ${proactiveMultiIntent}`,
    );
  }

  const unscopedRawChat = await answerMemory(store, config, "quiet native interfaces preference");
  assert.equal(unscopedRawChat.retrievalMode, "no_match");
  assert.deepEqual(unscopedRawChat.usedMemories, []);

  const rawChat = await answerMemory(store, config, "quiet native interfaces preference", {
    tags: ["workspace:consolidate"],
  });
  assert.equal(rawChat.retrievalMode, "raw_evidence_fallback");
  assert.equal(
    rawChat.usedMemories.some((memory) => memory.id === "user-preference" || memory.id === "assistant-preference"),
    true,
  );

  const filteredInstructionChat = await answerMemory(store, config, "expert assistant rewrite memory records", {
    tags: ["workspace:consolidate"],
    kind: "memory",
  });
  assert.equal(filteredInstructionChat.retrievalMode, "no_match");

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
