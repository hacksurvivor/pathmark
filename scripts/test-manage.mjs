import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../dist/config.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-manage-"));
const sourceDir = path.join(temp, "source");
const targetDir = path.join(temp, "target");
const exportFile = path.join(temp, "scope.jsonl");

try {
  process.env.PATHMARK_STORE_DIR = sourceDir;
  const source = new PathmarkStore(loadConfig());
  await source.add({ id: "manage-one", kind: "memory", text: "Managed scoped record", tags: ["namespace:managed"], source: "test" });
  await source.add({ id: "manage-other", kind: "memory", text: "Other scoped record", tags: ["namespace:other"], source: "test" });
  await source.proposeConclusion({
    id: "manage-pending",
    text: "Pending imported conclusion",
    tags: ["namespace:managed"],
    source: "test",
  });
  await source.proposeConclusion({
    id: "manage-rejected",
    text: "Rejected imported conclusion",
    tags: ["namespace:managed"],
    source: "test",
  });
  await source.decideConclusion("manage-rejected", "rejected", { decidedBy: "test" });

  const doctor = run(sourceDir, ["doctor"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).totalRecords, 4);

  const audit = run(sourceDir, ["audit", "--days=30", "--namespace=managed"]);
  assert.equal(audit.status, 0, audit.stderr);
  const auditPayload = JSON.parse(audit.stdout);
  assert.deepEqual(auditPayload.scope.tags, ["namespace:managed"]);
  assert.equal(auditPayload.inventory.rawEvidenceRecords, 1);
  assert.equal(auditPayload.precision.status, "unlabeled");

  const chat = run(sourceDir, ["chat", "Managed scoped record", "--namespace=managed"]);
  assert.equal(chat.status, 0, chat.stderr);
  const chatPayload = JSON.parse(chat.stdout);
  assert.equal(chatPayload.retrievalMode, "raw_evidence_fallback");
  assert.equal(chatPayload.usedMemories[0].id, "manage-one");
  assert.equal(typeof chatPayload.recallId, "string");

  const feedback = run(sourceDir, [
    "feedback",
    `--recall-id=${chatPayload.recallId}`,
    "--relevant=manage-one",
  ]);
  assert.equal(feedback.status, 0, feedback.stderr);
  assert.deepEqual(JSON.parse(feedback.stdout).relevantIds, ["manage-one"]);

  const labeledAudit = run(sourceDir, ["audit", "--days=30", "--namespace=managed"]);
  assert.equal(labeledAudit.status, 0, labeledAudit.stderr);
  assert.equal(JSON.parse(labeledAudit.stdout).precision.status, "labeled");

  const consolidation = run(sourceDir, ["consolidate", "--namespace=managed"]);
  assert.equal(consolidation.status, 0, consolidation.stderr);
  assert.equal(JSON.parse(consolidation.stdout).status, "no_evidence");

  const exported = run(sourceDir, ["export", `--output=${exportFile}`, "--namespace=managed"]);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(JSON.parse(exported.stdout).recordCount, 5);

  const imported = run(targetDir, ["import", exportFile, "--namespace=managed"]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).imported, 5);

  process.env.PATHMARK_STORE_DIR = targetDir;
  const target = new PathmarkStore(loadConfig());
  assert.deepEqual((await target.listConclusions({ status: "pending" })).map((record) => record.id), ["manage-pending"]);
  assert.deepEqual((await target.listConclusions({ status: "rejected" })).map((record) => record.id), ["manage-rejected"]);
  assert.equal((await target.search({ query: "imported conclusion" })).length, 0);

  const ingested = run(
    targetDir,
    ["ingest", "--client=opencode", "--namespace=managed"],
    JSON.stringify([{ role: "assistant", content: "Imported OpenCode answer", sessionId: "oc-one" }]),
  );
  assert.equal(ingested.status, 0, ingested.stderr);
  assert.equal(JSON.parse(ingested.stdout).imported, 1);

  const preview = run(targetDir, ["purge", "--namespace=managed"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).applied, false);
  const purge = run(targetDir, ["purge", "--namespace=managed", "--apply"]);
  assert.equal(purge.status, 0, purge.stderr);
  assert.equal(JSON.parse(purge.stdout).applied, true);

  console.log("Management CLI tests passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}

function run(storeDir, args, input) {
  return spawnSync(process.execPath, ["dist/index.js", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, PATHMARK_STORE_DIR: storeDir },
    input,
    encoding: "utf8",
  });
}
