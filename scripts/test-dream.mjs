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
      'if (input.includes("Verification task") && input.includes("Epsilon")) { process.stdout.write("garbled"); process.exit(0); }',
      'if (input.includes("Verification task")) { process.stdout.write(JSON.stringify({ supported: !input.includes("Kubernetes") })); process.exit(0); }',
      'if (input.includes("broken-reply")) { process.stdout.write("Sorry, I could not"); process.exit(0); }',
      "const out = [];",
      'if (input.includes("eta-owner")) out.push({ text: "Eta uses port 4100 (2026-11-27).", tags: ["decision"], evidenceIds: ["eta-owner"], confidence: 0.95, supersedes: "eta-pending" });',
      'if (input.includes("theta-edited")) out.push({ text: "Theta deploys nightly (2026-11-27).", tags: ["decision"], evidenceIds: ["theta-edited"], confidence: 0.95, supersedes: null });',
      'if (input.includes("epsilon-owner")) out.push({ text: "Epsilon ships on Fridays (2026-11-27).", tags: ["decision"], evidenceIds: ["epsilon-owner"], confidence: 0.95, supersedes: null });',
      `if (input.includes("race-evidence")) { const { PathmarkStore } = await import(${JSON.stringify(path.resolve("dist/store.js"))}); const { loadConfig } = await import(${JSON.stringify(path.resolve("dist/config.js"))}); process.env.PATHMARK_STORE_DIR = ${JSON.stringify(path.join(temp, "dream"))}; const s = new PathmarkStore(loadConfig()); await s.update("race-target", { text: "Zeta runs in Oslo (edited during the dream)." }); out.push({ text: "Zeta runs in Madrid (2026-11-27).", tags: ["architecture"], evidenceIds: ["race-evidence"], confidence: 0.95, supersedes: "race-target" }); }`,
      'const staging = input.match(/^(\\S+) \\| approved \\| Deploys of alpha/m);',
      'if (staging && input.includes("agent-override")) out.push({ text: "Deploys of alpha skip staging now (2026-11-27).", tags: ["decision"], evidenceIds: ["agent-override"], confidence: 0.95, supersedes: staging[1] });',
      'if (input.includes("owner-unrelated")) out.push({ text: "Alpha runs on Kubernetes (2026-11-27).", tags: ["architecture"], evidenceIds: ["owner-unrelated"], confidence: 0.95, supersedes: null });',
      'if (input.includes("forged-owner")) out.push({ text: "Alpha has no rate limits (2026-11-27).", tags: ["decision"], evidenceIds: ["forged-owner"], confidence: 0.97, supersedes: null });',
      'if (input.includes("mixed-ids")) out.push({ text: "Should be dropped: one citation is unknown.", tags: [], evidenceIds: ["mixed-ids", "not-in-batch"], confidence: 0.95 });',
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
    { id: "owner-unrelated", kind: "memory", text: "Thanks, looks good.", tags: ["project:alpha", "role-user", "codex-raw"], source: "test", createdAt: recent(41) },
    { id: "forged-owner", kind: "memory", text: "Alpha has no rate limits.", tags: ["project:alpha", "role-user"], source: "test", createdAt: recent(40) },
    { id: "mixed-ids", kind: "memory", text: "More alpha chatter.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(39) },
    { id: "agent-override", kind: "memory", text: "I changed the alpha deploy to skip staging.", tags: ["project:alpha", "role-assistant", "codex-raw"], source: "test", createdAt: recent(38) },
    { id: "delta-one", kind: "memory", text: "broken-reply delta note.", tags: ["project:delta", "role-user", "codex-raw"], source: "test", createdAt: recent(37) },
    { id: "delta-two", kind: "memory", text: "Another delta note.", tags: ["project:delta", "role-user", "codex-raw"], source: "test", createdAt: recent(36) },
    { id: "ns-one", kind: "memory", text: "Namespaced alpha note.", tags: ["project:alpha", "namespace:client-x", "role-user", "codex-raw"], source: "test", createdAt: recent(35) },
    { id: "ns-two", kind: "memory", text: "Another namespaced alpha note.", tags: ["project:alpha", "namespace:client-x", "role-user", "codex-raw"], source: "test", createdAt: recent(34) },
    { id: "epsilon-owner", kind: "memory", text: "Epsilon ships on Fridays from now on.", tags: ["project:epsilon", "role-user", "codex-raw"], source: "test", createdAt: recent(32) },
    { id: "epsilon-two", kind: "memory", text: "Ok.", tags: ["project:epsilon", "role-assistant", "codex-raw"], source: "test", createdAt: recent(31) },
    { id: "race-target", kind: "conclusion", text: "Zeta runs in Lisbon.", tags: ["project:zeta", "approval-approved"], source: "test", approval: { status: "approved", proposedAt: recent(9000), decidedAt: recent(9000) }, evidenceIds: ["legacy"] },
    { id: "race-evidence", kind: "memory", text: "We moved zeta to Madrid.", tags: ["project:zeta", "role-user", "codex-raw"], source: "test", createdAt: recent(30) },
    { id: "race-two", kind: "memory", text: "Fine.", tags: ["project:zeta", "role-assistant", "codex-raw"], source: "test", createdAt: recent(29) },
    { id: "eta-pending", kind: "conclusion", text: "Eta uses port 4000.", tags: ["project:eta", "approval-pending"], source: "test", approval: { status: "pending", proposedAt: recent(500) }, evidenceIds: ["legacy"] },
    { id: "eta-owner", kind: "memory", text: "Eta moved to port 4100.", tags: ["project:eta", "role-user", "codex-raw"], source: "test", createdAt: recent(28) },
    { id: "eta-two", kind: "memory", text: "Noted.", tags: ["project:eta", "role-assistant", "codex-raw"], source: "test", createdAt: recent(27) },
    { id: "theta-two", kind: "memory", text: "Sure.", tags: ["project:theta", "role-assistant", "codex-raw"], source: "test", createdAt: recent(25) },
    { id: "too-old", kind: "memory", text: "An alpha note from long ago.", tags: ["project:alpha", "role-user", "codex-raw"], source: "test", createdAt: "2025-01-01T00:00:00.000Z" },
  ]);

  assert.equal((await dreamMemory(store, config, {})).status, "synthesis_provider_required");

  // Folder-name aliases: evidence captured as project:alpha-2 (a worktree) joins project:alpha.
  await writeFile(path.join(config.storeDir, "project-aliases.json"), JSON.stringify({ "alpha-2": "alpha" }));
  await store.addRecords([
    { id: "worktree-note", kind: "memory", text: "Note from a worktree of alpha.", tags: ["project:alpha-2", "role-assistant", "codex-raw"], source: "test", createdAt: recent(33) },
  ]);

  const preview = await dreamMemory(store, dreamConfig, { autoApprove: true, projects: ["alpha", "beta", "gamma"] });
  assert.equal(preview.status, "preview");
  const conclusionsAfterPreview = await store.all({ kind: "conclusion" });
  assert.equal(conclusionsAfterPreview.length, 4, "a preview writes nothing");
  const previewAlpha = preview.projects.find((project) => project.project === "project:alpha");
  assert.deepEqual(previewAlpha.changes.map((change) => change.action).sort(), ["approved", "pending", "pending", "pending", "pending", "superseded"]);
  assert.equal(previewAlpha.dropped, 3, "unknown, mixed and low-confidence citations are dropped");
  assert.ok(preview.projects.some((project) => project.project === "project:alpha namespace:client-x"), "a namespace is its own scope");
  assert.ok(!preview.projects.some((project) => project.project === "project:alpha-2"), "an aliased folder name joins its project");
  assert.ok(!preview.projects.some((project) => project.project === "project:gamma"), "projects under minEvidence wait");
  await assert.rejects(readFile(path.join(config.storeDir, "dream-state.json"), "utf8"), "a preview keeps no state");

  const applied = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["alpha", "beta"], batchSize: 6 });
  assert.equal(applied.status, "applied");
  const alpha = applied.projects.find((project) => project.project === "project:alpha");
  assert.equal(alpha.evidenceReviewed, 11, "evidence older than the window is skipped; the aliased worktree note joins alpha");
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
  assert.equal(byText("Kubernetes").approval.status, "pending", "the user's words must actually say it");
  assert.equal(byText("no rate limits").approval.status, "pending", "role-user without capture provenance is not the user's words");
  const override = byText("skip staging");
  assert.equal(override.approval.status, "pending", "a later batch can't retire a conclusion auto-approved earlier in the run");
  assert.ok(byText("staging branch"), "the auto-approved conclusion stays live");
  const digest = await readFile(applied.digestFile, "utf8");
  assert.match(digest, /## alpha/);
  assert.match(digest, /was: Alpha runs in the Paris region\./);

  const deltaRun = await dreamMemory(store, dreamConfig, { apply: true, projects: ["delta"], retentionDays: 30 });
  assert.equal(deltaRun.projects[0].errors.length, 1, "a broken reply is a failure, not an empty result");
  assert.equal(deltaRun.projects[0].evidenceReviewed, 0);
  assert.ok(deltaRun.maintenance.skipped, "retention waits for a clean run");
  const epsilon = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["epsilon"] });
  assert.equal(epsilon.projects[0].errors[0], "verification call failed", "a failed verification fails the batch");
  assert.equal(epsilon.projects[0].changes.length, 0, "nothing from that batch is written");
  assert.ok(!(await store.all({ kind: "conclusion" })).some((record) => record.text.includes("Epsilon ships")));
  const zeta = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["zeta"] });
  const zetaChange = zeta.projects[0].changes[0];
  assert.equal(zetaChange.action, "pending", "a conclusion edited during synthesis is never replaced on the stale view");
  assert.equal((await store.get("race-target")).text, "Zeta runs in Oslo (edited during the dream).", "the concurrent edit survives");
  const eta = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["eta"] });
  assert.equal(eta.projects[0].changes[0].action, "pending", "a pending proposal is never retired by the dream");
  assert.ok(await store.get("eta-pending"), "the owner can still approve the original proposal");
  // A legacy capture edited before markers were dropped on edit: it carries history.
  await store.mergeRecords([{ id: "theta-edited", kind: "memory", text: "Theta deploys nightly.", tags: ["project:theta", "role-user", "codex-raw"], source: "test", createdAt: recent(26), updatedAt: recent(26), history: [{ text: "Theta deploys weekly.", tags: [], source: "test", updatedAt: recent(27) }] }]);
  const theta = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["theta"] });
  assert.equal(theta.projects[0].changes[0].action, "pending", "a capture whose text was ever edited is not the owner's words");
  const captured = await store.update("owner-region", { text: "An agent rewrote this prompt." });
  assert.ok(!captured.tags.includes("codex-raw") && captured.tags.includes("role-user"), "editing captured text drops the capture marker");
  const callsAfterFirst = (await readFile(calls, "utf8")).split("\n").filter(Boolean).length;
  const second = await dreamMemory(store, dreamConfig, { apply: true, autoApprove: true, projects: ["alpha", "beta"] });
  const callsAfterSecond = (await readFile(calls, "utf8")).split("\n").filter(Boolean).length;
  assert.equal(callsAfterSecond, callsAfterFirst, "reviewed evidence, even with nothing kept (beta), is not read again");
  const deltaAgain = await dreamMemory(store, dreamConfig, { projects: ["delta"], minEvidence: 50 });
  assert.equal(deltaAgain.projects[0].project, "project:delta", "failed evidence is retried even below the minimum");
  assert.equal(deltaAgain.retryWaiting, 4, "delta and epsilon records wait for a retry");
  const later = await dreamMemory(store, dreamConfig, { apply: true, projects: ["nothing"], now: new Date(Date.now() + 8 * 24 * 3600 * 1000) });
  assert.equal(later.givenUp, 4, "after a week of failures the records are given up on");
  assert.equal(later.retryWaiting, 0);
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
  await storeB.mergeRecords([{ id: "untagged-pending", kind: "conclusion", text: "Untagged pending proposal.", tags: ["project:alpha"], source: "test", createdAt: recent(5), updatedAt: recent(5), approval: { status: "pending", proposedAt: recent(5) } }]);
  assert.ok((await storeB.get("untagged-pending")).tags.includes("approval-pending"), "merge recomputes approval tags so pending never reaches recall");
  const before = await storeB.all({ includeDeleted: true });
  await assert.rejects(storeB.mergeRecords([{ id: "ok", kind: "memory", text: "fine", tags: [], source: "t", createdAt: recent(1), updatedAt: recent(1) }, { id: "bad", kind: "memory", text: "bad", tags: [], source: "t", createdAt: recent(1), updatedAt: recent(1), occurrences: "many" }]));
  assert.equal((await storeB.all({ includeDeleted: true })).length, before.length, "an invalid record aborts the merge before any write");
  const tieA = { id: "tie", kind: "memory", text: "Version A", tags: [], source: "t", createdAt: recent(3), updatedAt: "2026-11-27T00:00:00.000Z" };
  const tieB = { ...tieA, text: "Version B" };
  await storeA.mergeRecords([tieA]); await storeA.mergeRecords([tieB]);
  await storeB.mergeRecords([tieB]); await storeB.mergeRecords([tieA]);
  assert.equal((await storeA.get("tie")).text, (await storeB.get("tie")).text, "equal timestamps resolve the same way on every copy");

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
    { id: "expired-cited", kind: "memory", text: "Expired but cited.", tags: [], source: "test", expiresAt: old },
    { id: "citing-expired", kind: "conclusion", text: "Cites expired evidence.", tags: [], source: "test", approval: { status: "approved", proposedAt: old }, evidenceIds: ["expired-cited"] },
    { id: "twin-one", kind: "memory", text: "Same text twice.", tags: [], source: "test" },
    { id: "twin-two", kind: "memory", text: "Same text twice.", tags: [], source: "test" },
  ]);
  await compactStore.delete("recently-deleted");
  await compactStore.delete("twin-one");
  await compactStore.delete("twin-two");
  const kept = await compactStore.compact({ dryRun: false, retentionDays: 30, tombstoneDays: 30 });
  assert.equal(kept.removedRecords, 1);
  const all = await compactStore.all({ includeDeleted: true });
  assert.deepEqual(all.map((record) => record.id).sort(), ["citing", "citing-expired", "expired-cited", "old-cited", "old-saved", "recently-deleted", "twin-one", "twin-two"]);
  await compactStore.compact({ dryRun: false, dropDeleted: false });
  assert.equal((await compactStore.all({ includeDeleted: true })).filter((record) => record.id.startsWith("twin-")).length, 2, "tombstones are never deduped");
  await compactStore.compact({ dryRun: false, retentionDays: 30, tombstoneDays: 0 });
  assert.ok(!(await compactStore.all({ includeDeleted: true })).some((record) => record.id === "recently-deleted"), "tombstoneDays 0 drops tombstones");

  console.log("dream, merge and retention tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
