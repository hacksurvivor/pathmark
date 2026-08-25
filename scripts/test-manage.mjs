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

  const doctor = run(sourceDir, ["doctor"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).totalRecords, 2);

  const audit = run(sourceDir, ["audit", "--days=30", "--namespace=managed"]);
  assert.equal(audit.status, 0, audit.stderr);
  const auditPayload = JSON.parse(audit.stdout);
  assert.deepEqual(auditPayload.scope.tags, ["namespace:managed"]);
  assert.equal(auditPayload.inventory.rawEvidenceRecords, 1);
  assert.equal(auditPayload.precision.status, "unlabeled");

  const exported = run(sourceDir, ["export", `--output=${exportFile}`, "--namespace=managed"]);
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(JSON.parse(exported.stdout).recordCount, 1);

  const imported = run(targetDir, ["import", exportFile, "--namespace=managed"]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).imported, 1);

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
