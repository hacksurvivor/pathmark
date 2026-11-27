import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../dist/config.js";
import { dreamMemory } from "../dist/dream.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-dream-test-"));
const recent = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

try {
  // --- dream: consolidate, auto-approve owner-backed facts, replace contradicted ones, remember what was reviewed ---
  process.env.PATHMARK_STORE_DIR = path.join(temp, "dream");
  const config = loadConfig();
  const store = new PathmarkStore(config);
  const calls = path.join(temp, "calls.log");
  const fake = path.join(temp, "fake-dreamer.mjs");
  await writeFile(
    fake,
    [
      "#!/usr/bin/env node",
      'import { appendFileSync, readFileSync } from "node:fs";',
      'const input = readFileSync(0, "utf8");',
      `appendFileSync(${JSON.stringify(calls)}, "call\\n");`,
      "const out = [];",
      'if (input.includes("owner-deploy")) out.push({ text: "Deploys of alpha go through the staging branch first (2026-11-27).", tags: ["decision"], evidenceIds: ["owner-deploy"], confidence: 0.95, supersedes: null });',
      'if (input.includes("agent-claim")) out.push({ text: "Alpha builds take about four minutes (2026-11-27).", tags: ["gotcha"], evidenceIds: ["agent-claim"], confidence: 0.95, supersedes: null });',
      'if (input.includes("owner-region")) out.push({ text: "Alpha runs in the Frankfurt region now (2026-11-27).", tags: ["architecture"], evidenceIds: ["owner-region"], confidence: 0.93, supersedes: "old-region" });',
      'if (input.includes("agent-db")) out.push({ text: "Alpha uses Postgres 17 (2026-11-27).", tags: ["architecture"], evidenceIds: ["agent-db"], confidence: 0.9, supersedes: "old-db" });',
      'if (input.includes("bad-ids")) out.push({ text: "Should be dropped: cites unknown evidence.", tags: [], evidenceIds: ["not-in-batch"], confidence: 0.99 });',
      'if (input.includes("low-confidence")) out.push({ text: "Should be dropped: confidence too low.", tags: [], evidenceIds: ["low-confidence"], confidence: 0.5 });',
      "process.stdout.write(JSON.stringify({ conclusions: out }));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fake, 0o755);
  const dreamConfig = { ...config, synthesisProvider: "command", chatCommand: fake, retentionDays: 0 };

  await store.addRecords([
    { id: "old-region", kind: "conclusion", text: "Alpha runs in the Paris region.", tags: ["project:alpha", "approval-approved"], source: "test", approval: { status: "approved", proposedAt: recent(9000), decidedAt: recent(9000) }, evidenceIds: ["legacy"] },
    { id: "old-db", kind: "conclusion", text: "Alpha uses Postgres 15.", tags: ["project:alpha", "approval-approved"], source: "test", approval: { status: "approved", proposedAt: recent(9000), decidedAt: recent(9000) }, evidenceIds: ["legacy"] },
    { id: "owner-deploy", kind: "memory", text: "From now on alpha deploys go through staging first.", tags: ["project:alpha", "role-user", "codex-raw"], source: "test", createdAt: recent(50) },
    { id: "agent-claim", kind: "memory", text: "The alpha build took four minutes.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(49) },
    { id: "owner-region", kind: "memory", text: "We moved alpha to Frankfurt.", tags: ["project:alpha", "role-user", "codex-raw"], source: "test", createdAt: recent(48) },
    { id: "agent-db", kind: "memory", text: "Upgraded alpha to Postgres 17.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(47) },
    { id: "bad-ids", kind: "memory", text: "Some chatter about alpha.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(46) },
    { id: "low-confidence", kind: "memory", text: "Maybe alpha needs a cache.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(45) },
    { id: "beta-one", kind: "memory", text: "Beta note one.", tags: ["project:beta", "role-user", "codex-raw"], source: "test", createdAt: recent(44) },
    { id: "beta-two", kind: "memory", text: "Beta note two.", tags: ["project:beta", "role-user", "codex-raw"], source: "test", createdAt: recent(43) },
    { id: "gamma-only", kind: "memory", text: "A single gamma note.", tags: ["project:gamma", "role-user", "codex-raw"], source: "test", createdAt: recent(42) },
    { id: "too-old", kind: "memory", text: "An alpha note from long ago.", tags: ["project:alpha", "role-user", "codex-raw"], source: "test", createdAt: "2025-01-01T00:00:00.000Z" },
  ]);

  assert.equal((await dreamMemory(store, config, {})).status, "synthesis_provider_required");

  const preview = await dreamMemory(store, dreamConfig, { autoApprove: true });
  assert.equal(preview.status, "preview");
  const conclusionsAfterPreview = await store.all({ kind: "conclusion" });
  assert.equal(conclusionsAfterPreview.length, 2, "a preview writes nothing");
  const previewAlpha = preview.projects.find((project) => project.project === "project:alpha");
  assert.deepEqual(previewAlpha.changes.map((change) => change.action).sort(), ["approved", "pending", "pending", "superseded"]);
  assert.ok(!preview.projects.some((project) => project.project === "project:gamma"), "projects under minEvidence wait");
  await assert.rejects(readFile(path.join(config.storeDir, "dream-state.json"), "utf8"), "a preview keeps no state");

  const applied = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["alpha", "beta"] });
  assert.equal(applied.status, "applied");
  const alpha = applied.projects.find((project) => project.project === "project:alpha");
  assert.equal(alpha.evidenceReviewed, 6, "evidence older than the window is skipped");
  const live = (await store.all({ kind: "conclusion" })).filter((record) => !record.deletedAt);
  const byText = (needle) => live.find((record) => record.text.includes(needle));
  assert.equal(byText("staging branch").approval.status, "approved", "owner-backed and confident: auto-approved");
  assert.equal(byText("staging branch").approval.decidedBy, "pathmark dream");
  assert.equal(byText("four minutes").approval.status, "pending", "an agent's claim waits for review");
  const frankfurt = byText("Frankfurt");
  assert.equal(frankfurt.approval.status, "approved");
  assert.equal(frankfurt.supersedes, "old-region");
  const oldRegion = (await store.all({ kind: "conclusion", includeDeleted: true })).find((record) => record.id === "old-region");
  assert.ok(oldRegion.deletedAt && oldRegion.supersededBy === frankfurt.id, "the contradicted fact is retired, history kept");
  const postgres = byText("Postgres 17");
  assert.equal(postgres.approval.status, "pending", "an approved fact is replaced by an agent claim only after review");
  assert.equal(postgres.supersedes, "old-db");
  assert.ok(byText("Postgres 15"), "the old fact stays until the replacement is approved");
  assert.ok(!byText("Should be dropped"), "unknown evidence ids and low confidence are rejected");
  const digest = await readFile(applied.digestFile, "utf8");
  assert.match(digest, /## alpha/);
  assert.match(digest, /was: Alpha runs in the Paris region\./);

  const callsAfterFirst = (await readFile(calls, "utf8")).split("\n").filter(Boolean).length;
  const second = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["alpha", "beta"] });
  const callsAfterSecond = (await readFile(calls, "utf8")).split("\n").filter(Boolean).length;
  assert.equal(callsAfterSecond, callsAfterFirst, "reviewed evidence, even with nothing kept (beta), is not read again");
  assert.equal(second.projects.length, 0);

  const noAuto = new PathmarkStore({ ...config, storeDir: path.join(temp, "noauto"), memoryFile: path.join(temp, "noauto", "memory.jsonl") });
  await noAuto.addRecords([
    { id: "owner-deploy", kind: "memory", text: "From now on alpha deploys go through staging first.", tags: ["project:alpha", "role-user", "codex-raw"], source: "test", createdAt: recent(5) },
    { id: "agent-claim", kind: "memory", text: "The alpha build took four minutes.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(4) },
  ]);
  await dreamMemory(noAuto, { ...dreamConfig, storeDir: path.join(temp, "noauto"), dreamAutoApprove: false }, { apply: true });
  assert.ok((await noAuto.all({ kind: "conclusion" })).every((record) => record.approval.status === "pending"), "auto-approval is off by default");

  // --- merge: the newer version wins, tombstones travel ---
  process.env.PATHMARK_STORE_DIR = path.join(temp, "merge-a");
  const storeA = new PathmarkStore(loadConfig());
  process.env.PATHMARK_STORE_DIR = path.join(temp, "merge-b");
  const storeB = new PathmarkStore(loadConfig());
  const shared = [
    { id: "shared-conclusion", kind: "conclusion", text: "Shared proposal.", tags: ["project:alpha"], source: "test", createdAt: recent(100), approval: { status: "pending", proposedAt: recent(100) } },
    { id: "shared-note", kind: "memory", text: "Shared note.", tags: ["project:alpha"], source: "test", createdAt: recent(100) },
    { id: "b-newer", kind: "memory", text: "Original text.", tags: ["project:alpha"], source: "test", createdAt: recent(100) },
  ];
  await storeA.addRecords(shared);
  await storeB.addRecords(shared);
  await storeA.decideConclusion("shared-conclusion", "approved", { decidedBy: "owner" });
  await storeA.delete("shared-note");
  await storeA.addRecords([{ id: "a-only", kind: "memory", text: "Only on A.", tags: [], source: "test" }]);
  await storeB.update("b-newer", { text: "Edited on B later." });
  const exportFile = path.join(temp, "a-export.jsonl");
  await storeA.exportTo(exportFile, { includeDeleted: true });
  const exported = (await readFile(exportFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const merged = await storeB.mergeRecords(exported);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 2);
  assert.equal((await storeB.get("shared-conclusion")).approval.status, "approved", "an approval reaches the other copy");
  assert.equal(await storeB.get("shared-note"), undefined, "a delete reaches the other copy");
  assert.equal((await storeB.get("b-newer")).text, "Edited on B later.", "an older version never overwrites a newer one");
  assert.deepEqual(await storeB.mergeRecords(exported), { added: 0, updated: 0, unchanged: exported.length }, "a merge is safe to repeat");

  // --- compact: retention removes old automatic capture only; cited evidence and saved memories stay ---
  process.env.PATHMARK_STORE_DIR = path.join(temp, "compact");
  const compactStore = new PathmarkStore(loadConfig());
  const old = "2025-01-01T00:00:00.000Z";
  await compactStore.addRecords([
    { id: "old-raw", kind: "memory", text: "Old raw capture.", tags: ["codex-raw"], source: "test", createdAt: old, updatedAt: old },
    { id: "old-cited", kind: "memory", text: "Old raw capture a conclusion cites.", tags: ["codex-raw"], source: "test", createdAt: old, updatedAt: old },
    { id: "old-saved", kind: "memory", text: "A memory saved on purpose long ago.", tags: ["decision"], source: "test", createdAt: old, updatedAt: old },
    { id: "citing", kind: "conclusion", text: "A conclusion with old evidence.", tags: [], source: "test", approval: { status: "approved", proposedAt: old }, evidenceIds: ["old-cited"] },
    { id: "recently-deleted", kind: "memory", text: "Deleted today.", tags: [], source: "test" },
  ]);
  await compactStore.delete("recently-deleted");
  const kept = await compactStore.compact({ dryRun: false, retentionDays: 30, tombstoneDays: 30 });
  assert.equal(kept.removedRecords, 1);
  const all = await compactStore.all({ includeDeleted: true });
  assert.deepEqual(all.map((record) => record.id).sort(), ["citing", "old-cited", "old-saved", "recently-deleted"]);
  await compactStore.compact({ dryRun: false, retentionDays: 30, tombstoneDays: 0 });
  assert.ok(!(await compactStore.all({ includeDeleted: true })).some((record) => record.id === "recently-deleted"), "tombstoneDays 0 drops tombstones");

  console.log("dream, merge and retention tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
