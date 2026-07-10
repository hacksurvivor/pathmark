import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prompt } from "../dist/codex/capture.js";
import { installPathmarkMcp, pathmarkMcpStatus } from "../dist/codex/config-file.js";
import { loadConfig } from "../dist/config.js";
import { redactSecrets } from "../dist/redact.js";
import { PathmarkStore } from "../dist/store.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "pathmark-hardening-"));
const originalStoreDir = process.env.PATHMARK_STORE_DIR;

try {
  testSecretRedaction();
  await testUnicodePromptRecall();
  await testCorruptJsonlRecovery();
  await testIndexedStore();
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
  assert.equal((await readdir(storeDir)).includes("memory.index.sqlite"), true);
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
