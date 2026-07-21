import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { prompt } from "../dist/codex/capture.js";
import { installPathmarkMcp, pathmarkMcpStatus } from "../dist/codex/config-file.js";
import { loadConfig } from "../dist/config.js";
import { redactSecrets } from "../dist/redact.js";
import { decryptPortableExport } from "../dist/portable.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-hardening-"));
const originalStoreDir = process.env.PATHMARK_STORE_DIR;

try {
  testSecretRedaction();
  await testUnicodePromptRecall();
  await testCorruptJsonlRecovery();
  await testIndexedStore();
  await testBusyIndexIsNotRenamedAsCorrupt();
  await testLifecycleMaintenance();
  await testHybridReranker();
  await testEncryptedPortableExport();
  await testInstallerPreservesUserConfig();
  await testImporterUsesStoreLock();
  console.log("Hardening tests passed");
} finally {
  if (originalStoreDir === undefined) delete process.env.PATHMARK_STORE_DIR;
  else process.env.PATHMARK_STORE_DIR = originalStoreDir;
  await rm(temp, { recursive: true, force: true });
}

function testSecretRedaction() {
  const pem = [
    "-----BEGIN PRIVATE KEY-----",
    "FAKEFAKEFAKEFAKEFAKEFAKE",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const pemResult = redactSecrets(pem);
  assert.equal(pemResult.redacted, true);
  assert.equal(pemResult.text.includes("FAKEFAKEFAKEFAKEFAKEFAKE"), false);

  const unmatched = redactSecrets('PRIVATE_KEY="FAKEFAKEFAKEFAKEFAKEFAKE');
  assert.equal(unmatched.redacted, true);
  assert.equal(unmatched.text.includes("FAKEFAKEFAKEFAKEFAKEFAKE"), false);
}

async function testUnicodePromptRecall() {
  const storeDir = path.join(temp, "unicode");
  process.env.PATHMARK_STORE_DIR = storeDir;
  const store = new PathmarkStore(loadConfig());
  const cwd = "/workspace/pathmark";
  const workspaceTag = `workspace:${createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 12)}`;

  await store.addRecords([
    record({
      id: "relevant-russian",
      text: "Решение по аутентификации: использовать короткие сессии.",
      tags: [workspaceTag, "project:pathmark", "role-user"],
      at: "2026-01-01T00:00:00.000Z",
    }),
    record({
      id: "relevant-cjk",
      text: "用户认证方案使用短会话。",
      tags: [workspaceTag, "project:pathmark", "role-user"],
      at: "2026-01-02T00:00:00.000Z",
    }),
    ...Array.from({ length: 8 }, (_, index) =>
      record({
        id: `irrelevant-${index}`,
        text: `Unrelated workspace note number ${index}.`,
        tags: [workspaceTag, "project:pathmark", "role-user"],
        at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    ),
  ]);

  const russian = await prompt({ cwd, session_id: "russian-audit", prompt: "Что мы решили по аутентификации?" });
  assert.equal(russian.includes("Решение по аутентификации"), true);

  const cjk = await prompt({ cwd, session_id: "cjk-audit", prompt: "用户认证方案是什么？" });
  assert.equal(cjk.includes("用户认证方案"), true);
}

async function testCorruptJsonlRecovery() {
  const storeDir = path.join(temp, "corrupt");
  process.env.PATHMARK_STORE_DIR = storeDir;
  const store = new PathmarkStore(loadConfig());
  await store.add({ kind: "memory", text: "valid searchable record", source: "hardening-test" });
  await appendFile(path.join(storeDir, "memory.jsonl"), "{broken-json\n", "utf8");

  const results = await store.search({ query: "valid searchable" });
  assert.equal(results.some((result) => result.record.text === "valid searchable record"), true);
  assert.equal((await store.health()).invalidRecordCount, 1);
}

async function testIndexedStore() {
  const storeDir = path.join(temp, "indexed");
  process.env.PATHMARK_STORE_DIR = storeDir;
  await mkdir(storeDir, { recursive: true });
  const legacyIndex = path.join(storeDir, "memory.index.sqlite");
  await writeFile(legacyIndex, "legacy-index-sentinel", "utf8");
  const store = new PathmarkStore(loadConfig());
  await store.addRecords(
    Array.from({ length: 2_000 }, (_, index) =>
      record({
        id: `indexed-${index}`,
        text: `Indexed project decision number ${index}`,
        tags: ["project:indexed"],
        at: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
      }),
    ),
  );
  const results = await store.search({ query: "decision 1999", limit: 5 });
  assert.equal(results.some((result) => result.record.id === "indexed-1999"), true);
  assert.equal((await readdir(storeDir)).includes("memory.index.v4.sqlite"), true);
  assert.equal(await readFile(legacyIndex, "utf8"), "legacy-index-sentinel");
}

async function testBusyIndexIsNotRenamedAsCorrupt() {
  const storeDir = path.join(temp, "busy-index");
  process.env.PATHMARK_STORE_DIR = storeDir;
  const store = new PathmarkStore(loadConfig());
  await store.add({ id: "busy-one", kind: "memory", text: "busy index record", source: "hardening-test" });
  await store.search({ query: "busy index" });

  const indexFile = path.join(storeDir, "memory.index.v4.sqlite");
  const locker = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(${JSON.stringify(indexFile)}); db.exec("BEGIN EXCLUSIVE"); console.log("ready"); setTimeout(() => { db.exec("ROLLBACK"); db.close(); }, 250);`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const lockerExit = waitForExit(locker);
  await waitForOutput(locker, "ready");
  const parallel = new PathmarkStore(loadConfig());
  const results = await parallel.search({ query: "busy index" });
  assert.equal(results.length, 1);
  await lockerExit;
  assert.equal((await readdir(storeDir)).some((name) => name.includes(".corrupt-")), false);
}

async function testLifecycleMaintenance() {
  const storeDir = path.join(temp, "lifecycle");
  process.env.PATHMARK_STORE_DIR = storeDir;
  const store = new PathmarkStore(loadConfig());
  const first = await store.addRecord(
    { id: "lifecycle-one", kind: "memory", text: "Keep one exact memory", tags: ["namespace:test"], source: "hardening" },
    { dedupe: true },
  );
  const duplicate = await store.addRecord(
    { id: "lifecycle-two", kind: "memory", text: "Keep one exact memory", tags: ["namespace:test"], source: "other" },
    { dedupe: true },
  );
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.id, first.record.id);

  const updated = await store.update(first.record.id, { text: "Updated exact memory" });
  assert.equal(updated?.history?.[0]?.text, "Keep one exact memory");
  const replacement = await store.supersede(first.record.id, {
    kind: "conclusion",
    text: "Current exact memory",
    tags: ["namespace:test"],
    source: "hardening",
  });
  assert.equal(replacement?.supersedes, first.record.id);
  assert.equal((await store.get(first.record.id)) === undefined, true);

  await store.add({ id: "expired", kind: "memory", text: "Expired record", source: "hardening", expiresAt: "2020-01-01T00:00:00.000Z" });
  assert.equal((await store.search({ query: "Expired record" })).length, 0);
  const preview = await store.compact({ dryRun: true });
  assert.equal(preview.applied, false);
  assert.equal(preview.removedRecords >= 2, true);
  const compacted = await store.compact({ dryRun: false });
  assert.equal(compacted.applied, true);
  assert.equal(typeof compacted.backupFile, "string");
  assert.equal(await fileExists(compacted.backupFile), true);

  const purgePreview = await store.purge({ namespace: "test", dryRun: true });
  assert.equal(purgePreview.applied, false);
  const purged = await store.purge({ namespace: "test", dryRun: false });
  assert.equal(purged.applied, true);
  assert.equal((await store.all({ includeDeleted: true })).length, 0);
}

async function testHybridReranker() {
  const storeDir = path.join(temp, "hybrid");
  const reranker = path.join(temp, "fake-reranker.mjs");
  await writeFile(
    reranker,
    [
      "#!/usr/bin/env node",
      'let input = "";',
      "for await (const chunk of process.stdin) input += String(chunk);",
      "const payload = JSON.parse(input);",
      'const preferred = payload.candidates.find((candidate) => candidate.text.includes("PostgreSQL"));',
      "console.log(JSON.stringify([preferred.id, ...payload.candidates.filter((candidate) => candidate.id !== preferred.id).map((candidate) => candidate.id)]));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(reranker, 0o755);
  const previousCommand = process.env.PATHMARK_RERANK_COMMAND;
  try {
    process.env.PATHMARK_STORE_DIR = storeDir;
    process.env.PATHMARK_RERANK_COMMAND = reranker;
    const store = new PathmarkStore(loadConfig());
    await store.addRecords([
      { id: "hybrid-postgres", kind: "conclusion", text: "Persistence uses PostgreSQL.", source: "hardening" },
      { id: "hybrid-other", kind: "memory", text: "The interface uses dark colors.", source: "hardening" },
    ]);
    const results = await store.search({ query: "Which database engine did we choose?", limit: 1 });
    assert.equal(results[0]?.record.id, "hybrid-postgres");
    assert.equal(results[0]?.retrieval, "hybrid");
  } finally {
    if (previousCommand === undefined) delete process.env.PATHMARK_RERANK_COMMAND;
    else process.env.PATHMARK_RERANK_COMMAND = previousCommand;
  }
}

async function testEncryptedPortableExport() {
  const storeDir = path.join(temp, "encrypted-export");
  const destination = path.join(temp, "portable.pathmark");
  const previousKey = process.env.PATHMARK_EXPORT_KEY;
  try {
    process.env.PATHMARK_STORE_DIR = storeDir;
    process.env.PATHMARK_EXPORT_KEY = "hardening-passphrase";
    const store = new PathmarkStore(loadConfig());
    await store.add({ id: "encrypted-one", kind: "memory", text: "Private portable memory", source: "hardening" });
    await store.exportTo(destination, { encrypted: true });
    const encrypted = await readFile(destination, "utf8");
    assert.equal(encrypted.includes("Private portable memory"), false);
    const decrypted = await decryptPortableExport(encrypted, "hardening-passphrase");
    assert.equal(decrypted.includes("Private portable memory"), true);
    await assert.rejects(() => decryptPortableExport(encrypted, "wrong-passphrase"));
  } finally {
    if (previousKey === undefined) delete process.env.PATHMARK_EXPORT_KEY;
    else process.env.PATHMARK_EXPORT_KEY = previousKey;
  }
}

async function testInstallerPreservesUserConfig() {
  const dir = path.join(temp, "installer");
  const configPath = path.join(dir, "config.toml");
  await mkdir(dir, { recursive: true });
  await writeFile(
    configPath,
    [
      "[features]",
      "hooks = false",
      "",
      "[mcp_servers.pathmark]",
      'command = "custom-pathmark"',
      "",
      "[mcp_servers.pathmark.env]",
      'CUSTOM_KEEP = "yes"',
      'PATHMARK_SYNTHESIS_PROVIDER = "openai-compatible"',
      "",
    ].join("\n"),
    "utf8",
  );

  await installPathmarkMcp(configPath);
  const installed = await readFile(configPath, "utf8");
  assert.equal(installed.includes('command = "custom-pathmark"'), true);
  assert.equal(installed.includes('CUSTOM_KEEP = "yes"'), true);
  assert.equal(installed.includes('PATHMARK_SYNTHESIS_PROVIDER = "openai-compatible"'), true);
  assert.deepEqual(await pathmarkMcpStatus(configPath), { installed: true, hooksFeatureEnabled: true });
  assert.equal((await readdir(dir)).some((name) => name.startsWith("config.toml.backup-")), true);
}

async function testImporterUsesStoreLock() {
  const legacyDir = path.join(temp, "legacy-source");
  const storeDir = path.join(temp, "legacy-target");
  await mkdir(legacyDir, { recursive: true });
  await mkdir(storeDir, { recursive: true });
  await writeFile(
    path.join(legacyDir, "conclusions.jsonl"),
    `${JSON.stringify({ id: "legacy-one", text: "Imported conclusion", createdAt: "2026-01-01T00:00:00.000Z" })}\n`,
    "utf8",
  );
  await writeFile(path.join(storeDir, "memory.jsonl"), "", "utf8");

  const lockDir = path.join(storeDir, ".memory.lock");
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    path.join(lockDir, "owner.json"),
    `${JSON.stringify({ pid: process.pid, token: "hardening-lock", createdAtMs: Date.now() })}\n`,
    "utf8",
  );

  const locked = runImporter(legacyDir, storeDir, {
    PATHMARK_LOCK_TIMEOUT_MS: "50",
    PATHMARK_LOCK_RETRY_MS: "5",
    PATHMARK_STALE_LOCK_MS: "10000",
  });
  assert.notEqual(locked.status, 0, "Importer must honor the active Pathmark write lock");

  await rm(lockDir, { recursive: true, force: true });
  const imported = runImporter(legacyDir, storeDir);
  assert.equal(imported.status, 0, imported.stderr);
  const target = await readFile(path.join(storeDir, "memory.jsonl"), "utf8");
  assert.equal(target.includes("Imported conclusion"), true);
}

function runImporter(legacyDir, storeDir, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ["scripts/import-legacy-memory.mjs", "--source-dir", legacyDir, "--pathmark-dir", storeDir],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      timeout: 10_000,
    },
  );
}

function record({ id, text, tags, at }) {
  return {
    id,
    kind: "memory",
    text,
    tags,
    source: "codex:session:hardening",
    createdAt: at,
    updatedAt: at,
  };
}

function waitForOutput(child, expected) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for child output: ${stderr}`)), 3_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes(expected)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("close", (status) => (status === 0 ? resolve() : reject(new Error(`Child exited with ${status}`))));
    child.on("error", reject);
  });
}

async function fileExists(file) {
  if (!file) return false;
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}
